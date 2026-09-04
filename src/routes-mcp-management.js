const express = require('express');
const { authMiddleware } = require('./auth');
const mcpAuth = require('./mcp-auth-service');

const router = express.Router();
router.use(authMiddleware);

router.get('/config', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ access_key: mcpAuth.getAccessKey() });
});

router.get('/tokens', (req, res) => {
  res.json(mcpAuth.listTokens());
});

router.post('/tokens', (req, res) => {
  try {
    const created = mcpAuth.createToken({
      name: req.body && req.body.name,
      expiresInHours: req.body && req.body.expires_in_hours,
      req
    });
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/tokens/:id', (req, res) => {
  const token = mcpAuth.revokeToken(Number(req.params.id), req);
  if (!token) return res.status(404).json({ error: 'MCP token not found' });
  res.json({ message: 'MCP token revoked' });
});

router.get('/audit-logs', (req, res) => {
  res.json(mcpAuth.listAuditLogs(req.query.limit));
});

module.exports = router;
