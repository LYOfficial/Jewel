const express = require('express');
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const { authMiddleware, requireAdmin } = require('./auth');
const db = require('./database');
const dockerService = require('./docker-service');

const router = express.Router();

router.use(authMiddleware);

function assignedProject(user, labels) {
  const name = labels && labels['com.docker.compose.project'];
  if (!name || labels['io.jewel.managed'] === 'true' || !user || user.role !== 'maintainer') return null;
  return db.prepare(`
    SELECT p.id FROM projects p
    JOIN project_user_assignments a ON a.project_id = p.id
    WHERE a.user_id = ? AND p.name = ? AND p.is_self = 0
  `).get(user.id, name);
}

function hasHostControl(info) {
  const host = info.HostConfig || {};
  const unsafeNamespace = ['PidMode', 'IpcMode', 'CgroupnsMode', 'UsernsMode'].some(key => host[key] === 'host');
  const unsafeMount = (info.Mounts || []).some(mount => {
    const source = path.posix.normalize(mount.Source || '');
    const destination = path.posix.normalize(mount.Destination || '');
    return source === '/' || destination === '/' ||
      ['/var/run/docker.sock', '/run/docker.sock'].some(socket =>
        source === socket || destination === socket ||
        (mount.Type === 'bind' && (source === path.posix.dirname(socket) || destination === path.posix.dirname(socket))));
  });
  return Boolean(host.Privileged || unsafeNamespace || host.NetworkMode === 'host' ||
    (host.Devices || []).length || (host.CapAdd || []).length || unsafeMount);
}

