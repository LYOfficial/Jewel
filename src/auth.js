const jwt = require('jsonwebtoken');
const config = require('./config');

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function generateToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, is_first_login: user.is_first_login },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
}

module.exports = { authMiddleware, generateToken };
