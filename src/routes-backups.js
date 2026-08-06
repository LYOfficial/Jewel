const express = require('express');
const db = require('./database');
const { authMiddleware } = require('./auth');
const backupService = require('./backup-service');
const operationService = require('./operation-service');
const {
  parseJson,
  normalizeVolumeSelections,
  normalizeRemotePath,
  computeNextRun,
  maskConfig,
  validateProvider
} = require('./backup-utils');

const router = express.Router();
router.use(authMiddleware);

function sanitizeProvider(row) {
  if (!row) return row;
  const config = parseJson(row.config_json, {});
  return { ...row, config: maskConfig(config), configured_fields: Object.keys(config), config_json: undefined };
}

function mergeProviderConfig(existing, incoming) {
  const next = { ...parseJson(existing && existing.config_json, {}) };
  const secretField = /(secret|token|password|cookie|key|bduss|link)/i;
  for (const [key, value] of Object.entries(incoming || {})) {
    if (value === '••••••••') continue;
    if (value === '' && secretField.test(key) && key in next) continue;
    next[key] = value;
  }
  return next;
}

function serializePlan(row) {
  return { ...row, volume_selections: parseJson(row.volume_selections, []) };
}

router.get('/volumes', async (req, res) => {
  try {
    const projectId = req.query.project_id ? Number(req.query.project_id) : null;
    res.json(await backupService.listVolumeResources(projectId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/providers', (req, res) => {
  const providers = db.prepare('SELECT * FROM backup_providers ORDER BY name').all();
  res.json(providers.map(sanitizeProvider));
});

router.post('/providers', (req, res) => {
  try {
    const { name, type, config = {}, enabled = true } = req.body || {};
    if (!name || !type) return res.status(400).json({ error: 'Provider name and type are required' });
    validateProvider(type, config);
    const result = db.prepare(`
      INSERT INTO backup_providers (name, type, config_json, enabled) VALUES (?, ?, ?, ?)
    `).run(name.trim(), type, JSON.stringify(config), enabled ? 1 : 0);
    res.status(201).json(sanitizeProvider(db.prepare('SELECT * FROM backup_providers WHERE id=?').get(result.lastInsertRowid)));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/providers/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM backup_providers WHERE id=?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Backup provider not found' });
  try {
    const name = req.body.name === undefined ? existing.name : String(req.body.name).trim();
    const type = req.body.type || existing.type;
    const config = mergeProviderConfig(existing, req.body.config);
    const enabled = req.body.enabled === undefined ? existing.enabled : (req.body.enabled ? 1 : 0);
    validateProvider(type, config);
    db.prepare(`
      UPDATE backup_providers SET name=?, type=?, config_json=?, enabled=?, updated_at=CURRENT_TIMESTAMP WHERE id=?
    `).run(name, type, JSON.stringify(config), enabled, existing.id);
    res.json(sanitizeProvider(db.prepare('SELECT * FROM backup_providers WHERE id=?').get(existing.id)));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/providers/:id', (req, res) => {
  const count = db.prepare('SELECT COUNT(*) AS count FROM backup_plans WHERE provider_id=?').get(req.params.id).count;
  if (count) return res.status(409).json({ error: 'Delete or reassign the backup plans using this provider first' });
  const result = db.prepare('DELETE FROM backup_providers WHERE id=?').run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'Backup provider not found' });
  res.json({ message: 'Backup provider deleted' });
});

router.post('/providers/:id/test', async (req, res) => {
  const provider = db.prepare('SELECT * FROM backup_providers WHERE id=?').get(req.params.id);
  if (!provider) return res.status(404).json({ error: 'Backup provider not found' });
  try {
    res.json(await backupService.testProvider(provider));
  } catch (err) {
    res.status(422).json({ error: err.message });
  }
});

router.get('/plans', (req, res) => {
  const plans = db.prepare(`
    SELECT p.*, pr.name AS project_name, bp.name AS provider_name, bp.type AS provider_type,
      (SELECT status FROM backup_tasks t WHERE t.plan_id=p.id ORDER BY t.id DESC LIMIT 1) AS last_status
    FROM backup_plans p
    JOIN projects pr ON pr.id=p.project_id
    JOIN backup_providers bp ON bp.id=p.provider_id
    ORDER BY p.id DESC
  `).all();
  res.json(plans.map(serializePlan));
});

router.post('/plans', async (req, res) => {
  try {
    const {
      project_id, provider_id, name, volume_selections, remote_path = '', pause_project = true, retention_count = 3,
      schedule_enabled = false, interval_hours = 24, enabled = true
    } = req.body || {};
    const project = db.prepare('SELECT * FROM projects WHERE id=?').get(project_id);
    const provider = db.prepare('SELECT * FROM backup_providers WHERE id=?').get(provider_id);
    if (!project || !provider) return res.status(400).json({ error: 'A valid project and provider are required' });
    const selections = normalizeVolumeSelections(volume_selections);
    const available = new Set((await backupService.getProjectVolumeResources(project)).map(v => v.name));
    const missing = selections.filter(v => !available.has(v.name)).map(v => v.name);
    if (missing.length) return res.status(400).json({ error: `Volumes are not attached to the project: ${missing.join(', ')}` });
    const nextRunAt = schedule_enabled ? computeNextRun(interval_hours) : null;
    const normalizedRemotePath = normalizeRemotePath(remote_path);
    const result = db.prepare(`
      INSERT INTO backup_plans
      (project_id, provider_id, name, volume_selections, remote_path, pause_project, retention_count, schedule_enabled, interval_hours, next_run_at, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      project.id, provider.id, name || `${project.name} backup`, JSON.stringify(selections), normalizedRemotePath,
      pause_project ? 1 : 0, Math.max(0, Math.min(Number(retention_count) || 0, 100)),
      schedule_enabled ? 1 : 0, Math.max(1, Number(interval_hours) || 24), nextRunAt, enabled ? 1 : 0
    );
    res.status(201).json(serializePlan(db.prepare('SELECT * FROM backup_plans WHERE id=?').get(result.lastInsertRowid)));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/plans/:id', async (req, res) => {
  const existing = db.prepare('SELECT * FROM backup_plans WHERE id=?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Backup plan not found' });
  try {
    const projectId = req.body.project_id === undefined ? existing.project_id : Number(req.body.project_id);
    const providerId = req.body.provider_id === undefined ? existing.provider_id : Number(req.body.provider_id);
    const project = db.prepare('SELECT * FROM projects WHERE id=?').get(projectId);
    const provider = db.prepare('SELECT * FROM backup_providers WHERE id=?').get(providerId);
    if (!project || !provider) return res.status(400).json({ error: 'A valid project and provider are required' });
    const selections = req.body.volume_selections === undefined
      ? parseJson(existing.volume_selections, [])
      : normalizeVolumeSelections(req.body.volume_selections);
    const available = new Set((await backupService.getProjectVolumeResources(project)).map(v => v.name));
    const existingNames = projectId === existing.project_id
      ? new Set(parseJson(existing.volume_selections, []).map(item => item.name))
      : new Set();
    const missing = selections.filter(v => !available.has(v.name) && !existingNames.has(v.name)).map(v => v.name);
    if (missing.length) return res.status(400).json({ error: `Volumes are not attached to the project: ${missing.join(', ')}` });
    const intervalHours = req.body.interval_hours === undefined ? existing.interval_hours : Math.max(1, Number(req.body.interval_hours) || 24);
    const scheduleEnabled = req.body.schedule_enabled === undefined ? existing.schedule_enabled : (req.body.schedule_enabled ? 1 : 0);
    const nextRunAt = scheduleEnabled
      ? (existing.next_run_at && req.body.interval_hours === undefined ? existing.next_run_at : computeNextRun(intervalHours))
      : null;
    const normalizedRemotePath = req.body.remote_path === undefined
      ? existing.remote_path
      : normalizeRemotePath(req.body.remote_path);
    const retentionCount = req.body.retention_count === undefined
      ? existing.retention_count
      : Math.max(0, Math.min(Number(req.body.retention_count) || 0, 100));
    db.prepare(`
      UPDATE backup_plans SET project_id=?, provider_id=?, name=?, volume_selections=?, remote_path=?, pause_project=?, retention_count=?,
      schedule_enabled=?, interval_hours=?, next_run_at=?, enabled=?, updated_at=CURRENT_TIMESTAMP WHERE id=?
    `).run(
      projectId, providerId, req.body.name === undefined ? existing.name : req.body.name,
      JSON.stringify(selections), normalizedRemotePath,
      req.body.pause_project === undefined ? existing.pause_project : (req.body.pause_project ? 1 : 0),
      retentionCount, scheduleEnabled, intervalHours, nextRunAt,
      req.body.enabled === undefined ? existing.enabled : (req.body.enabled ? 1 : 0), existing.id
    );
    res.json(serializePlan(db.prepare('SELECT * FROM backup_plans WHERE id=?').get(existing.id)));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/plans/:id', (req, res) => {
  const active = db.prepare(`SELECT id FROM backup_tasks WHERE plan_id=? AND status IN ('queued','running')`).get(req.params.id);
  if (active) return res.status(409).json({ error: 'Wait for the active backup task to finish before deleting this plan' });
  const result = db.prepare('DELETE FROM backup_plans WHERE id=?').run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'Backup plan not found' });
  res.json({ message: 'Backup plan deleted' });
});

router.post('/plans/:id/run', (req, res) => {
  try {
    res.status(202).json(backupService.createTask(Number(req.params.id), 'manual'));
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

router.get('/tasks', (req, res) => {
  res.json(backupService.listTasks(req.query.limit));
});

router.get('/tasks/:id', (req, res) => {
  const task = backupService.getTask(req.params.id);
  if (!task) return res.status(404).json({ error: 'Backup task not found' });
  if (task.operation_id) {
    const operation = operationService.get(task.operation_id);
    const project = task.project_id ? db.prepare('SELECT * FROM projects WHERE id=?').get(task.project_id) : null;
    task.diagnostic_report = operationService.report(operation, project, '', task.log);
  }
  res.json(task);
});

module.exports = router;
