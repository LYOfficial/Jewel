const db = require('./database');
const { redactSecrets, buildDiagnosticReport } = require('./diagnostics');

function start({ projectId = null, resourceType = 'project', resourceId = '', action, metadata = {} }) {
  const result = db.prepare(`
    INSERT INTO operation_logs (project_id, resource_type, resource_id, action, status, metadata)
    VALUES (?, ?, ?, ?, 'running', ?)
  `).run(projectId, resourceType, String(resourceId || ''), action, JSON.stringify(metadata || {}));
  return Number(result.lastInsertRowid);
}

function succeed(id, { summary = 'Operation completed', detail = '', metadata } = {}) {
  const current = get(id);
  const nextMetadata = metadata === undefined ? (current ? current.metadata : '{}') : JSON.stringify(metadata || {});
  db.prepare(`
    UPDATE operation_logs
    SET status='succeeded', summary=?, detail=?, metadata=?, finished_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(summary, redactSecrets(detail), nextMetadata, id);
  return get(id);
}

function fail(id, error, { summary, detail = '', metadata } = {}) {
  const current = get(id);
  const message = error && error.message ? error.message : String(error || 'Unknown error');
  const combined = [detail, error && error.stack ? error.stack : message].filter(Boolean).join('\n\n');
  const nextMetadata = metadata === undefined ? (current ? current.metadata : '{}') : JSON.stringify(metadata || {});
  db.prepare(`
    UPDATE operation_logs
    SET status='failed', summary=?, detail=?, metadata=?, finished_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(redactSecrets(summary || message), redactSecrets(combined), nextMetadata, id);
  return get(id);
}

function get(id) {
  return db.prepare('SELECT * FROM operation_logs WHERE id = ?').get(id);
}

function listForProject(projectId, limit = 20) {
  return db.prepare(`
    SELECT * FROM operation_logs WHERE project_id = ? ORDER BY id DESC LIMIT ?
  `).all(projectId, Math.max(1, Math.min(Number(limit) || 20, 100)));
}

function latestFailure(projectId) {
  return db.prepare(`
    SELECT * FROM operation_logs
    WHERE project_id = ? AND status = 'failed'
    ORDER BY id DESC LIMIT 1
  `).get(projectId);
}

function report(operation, project, deployLog = '', extra = '') {
  return buildDiagnosticReport({ operation, project, deployLog, extra });
}

module.exports = { start, succeed, fail, get, listForProject, latestFailure, report };
