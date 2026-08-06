const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const {
  normalizeRelativePath,
  normalizeVolumeSelections,
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

test('computes a bounded next run timestamp', () => {
  const from = new Date('2026-08-05T00:00:00.000Z');
  assert.equal(computeNextRun(6, from), '2026-08-05T06:00:00.000Z');
  assert.equal(computeNextRun(0, from), '2026-08-05T01:00:00.000Z');
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
  assert.throws(() => validateProvider('r2', { bucket: 'demo' }), /endpoint/);
  assert.throws(() => validateProvider('unknown', {}), /Unsupported/);
});
