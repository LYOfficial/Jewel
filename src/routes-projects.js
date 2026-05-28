const express = require('express');
const crypto = require('crypto');
const db = require('./database');
const { authMiddleware } = require('./auth');
const gitService = require('./git-service');
const dockerService = require('./docker-service');

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
  const { name, git_url, git_token, git_branch, compose_path, env_vars, auto_deploy } = req.body;

  if (!name || !git_url) {
    return res.status(400).json({ error: 'Name and git_url are required' });
  }

  const webhookSecret = auto_deploy ? crypto.randomBytes(32).toString('hex') : '';

  const result = db.prepare(`
    INSERT INTO projects (name, git_url, git_token, git_branch, compose_path, env_vars, auto_deploy, webhook_secret)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    name,
    git_url,
    git_token || '',
    git_branch || 'main',
    compose_path || 'docker-compose.yml',
    JSON.stringify(env_vars || {}),
    auto_deploy ? 1 : 0,
    webhookSecret
  );

  try {
    db.prepare('UPDATE projects SET status = ? WHERE id = ?').run('cloning', result.lastInsertRowid);
    await gitService.cloneRepo(git_url, result.lastInsertRowid, git_branch || 'main', git_token || '');
    db.prepare('UPDATE projects SET status = ? WHERE id = ?').run('ready', result.lastInsertRowid);
  } catch (err) {
    db.prepare('UPDATE projects SET status = ? WHERE id = ?').run('error', result.lastInsertRowid);
  }

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(result.lastInsertRowid);
  res.json(project);
});

router.put('/:id', (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const {
    name = project.name,
    git_url = project.git_url,
    git_token = project.git_token,
    git_branch = project.git_branch,
    compose_path = project.compose_path,
    env_vars,
    auto_deploy
  } = req.body;

  const autoDeployVal = auto_deploy !== undefined ? (auto_deploy ? 1 : 0) : project.auto_deploy;
  let webhookSecret = project.webhook_secret;
  if (autoDeployVal && !webhookSecret) {
    webhookSecret = crypto.randomBytes(32).toString('hex');
  }

  db.prepare(`
    UPDATE projects SET name=?, git_url=?, git_token=?, git_branch=?, compose_path=?,
    env_vars=?, auto_deploy=?, webhook_secret=?, updated_at=CURRENT_TIMESTAMP WHERE id=?
  `).run(
    name, git_url, git_token, git_branch, compose_path,
    JSON.stringify(env_vars || (() => { try { return JSON.parse(project.env_vars); } catch { return {}; } })()),
    autoDeployVal, webhookSecret, req.params.id
  );

  const updated = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  res.json(updated);
});

router.put('/:id/env', (req, res) => {
  const { env_vars } = req.body;
  if (!env_vars) return res.status(400).json({ error: 'env_vars is required' });

  db.prepare('UPDATE projects SET env_vars = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(JSON.stringify(env_vars), req.params.id);

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
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
    res.json({ message: 'Deployed successfully', output: result });
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

module.exports = router;
