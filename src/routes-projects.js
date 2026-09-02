const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('./database');
const { authMiddleware } = require('./auth');
const gitService = require('./git-service');
const dockerService = require('./docker-service');
const projectUpdateService = require('./project-update-service');
const operationService = require('./operation-service');
const { redactSecrets, tailLines } = require('./diagnostics');
const backupService = require('./backup-service');
const {
  containerName,
  collectContainerMounts,
  mergeNamedVolumes,
  summarizeContainerStats
} = require('./project-resource-utils');

const router = express.Router();

const DOCKER_READ_TIMEOUT_MS = Math.max(1000, Number(process.env.DOCKER_READ_TIMEOUT_MS) || 8000);

function withDockerReadTimeout(promise, label = 'Docker read') {
  let timeout;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error(`${label} timed out after ${DOCKER_READ_TIMEOUT_MS}ms`)), DOCKER_READ_TIMEOUT_MS);
      if (timeout.unref) timeout.unref();
    })
  ]).finally(() => clearTimeout(timeout));
}

router.use(authMiddleware);

function projectQuery(whereClause = '') {
  return `
    SELECT p.*,
      op.id AS last_operation_id,
      op.action AS last_operation_action,
      op.status AS last_operation_status,
      op.summary AS last_operation_summary,
      op.finished_at AS last_operation_at,
      (SELECT id FROM operation_logs WHERE project_id=p.id AND status='failed' ORDER BY id DESC LIMIT 1) AS last_failure_id
    FROM projects p
    LEFT JOIN operation_logs op ON op.id = (
      SELECT id FROM operation_logs WHERE project_id=p.id ORDER BY id DESC LIMIT 1
    )
    ${whereClause}
  `;
}

function operationErrorResponse(res, project, operation, err, status = 500) {
  const deployLog = dockerService.readDeployLog(project.id);
  const report = operationService.report(operation, project, deployLog);
  const message = redactSecrets(err && err.message ? err.message : String(err || 'Operation failed'));
  return res.status(status).json({
    error: message.length > 2000 ? `${message.substring(0, 2000)}…` : message,
    project_id: project.id,
    operation_id: operation.id,
    report
  });
}

async function snapshotOperationCommit(operationId, projectId) {
  // A deploy can pull a new revision after the operation starts. Read HEAD
  // when the operation settles so its immutable history entry reflects the
  // revision actually used; fall back to the project's last known revision.
  try {
    const commitHash = await gitService.getRepoCommit(projectId);
    if (commitHash) return operationService.setCommitHash(operationId, commitHash);
  } catch { /* use the persisted project value below */ }

  const project = db.prepare('SELECT commit_hash FROM projects WHERE id = ?').get(projectId);
  return operationService.setCommitHash(operationId, project && project.commit_hash);
}

async function runProjectOperation({ res, project, action, activeStatus, successStatus, work, summary, response }) {
  const operationId = operationService.start({
    projectId: project.id,
    action,
    metadata: { project_name: project.name }
  });
  try {
    if (activeStatus) db.prepare('UPDATE projects SET status=? WHERE id=?').run(activeStatus, project.id);
    const result = await work();
    if (successStatus) db.prepare('UPDATE projects SET status=? WHERE id=?').run(successStatus, project.id);
    await snapshotOperationCommit(operationId, project.id);
    const operation = operationService.succeed(operationId, {
      summary: typeof summary === 'function' ? summary(result) : summary,
      detail: result && result.output ? tailLines(result.output, 80) : ''
    });
    const payload = typeof response === 'function' ? response(result) : (result || {});
    return res.json({ ...payload, operation_id: operation.id });
  } catch (err) {
    if (activeStatus) db.prepare('UPDATE projects SET status=? WHERE id=?').run('error', project.id);
    await snapshotOperationCommit(operationId, project.id);
    const operation = operationService.fail(operationId, err, {
      summary: `${action} failed for ${project.name}`,
      detail: tailLines(dockerService.readDeployLog(project.id), 400)
    });
    return operationErrorResponse(res, project, operation, err);
  }
}

router.get('/', (req, res) => {
  const projects = db.prepare(`${projectQuery()} ORDER BY p.created_at DESC`).all();
  res.json(projects);
});

