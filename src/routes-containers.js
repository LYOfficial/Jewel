const express = require('express');
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

router.post('/:id/restart', async (req, res) => {
  try {
    await dockerService.restartContainer(req.params.id);
    res.json({ message: 'Container restarted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await dockerService.removeContainer(req.params.id, req.query.force === 'true');
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

module.exports = router;
