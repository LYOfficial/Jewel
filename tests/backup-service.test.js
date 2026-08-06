const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');

let hasSqlite = true;
try { require.resolve('better-sqlite3'); } catch { hasSqlite = false; }

const dataDir = hasSqlite ? fs.mkdtempSync(path.join(os.tmpdir(), 'jewel-backup-service-')) : null;
if (dataDir) process.env.DATA_DIR = dataDir;

const db = hasSqlite ? require('../src/database') : null;
const dockerService = hasSqlite ? require('../src/docker-service') : null;
const backupService = hasSqlite ? require('../src/backup-service') : null;

if (hasSqlite) {
  test.after(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
}

function insertInterruptedTask(containerId, projectStatus = 'backing-up') {
  const project = db.prepare(`
    INSERT INTO projects (name, git_url, status) VALUES (?, ?, ?)
  `).run(`project-${Date.now()}-${Math.random()}`, 'https://example.invalid/repo.git', projectStatus);
  const task = db.prepare(`
    INSERT INTO backup_tasks
      (project_id, status, phase, paused_container_ids, previous_project_status, started_at)
    VALUES (?, 'running', 'archiving', ?, 'running', ?)
  `).run(Number(project.lastInsertRowid), JSON.stringify([containerId]), new Date().toISOString());
  return { projectId: Number(project.lastInsertRowid), taskId: Number(task.lastInsertRowid) };
}

test('startup recovery unpauses persisted containers before closing an interrupted task', { skip: !hasSqlite }, async () => {
  const { projectId, taskId } = insertInterruptedTask('container-recovered');
  const calls = [];
  const originalInspect = dockerService.getContainerInfo;
  const originalUnpause = dockerService.unpauseContainer;
  dockerService.getContainerInfo = async id => ({ Id: id, State: { Paused: true } });
  dockerService.unpauseContainer = async id => { calls.push(id); };

  try {
    await backupService.recoverInterruptedTasks({ startup: true });
  } finally {
    dockerService.getContainerInfo = originalInspect;
    dockerService.unpauseContainer = originalUnpause;
  }

  assert.deepEqual(calls, ['container-recovered']);
  const taskRow = db.prepare('SELECT * FROM backup_tasks WHERE id=?').get(taskId);
  assert.equal(taskRow.status, 'failed');
  assert.equal(taskRow.phase, 'interrupted');
  assert.equal(taskRow.paused_container_ids, '[]');
  assert.equal(db.prepare('SELECT status FROM projects WHERE id=?').get(projectId).status, 'running');
});

test('failed container recovery remains active and succeeds on a later scheduler retry', { skip: !hasSqlite }, async () => {
  const { projectId, taskId } = insertInterruptedTask('container-retry');
  const originalInspect = dockerService.getContainerInfo;
  const originalUnpause = dockerService.unpauseContainer;
  dockerService.getContainerInfo = async () => { throw new Error('Docker daemon unavailable'); };
  dockerService.unpauseContainer = async () => {};

  try {
    await backupService.recoverInterruptedTasks({ startup: true });
    let taskRow = db.prepare('SELECT * FROM backup_tasks WHERE id=?').get(taskId);
    assert.equal(taskRow.status, 'running');
    assert.equal(taskRow.phase, 'recovery-pending');
    assert.deepEqual(JSON.parse(taskRow.paused_container_ids), ['container-retry']);
    assert.equal(db.prepare('SELECT status FROM projects WHERE id=?').get(projectId).status, 'backup-recovery');

    dockerService.getContainerInfo = async id => ({ Id: id, State: { Paused: true } });
    let resumedId = null;
    dockerService.unpauseContainer = async id => { resumedId = id; };
    await backupService.recoverInterruptedTasks({ startup: false });

    taskRow = db.prepare('SELECT * FROM backup_tasks WHERE id=?').get(taskId);
    assert.equal(resumedId, 'container-retry');
    assert.equal(taskRow.status, 'failed');
    assert.equal(taskRow.phase, 'failed');
    assert.equal(taskRow.paused_container_ids, '[]');
    assert.equal(db.prepare('SELECT status FROM projects WHERE id=?').get(projectId).status, 'running');
  } finally {
    dockerService.getContainerInfo = originalInspect;
    dockerService.unpauseContainer = originalUnpause;
  }
});

test('provider checks perform read-only remote probes with injected credentials', { skip: !hasSqlite }, async () => {
  const calls = [];
  const runner = async (binary, args, options) => {
    calls.push({ binary, args, options });
    return { stdout: '', stderr: '' };
  };

  await backupService.testProvider({
    type: 'r2',
    config_json: JSON.stringify({
      endpoint: 'https://account.r2.cloudflarestorage.com', bucket: 'jewel-backups',
      access_key_id: 'access-id', secret_access_key: 'secret-key'
    })
  }, runner);
  await backupService.testProvider({
    type: 'onedrive',
    config_json: JSON.stringify({ remote_name: 'jewel-drive', token: '{"access_token":"token"}' })
  }, runner);
  await backupService.testProvider({
    type: 'baidu',
    config_json: JSON.stringify({ config_dir: '/data/provider-config/baidu' })
  }, runner);
  await backupService.testProvider({
    type: 'anyshare',
    config_json: JSON.stringify({ share_link: 'https://share.example.invalid/s/demo', base_path: 'backups' })
  }, runner);

  assert.deepEqual(calls[0].args, ['lsf', 'jewelr2:jewel-backups', '--max-depth', '1']);
  assert.equal(calls[0].options.env.RCLONE_CONFIG_JEWELR2_SECRET_ACCESS_KEY, 'secret-key');
  assert.deepEqual(calls[1].args, ['lsf', 'jewel-drive:', '--max-depth', '1']);
  assert.equal(calls[1].options.env.RCLONE_CONFIG_JEWEL_DRIVE_TOKEN, '{"access_token":"token"}');
  assert.deepEqual(calls[2].args, ['--config-dir', '/data/provider-config/baidu', 'info']);
  assert.equal(calls[3].binary, 'python3');
  assert.equal(calls[3].args.includes('--check'), true);
  assert.equal(calls.every(call => call.options.timeoutMs === 30000), true);
});

test('cloud upload adapters build provider-specific destinations and keep rclone credentials in environment', { skip: !hasSqlite }, async () => {
  const task = db.prepare(`INSERT INTO backup_tasks (status, phase) VALUES ('running', 'uploading')`).run();
  const taskId = Number(task.lastInsertRowid);
  const project = { name: 'My Project' };
  const plan = { remote_path: 'daily/database' };
  const archive = { name: 'data.tar.gz', local_path: path.join(dataDir, 'data.tar.gz') };
  const calls = [];
  const runner = async (binary, args, options = {}) => {
    calls.push({ binary, args, options });
    return { stdout: '', stderr: '' };
  };

  const r2Target = await backupService.uploadArchive(taskId, {
    type: 'r2',
    config_json: JSON.stringify({
      endpoint: 'https://account.r2.cloudflarestorage.com', bucket: 'bucket',
      access_key_id: 'access', secret_access_key: 'secret', base_path: 'provider-root'
    })
  }, project, plan, archive, runner);
  const oneDriveTarget = await backupService.uploadArchive(taskId, {
    type: 'onedrive',
    config_json: JSON.stringify({ remote_name: 'jewel-drive', token: '{"access_token":"token"}', base_path: 'provider-root' })
  }, project, plan, archive, runner);
  const baiduTarget = await backupService.uploadArchive(taskId, {
    type: 'baidu',
    config_json: JSON.stringify({ config_dir: '/data/baidu', base_path: 'provider-root' })
  }, project, plan, archive, runner);
  const anyShareTarget = await backupService.uploadArchive(taskId, {
    type: 'anyshare',
    config_json: JSON.stringify({ share_link: 'https://share.example/link/demo', base_url: 'https://share.example', base_path: 'provider-root' })
  }, project, plan, archive, runner);

  assert.equal(r2Target, 'jewelr2:bucket/provider-root/daily/database/My-Project/data.tar.gz');
  assert.equal(oneDriveTarget, 'jewel-drive:provider-root/daily/database/My-Project/data.tar.gz');
  assert.equal(baiduTarget, 'Jewel/provider-root/daily/database/My-Project/data.tar.gz');
  assert.equal(anyShareTarget, 'provider-root/daily/database/My-Project/data.tar.gz');
  assert.equal(calls[0].binary, 'rclone');
  assert.equal(calls[0].args.includes('secret'), false);
  assert.equal(calls[0].options.env.RCLONE_CONFIG_JEWELR2_SECRET_ACCESS_KEY, 'secret');
  assert.equal(calls[1].options.env.RCLONE_CONFIG_JEWEL_DRIVE_TOKEN, '{"access_token":"token"}');
  assert.deepEqual(calls[2].args, ['/data/baidu', 'upload', archive.local_path, baiduTarget].flatMap((value, index) => index === 0 ? ['--config-dir', value] : [value]));
  assert.equal(calls[3].binary, 'python3');
  assert.equal(calls[3].args.includes('--link'), true);
  assert.equal(calls[3].args.includes('--path'), true);
});

test('retention pruning removes only older local staging archives', { skip: !hasSqlite }, () => {
  const project = db.prepare(`INSERT INTO projects (name, git_url) VALUES (?, ?)`)
    .run(`retention-${Date.now()}`, 'https://example.invalid/retention.git');
  const provider = db.prepare(`INSERT INTO backup_providers (name, type, config_json) VALUES (?, 'local', ?)`)
    .run('retention-local', JSON.stringify({ directory: path.join(dataDir, 'export') }));
  const plan = db.prepare(`
    INSERT INTO backup_plans (project_id, provider_id, name, retention_count)
    VALUES (?, ?, 'retention-plan', 1)
  `).run(Number(project.lastInsertRowid), Number(provider.lastInsertRowid));

  const taskIds = [];
  for (let index = 0; index < 2; index += 1) {
    const task = db.prepare(`
      INSERT INTO backup_tasks (plan_id, project_id, provider_id, status, phase)
      VALUES (?, ?, ?, 'succeeded', 'completed')
    `).run(Number(plan.lastInsertRowid), Number(project.lastInsertRowid), Number(provider.lastInsertRowid));
    const taskId = Number(task.lastInsertRowid);
    taskIds.push(taskId);
    const taskDir = path.join(dataDir, 'backups', 'staging', String(taskId));
    fs.mkdirSync(taskDir, { recursive: true });
    const archivePath = path.join(taskDir, `archive-${taskId}.tar.gz`);
    fs.writeFileSync(archivePath, `archive-${taskId}`);
    db.prepare('UPDATE backup_tasks SET archives=? WHERE id=?').run(JSON.stringify([{
      name: path.basename(archivePath), local_path: archivePath, size: fs.statSync(archivePath).size
    }]), taskId);
  }

  const removed = backupService.prunePlanTaskArchives(Number(plan.lastInsertRowid), 1);
  assert.equal(removed, 1);

  const older = JSON.parse(db.prepare('SELECT archives FROM backup_tasks WHERE id=?').get(taskIds[0]).archives)[0];
  const newest = JSON.parse(db.prepare('SELECT archives FROM backup_tasks WHERE id=?').get(taskIds[1]).archives)[0];
  assert.equal(older.local_available, false);
  assert.equal(older.local_path, '');
  assert.equal(fs.existsSync(path.join(dataDir, 'backups', 'staging', String(taskIds[0]), `archive-${taskIds[0]}.tar.gz`)), false);
  assert.equal(fs.existsSync(newest.local_path), true);
});

function insertRunnableBackup(suffix) {
  const project = db.prepare(`INSERT INTO projects (name, git_url, status) VALUES (?, ?, 'running')`)
    .run(`backup-${suffix}-${Date.now()}`, 'https://example.invalid/backup.git');
  const providerDirectory = path.join(dataDir, `export-${suffix}`);
  const provider = db.prepare(`INSERT INTO backup_providers (name, type, config_json) VALUES (?, 'local', ?)`)
    .run(`local-${suffix}`, JSON.stringify({ directory: providerDirectory, base_path: 'provider-root' }));
  const plan = db.prepare(`
    INSERT INTO backup_plans
      (project_id, provider_id, name, volume_selections, remote_path, pause_project, retention_count)
    VALUES (?, ?, ?, ?, 'daily', 1, 3)
  `).run(
    Number(project.lastInsertRowid), Number(provider.lastInsertRowid), `plan-${suffix}`,
    JSON.stringify([{ name: `volume-${suffix}`, paths: ['/'] }])
  );
  const task = db.prepare(`
    INSERT INTO backup_tasks (plan_id, project_id, provider_id)
    VALUES (?, ?, ?)
  `).run(Number(plan.lastInsertRowid), Number(project.lastInsertRowid), Number(provider.lastInsertRowid));
  return {
    projectId: Number(project.lastInsertRowid),
    planId: Number(plan.lastInsertRowid),
    taskId: Number(task.lastInsertRowid),
    volumeName: `volume-${suffix}`
  };
}

function installFakeDocker({ volumeName, archiveError = null }) {
  const original = {
    getDocker: dockerService.getDocker,
    getProjectContainers: dockerService.getProjectContainers,
    pauseContainer: dockerService.pauseContainer,
    getContainerInfo: dockerService.getContainerInfo,
    unpauseContainer: dockerService.unpauseContainer
  };
  const calls = [];
  let paused = false;
  const helper = {
    start: async () => { calls.push('helper-start'); },
    getArchive: async () => {
      calls.push('archive');
      if (archiveError) throw archiveError;
      return Readable.from([Buffer.from('fake-docker-tar-stream')]);
    },
    remove: async () => { calls.push('helper-remove'); }
  };
  dockerService.getDocker = () => ({
    getVolume: name => ({ inspect: async () => {
      assert.equal(name, volumeName);
      return { Name: name };
    } }),
    getImage: () => ({ inspect: async () => ({ Id: 'helper-image' }) }),
    createContainer: async () => helper
  });
  dockerService.getProjectContainers = async () => [{
    Id: 'project-container', Names: ['/project-container'], State: 'running', Mounts: []
  }];
  dockerService.pauseContainer = async id => {
    assert.equal(id, 'project-container');
    paused = true;
    calls.push('pause');
  };
  dockerService.getContainerInfo = async id => ({ Id: id, State: { Paused: paused } });
  dockerService.unpauseContainer = async id => {
    assert.equal(id, 'project-container');
    paused = false;
    calls.push('unpause');
  };
  return {
    calls,
    isPaused: () => paused,
    restore() {
      Object.assign(dockerService, original);
    }
  };
}

test('runs the complete pause, archive, local upload, and resume lifecycle', { skip: !hasSqlite }, async () => {
  const fixture = insertRunnableBackup('success');
  const fake = installFakeDocker({ volumeName: fixture.volumeName });
  let task;
  try {
    task = await backupService.runTask(fixture.taskId);
  } finally {
    fake.restore();
  }

  assert.equal(task.status, 'succeeded');
  assert.equal(task.phase, 'completed');
  assert.equal(fake.isPaused(), false);
  assert.deepEqual(fake.calls, ['pause', 'helper-start', 'archive', 'helper-remove', 'unpause']);
  assert.equal(task.archives.length, 1);
  assert.equal(fs.existsSync(task.archives[0].local_path), true);
  assert.equal(fs.existsSync(task.archives[0].remote), true);
  assert.equal(task.archives[0].remote.includes(`${path.sep}provider-root${path.sep}daily${path.sep}`), true);
  assert.equal(db.prepare('SELECT status FROM projects WHERE id=?').get(fixture.projectId).status, 'running');
  assert.equal(db.prepare('SELECT status FROM operation_logs WHERE id=?').get(task.operation_id).status, 'succeeded');
});

test('archive failure resumes paused containers and records a failed operation', { skip: !hasSqlite }, async () => {
  const fixture = insertRunnableBackup('failure');
  const fake = installFakeDocker({ volumeName: fixture.volumeName, archiveError: new Error('archive stream failed') });
  let task;
  try {
    task = await backupService.runTask(fixture.taskId);
  } finally {
    fake.restore();
  }

  assert.equal(task.status, 'failed');
  assert.equal(task.phase, 'failed');
  assert.match(task.error, /archive stream failed/);
  assert.equal(fake.isPaused(), false);
  assert.deepEqual(fake.calls, ['pause', 'helper-start', 'archive', 'helper-remove', 'unpause']);
  assert.equal(task.paused_container_ids, '[]');
  assert.equal(db.prepare('SELECT status FROM projects WHERE id=?').get(fixture.projectId).status, 'running');
  assert.equal(db.prepare('SELECT status FROM operation_logs WHERE id=?').get(task.operation_id).status, 'failed');
});
