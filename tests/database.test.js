const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

let hasSqlite = true;
try { require.resolve('better-sqlite3'); } catch { hasSqlite = false; }

test('creates operation and backup schema on a fresh data directory', { skip: !hasSqlite }, () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jewel-schema-'));
  process.env.DATA_DIR = dataDir;
  const db = require('../src/database');
  try {
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
    for (const table of ['operation_logs', 'backup_providers', 'backup_plans', 'backup_tasks']) {
      assert.equal(tables.has(table), true, `${table} should exist`);
    }
    const taskColumns = new Set(db.prepare('PRAGMA table_info(backup_tasks)').all().map(row => row.name));
    assert.equal(taskColumns.has('operation_id'), true);
    assert.equal(taskColumns.has('paused_container_ids'), true);
    assert.equal(taskColumns.has('previous_project_status'), true);
    const planColumns = new Set(db.prepare('PRAGMA table_info(backup_plans)').all().map(row => row.name));
    assert.equal(planColumns.has('retention_count'), true);
  } finally {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
