const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('./database');
const { authMiddleware, requireAdmin } = require('./auth');

const router = express.Router();
router.use(authMiddleware, requireAdmin);

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    is_first_login: Boolean(user.is_first_login),
    created_at: user.created_at,
    project_ids: db.prepare('SELECT project_id FROM project_user_assignments WHERE user_id = ? ORDER BY project_id').all(user.id).map(row => row.project_id)
  };
}

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT id, username, role, is_first_login, created_at FROM users ORDER BY id').all().map(publicUser));
});

router.post('/', (req, res) => {
  const username = String(req.body && req.body.username || '').trim();
  const password = String(req.body && req.body.password || '');
  if (!/^[a-zA-Z0-9_]{3,32}$/.test(username)) return res.status(400).json({ error: '用户名需为 3-32 位字母、数字或下划线' });
  if (password.length < 6) return res.status(400).json({ error: '密码至少需要 6 位' });
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) return res.status(409).json({ error: '用户名已存在' });
  const result = db.prepare('INSERT INTO users (username, password, role, is_first_login) VALUES (?, ?, \'maintainer\', 1)')
    .run(username, bcrypt.hashSync(password, 10));
  res.status(201).json(publicUser(db.prepare('SELECT id, username, role, is_first_login, created_at FROM users WHERE id = ?').get(result.lastInsertRowid)));
});

router.put('/:id/projects', (req, res) => {
  const user = db.prepare('SELECT id, username, role, is_first_login, created_at FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.role !== 'maintainer') return res.status(400).json({ error: 'Only maintainer accounts can receive project assignments' });
  const ids = [...new Set((Array.isArray(req.body && req.body.project_ids) ? req.body.project_ids : []).map(Number))]
    .filter(id => Number.isSafeInteger(id) && id > 0);
  const valid = new Set(db.prepare(`SELECT id FROM projects WHERE id IN (${ids.length ? ids.map(() => '?').join(',') : 'NULL'})`).all(...ids).map(row => row.id));
  const save = db.transaction(() => {
    db.prepare('DELETE FROM project_user_assignments WHERE user_id = ?').run(user.id);
    const insert = db.prepare('INSERT INTO project_user_assignments (user_id, project_id) VALUES (?, ?)');
    for (const id of ids) if (valid.has(id)) insert.run(user.id, id);
  });
  save();
  res.json(publicUser(user));
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: '不能删除当前登录账号' });
  const user = db.prepare('SELECT id, role FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ message: 'User deleted' });
});

module.exports = router;
