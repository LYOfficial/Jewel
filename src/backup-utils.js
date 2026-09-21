const path = require('path');

const PROVIDER_TYPES = new Set(['local', 'r2', 'onedrive', 'baidu', 'anyshare']);

function parseJson(value, fallback) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}

function normalizeRelativePath(value) {
  const raw = String(value == null ? '/' : value).trim().replace(/\\/g, '/');
  if (!raw || raw === '/') return '/';
  if (raw.split('/').some(segment => segment === '..')) {
    throw new Error(`Invalid volume path: ${value}`);
  }
  const normalized = path.posix.normalize(`/${raw}`).replace(/^\/+/, '');
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new Error(`Invalid volume path: ${value}`);
  }
  return normalized;
}

function normalizeVolumeSelections(value) {
  const input = Array.isArray(value) ? value : parseJson(value, []);
  const seen = new Set();
  const selections = [];
  for (const item of input) {
    const name = String(item && item.name || '').trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name) || seen.has(name)) continue;
    seen.add(name);
    const rawPaths = Array.isArray(item.paths) && item.paths.length ? item.paths : ['/'];
    const paths = [...new Set(rawPaths.map(normalizeRelativePath))];
    selections.push({ name, paths });
  }
  if (!selections.length) throw new Error('Select at least one valid named volume');
  return selections;
}

function normalizeScheduleTime(value, fallback = '03:00') {
  const text = String(value == null || value === '' ? fallback : value).trim();
  const match = /^(\d{2}):(\d{2})$/.exec(text);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) {
    throw new Error('Schedule time must use HH:mm between 00:00 and 23:59');
  }
  return text;
}

function getZonedDateParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const values = Object.fromEntries(parts
    .filter(part => ['year', 'month', 'day', 'hour', 'minute'].includes(part.type))
    .map(part => [part.type, Number(part.value)]));
  return values;
}

function zonedDateTimeToUtc(year, month, day, hour, minute, timeZone) {
  const intended = Date.UTC(year, month - 1, day, hour, minute);
  let timestamp = intended;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = getZonedDateParts(new Date(timestamp), timeZone);
    const adjustment = intended - Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute);
    if (!adjustment) break;
    timestamp += adjustment;
  }
  return timestamp;
}

function computeNextRun(scheduleTime, timeZone = 'Asia/Shanghai', from = new Date()) {
  const [hour, minute] = normalizeScheduleTime(scheduleTime).split(':').map(Number);
  const now = from instanceof Date ? from : new Date(from);
  if (Number.isNaN(now.getTime())) throw new Error('Invalid schedule reference time');
  const local = getZonedDateParts(now, timeZone);
  let timestamp = zonedDateTimeToUtc(local.year, local.month, local.day, hour, minute, timeZone);
  if (timestamp <= now.getTime()) {
    const tomorrow = new Date(Date.UTC(local.year, local.month - 1, local.day + 1));
    timestamp = zonedDateTimeToUtc(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, tomorrow.getUTCDate(), hour, minute, timeZone);
  }
  return new Date(timestamp).toISOString();
}

function safeSegment(value, fallback = 'backup') {
  const text = String(value || '').trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return text || fallback;
}

function normalizeRemotePath(value) {
  const raw = String(value || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!raw) return '';
  if (raw.split('/').some(segment => segment === '..')) {
    throw new Error(`Invalid remote backup path: ${value}`);
  }
  const normalized = path.posix.normalize(`/${raw}`).replace(/^\/+/, '');
  if (!normalized || normalized === '.') return '';
  if (normalized.startsWith('../') || normalized.includes('/../')) {
    throw new Error(`Invalid remote backup path: ${value}`);
  }
  return normalized;
}

function buildRemotePath(basePath, projectName, archiveName) {
  return [normalizeRemotePath(basePath), safeSegment(projectName, 'project'), archiveName]
    .map(v => String(v || '').replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');
}

function resolveLocalDestination(rootDirectory, remotePath) {
  const root = path.resolve(rootDirectory);
  const normalized = normalizeRemotePath(remotePath);
  const destination = path.resolve(root, ...normalized.split('/').filter(Boolean));
  const relative = path.relative(root, destination);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Backup destination escapes the configured local directory');
  }
  return destination;
}

function maskConfig(config) {
  const result = {};
  const secretKey = /(secret|token|password|cookie|key|bduss|link)/i;
  for (const [key, value] of Object.entries(config || {})) {
    result[key] = secretKey.test(key) && value ? '••••••••' : value;
  }
  return result;
}

function validateProvider(type, config) {
  if (!PROVIDER_TYPES.has(type)) throw new Error('Unsupported backup provider type');
  const required = {
    local: ['directory'],
    r2: ['endpoint', 'access_key_id', 'secret_access_key', 'bucket'],
    onedrive: ['remote_name'],
    baidu: ['config_dir'],
    anyshare: ['share_link']
  }[type];
  const missing = required.filter(key => !String(config && config[key] || '').trim());
  if (missing.length) throw new Error(`Missing provider configuration: ${missing.join(', ')}`);
  if (type === 'local' && !path.isAbsolute(String(config.directory))) {
    throw new Error('Local backup directory must be an absolute path');
  }
  normalizeRemotePath(config && config.base_path);
}

module.exports = {
  PROVIDER_TYPES,
  parseJson,
  normalizeRelativePath,
  normalizeVolumeSelections,
  normalizeScheduleTime,
  computeNextRun,
  safeSegment,
  normalizeRemotePath,
  buildRemotePath,
  resolveLocalDestination,
  maskConfig,
  validateProvider
};
