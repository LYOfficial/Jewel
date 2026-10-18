const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const db = require('./database');
const config = require('./config');
const dockerService = require('./docker-service');

const HELPER_IMAGE = process.env.BACKUP_HELPER_IMAGE || 'busybox:1.36';

function root() {
  const value = path.join(config.dataDir, 'backups', 'incremental');
  fs.mkdirSync(path.join(value, 'objects'), { recursive: true });
  return value;
}

function safeRelative(value) {
  const normalized = path.relative(config.dataDir, value).replace(/\\/g, '/');
  if (!normalized || normalized === '..' || normalized.startsWith('../') || path.isAbsolute(normalized)) return null;
  return normalized;
}

function walk(directory, result = []) {
  if (!fs.existsSync(directory)) return result;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.name === 'backups' || entry.name === 'projects' || entry.name === 'jewel.db-wal' || entry.name === 'jewel.db-shm') continue;
    if (entry.isDirectory()) walk(full, result);
    else if (entry.isFile()) result.push(full);
  }
  return result;
}

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('error', reject);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function createDbCopy(target) {
  await db.backup(target);
}

async function prepareSnapshot({ task, plan, provider, archives, uploadObject, onProgress = () => {} }) {
  const previous = db.prepare(`SELECT * FROM backup_snapshots WHERE plan_id=? AND status='succeeded' ORDER BY id DESC LIMIT 1`).get(plan.id);
  const mode = previous ? 'incremental' : 'full';
  const tempDir = path.join(root(), 'tmp', String(task.id));
  fs.mkdirSync(tempDir, { recursive: true });
  const dbCopy = path.join(tempDir, 'jewel.db');
  if (plan.include_platform_data !== 0) await createDbCopy(dbCopy);

  const previousManifest = mode === 'incremental' && previous ? JSON.parse(previous.manifest_json || '{}') : {};
  const fileMap = new Map((previousManifest.files || []).map(item => [item.path, item]));
  const files = [];
  const sources = plan.include_platform_data === 0 ? [] : [{ absolute: dbCopy, relative: 'jewel.db', kind: 'platform' }];
  if (plan.include_platform_data !== 0) {
    for (const absolute of walk(config.dataDir)) {
      const relative = safeRelative(absolute);
      if (relative && relative !== 'jewel.db') sources.push({ absolute, relative, kind: 'platform' });
    }
  }
  for (const archive of archives) {
    sources.push({
      absolute: archive.local_path,
      relative: `volumes/${archive.volume}/${archive.source_path.replace(/^\//, '') || 'root'}.tar.gz`,
      kind: 'volume',
      volume: archive.volume,
      source_path: archive.source_path
    });
  }

  const objectDir = path.join(root(), 'objects');
  const objects = [];
  const currentPaths = new Set(sources.map(source => source.relative));
  let bytesTotal = 0;
  onProgress(`本地副本已完成，开始处理 ${sources.length} 个增量对象`);
  let processed = 0;
  for (const source of sources) {
    const previousFile = fileMap.get(source.relative);
    const stat = fs.statSync(source.absolute);
    const canReuseHash = source.kind === 'platform' && previousFile
      && previousFile.size === stat.size && previousFile.mtimeMs === stat.mtimeMs;
    const hash = canReuseHash ? previousFile.hash : await sha256(source.absolute);
    const objectPath = path.join(objectDir, hash);
    const existed = fs.existsSync(objectPath);
    if (!existed) fs.copyFileSync(source.absolute, objectPath);
    const object = { hash, size: stat.size, local_path: objectPath, uploaded: existed, ...source };
    const descriptor = { path: source.relative, hash, size: stat.size, mtimeMs: stat.mtimeMs, kind: source.kind, volume: source.volume, source_path: source.source_path };
    fileMap.set(source.relative, descriptor);
    objects.push(object);
    if (!existed) bytesTotal += stat.size;
    processed += 1;
    if (processed % 25 === 0 || processed === sources.length) onProgress(`已处理 ${processed}/${sources.length} 个对象`);
  }

  for (const [key, value] of fileMap) {
    if ((value.kind === 'platform' || value.kind === 'volume') && !currentPaths.has(key)) fileMap.delete(key);
  }

  files.push(...fileMap.values());
  const result = db.prepare(`
    INSERT INTO backup_snapshots (plan_id, task_id, provider_id, parent_id, mode, status, manifest_json, bytes_total)
    VALUES (?, ?, ?, ?, ?, 'running', ?, ?)
  `).run(plan.id, task.id, provider.id, previous ? previous.id : null, mode, JSON.stringify({ files }), bytesTotal);
  const snapshotId = Number(result.lastInsertRowid);
  const uploaded = [];
  try {
    for (const object of objects.filter(item => !item.uploaded)) {
      object.remote = await uploadObject(object, snapshotId);
      uploaded.push(object);
    }
    for (const object of uploaded) {
      const file = files.find(item => item.hash === object.hash);
      if (file) file.remote = object.remote;
    }
    const manifest = { version: 1, snapshot_id: snapshotId, plan_id: plan.id, provider_id: provider.id, mode, parent_id: previous ? previous.id : null, files };
    const manifestPath = path.join(root(), `manifest-${snapshotId}.json`);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    const manifestRemote = await uploadObject({
      local_path: manifestPath,
      hash: await sha256(manifestPath),
      size: fs.statSync(manifestPath).size,
      name: `manifest-${snapshotId}.json`,
      kind: 'manifest'
    }, snapshotId);
    manifest.remote = manifestRemote;
    db.prepare('UPDATE backup_snapshots SET status=\'succeeded\', manifest_json=?, completed_at=CURRENT_TIMESTAMP WHERE id=?')
      .run(JSON.stringify(manifest), snapshotId);
    db.prepare('UPDATE backup_tasks SET snapshot_id=? WHERE id=?').run(snapshotId, task.id);
    fs.rmSync(tempDir, { recursive: true, force: true });
    return { id: snapshotId, mode, bytes_total: bytesTotal, manifest };
  } catch (error) {
    db.prepare('UPDATE backup_snapshots SET status=\'failed\', error=?, completed_at=CURRENT_TIMESTAMP WHERE id=?').run(error.message, snapshotId);
    throw error;
  }
}

