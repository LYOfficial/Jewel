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
    const operationColumns = new Set(db.prepare('PRAGMA table_info(operation_logs)').all().map(row => row.name));
    assert.equal(operationColumns.has('commit_hash'), true);
    const projectColumns = new Set(db.prepare('PRAGMA table_info(projects)').all().map(row => row.name));
    assert.equal(projectColumns.has('auto_deploy'), true);

    const project = db.prepare('INSERT INTO projects (name, git_url, commit_hash) VALUES (?, ?, ?)')
      .run('commit-snapshot', 'https://example.invalid/repo.git', 'initial-commit');
    const operations = require('../src/operation-service');
    const operationId = operations.start({ projectId: Number(project.lastInsertRowid), action: 'deploy' });
    assert.equal(operations.get(operationId).commit_hash, 'initial-commit');
    operations.setCommitHash(operationId, 'deployed-commit');
    assert.equal(operations.get(operationId).commit_hash, 'deployed-commit');
  } finally {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