async function requireContainerAccess(req, res, next) {
  if (req.user.role === 'admin') return next();
  if (req.params.id === 'host') return res.status(403).json({ error: 'Administrator access required' });
  try {
    const info = await dockerService.getContainerInfo(req.params.id);
    const project = assignedProject(req.user, info.Config && info.Config.Labels);
    if (!project || hasHostControl(info)) {
      return res.status(403).json({ error: 'Container is not in an assigned project' });
    }
    req.containerInfo = info;
    if (req.method !== 'GET') {
      res.once('finish', () => {
        try {
          const action = req.path.split('/').filter(Boolean).slice(1).join('-') || 'operation';
          db.prepare(`
            INSERT INTO operation_logs (project_id, resource_type, resource_id, action, status, summary, metadata, finished_at)
            VALUES (?, 'container', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          `).run(project.id, info.Id, `container-${action}`, res.statusCode < 400 ? 'succeeded' : 'failed',
            `Container ${action} by ${req.user.username}`, JSON.stringify({ user_id: req.user.id }));
        } catch { /* audit failure must not interrupt the response */ }
      });
    }
    next();
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
}

router.get('/', async (req, res) => {
  try {
    const all = req.query.all === 'true';
    const containers = await dockerService.listContainers(all);
    if (req.user.role === 'admin') return res.json(containers);
    const candidates = containers.filter(container => assignedProject(req.user, container.Labels));
    const accessible = await Promise.all(candidates.map(async container => {
      try {
        const info = await dockerService.getContainerInfo(container.Id);
        if (!assignedProject(req.user, info.Config && info.Config.Labels) || hasHostControl(info)) return null;
        return {
          Id: container.Id,
          Names: container.Names,
          Image: container.Image,
          State: container.State,
          Status: container.Status,
          Ports: container.Ports,
          Labels: { 'com.docker.compose.project': info.Config.Labels['com.docker.compose.project'] },
          Mounts: (container.Mounts || []).map(mount => ({ Type: mount.Type, Destination: mount.Destination }))
        };
      } catch { return null; }
    }));
    res.json(accessible.filter(Boolean));
  } catch (err) {
    if (err.message && err.message.includes('connect')) {
      res.json([]);
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

router.use('/:id', requireContainerAccess);

router.get('/:id', async (req, res) => {
  try {
    const info = req.containerInfo || await dockerService.getContainerInfo(req.params.id);
    if (req.user.role === 'admin') return res.json(info);
    res.json({ Id: info.Id, Name: info.Name, State: info.State, Config: { Image: info.Config?.Image } });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

router.post('/:id/start', async (req, res) => {
  try {
    await dockerService.startContainer(req.params.id);
    res.json({ message: 'Container started' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/stop', async (req, res) => {
  try {
    await dockerService.stopContainer(req.params.id);
    res.json({ message: 'Container stopped' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/kill', async (req, res) => {
  try {
    await dockerService.killContainer(req.params.id);
    res.json({ message: 'Container killed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/restart', async (req, res) => {
  try {
    await dockerService.restartContainer(req.params.id);
    res.json({ message: 'Container restarted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/pause', async (req, res) => {
  try {
    await dockerService.pauseContainer(req.params.id);
    res.json({ message: 'Container paused' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/unpause', async (req, res) => {
  try {
    await dockerService.unpauseContainer(req.params.id);
    res.json({ message: 'Container resumed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    await dockerService.removeContainerAdvanced(req.params.id, {
      force: req.query.force !== 'false',
      removeVolumes: req.query.removeVolumes === 'true',
      removeImage: req.query.removeImage === 'true'
    });
    res.json({ message: 'Container removed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/logs', async (req, res) => {
  try {
    const tail = req.query.tail === 'all' ? 'all' : Math.max(1, Math.min(parseInt(req.query.tail, 10) || 500, 5000));
    const logs = await dockerService.getContainerLogs(req.params.id, tail);
    res.json({ logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/stats', async (req, res) => {
  try {
    const stats = await dockerService.getContainerStats(req.params.id);
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== Volume Mounts =====
router.get('/:id/mounts', async (req, res) => {
  try {
    const info = req.containerInfo || await dockerService.getContainerInfo(req.params.id);
    const mounts = (info.Mounts || []).map(m => ({
      type: m.Type,
      source: req.user.role === 'admin' ? m.Source : '',
      destination: m.Destination,
      mode: m.Mode,
      rw: m.RW
    }));
    res.json({ mounts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== Exec (terminal command) =====
router.post('/:id/exec', async (req, res) => {
  const { cmd } = req.body;
  if (!cmd) return res.status(400).json({ error: 'cmd is required' });

  try {
    const container = await dockerService.getContainer(req.params.id);
    const exec = await container.exec({
      Cmd: ['/bin/sh', '-c', cmd],
      AttachStdout: true,
      AttachStderr: true
    });

    const stream = await exec.start();
    const chunks = [];

    return new Promise((resolve) => {
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('end', () => {
        clearTimeout(timeout);
        const text = stripDockerStreamHeaders(Buffer.concat(chunks)).toString('utf-8');
        res.json({ output: text });
        resolve();
      });
      stream.on('error', (err) => {
        clearTimeout(timeout);
        res.status(500).json({ error: err.message });
        resolve();
      });
      const timeout = setTimeout(() => {
        const text = stripDockerStreamHeaders(Buffer.concat(chunks)).toString('utf-8');
        if (!res.headersSent) res.json({ output: text });
        resolve();
      }, 10000);
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== File Manager =====

// List files in container
router.get('/:id/files', async (req, res) => {
  const dirPath = req.query.path || '/';
  try {
    const container = await dockerService.getContainer(req.params.id);
    const exec = await container.exec({
      Cmd: ['ls', '-laL', dirPath],
      AttachStdout: true,
      AttachStderr: true
    });
    const stream = await exec.start();
    const chunks = [];
    return new Promise((resolve) => {
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('end', () => {
        clearTimeout(timeout);
        const output = stripDockerStreamHeaders(Buffer.concat(chunks)).toString('utf-8');
        const files = parseLsOutput(output, dirPath);
        res.json({ path: dirPath, files });
        resolve();
      });
      const timeout = setTimeout(() => {
        if (!res.headersSent) res.json({ path: dirPath, files: [], error: 'timeout' });
        resolve();
      }, 10000);
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Read file from container
router.get('/:id/file', async (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'path is required' });

  try {
    const container = await dockerService.getContainer(req.params.id);
    const exec = await container.exec({
      Cmd: ['cat', filePath],
      AttachStdout: true,
      AttachStderr: true
    });
    const stream = await exec.start();
    const chunks = [];
    return new Promise((resolve) => {
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('end', () => {
        clearTimeout(timeout);
        const output = Buffer.concat(chunks);
        const headerStripped = stripDockerStreamHeaders(output);
        res.json({ path: filePath, content: headerStripped.toString('utf-8') });
        resolve();
      });
      const timeout = setTimeout(() => {
        if (!res.headersSent) res.json({ path: filePath, content: '', error: 'timeout' });
        resolve();
      }, 10000);
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Write file in container
router.put('/:id/file', async (req, res) => {
  const { path: filePath, content } = req.body;
  if (!filePath || content === undefined) return res.status(400).json({ error: 'path and content are required' });

  const transferDir = fs.mkdtempSync(path.join(config.dataDir, 'container-transfer-'));
  try {
    const tmpFile = path.join(transferDir, 'content');
    fs.writeFileSync(tmpFile, String(content));
    execFileSync('docker', ['cp', tmpFile, `${req.params.id}:${filePath}`], { timeout: 30000 });
    res.json({ message: 'File saved' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    fs.rmSync(transferDir, { recursive: true, force: true });
  }
});

// Delete file in container
router.delete('/:id/file', async (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'path is required' });

  try {
    const container = await dockerService.getContainer(req.params.id);
    const exec = await container.exec({
      Cmd: ['rm', '-rf', filePath],
      AttachStdout: true,
      AttachStderr: true
    });
    const stream = await exec.start();
    return new Promise((resolve) => {
      stream.on('data', () => {});
      stream.on('end', () => {
        clearTimeout(timeout);
        res.json({ message: 'File deleted' });
        resolve();
      });
      const timeout = setTimeout(() => {
        if (!res.headersSent) res.json({ message: 'Done' });
        resolve();
      }, 10000);
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upload file to container
router.post('/:id/upload', express.raw({ type: 'application/octet-stream', limit: '64mb' }), async (req, res) => {
  const destPath = req.query.path || req.body?.path;
  const content = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body?.content || '', 'base64');
  if (!destPath || !content.length) return res.status(400).json({ error: 'path and content are required' });

  const transferDir = fs.mkdtempSync(path.join(config.dataDir, 'container-transfer-'));
  try {
    const tmpFile = path.join(transferDir, 'upload');
    fs.writeFileSync(tmpFile, content);
    execFileSync('docker', ['cp', tmpFile, `${req.params.id}:${destPath}`], { timeout: 30000 });
    res.json({ message: 'File uploaded' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    fs.rmSync(transferDir, { recursive: true, force: true });
  }
});

// Download file from container
router.get('/:id/download', async (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'path is required' });

  const transferDir = fs.mkdtempSync(path.join(config.dataDir, 'container-transfer-'));
  try {
    const tmpFile = path.join(transferDir, 'download');
    execFileSync('docker', ['cp', `${req.params.id}:${filePath}`, tmpFile], { timeout: 30000 });
    const content = fs.readFileSync(tmpFile);

    const filename = path.basename(filePath).replace(/["\r\n]/g, '_');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.send(content);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    fs.rmSync(transferDir, { recursive: true, force: true });
  }
});

// Browse host path (for volume mount host directories)
router.get('/host/browse', requireAdmin, (req, res) => {
  const dirPath = req.query.path || '/';
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const files = entries.map(e => ({
      name: e.name,
      isDirectory: e.isDirectory(),
      isFile: e.isFile()
    })).filter(f => f.name !== '.' && f.name !== '..');
    res.json({ path: dirPath, files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== Images =====
//
// Image routes now live in routes-images.js and are mounted in index.js
// at /api/containers/images (BEFORE this router) so they aren't shadowed
// by the /:id wildcard below.

// Helpers
function parseLsOutput(output, basePath) {
  const lines = output.split('\n').filter(l => l.trim());
  const files = [];
  for (const line of lines) {
    if (line.startsWith('total')) continue;
    const match = line.match(/^([bcdlps-][rwxStTs-]{9})\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(?:\d{4}-\d{2}-\d{2}|[A-Za-z]{3}\s+\d{1,2})\s+(?:\d{2}:\d{2}|\d{4})\s+(.+)$/);
    if (!match) continue;
    const perms = match[1];
    const size = parseInt(match[2]) || 0;
    const name = match[3];
    if (name === '.' || name === '..') continue;
    files.push({
      name,
      isDirectory: perms.startsWith('d'),
      isFile: perms.startsWith('-'),
      isSymlink: perms.startsWith('l'),
      size,
      permissions: perms,
      path: basePath === '/' ? `/${name}` : `${basePath}/${name}`
    });
  }
  return files;
}

function stripDockerStreamHeaders(buf) {
  const result = [];
  let offset = 0;
  while (offset < buf.length) {
    if (offset + 8 > buf.length) return buf;
    const streamType = buf[offset];
    if ((streamType !== 1 && streamType !== 2) || buf[offset + 1] || buf[offset + 2] || buf[offset + 3]) return buf;
    const frameSize = buf.readUInt32BE(offset + 4);
    offset += 8;
    if (offset + frameSize > buf.length) return buf;
    result.push(buf.slice(offset, offset + frameSize));
    offset += frameSize;
  }
  return Buffer.concat(result);
}

module.exports = router;
