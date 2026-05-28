const express = require('express');
const db = require('./database');
const { authMiddleware } = require('./auth');

const router = express.Router();

router.use(authMiddleware);

router.get('/', (req, res) => {
  const tokens = db.prepare('SELECT id, name, provider, host, created_at, updated_at FROM git_tokens ORDER BY created_at DESC').all();
  res.json(tokens);
});

router.get('/:id', (req, res) => {
  const token = db.prepare('SELECT * FROM git_tokens WHERE id = ?').get(req.params.id);
  if (!token) return res.status(404).json({ error: 'Token not found' });
  res.json(token);
});

router.post('/', (req, res) => {
  const { name, provider, host, token } = req.body;
  if (!name || !token) {
    return res.status(400).json({ error: 'Name and token are required' });
  }

  const result = db.prepare(
    'INSERT INTO git_tokens (name, provider, host, token) VALUES (?, ?, ?, ?)'
  ).run(name, provider || 'github', host || '', token);

  const saved = db.prepare('SELECT id, name, provider, host, created_at, updated_at FROM git_tokens WHERE id = ?').get(result.lastInsertRowid);
  res.json(saved);
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM git_tokens WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Token not found' });

  const { name, provider, host, token } = req.body;

  db.prepare(
    'UPDATE git_tokens SET name=?, provider=?, host=?, token=?, updated_at=CURRENT_TIMESTAMP WHERE id=?'
  ).run(
    name || existing.name,
    provider || existing.provider,
    host !== undefined ? host : existing.host,
    token || existing.token,
    req.params.id
  );

  const saved = db.prepare('SELECT id, name, provider, host, created_at, updated_at FROM git_tokens WHERE id = ?').get(req.params.id);
  res.json(saved);
});

router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM git_tokens WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Token not found' });

  db.prepare('DELETE FROM git_tokens WHERE id = ?').run(req.params.id);
  res.json({ message: 'Token deleted' });
});

module.exports = router;
