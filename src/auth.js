const jwt = require('jsonwebtoken');
const config = require('./config');
const db = require('./database');

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    const user = db.prepare('SELECT id, username, role, is_first_login FROM users WHERE id = ?').get(decoded.id);
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function generateToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role || 'admin', is_first_login: user.is_first_login },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Administrator access required' });
  next();
}

function canAccessProject(user, projectId) {
  if (user && user.role === 'admin') return true;
  return Boolean(user && db.prepare('SELECT 1 FROM project_user_assignments WHERE user_id = ? AND project_id = ?').get(user.id, projectId));
}

function requireProjectAccess(req, res, next) {
  if (!canAccessProject(req.user, req.params.id)) return res.status(403).json({ error: 'You do not have access to this project' });
  if (req.user.role !== 'admin' && req.method !== 'GET') {
    const allowed = req.method === 'POST' && /\/(check-update|deploy|rebuild|stop)$/.test(req.path);
    if (!allowed) return res.status(403).json({ error: 'Maintainers can only check updates, deploy, rebuild, or stop assigned projects' });
  }
  next();
}

module.exports = { authMiddleware, generateToken, requireAdmin, canAccessProject, requireProjectAccess };