router.get('/:id', (req, res) => {
  const project = db.prepare(projectQuery('WHERE p.id = ?')).get(req.params.id);
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

  const projectId = Number(result.lastInsertRowid);
  const operationId = operationService.start({
    projectId,
    action: 'clone',
    metadata: { project_name: name }
  });
  try {
    db.prepare('UPDATE projects SET status = ? WHERE id = ?').run('cloning', projectId);
    await gitService.cloneRepo(git_url, projectId, git_branch || 'main', git_token || '');
    db.prepare('UPDATE projects SET status = ? WHERE id = ?').run('ready', projectId);
    await projectUpdateService.updateCommitHash(projectId);
    await snapshotOperationCommit(operationId, projectId);
    operationService.succeed(operationId, { summary: `Repository cloned for ${name}` });
  } catch (err) {
    db.prepare('UPDATE projects SET status = ? WHERE id = ?').run('error', projectId);
    const operation = operationService.fail(operationId, err, { summary: `Initial clone failed for ${name}` });
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
    return operationErrorResponse(res, project, operation, err, 422);
  }

  const project = db.prepare(projectQuery('WHERE p.id = ?')).get(projectId);
  res.status(201).json(project);
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
    const operationId = operationService.start({
      projectId: project.id,
      action: 'reclone',
      metadata: { project_name: name }
    });
    try {
      db.prepare('UPDATE projects SET status = ? WHERE id = ?').run('cloning', project.id);
      await gitService.cloneRepo(git_url, project.id, git_branch || 'main', git_token || '');
      db.prepare('UPDATE projects SET status = ? WHERE id = ?').run('ready', project.id);
      await projectUpdateService.updateCommitHash(project.id);
      await snapshotOperationCommit(operationId, project.id);
      operationService.succeed(operationId, { summary: `Repository refreshed for ${name}` });
    } catch (err) {
      db.prepare('UPDATE projects SET status = ? WHERE id = ?').run('error', project.id);
      const operation = operationService.fail(operationId, err, { summary: `Repository refresh failed for ${name}` });
      return operationErrorResponse(res, { ...project, name }, operation, err);
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

  return runProjectOperation({
    res,
    project,
    action: 'deploy',
    activeStatus: 'deploying',
    successStatus: 'running',
    work: async () => {
      try { await gitService.pullRepo(project.id, project.git_branch); } catch { /* deploy existing checkout */ }
      const output = await dockerService.deployProject(project);
      await projectUpdateService.updateCommitHash(project.id);
      return { output };
    },
    summary: `Deployed ${project.name}`,
    response: result => ({ message: 'Deployed successfully', output: result.output })
  });
});

// Rebuild: stop compose → prune all unused images → check for upstream
// updates (and pull them if any) → redeploy. Volumes are preserved.
// The status is flipped to 'rebuilding' synchronously at the very top so
// the UI sees immediate feedback even if the rebuild takes a long time.
router.post('/:id/rebuild', async (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  return runProjectOperation({
    res,
    project,
    action: 'rebuild',
    activeStatus: 'rebuilding',
    successStatus: 'running',
    work: async () => {
      const result = await dockerService.rebuildProject(project);
      await projectUpdateService.updateCommitHash(project.id);
      return result;
    },
    summary: `Rebuilt ${project.name}`,
    response: result => ({
      message: 'Rebuilt successfully',
      output: result.stdout,
      update: result.update,
      localCommit: result.localCommit,
      remoteCommit: result.remoteCommit
    })
  });
});

router.post('/:id/stop', async (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  return runProjectOperation({
    res,
    project,
    action: 'stop',
    activeStatus: null,
    successStatus: 'stopped',
    work: () => dockerService.stopProject(project),
    summary: `Stopped ${project.name}`,
    response: () => ({ message: 'Stopped successfully' })
  });
});

router.post('/:id/restart', async (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  return runProjectOperation({
    res,
    project,
    action: 'restart',
    activeStatus: 'deploying',
    successStatus: 'running',
    work: async () => {
      await dockerService.stopProject(project);
      return { output: await dockerService.deployProject(project) };
    },
    summary: `Restarted ${project.name}`,
    response: result => ({ message: 'Restarted successfully', output: result.output })
  });
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
    const containers = await withDockerReadTimeout(
      dockerService.getProjectContainers(project.name),
      'Reading project containers'
    );
    res.json(containers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/resources', async (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  try {
    const containers = await withDockerReadTimeout(
      dockerService.getProjectContainers(project.name),
      'Reading project containers'
    );
    const knownVolumes = await withDockerReadTimeout(
      backupService.getProjectVolumeResources(project, containers),
      'Reading project volumes'
    );
    const detailedContainers = await Promise.all(containers.map(async container => {
      try {
        const info = await withDockerReadTimeout(
          dockerService.getContainerInfo(container.Id),
          `Reading mounts for ${containerName(container) || container.Id}`
        );
        return { container, info };
      } catch {
        // Retain the summary data when a container disappears between list
        // and inspect, or when a single inspect request times out.
        return { container, info: null };
      }
    }));
    const mountedResources = collectContainerMounts(detailedContainers);
    const volumes = mergeNamedVolumes(knownVolumes, mountedResources.volumes, project);
    const imageMap = new Map();
    for (const container of containers) {
      const name = containerName(container);
      const imageKey = container.ImageID || container.Image;
      if (imageKey && !imageMap.has(imageKey)) {
        imageMap.set(imageKey, { id: container.ImageID || '', name: container.Image || '', containers: [], size_bytes: 0 });
      }
      if (imageKey) imageMap.get(imageKey).containers.push(name);
    }

    const dockerClient = dockerService.getDocker();
    const diskUsagePromise = typeof dockerClient.df === 'function'
      ? withDockerReadTimeout(dockerClient.df(), 'Reading Docker disk usage')
      : Promise.resolve({});
    const [imagesResult, diskUsageResult, statsResult] = await Promise.allSettled([
      withDockerReadTimeout(dockerClient.listImages({ all: true }), 'Reading Docker images'),
      diskUsagePromise,
      Promise.all(containers.filter(container => container.State === 'running').map(async container => {
        try {
          return await withDockerReadTimeout(
            dockerService.getContainerStats(container.Id),
            `Reading stats for ${containerName(container) || container.Id}`
          );
        } catch {
          return null;
        }
      }))
    ]);

    const dockerImages = imagesResult.status === 'fulfilled' ? imagesResult.value : [];
    const imageById = new Map(dockerImages.map(image => [image.Id, image]));
    const imageByTag = new Map();
    for (const image of dockerImages) {
      for (const tag of image.RepoTags || []) imageByTag.set(tag, image);
    }
    for (const image of imageMap.values()) {
      const dockerImage = imageById.get(image.id) || imageByTag.get(image.name);
      image.size_bytes = Number(dockerImage && dockerImage.Size) || 0;
    }

    const diskUsage = diskUsageResult.status === 'fulfilled' ? diskUsageResult.value : {};
    const volumeSizeByName = new Map(((diskUsage && diskUsage.Volumes) || []).map(volume => [
      volume.Name,
      Number(volume.UsageData && volume.UsageData.Size) || 0
    ]));
    for (const volume of volumes) volume.size_bytes = volumeSizeByName.get(volume.name) || 0;

    const stats = summarizeContainerStats(statsResult.status === 'fulfilled' ? statsResult.value : []);
    const imageBytes = [...imageMap.values()].reduce((total, image) => total + image.size_bytes, 0);
    const writableLayerBytes = containers.reduce((total, container) => total + (Number(container.SizeRw) || 0), 0);
    const volumeBytes = volumes.reduce((total, volume) => total + volume.size_bytes, 0);
    res.json({
      containers,
      images: [...imageMap.values()],
      volumes,
      bind_mounts: mountedResources.bindMounts,
      storage: {
        total_bytes: imageBytes + writableLayerBytes + volumeBytes,
        image_bytes: imageBytes,
        writable_layer_bytes: writableLayerBytes,
        volume_bytes: volumeBytes,
        bind_mounts_included: false
      },
      cpu: {
        percent: stats.cpu_percent,
        running_containers: containers.filter(container => container.State === 'running').length,
        unavailable_containers: stats.unavailable_containers
      },
      memory: {
        usage_bytes: stats.memory_bytes,
        limit_bytes: stats.memory_limit_bytes,
        percent: stats.memory_percent
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/operations', (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(operationService.listForProject(project.id, req.query.limit));
});

router.get('/:id/error-report', (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const operation = operationService.latestFailure(project.id);
  if (!operation) return res.status(404).json({ error: 'No failed operation has been recorded for this project' });
  const report = operationService.report(operation, project, dockerService.readDeployLog(project.id));
  res.json({ operation, report });
});

router.get('/:id/logs', async (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  try {
    const containers = await withDockerReadTimeout(
      dockerService.getProjectContainers(project.name),
      'Reading project containers'
    );
    const logs = {};
    await Promise.all(containers.map(async c => {
      try {
        logs[c.Names[0]] = await withDockerReadTimeout(
          dockerService.getContainerLogs(c.Id, 50),
          `Reading logs for ${c.Names[0] || c.Id.substring(0, 12)}`
        );
      } catch {
        logs[c.Names[0]] = 'Unable to fetch logs';
      }
    }));
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
    const snapshot = await withDockerReadTimeout(
      dockerService.captureComposeProjectLogs(project.name, tail),
      'Capturing project logs'
    );
    dockerService.appendDeployLog(project.id, '\n[manual-capture] ' + new Date().toISOString() + '\n' + snapshot);
    const log = dockerService.readDeployLog(project.id);
    res.json({ log, captured: snapshot });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
