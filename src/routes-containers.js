const express = require('express');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { authMiddleware } = require('./auth');
const dockerService = require('./docker-service');

const router = express.Router();

router.use(authMiddleware);

router.get('/', async (req, res) => {
  try {
    const all = req.query.all === 'true';
    const containers = await dockerService.listContainers(all);
    res.json(containers);
  } catch (err) {
    if (err.message && err.message.includes('connect')) {
      res.json([]);
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

router.get('/:id', async (req, res) => {
  try {
    const info = await dockerService.getContainerInfo(req.params.id);
    res.json(info);
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

router.delete('/:id', async (req, res) => {
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
    const tail = parseInt(req.query.tail) || 100;
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
    const info = await dockerService.getContainerInfo(req.params.id);
    const mounts = (info.Mounts || []).map(m => ({
      type: m.Type,
      source: m.Source,
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
        const output = Buffer.concat(chunks).toString('utf-8');
        // Skip first 8 bytes (docker stream header per frame)
        let text = output.replace(/[\x00-\x08].{7}/g, '');
        res.json({ output: text });
        resolve();
      });
      stream.on('error', (err) => {
        res.status(500).json({ error: err.message });
        resolve();
      });
      setTimeout(() => {
        const output = Buffer.concat(chunks).toString('utf-8');
        let text = output.replace(/[\x00-\x08].{7}/g, '');
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
      Cmd: ['ls', '-la', '--time-style=long-iso', dirPath],
      AttachStdout: true,
      AttachStderr: true
    });
    const stream = await exec.start();
    const chunks = [];
    return new Promise((resolve) => {
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('end', () => {
        const output = Buffer.concat(chunks).toString('utf-8').replace(/[\x00-\x08].{7}/g, '');
        const files = parseLsOutput(output, dirPath);
        res.json({ path: dirPath, files });
        resolve();
      });
      setTimeout(() => {
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
        const output = Buffer.concat(chunks);
        const headerStripped = stripDockerStreamHeaders(output);
        res.json({ path: filePath, content: headerStripped.toString('utf-8') });
        resolve();
      });
      setTimeout(() => {
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

  try {
    const container = await dockerService.getContainer(req.params.id);
    const exec = await container.exec({
      Cmd: ['/bin/sh', '-c', `cat > '${filePath}' << 'JEWEL_EOF'\n${content}\nJEWEL_EOF`],
      AttachStdout: true,
      AttachStderr: true
    });
    const stream = await exec.start();
    const chunks = [];
    return new Promise((resolve) => {
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('end', () => {
        res.json({ message: 'File saved' });
        resolve();
      });
      setTimeout(() => {
        if (!res.headersSent) res.json({ message: 'File saved (timeout)' });
        resolve();
      }, 10000);
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
        res.json({ message: 'File deleted' });
        resolve();
      });
      setTimeout(() => {
        if (!res.headersSent) res.json({ message: 'Done' });
        resolve();
      }, 10000);
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upload file to container
router.post('/:id/upload', async (req, res) => {
  const { path: destPath, content: b64content } = req.body;
  if (!destPath || !b64content) return res.status(400).json({ error: 'path and content (base64) are required' });

  try {
    const content = Buffer.from(b64content, 'base64');
    const tmpFile = path.join(require('./config').dataDir, `upload-${Date.now()}`);
    fs.writeFileSync(tmpFile, content);

    const container = await dockerService.getContainer(req.params.id);

    // Use docker cp
    try {
      execSync(`docker cp "${tmpFile}" "${req.params.id}:${destPath}"`, { timeout: 30000 });
    } catch {
      try {
        const { execSync: es } = require('child_process');
        es(`docker cp "${tmpFile}" "${req.params.id}:${destPath}"`, { timeout: 30000 });
      } finally {
        try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
      }
    }

    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    res.json({ message: 'File uploaded' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Download file from container
router.get('/:id/download', async (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'path is required' });

  try {
    const tmpFile = path.join(require('./config').dataDir, `download-${Date.now()}`);
    execSync(`docker cp "${req.params.id}:${filePath}" "${tmpFile}"`, { timeout: 30000 });

    const content = fs.readFileSync(tmpFile);
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }

    const filename = path.basename(filePath);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.send(content);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Browse host path (for volume mount host directories)
router.get('/host/browse', (req, res) => {
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

// Helpers
function parseLsOutput(output, basePath) {
  const lines = output.split('\n').filter(l => l.trim());
  const files = [];
  for (const line of lines) {
    if (line.startsWith('total')) continue;
    const match = line.match(/^([drwxls\-]{10})\s+\d+\s+(\S+)\s+(\S+)\s+(\d+)\s+(\d{4}-\d{2}-\d{2})?\s*(\d{2}:\d{2})?\s+(.+)$/);
    if (!match) continue;
    const perms = match[1];
    const size = parseInt(match[4]) || 0;
    const name = match[7];
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
    if (offset + 8 > buf.length) {
      result.push(buf.slice(offset));
      break;
    }
    const streamType = buf[offset];
    const frameSize = buf.readUInt32BE(offset + 4);
    offset += 8;
    const end = Math.min(offset + frameSize, buf.length);
    result.push(buf.slice(offset, end));
    offset = end;
  }
  return Buffer.concat(result);
}

module.exports = router;
