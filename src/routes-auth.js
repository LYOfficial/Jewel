const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('./database');
const { authMiddleware, generateToken } = require('./auth');

const router = express.Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const valid = bcrypt.compareSync(password, user.password);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = generateToken(user);
  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      is_first_login: user.is_first_login
    }
  });
});

router.get('/me', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT id, username, is_first_login, created_at FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

router.post('/change-password', authMiddleware, (req, res) => {
  const { current_password, new_password } = req.body;
  if (!new_password) {
    return res.status(400).json({ error: 'New password is required' });
  }
  if (new_password.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

  if (!user.is_first_login) {
    if (!current_password) {
      return res.status(400).json({ error: 'Current password is required' });
    }
    if (!bcrypt.compareSync(current_password, user.password)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
  }

  const hashed = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE users SET password = ?, is_first_login = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(hashed, req.user.id);

  const updatedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const token = generateToken(updatedUser);
  res.json({ message: 'Password changed', token });
});

router.post('/change-username', authMiddleware, (req, res) => {
  const { new_username } = req.body;
  if (!new_username) {
    return res.status(400).json({ error: 'New username is required' });
  }
  if (!/^[a-zA-Z0-9]+$/.test(new_username)) {
    return res.status(400).json({ error: 'Username can only contain letters and numbers' });
  }
  if (new_username.length < 3) {
    return res.status(400).json({ error: 'Username must be at least 3 characters' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(new_username, req.user.id);
  if (existing) {
    return res.status(400).json({ error: 'Username already taken' });
  }

  db.prepare('UPDATE users SET username = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(new_username, req.user.id);

  const updatedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const token = generateToken(updatedUser);
  res.json({ message: 'Username changed', token });
});

module.exports = router;
