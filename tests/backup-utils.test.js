const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const {
  normalizeRelativePath,
  normalizeVolumeSelections,
  normalizeScheduleTime,
  computeNextRun,
  normalizeRemotePath,
  buildRemotePath,
  resolveLocalDestination,
  maskConfig,
  validateProvider
} = require('../src/backup-utils');

test('normalizes volume selections and removes duplicates', () => {
  assert.deepEqual(normalizeVolumeSelections([
    { name: 'app_data', paths: ['/', 'uploads', 'uploads'] },
    { name: 'app_data', paths: ['ignored'] },
    { name: '../bad', paths: ['/'] }
  ]), [{ name: 'app_data', paths: ['/', 'uploads'] }]);
});

test('normalizes safe paths and rejects traversal', () => {
  assert.equal(normalizeRelativePath('data\\uploads'), 'data/uploads');
  assert.equal(normalizeRelativePath('/'), '/');
  assert.throws(() => normalizeRelativePath('../../etc'), /Invalid volume path/);
});

test('computes the next daily run in the configured platform timezone', () => {
  assert.equal(normalizeScheduleTime('03:00'), '03:00');
  assert.throws(() => normalizeScheduleTime('24:00'), /HH:mm/);
  assert.equal(
    computeNextRun('03:00', 'Asia/Shanghai', new Date('2026-08-05T18:30:00.000Z')),
    '2026-08-05T19:00:00.000Z'
  );
  assert.equal(
    computeNextRun('03:00', 'America/New_York', new Date('2026-08-05T12:00:00.000Z')),
    '2026-08-06T07:00:00.000Z'
  );
});

test('builds stable remote paths and masks provider secrets', () => {
  assert.equal(buildRemotePath('/daily/', 'My Project', 'data.tar.gz'), 'daily/My-Project/data.tar.gz');
  assert.deepEqual(maskConfig({ bucket: 'demo', access_key_id: 'abc', token: 'secret' }), {
    bucket: 'demo', access_key_id: '••••••••', token: '••••••••'
  });
});

test('normalizes remote paths and keeps local backups inside their configured root', () => {
  assert.equal(normalizeRemotePath('/daily\\database/'), 'daily/database');
  assert.throws(() => normalizeRemotePath('daily/../../outside'), /Invalid remote backup path/);
  const root = path.resolve('backup-root');
  assert.equal(resolveLocalDestination(root, 'daily/archive.tar.gz'), path.join(root, 'daily', 'archive.tar.gz'));
  assert.throws(() => resolveLocalDestination(root, '../outside.tar.gz'), /Invalid remote backup path/);
});

test('validates provider-specific fields', () => {
  assert.doesNotThrow(() => validateProvider('local', { directory: '/tmp/backups' }));
  assert.doesNotThrow(() => validateProvider('r2', {
    endpoint: 'https://account.r2.cloudflarestorage.com', bucket: 'demo',
    access_key_id: 'A'.repeat(32), secret_access_key: 'S'.repeat(64)
  }));
  assert.throws(() => validateProvider('r2', { bucket: 'demo' }), /endpoint/);
  assert.throws(
    () => validateProvider('r2', { endpoint: 'https://account.r2.cloudflarestorage.com', bucket: 'demo' }),
    /access_key_id, secret_access_key/
  );
  assert.throws(() => validateProvider('r2', {
    endpoint: 'https://account.r2.cloudflarestorage.com', bucket: 'demo',
    access_key_id: 'A'.repeat(64), secret_access_key: 'S'.repeat(32)
  }), /may be entered in the wrong fields/);
  assert.throws(() => validateProvider('unknown', {}), /Unsupported/);
});