function listSnapshots(limit = 50) {
  const rows = db.prepare(`
    SELECT s.*, p.name AS plan_name, bp.name AS provider_name
    FROM backup_snapshots s
    LEFT JOIN backup_plans p ON p.id=s.plan_id
    LEFT JOIN backup_providers bp ON bp.id=s.provider_id
    ORDER BY s.id DESC LIMIT ?
  `).all(Math.max(1, Math.min(Number(limit) || 50, 200))).map(item => ({ ...item, manifest: JSON.parse(item.manifest_json || '{}') }));
  const known = new Set(rows.map(item => Number(item.id)));
  const directory = root();
  if (fs.existsSync(directory)) {
    for (const name of fs.readdirSync(directory).filter(item => /^manifest-\d+\.json$/.test(item))) {
      const manifest = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
      if (!manifest.snapshot_id || known.has(Number(manifest.snapshot_id))) continue;
      rows.push({ id: manifest.snapshot_id, plan_id: manifest.plan_id, provider_id: manifest.provider_id, mode: manifest.mode, status: 'orphaned', bytes_total: 0, created_at: fs.statSync(path.join(directory, name)).mtime.toISOString(), manifest, plan_name: '数据库丢失后的本地恢复点', provider_name: '本地增量对象' });
    }
  }
  return rows.sort((a, b) => Number(b.id) - Number(a.id)).slice(0, Math.max(1, Math.min(Number(limit) || 50, 200)));
}

