const express = require('express');
const db = require('./database');
const { authMiddleware } = require('./auth');
const updateService = require('./update-service');
const dockerService = require('./docker-service');

const router = express.Router();

router.use(authMiddleware);

router.get('/info', async (req, res) => {
  const info = {
    version: require('../package.json').version,
    nodeVersion: process.version,
    platform: process.platform,
    uptime: process.uptime()
  };

  try {
    info.docker = await dockerService.getDockerInfo();
  } catch {
    info.docker = null;
  }

  res.json(info);
});

router.get('/update/check', (req, res) => {
  res.json(updateService.getUpdateInfo());
});

router.post('/update/apply', async (req, res) => {
  try {
    const result = await updateService.applyUpdate();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/settings', (req, res) => {
  const settings = db.prepare('SELECT * FROM settings').all();
  const obj = {};
  for (const s of settings) obj[s.key] = s.value;
  res.json(obj);
});

router.put('/settings', (req, res) => {
  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(req.body)) {
    upsert.run(key, String(value));
  }
  const settings = db.prepare('SELECT * FROM settings').all();
  const obj = {};
  for (const s of settings) obj[s.key] = s.value;
  res.json(obj);
});

module.exports = router;
