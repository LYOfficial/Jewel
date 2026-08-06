const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');
const { spawn } = require('child_process');
const db = require('./database');
const config = require('./config');
const dockerService = require('./docker-service');
const operations = require('./operation-service');
const {
  parseJson,
  normalizeRelativePath,
  normalizeVolumeSelections,
  computeNextRun,
  safeSegment,
  normalizeRemotePath,
  buildRemotePath,
  resolveLocalDestination
} = require('./backup-utils');

const HELPER_IMAGE = process.env.BACKUP_HELPER_IMAGE || 'busybox:1.36';
const DOCKER_READ_TIMEOUT_MS = Math.max(1000, Number(process.env.DOCKER_READ_TIMEOUT_MS) || 8000);
const runningPlans = new Set();
let scheduler = null;
let schedulerTickPromise = null;
let helperImagePromise = null;

function withTimeout(promise, label, timeoutMs = DOCKER_READ_TIMEOUT_MS) {
  let timeout;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      if (timeout.unref) timeout.unref();
    })
  ]).finally(() => clearTimeout(timeout));
}

function getBackupRoot() {
  const dir = path.join(config.dataDir, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getBackupStagingRoot() {
  const dir = path.join(getBackupRoot(), 'staging');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function appendTaskLog(taskId, message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  const row = db.prepare('SELECT log FROM backup_tasks WHERE id = ?').get(taskId);
  const next = `${row && row.log || ''}${line}`.slice(-200000);
  db.prepare('UPDATE backup_tasks SET log = ? WHERE id = ?').run(next, taskId);
}

function setTaskPhase(taskId, phase, status) {
  if (status) {
    db.prepare('UPDATE backup_tasks SET phase = ?, status = ? WHERE id = ?').run(phase, status, taskId);
  } else {
    db.prepare('UPDATE backup_tasks SET phase = ? WHERE id = ?').run(phase, taskId);
  }
}

function readPausedContainerIds(taskId) {
  const row = db.prepare('SELECT paused_container_ids FROM backup_tasks WHERE id = ?').get(taskId);
  const ids = parseJson(row && row.paused_container_ids, []);
  return Array.isArray(ids) ? [...new Set(ids.map(String).filter(Boolean))] : [];
}

function writePausedContainerIds(taskId, ids) {
  const normalized = [...new Set((ids || []).map(String).filter(Boolean))];
  db.prepare('UPDATE backup_tasks SET paused_container_ids = ? WHERE id = ?')
    .run(JSON.stringify(normalized), taskId);
  return normalized;
}

function isMissingContainerError(err) {
  return Boolean(err && (
    err.statusCode === 404 ||
    err.status === 404 ||
    /no such container|container .* not found/i.test(err.message || '')
  ));
}

function isPathInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function removeEmptyParentDirectories(startDirectory, stopDirectory) {
  let current = path.resolve(startDirectory);
  const stop = path.resolve(stopDirectory);
  while (current !== stop && isPathInside(stop, current)) {
    try {
      fs.rmdirSync(current);
    } catch {
      break;
    }
    current = path.dirname(current);
  }
}

function clearTaskLocalArchives(task) {
  const backupRoot = getBackupRoot();
  const archives = parseJson(task.archives, []);
  let removed = 0;
  const parentDirectories = new Set();
  const updated = archives.map(archive => {
    const localPath = archive && archive.local_path ? path.resolve(archive.local_path) : '';
    if (localPath && isPathInside(backupRoot, localPath)) {
      try {
        if (fs.statSync(localPath).isFile()) {
          fs.unlinkSync(localPath);
          removed += 1;
          parentDirectories.add(path.dirname(localPath));
        }
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
    }
    return {
      ...archive,
      local_path: '',
      local_available: false,
      local_deleted_at: new Date().toISOString()
    };
  });
  for (const directory of parentDirectories) removeEmptyParentDirectories(directory, backupRoot);
  db.prepare('UPDATE backup_tasks SET archives=? WHERE id=?').run(JSON.stringify(updated), task.id);
  if (removed) appendTaskLog(task.id, `Removed ${removed} local staging archive(s) according to the retention policy`);
  return removed;
}

function prunePlanTaskArchives(planId, retentionCount) {
  const keep = Math.max(0, Math.min(Number(retentionCount) || 0, 100));
  const tasks = db.prepare(`
    SELECT id, archives FROM backup_tasks
    WHERE plan_id=? AND status='succeeded'
    ORDER BY id DESC
  `).all(planId);
  let removed = 0;
  for (const task of tasks.slice(keep)) removed += clearTaskLocalArchives(task);
  return removed;
}

async function getProjectVolumeResources(project, discoveredContainers = null, discoveredVolumes = null) {
  const containers = discoveredContainers || await withTimeout(
    dockerService.getProjectContainers(project.name),
    'Reading project containers'
  );
  const volumeMap = new Map();
  for (const container of containers) {
    const containerName = ((container.Names && container.Names[0]) || container.Id).replace(/^\//, '');
    for (const mount of container.Mounts || []) {
      if (mount.Type !== 'volume' || !mount.Name) continue;
      if (!volumeMap.has(mount.Name)) {
        volumeMap.set(mount.Name, {
          name: mount.Name,
          destinations: [],
          containers: [],
          project_id: project.id,
          project_name: project.name
        });
      }
      const item = volumeMap.get(mount.Name);
      if (mount.Destination && !item.destinations.includes(mount.Destination)) item.destinations.push(mount.Destination);
      if (!item.containers.includes(containerName)) item.containers.push(containerName);
    }
  }
  try {
    const volumes = discoveredVolumes || (await withTimeout(
      dockerService.getDocker().listVolumes(),
      'Reading Docker volumes'
    )).Volumes || [];
    for (const volume of volumes) {
      const labels = volume.Labels || {};
      if (labels['com.docker.compose.project'] !== project.name) continue;
      if (!volumeMap.has(volume.Name)) {
        volumeMap.set(volume.Name, {
          name: volume.Name,
          destinations: [],
          containers: [],
          project_id: project.id,
          project_name: project.name
        });
      }
    }
  } catch { /* container mount discovery above still works */ }
  return [...volumeMap.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function listVolumeResources(projectId) {
  const projects = projectId
    ? db.prepare('SELECT * FROM projects WHERE id = ?').all(projectId)
    : db.prepare('SELECT * FROM projects ORDER BY name').all();
  if (!projects.length) return [];
  const [containersResult, volumesResult] = await Promise.allSettled([
    withTimeout(dockerService.listContainers(true), 'Reading Docker containers'),
    withTimeout(dockerService.getDocker().listVolumes(), 'Reading Docker volumes')
  ]);
  const containers = containersResult.status === 'fulfilled' ? containersResult.value : [];
  const volumes = volumesResult.status === 'fulfilled' ? (volumesResult.value.Volumes || []) : [];
  const all = [];
  for (const project of projects) {
    const projectContainers = containers.filter(container =>
      container.Labels && container.Labels['com.docker.compose.project'] === project.name
    );
    all.push(...await getProjectVolumeResources(project, projectContainers, volumes));
  }
  return all;
}

async function ensureHelperImage(taskId) {
  if (helperImagePromise) return helperImagePromise;
  helperImagePromise = (async () => {
    const docker = dockerService.getDocker();
    try {
      await docker.getImage(HELPER_IMAGE).inspect();
      return;
    } catch { /* pull below */ }
    appendTaskLog(taskId, `Pulling backup helper image ${HELPER_IMAGE}`);
    const stream = await new Promise((resolve, reject) => {
      docker.pull(HELPER_IMAGE, (err, output) => err ? reject(err) : resolve(output));
    });
    await new Promise((resolve, reject) => {
      docker.modem.followProgress(stream, err => err ? reject(err) : resolve());
    });
  })().catch(err => {
    helperImagePromise = null;
    throw err;
  });
  return helperImagePromise;
}

async function archiveVolume(taskId, project, selection, taskDir) {
  await ensureHelperImage(taskId);
  const docker = dockerService.getDocker();
  const container = await docker.createContainer({
    Image: HELPER_IMAGE,
    Cmd: ['sh', '-c', 'trap : TERM INT; sleep 600 & wait'],
    Labels: {
      'io.jewel.managed': 'true',
      'io.jewel.purpose': 'volume-backup',
      'io.jewel.task': String(taskId)
    },
    HostConfig: { Binds: [`${selection.name}:/volume:ro`] }
  });

  const archives = [];
  try {
    await container.start();
    for (const selectedPath of selection.paths) {
      const relative = normalizeRelativePath(selectedPath);
      const target = relative === '/' ? '/volume' : `/volume/${relative}`;
      const pathLabel = relative === '/' ? 'root' : safeSegment(relative.replace(/\//g, '-'), 'path');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const archiveName = `${safeSegment(project.name)}__${safeSegment(selection.name)}__${pathLabel}__${stamp}.tar.gz`;
      const archivePath = path.join(taskDir, archiveName);
      appendTaskLog(taskId, `Archiving ${selection.name}:${relative}`);
      const archiveStream = await container.getArchive({ path: target });
      await pipeline(archiveStream, zlib.createGzip({ level: 6 }), fs.createWriteStream(archivePath));
      const stat = fs.statSync(archivePath);
      archives.push({
        volume: selection.name,
        source_path: relative,
        name: archiveName,
        local_path: archivePath,
        size: stat.size
      });
      appendTaskLog(taskId, `Created ${archiveName} (${stat.size} bytes)`);
    }
  } finally {
    try { await container.remove({ force: true, v: false }); } catch { /* best effort */ }
  }
  return archives;
}

async function pauseProjectContainers(taskId, project, pausedByUs = []) {
  const containers = await dockerService.getProjectContainers(project.name);
  for (const item of containers) {
    if (item.State !== 'running') continue;
    appendTaskLog(taskId, `Pausing container ${((item.Names || [item.Id])[0] || item.Id).replace(/^\//, '')}`);
    pausedByUs.push(item.Id);
    writePausedContainerIds(taskId, pausedByUs);
    await dockerService.pauseContainer(item.Id);
    appendTaskLog(taskId, `Paused container ${item.Id.substring(0, 12)}`);
  }
  return pausedByUs;
}

async function resumeProjectContainers(taskId, ids) {
  let remaining = [...new Set((ids || []).map(String).filter(Boolean))];
  for (const id of [...remaining]) {
    try {
      const info = await dockerService.getContainerInfo(id);
      if (info && info.State && info.State.Paused) {
        await dockerService.unpauseContainer(id);
        appendTaskLog(taskId, `Resumed container ${id.substring(0, 12)}`);
      } else {
        appendTaskLog(taskId, `Container ${id.substring(0, 12)} is already active`);
      }
      remaining = remaining.filter(item => item !== id);
      writePausedContainerIds(taskId, remaining);
    } catch (err) {
      if (isMissingContainerError(err)) {
        appendTaskLog(taskId, `Container ${id.substring(0, 12)} no longer exists; recovery is not required`);
        remaining = remaining.filter(item => item !== id);
        writePausedContainerIds(taskId, remaining);
      } else {
        appendTaskLog(taskId, `Warning: failed to resume ${id.substring(0, 12)}: ${err.message}`);
      }
    }
  }
  return remaining;
}

function runCommand(binary, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd: options.cwd,
      env: { ...process.env, ...(options.env || {}) },
      windowsHide: true,
      shell: false
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timeout = Number(options.timeoutMs) > 0
      ? setTimeout(() => {
        timedOut = true;
        child.kill();
      }, Number(options.timeoutMs))
      : null;
    if (timeout && timeout.unref) timeout.unref();
    child.stdout.on('data', chunk => { stdout = `${stdout}${chunk}`.slice(-100000); });
    child.stderr.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-100000); });
    child.on('error', err => {
      if (timeout) clearTimeout(timeout);
      reject(err);
    });
    child.on('close', code => {
      if (timeout) clearTimeout(timeout);
      if (timedOut) return reject(new Error(`${binary} timed out after ${options.timeoutMs}ms`));
      if (code === 0) return resolve({ stdout, stderr });
      const err = new Error(`${binary} exited with code ${code}: ${(stderr || stdout).trim()}`);
      err.code = code;
      reject(err);
    });
  });
}

function r2Environment(providerConfig) {
  return {
    RCLONE_CONFIG_JEWELR2_TYPE: 's3',
    RCLONE_CONFIG_JEWELR2_PROVIDER: 'Cloudflare',
    RCLONE_CONFIG_JEWELR2_ACCESS_KEY_ID: providerConfig.access_key_id,
    RCLONE_CONFIG_JEWELR2_SECRET_ACCESS_KEY: providerConfig.secret_access_key,
    RCLONE_CONFIG_JEWELR2_ENDPOINT: providerConfig.endpoint,
    RCLONE_CONFIG_JEWELR2_ACL: 'private'
  };
}

function oneDriveEnvironment(providerConfig) {
  const remoteName = safeSegment(providerConfig.remote_name, 'jewelonedrive');
  const envKey = remoteName.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  const env = {};
  if (providerConfig.token) {
    env[`RCLONE_CONFIG_${envKey}_TYPE`] = 'onedrive';
    env[`RCLONE_CONFIG_${envKey}_TOKEN`] = providerConfig.token;
    if (providerConfig.drive_id) env[`RCLONE_CONFIG_${envKey}_DRIVE_ID`] = providerConfig.drive_id;
    if (providerConfig.drive_type) env[`RCLONE_CONFIG_${envKey}_DRIVE_TYPE`] = providerConfig.drive_type;
  }
  return { remoteName, env };
}

async function uploadArchive(taskId, provider, project, plan, archive, commandRunner = runCommand) {
  const providerConfig = parseJson(provider.config_json, {});
  const remoteBase = [providerConfig.base_path, plan.remote_path].filter(Boolean).join('/');
  const remotePath = buildRemotePath(remoteBase, project.name, archive.name);
  appendTaskLog(taskId, `Uploading ${archive.name} to ${provider.type}:${remotePath}`);

  if (provider.type === 'local') {
    const destination = resolveLocalDestination(providerConfig.directory, remotePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    await fs.promises.copyFile(archive.local_path, destination);
    return destination;
  }

  if (provider.type === 'r2') {
    const env = r2Environment(providerConfig);
    const target = `jewelr2:${String(providerConfig.bucket).replace(/^\/+|\/+$/g, '')}/${remotePath}`;
    await commandRunner('rclone', ['copyto', archive.local_path, target, '--stats-one-line', '--stats', '15s'], { env });
    return target;
  }

  if (provider.type === 'onedrive') {
    const { remoteName, env } = oneDriveEnvironment(providerConfig);
    const target = `${remoteName}:${remotePath}`;
    await commandRunner('rclone', ['copyto', archive.local_path, target, '--stats-one-line', '--stats', '15s'], { env });
    return target;
  }

  if (provider.type === 'baidu') {
    const base = normalizeRemotePath([providerConfig.base_path, plan.remote_path].filter(Boolean).join('/'));
    const target = ['Jewel', base, safeSegment(project.name), archive.name].filter(Boolean).join('/');
    await commandRunner('bypy', ['--config-dir', providerConfig.config_dir, 'upload', archive.local_path, target]);
    return target;
  }

  if (provider.type === 'anyshare') {
    const helper = path.join(__dirname, '..', 'scripts', 'anyshare_upload.py');
    const args = [helper, '--link', providerConfig.share_link, '--file', archive.local_path];
    if (providerConfig.base_url) args.push('--base-url', providerConfig.base_url);
    const targetPath = normalizeRemotePath(
      [providerConfig.base_path, plan.remote_path, safeSegment(project.name)].filter(Boolean).join('/')
    );
    if (targetPath) args.push('--path', targetPath);
    await commandRunner('python3', args);
    return `${targetPath}/${archive.name}`.replace(/^\//, '');
  }

  throw new Error(`Unsupported provider: ${provider.type}`);
}

async function runTask(taskId) {
  const task = db.prepare('SELECT * FROM backup_tasks WHERE id = ?').get(taskId);
  if (!task) throw new Error('Backup task not found');
  const plan = task.plan_id ? db.prepare('SELECT * FROM backup_plans WHERE id = ?').get(task.plan_id) : null;
  if (!plan) throw new Error('Backup plan not found');
  if (runningPlans.has(plan.id)) throw new Error('This backup plan is already running');
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(plan.project_id);
  const provider = db.prepare('SELECT * FROM backup_providers WHERE id = ?').get(plan.provider_id);
  if (!project || !provider) throw new Error('Project or backup provider no longer exists');

  runningPlans.add(plan.id);
  const opId = operations.start({
    projectId: project.id,
    resourceType: 'backup',
    resourceId: taskId,
    action: 'volume-backup',
    metadata: { plan_id: plan.id, provider: provider.type, project_name: project.name }
  });
  const previousStatus = project.status;
  db.prepare(`
    UPDATE backup_tasks
    SET operation_id=?, status='running', phase='preparing', started_at=?, previous_project_status=?, paused_container_ids='[]'
    WHERE id=?
  `).run(opId, new Date().toISOString(), previousStatus, taskId);

  const taskDir = path.join(getBackupStagingRoot(), String(taskId));
  fs.mkdirSync(taskDir, { recursive: true });
  let pausedIds = [];
  const archives = [];

  try {
    const selections = normalizeVolumeSelections(plan.volume_selections);
    const missing = [];
    for (const selection of selections) {
      try { await dockerService.getDocker().getVolume(selection.name).inspect(); }
      catch { missing.push(selection.name); }
    }
    if (missing.length) throw new Error(`Docker volumes no longer exist: ${missing.join(', ')}`);

    if (plan.pause_project) {
      setTaskPhase(taskId, 'pausing');
      db.prepare('UPDATE projects SET status = ? WHERE id = ?').run('backing-up', project.id);
      await pauseProjectContainers(taskId, project, pausedIds);
    }

    setTaskPhase(taskId, 'archiving');
    for (const selection of selections) {
      archives.push(...await archiveVolume(taskId, project, selection, taskDir));
      db.prepare('UPDATE backup_tasks SET archives=?, bytes_total=? WHERE id=?')
        .run(JSON.stringify(archives), archives.reduce((sum, item) => sum + item.size, 0), taskId);
    }

    setTaskPhase(taskId, 'uploading');
    for (const archive of archives) {
      archive.remote = await uploadArchive(taskId, provider, project, plan, archive);
      db.prepare('UPDATE backup_tasks SET archives=? WHERE id=?').run(JSON.stringify(archives), taskId);
    }

    setTaskPhase(taskId, 'resuming');
    pausedIds = await resumeProjectContainers(taskId, pausedIds);
    if (pausedIds.length) {
      throw new Error(`Could not resume ${pausedIds.length} project container(s)`);
    }
    db.prepare('UPDATE projects SET status = ? WHERE id = ?').run(previousStatus, project.id);

    const completedAt = new Date().toISOString();
    db.prepare(`
      UPDATE backup_tasks SET status='succeeded', phase='completed', archives=?, bytes_total=?, completed_at=? WHERE id=?
    `).run(JSON.stringify(archives), archives.reduce((sum, item) => sum + item.size, 0), completedAt, taskId);
    db.prepare('UPDATE backup_plans SET last_run_at=?, next_run_at=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
      .run(completedAt, computeNextRun(plan.interval_hours, new Date(completedAt)), plan.id);
    appendTaskLog(taskId, `Backup completed with ${archives.length} archive(s)`);
    operations.succeed(opId, {
      summary: `Backed up ${archives.length} archive(s) to ${provider.name}`,
      detail: archives.map(a => `${a.volume}:${a.source_path} -> ${a.remote}`).join('\n')
    });
    try {
      prunePlanTaskArchives(plan.id, plan.retention_count);
    } catch (err) {
      appendTaskLog(taskId, `Warning: failed to apply local archive retention: ${err.message}`);
    }
  } catch (err) {
    const persistedIds = readPausedContainerIds(taskId);
    pausedIds = await resumeProjectContainers(taskId, persistedIds.length ? persistedIds : pausedIds);
    const completedAt = new Date().toISOString();
    appendTaskLog(taskId, `Backup failed: ${err.message}`);
    const taskLog = db.prepare('SELECT log FROM backup_tasks WHERE id = ?').get(taskId)?.log || '';
    db.prepare('UPDATE backup_plans SET last_run_at=?, next_run_at=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
      .run(completedAt, computeNextRun(plan.interval_hours, new Date(completedAt)), plan.id);
    if (pausedIds.length) {
      db.prepare('UPDATE projects SET status = ? WHERE id = ?').run('backup-recovery', project.id);
      appendTaskLog(taskId, `Recovery pending for ${pausedIds.length} container(s); Jewel will retry automatically`);
      db.prepare(`UPDATE backup_tasks SET status='running', phase='recovery-pending', error=? WHERE id=?`)
        .run(err.message, taskId);
      return getTask(taskId);
    }
    db.prepare('UPDATE projects SET status = ? WHERE id = ?').run(previousStatus, project.id);
    db.prepare(`UPDATE backup_tasks SET status='failed', phase='failed', error=?, completed_at=? WHERE id=?`)
      .run(err.message, completedAt, taskId);
    operations.fail(opId, err, { summary: `Backup failed for ${project.name}`, detail: taskLog });
  } finally {
    runningPlans.delete(plan.id);
  }
  return getTask(taskId);
}

function createTask(planId, triggerType = 'manual') {
  const plan = db.prepare('SELECT * FROM backup_plans WHERE id = ?').get(planId);
  if (!plan) throw new Error('Backup plan not found');
  if (runningPlans.has(plan.id)) throw new Error('This backup plan is already running');
  const active = db.prepare(`SELECT id FROM backup_tasks WHERE plan_id=? AND status IN ('queued','running') LIMIT 1`).get(plan.id);
  if (active) throw new Error('This backup plan already has an active task');
  const result = db.prepare(`
    INSERT INTO backup_tasks (plan_id, project_id, provider_id, trigger_type)
    VALUES (?, ?, ?, ?)
  `).run(plan.id, plan.project_id, plan.provider_id, triggerType);
  const taskId = Number(result.lastInsertRowid);
  setImmediate(() => runTask(taskId).catch(err => {
    appendTaskLog(taskId, `Unhandled backup error: ${err.message}`);
    db.prepare(`UPDATE backup_tasks SET status='failed', phase='failed', error=?, completed_at=? WHERE id=?`)
      .run(err.message, new Date().toISOString(), taskId);
    runningPlans.delete(plan.id);
  }));
  return getTask(taskId);
}

function getTask(id) {
  const row = db.prepare(`
    SELECT t.*, p.name AS plan_name, pr.name AS project_name, bp.name AS provider_name, bp.type AS provider_type
    FROM backup_tasks t
    LEFT JOIN backup_plans p ON p.id=t.plan_id
    LEFT JOIN projects pr ON pr.id=t.project_id
    LEFT JOIN backup_providers bp ON bp.id=t.provider_id
    WHERE t.id=?
  `).get(id);
  if (row) row.archives = parseJson(row.archives, []);
  return row;
}

function listTasks(limit = 50) {
  const rows = db.prepare(`
    SELECT t.*, p.name AS plan_name, pr.name AS project_name, bp.name AS provider_name, bp.type AS provider_type
    FROM backup_tasks t
    LEFT JOIN backup_plans p ON p.id=t.plan_id
    LEFT JOIN projects pr ON pr.id=t.project_id
    LEFT JOIN backup_providers bp ON bp.id=t.provider_id
    ORDER BY t.id DESC LIMIT ?
  `).all(Math.max(1, Math.min(Number(limit) || 50, 200)));
  return rows.map(row => ({ ...row, archives: parseJson(row.archives, []) }));
}

async function testProvider(provider, commandRunner = runCommand) {
  const providerConfig = parseJson(provider.config_json, {});
  if (provider.type === 'local') {
    fs.mkdirSync(providerConfig.directory, { recursive: true });
    await fs.promises.access(providerConfig.directory, fs.constants.W_OK);
    return { ok: true, message: 'Local directory is writable' };
  }
  if (provider.type === 'r2') {
    const target = `jewelr2:${String(providerConfig.bucket).replace(/^\/+|\/+$/g, '')}`;
    await commandRunner('rclone', ['lsf', target, '--max-depth', '1'], {
      env: r2Environment(providerConfig), timeoutMs: 30000
    });
    return { ok: true, message: `Connected to Cloudflare R2 bucket ${providerConfig.bucket}` };
  }
  if (provider.type === 'onedrive') {
    const { remoteName, env } = oneDriveEnvironment(providerConfig);
    await commandRunner('rclone', ['lsf', `${remoteName}:`, '--max-depth', '1'], { env, timeoutMs: 30000 });
    return { ok: true, message: `Connected to OneDrive remote ${remoteName}` };
  }
  if (provider.type === 'baidu') {
    await commandRunner('bypy', ['--config-dir', providerConfig.config_dir, 'info'], { timeoutMs: 30000 });
    return { ok: true, message: 'Connected to Baidu Netdisk' };
  }
  if (provider.type === 'anyshare') {
    const helper = path.join(__dirname, '..', 'scripts', 'anyshare_upload.py');
    await fs.promises.access(helper, fs.constants.R_OK);
    const args = [helper, '--link', providerConfig.share_link, '--check'];
    if (providerConfig.base_url) args.push('--base-url', providerConfig.base_url);
    if (providerConfig.base_path) args.push('--path', normalizeRemotePath(providerConfig.base_path));
    await commandRunner('python3', args, { timeoutMs: 30000 });
    return { ok: true, message: 'Connected to AnyShare public share' };
  }
  throw new Error('Unsupported provider type');
}

async function runDuePlans() {
  const now = Date.now();
  const plans = db.prepare(`SELECT * FROM backup_plans WHERE enabled=1 AND schedule_enabled=1`).all();
  for (const plan of plans) {
    const dueAt = plan.next_run_at ? Date.parse(plan.next_run_at) : 0;
    if (!dueAt || dueAt <= now) {
      try { createTask(plan.id, 'schedule'); } catch { /* active tasks are expected */ }
    }
  }
}

async function recoverInterruptedTasks(options = {}) {
  const startup = options.startup !== false;
  const tasks = startup
    ? db.prepare(`SELECT * FROM backup_tasks WHERE status IN ('queued','running') ORDER BY id`).all()
    : db.prepare(`SELECT * FROM backup_tasks WHERE status='running' AND phase='recovery-pending' ORDER BY id`).all();

  for (const task of tasks) {
    const wasRecoveryPending = task.phase === 'recovery-pending';
    let remaining = readPausedContainerIds(task.id);
    if (remaining.length) {
      setTaskPhase(task.id, 'recovery-pending', 'running');
      appendTaskLog(task.id, `Recovering ${remaining.length} container(s) after an interrupted backup`);
      remaining = await resumeProjectContainers(task.id, remaining);
    }
    if (remaining.length) {
      if (task.project_id) {
        db.prepare('UPDATE projects SET status = ? WHERE id = ?').run('backup-recovery', task.project_id);
      }
      db.prepare(`UPDATE backup_tasks SET status='running', phase='recovery-pending', error=? WHERE id=?`)
        .run(`Unable to resume ${remaining.length} container(s); recovery will retry automatically`, task.id);
      continue;
    }

    if (task.project_id && task.previous_project_status) {
      db.prepare(`
        UPDATE projects SET status=? WHERE id=? AND status IN ('backing-up','backup-recovery')
      `).run(task.previous_project_status, task.project_id);
    }
    const completedAt = new Date().toISOString();
    const errorMessage = wasRecoveryPending && task.error
      ? task.error
      : 'Jewel restarted before the backup completed';
    const finalPhase = wasRecoveryPending ? 'failed' : 'interrupted';
    db.prepare(`
      UPDATE backup_tasks
      SET status='failed', phase=?, error=?, paused_container_ids='[]', completed_at=?
      WHERE id=?
    `).run(finalPhase, errorMessage, completedAt, task.id);
    appendTaskLog(task.id, wasRecoveryPending
      ? 'Project recovery completed; the failed backup task is now closed'
      : 'Project recovery completed after Jewel restart; the backup was marked interrupted');

    const operation = operationServiceSafeGet(task.operation_id);
    if (operation && operation.status === 'running') {
      operations.fail(task.operation_id, new Error(errorMessage), {
        summary: wasRecoveryPending
          ? 'Backup failed; project recovery completed'
          : 'Backup interrupted by Jewel restart'
      });
    }
  }
  return tasks.length;
}

function schedulerTick(startup = false) {
  if (schedulerTickPromise) return schedulerTickPromise;
  schedulerTickPromise = recoverInterruptedTasks({ startup })
    .then(() => runDuePlans())
    .catch(() => {})
    .finally(() => { schedulerTickPromise = null; });
  return schedulerTickPromise;
}

function startScheduler() {
  if (scheduler) return;
  schedulerTick(true);
  scheduler = setInterval(() => schedulerTick(false), 60 * 1000);
  if (scheduler.unref) scheduler.unref();
}

function operationServiceSafeGet(id) {
  try { return operations.get(id); } catch { return null; }
}

module.exports = {
  getProjectVolumeResources,
  listVolumeResources,
  createTask,
  runTask,
  getTask,
  listTasks,
  uploadArchive,
  testProvider,
  recoverInterruptedTasks,
  prunePlanTaskArchives,
  runDuePlans,
  startScheduler,
  runCommand
};
