const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('./database');
const { authMiddleware } = require('./auth');
const gitService = require('./git-service');
const dockerService = require('./docker-service');
const projectUpdateService = require('./project-update-service');

const router = express.Router();

router.use(authMiddleware);

router.get('/', (req, res) => {
  const projects = db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all();
  res.json(projects);
});

router.get('/:id', (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(project);
});

router.post('/', async (req, res) => {
  const { name, git_url, git_token, git_branch, compose_path, env_vars, container_name, reuse_volumes } = req.body;

  if (!name || !git_url) {
    return res.status(400).json({ error: 'Name and git_url are required' });
  }

  const result = db.prepare(`
    INSERT INTO projects (name, git_url, git_token, git_branch, compose_path, env_vars, container_name, reuse_volumes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    name,
    git_url,
    git_token || '',
    git_branch || 'main',
    compose_path || 'docker-compose.yml',
    JSON.stringify(env_vars || {}),
    container_name || '',
    reuse_volumes ? 1 : 0
  );

  try {
    db.prepare('UPDATE projects SET status = ? WHERE id = ?').run('cloning', result.lastInsertRowid);
    await gitService.cloneRepo(git_url, result.lastInsertRowid, git_branch || 'main', git_token || '');
    db.prepare('UPDATE projects SET status = ? WHERE id = ?').run('ready', result.lastInsertRowid);
    await projectUpdateService.updateCommitHash(result.lastInsertRowid);
  } catch (err) {
    db.prepare('UPDATE projects SET status = ? WHERE id = ?').run('error', result.lastInsertRowid);
  }

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(result.lastInsertRowid);
  res.json(project);
});

router.put('/:id', async (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const {
    name = project.name,
    git_url = project.git_url,
    git_token = project.git_token,
    git_branch = project.git_branch,
    compose_path = project.compose_path,
    env_vars,
    container_name,
    reuse_volumes
  } = req.body;

  const containerNameVal = container_name !== undefined ? container_name : project.container_name;
  const reuseVolumesVal = reuse_volumes !== undefined ? (reuse_volumes ? 1 : 0) : project.reuse_volumes;

  const repoChanged =
    git_url !== project.git_url ||
    git_branch !== project.git_branch ||
    git_token !== project.git_token;

  db.prepare(`
    UPDATE projects SET name=?, git_url=?, git_token=?, git_branch=?, compose_path=?,
    env_vars=?, container_name=?, reuse_volumes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?
  `).run(
    name, git_url, git_token, git_branch, compose_path,
    JSON.stringify(env_vars || (() => { try { return JSON.parse(project.env_vars); } catch { return {}; } })()),
    containerNameVal, reuseVolumesVal, req.params.id
  );

  if (repoChanged) {
    try {
      db.prepare('UPDATE projects SET status = ? WHERE id = ?').run('cloning', project.id);
      await gitService.cloneRepo(git_url, project.id, git_branch || 'main', git_token || '');
      db.prepare('UPDATE projects SET status = ? WHERE id = ?').run('ready', project.id);
      await projectUpdateService.updateCommitHash(project.id);
    } catch (err) {
      db.prepare('UPDATE projects SET status = ? WHERE id = ?').run('error', project.id);
      return res.status(500).json({ error: `Failed to re-clone repository: ${err.message}` });
    }
  }

  const updated = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  res.json(updated);
});

router.put('/:id/env', (req, res) => {
  const { env_vars } = req.body;
  if (!env_vars) return res.status(400).json({ error: 'env_vars is required' });

  db.prepare('UPDATE projects SET env_vars = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(JSON.stringify(env_vars), req.params.id);

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);

  // Sync the .env file to disk immediately
  try {
    const projectDir = path.join(
      process.env.DATA_DIR || path.join(__dirname, '..', 'data'),
      'projects',
      String(project.id)
    );
    const composePath = path.join(projectDir, project.compose_path);
    if (fs.existsSync(composePath)) {
      dockerService.ensureEnvFiles(projectDir, composePath);
    }

    let envStr = '';
    try {
      const parsed = JSON.parse(project.env_vars || '{}');
      for (const [key, value] of Object.entries(parsed)) {
        envStr += `${key}=${value}\n`;
      }
    } catch { /* ignore */ }
    fs.writeFileSync(path.join(projectDir, '.env'), envStr || '', 'utf-8');
  } catch { /* ignore — env file sync is best-effort */ }

  res.json(project);
});

router.delete('/:id', async (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  res.json({ message: 'Project deleted' });
});

router.post('/:id/deploy', async (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  try {
    db.prepare('UPDATE projects SET status = ? WHERE id = ?').run('deploying', project.id);

    try {
      await gitService.pullRepo(project.id, project.git_branch);
    } catch { /* pull failed, continue with existing code */ }

    const result = await dockerService.deployProject(project);
    db.prepare('UPDATE projects SET status = ? WHERE id = ?').run('running', project.id);
    await projectUpdateService.updateCommitHash(project.id);
    res.json({ message: 'Deployed successfully', output: result });
  } catch (err) {
    db.prepare('UPDATE projects SET status = ? WHERE id = ?').run('error', project.id);
    res.status(500).json({ error: err.message });
  }
});

// Rebuild: stop compose → prune all unused images → check for upstream
// updates (and pull them if any) → redeploy. Volumes are preserved.
// The status is flipped to 'rebuilding' synchronously at the very top so
// the UI sees immediate feedback even if the rebuild takes a long time.
router.post('/:id/rebuild', async (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  try {
    db.prepare('UPDATE projects SET status = ? WHERE id = ?').run('rebuilding', project.id);

    const result = await dockerService.rebuildProject(project);
    db.prepare('UPDATE projects SET status = ? WHERE id = ?').run('running', project.id);
    await projectUpdateService.updateCommitHash(project.id);
    res.json({
      message: 'Rebuilt successfully',
      output: result.stdout,
      update: result.update,
      localCommit: result.localCommit,
      remoteCommit: result.remoteCommit
    });
  } catch (err) {
    db.prepare('UPDATE projects SET status = ? WHERE id = ?').run('error', project.id);
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/stop', async (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  try {
    await dockerService.stopProject(project);
    db.prepare('UPDATE projects SET status = ? WHERE id = ?').run('stopped', project.id);
    res.json({ message: 'Stopped successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/restart', async (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  try {
    await dockerService.stopProject(project);
    const result = await dockerService.deployProject(project);
    db.prepare('UPDATE projects SET status = ? WHERE id = ?').run('running', project.id);
    res.json({ message: 'Restarted successfully', output: result });
  } catch (err) {
    db.prepare('UPDATE projects SET status = ? WHERE id = ?').run('error', project.id);
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/check-update', async (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  try {
    const localCommit = await gitService.getRepoCommit(project.id);
    await gitService.fetchRepo(project.id);
    const remoteCommit = await gitService.getRemoteCommit(project.id, project.git_branch);
    const updateAvailable = remoteCommit && remoteCommit !== localCommit;

    db.prepare(`
      UPDATE projects SET commit_hash=?, remote_commit=?, update_available=?, last_update_check=CURRENT_TIMESTAMP WHERE id=?
    `).run(localCommit || '', remoteCommit || '', updateAvailable ? 1 : 0, project.id);

    const updated = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/containers', async (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  try {
    const containers = await dockerService.getProjectContainers(project.name);
    res.json(containers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/logs', async (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  try {
    const containers = await dockerService.getProjectContainers(project.name);
    const logs = {};
    for (const c of containers) {
      try {
        logs[c.Names[0]] = await dockerService.getContainerLogs(c.Id, 50);
      } catch {
        logs[c.Names[0]] = 'Unable to fetch logs';
      }
    }
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/deploy-log', (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const log = dockerService.readDeployLog(project.id);
  res.json({ log });
});

// Re-capture logs from any containers still around for this compose project
// and append them to the deploy log. Useful when the user wants to inspect
// a failure after the auto-cleanup has already removed the containers — at
// which point this will report "No containers were found". If something is
// still running/exited, the user gets another snapshot of its output.
router.post('/:id/capture-failed-logs', async (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  try {
    const tail = Math.max(50, Math.min(parseInt(req.query.tail, 10) || 500, 5000));
    const snapshot = await dockerService.captureComposeProjectLogs(project.name, tail);
    dockerService.appendDeployLog(project.id, '\n[manual-capture] ' + new Date().toISOString() + '\n' + snapshot);
    const log = dockerService.readDeployLog(project.id);
    res.json({ log, captured: snapshot });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
