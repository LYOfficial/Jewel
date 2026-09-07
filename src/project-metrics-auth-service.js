const crypto = require('crypto');
const db = require('./database');

const ACCESS_KEY_SETTING = 'project_metrics_access_key';

function createAccessKey() {
  return `jwl_pm_${crypto.randomBytes(32).toString('base64url')}`;
}

function getAccessKey() {
  let row = db.prepare('SELECT value FROM settings WHERE key=?').get(ACCESS_KEY_SETTING);
  if (!row || !row.value) {
    const value = createAccessKey();
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(ACCESS_KEY_SETTING, value);
    row = { value };
  }
  return row.value;
}

function rotateAccessKey() {
  const value = createAccessKey();
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(ACCESS_KEY_SETTING, value);
  return value;
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function authenticate(req) {
  return safeEqual(req.headers['x-jewel-project-metrics-key'], getAccessKey());
}

module.exports = { getAccessKey, rotateAccessKey, authenticate };