function pruneSnapshots(planId, retentionCount) {
  const keep = Math.max(0, Math.min(Number(retentionCount) || 0, 100));
  const rows = db.prepare("SELECT id, manifest_json FROM backup_snapshots WHERE plan_id=? AND status='succeeded' ORDER BY id DESC").all(planId);
  const removed = rows.slice(keep);
  if (!removed.length) return 0;
  const remove = db.transaction(items => {
    for (const item of items) db.prepare('DELETE FROM backup_snapshots WHERE id=?').run(item.id);
  });
  remove(removed);
  const referenced = new Set();
  for (const row of db.prepare("SELECT manifest_json FROM backup_snapshots WHERE status='succeeded'").all()) {
    for (const file of JSON.parse(row.manifest_json || '{}').files || []) referenced.add(file.hash);
  }
  const objectDir = path.join(root(), 'objects');
  for (const name of fs.readdirSync(objectDir)) {
    if (!referenced.has(name)) fs.rmSync(path.join(objectDir, name), { force: true });
  }
  return removed.length;
}

async function restoreSnapshot(snapshotId, downloadObject = null) {
  let snapshot = db.prepare('SELECT * FROM backup_snapshots WHERE id=? AND status=\'succeeded\'').get(snapshotId);
  let manifest;
  if (snapshot) manifest = JSON.parse(snapshot.manifest_json || '{}');
  else {
    const manifestPath = path.join(root(), `manifest-${snapshotId}.json`);
    if (!fs.existsSync(manifestPath)) throw new Error('Backup snapshot not found or is not complete');
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    snapshot = { id: snapshotId, manifest_json: JSON.stringify(manifest) };
  }
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  const objectDir = path.join(root(), 'objects');
  const stage = path.join(root(), 'restore', `${snapshotId}-${Date.now()}`);
  fs.mkdirSync(stage, { recursive: true });
  try {
    for (const item of files.filter(file => file.kind === 'platform')) {
      const object = path.join(objectDir, item.hash);
      if (!fs.existsSync(object) && downloadObject) await downloadObject(item, object);
      if (!fs.existsSync(object) || await sha256(object) !== item.hash) throw new Error(`Snapshot object is missing or corrupt: ${item.path}`);
      const target = path.resolve(stage, item.path);
      if (!target.startsWith(`${path.resolve(stage)}${path.sep}`) && target !== path.resolve(stage)) throw new Error('Invalid snapshot path');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(object, target);
    }
    for (const item of files.filter(file => file.kind === 'platform')) {
      const staged = path.resolve(stage, item.path);
      const target = path.resolve(config.dataDir, item.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(staged, target);
    }
    const volumeFiles = files.filter(file => file.kind === 'volume');
    if (volumeFiles.length) {
      const docker = dockerService.getDocker();
      const byVolume = new Map();
      for (const item of volumeFiles) {
        if (!byVolume.has(item.volume)) byVolume.set(item.volume, []);
        byVolume.get(item.volume).push(item);
      }
      for (const [volume, items] of byVolume) {
        const container = await docker.createContainer({
          Image: HELPER_IMAGE,
          Cmd: ['sh', '-c', 'trap : TERM INT; sleep 600 & wait'],
          HostConfig: { Binds: [`${volume}:/volume`] }
        });
        try {
          await container.start();
          for (const item of items) {
            const object = path.join(objectDir, item.hash);
            if (!fs.existsSync(object) && downloadObject) await downloadObject(item, object);
            if (!fs.existsSync(object) || await sha256(object) !== item.hash) throw new Error(`Snapshot object is missing or corrupt: ${item.path}`);
            const stream = fs.createReadStream(object).pipe(zlib.createGunzip());
            const destination = item.source_path === '/' ? '/volume' : `/volume/${item.source_path.replace(/^\/+/, '')}`;
            await container.putArchive(stream, { path: destination });
          }
        } finally {
          try { await container.remove({ force: true }); } catch { /* best effort */ }
        }
      }
    }
    return { id: snapshot.id, restored: files.length, restart_required: true };
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

module.exports = { prepareSnapshot, listSnapshots, restoreSnapshot, pruneSnapshots, root };
