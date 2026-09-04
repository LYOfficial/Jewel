const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./database');

const ACCESS_KEY_SETTING = 'mcp_access_key';
const TOKEN_PREFIX_LENGTH = 18;
const MAX_TOKEN_LIFETIME_HOURS = 24 * 365 * 10;

function randomSecret(prefix) {
  return `${prefix}${crypto.randomBytes(32).toString('base64url')}`;
}

function getAccessKey() {
  let row = db.prepare('SELECT value FROM settings WHERE key=?').get(ACCESS_KEY_SETTING);
  if (!row || !row.value) {
    const value = randomSecret('jwl_ak_');
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(ACCESS_KEY_SETTING, value);
    row = { value };
  }
  return row.value;
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function clientAddress(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.ip || req.socket?.remoteAddress || '';
}

function audit({ tokenId = null, event, toolName = '', success = true, detail = '', req = null }) {
  db.prepare(`
    INSERT INTO mcp_audit_logs (mcp_token_id, event, tool_name, success, detail, client_address)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    tokenId,
    String(event || '').slice(0, 80),
    String(toolName || '').slice(0, 120),
    success ? 1 : 0,
    String(detail || '').slice(0, 2000),
    req ? String(clientAddress(req)).slice(0, 160) : ''
  );
}

function normalizeLifetime(value) {
  if (value === undefined || value === null || value === '' || Number(value) === 0) return null;
  const hours = Number(value);
  if (!Number.isInteger(hours) || hours < 1 || hours > MAX_TOKEN_LIFETIME_HOURS) {
    throw new Error(`expires_in_hours must be an integer between 1 and ${MAX_TOKEN_LIFETIME_HOURS}, or 0 for no expiry`);
  }
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function tokenStatus(token, now = new Date().toISOString()) {
  if (token.revoked_at) return 'revoked';
  if (token.expires_at && token.expires_at <= now) return 'expired';
  return 'active';
}

function publicToken(token) {
  return {
    id: token.id,
    name: token.name,
    token_prefix: token.token_prefix,
    expires_at: token.expires_at,
    revoked_at: token.revoked_at,
    last_used_at: token.last_used_at,
    created_at: token.created_at,
    status: tokenStatus(token)
  };
}

function listTokens() {
  return db.prepare(`
    SELECT id, name, token_prefix, expires_at, revoked_at, last_used_at, created_at
    FROM mcp_tokens ORDER BY id DESC
  `).all().map(publicToken);
}

function createToken({ name, expiresInHours, req = null }) {
  const normalizedName = String(name || '').trim();
  if (!normalizedName || normalizedName.length > 100) {
    throw new Error('name is required and must be at most 100 characters');
  }
  const expiresAt = normalizeLifetime(expiresInHours);
  const value = randomSecret('jwl_mcp_');
  const tokenPrefix = value.slice(0, TOKEN_PREFIX_LENGTH);
  const result = db.prepare(`
    INSERT INTO mcp_tokens (name, token_prefix, token_hash, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(normalizedName, tokenPrefix, bcrypt.hashSync(value, 12), expiresAt);
  const token = db.prepare('SELECT * FROM mcp_tokens WHERE id=?').get(result.lastInsertRowid);
  audit({ tokenId: token.id, event: 'token_created', detail: `Created token "${normalizedName}"`, req });
  return { token: publicToken(token), value };
}

function revokeToken(id, req = null) {
  const token = db.prepare('SELECT * FROM mcp_tokens WHERE id=?').get(id);
  if (!token) return null;
  if (!token.revoked_at) {
    db.prepare('UPDATE mcp_tokens SET revoked_at=CURRENT_TIMESTAMP WHERE id=?').run(id);
    audit({ tokenId: token.id, event: 'token_revoked', detail: `Revoked token "${token.name}"`, req });
  }
  return db.prepare('SELECT * FROM mcp_tokens WHERE id=?').get(id);
}

function extractCredentials(req) {
  const authorization = String(req.headers.authorization || '');
  const bearer = authorization.match(/^Bearer\s+(.+)$/i);
  // Query authentication is intentionally not supported: URLs frequently end
  // up in reverse-proxy logs and browser history. Streamable HTTP clients can
  // set both headers in their MCP configuration.
  return {
    accessKey: req.headers['x-jewel-access-key'],
    token: bearer ? bearer[1].trim() : ''
  };
}

function authenticate(req) {
  const { accessKey, token: suppliedToken } = extractCredentials(req);
  if (!safeEqual(accessKey, getAccessKey())) {
    audit({ event: 'authentication_failed', success: false, detail: 'Invalid access key', req });
    return { ok: false, error: 'Invalid MCP credentials' };
  }
  if (!suppliedToken) {
    audit({ event: 'authentication_failed', success: false, detail: 'Missing bearer token', req });
    return { ok: false, error: 'Invalid MCP credentials' };
  }

  const prefix = suppliedToken.slice(0, TOKEN_PREFIX_LENGTH);
  const candidates = db.prepare(`
    SELECT * FROM mcp_tokens
    WHERE token_prefix=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)
  `).all(prefix, new Date().toISOString());
  const token = candidates.find(candidate => bcrypt.compareSync(suppliedToken, candidate.token_hash));
  if (!token) {
    audit({ event: 'authentication_failed', success: false, detail: 'Invalid, revoked, or expired bearer token', req });
    return { ok: false, error: 'Invalid MCP credentials' };
  }

  db.prepare('UPDATE mcp_tokens SET last_used_at=CURRENT_TIMESTAMP WHERE id=?').run(token.id);
  return { ok: true, token: publicToken(token) };
}

function listAuditLogs(limit = 100) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
  return db.prepare(`
    SELECT a.*, t.name AS token_name, t.token_prefix
    FROM mcp_audit_logs a
    LEFT JOIN mcp_tokens t ON t.id=a.mcp_token_id
    ORDER BY a.id DESC LIMIT ?
  `).all(safeLimit);
}

module.exports = {
  getAccessKey,
  listTokens,
  createToken,
  revokeToken,
  authenticate,
  audit,
  listAuditLogs,
  tokenStatus
};
