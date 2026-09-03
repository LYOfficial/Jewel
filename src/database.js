const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const config = require('./config');

const dbDir = config.dataDir;
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const projectsDir = path.join(dbDir, 'projects');
if (!fs.existsSync(projectsDir)) fs.mkdirSync(projectsDir, { recursive: true });

const dbPath = path.join(dbDir, 'jewel.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    is_first_login INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    git_url TEXT NOT NULL,
    git_token TEXT DEFAULT '',
    git_branch TEXT DEFAULT 'main',
    compose_path TEXT DEFAULT 'docker-compose.yml',
    env_vars TEXT DEFAULT '{}',
    auto_deploy INTEGER DEFAULT 0,
    webhook_secret TEXT DEFAULT '',
    status TEXT DEFAULT 'idle',
    is_self INTEGER DEFAULT 0,
    container_name TEXT DEFAULT '',
    reuse_volumes INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS git_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    provider TEXT DEFAULT 'github',
    host TEXT DEFAULT '',
    token TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS operation_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER,
    resource_type TEXT DEFAULT 'project',
    resource_id TEXT DEFAULT '',
    action TEXT NOT NULL,
    status TEXT DEFAULT 'running',
    summary TEXT DEFAULT '',
    detail TEXT DEFAULT '',
    commit_hash TEXT DEFAULT '',
    metadata TEXT DEFAULT '{}',
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    finished_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS backup_providers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    config_json TEXT DEFAULT '{}',
    enabled INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS backup_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    provider_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    volume_selections TEXT DEFAULT '[]',
    remote_path TEXT DEFAULT '',
    pause_project INTEGER DEFAULT 1,
    retention_count INTEGER DEFAULT 3,
    schedule_enabled INTEGER DEFAULT 0,
    interval_hours INTEGER DEFAULT 24,
    next_run_at TEXT,
    last_run_at TEXT,
    enabled INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (provider_id) REFERENCES backup_providers(id) ON DELETE RESTRICT
  );

  CREATE TABLE IF NOT EXISTS backup_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id INTEGER,
    project_id INTEGER,
    provider_id INTEGER,
    operation_id INTEGER,
    trigger_type TEXT DEFAULT 'manual',
    status TEXT DEFAULT 'queued',
    phase TEXT DEFAULT 'queued',
    paused_container_ids TEXT DEFAULT '[]',
    previous_project_status TEXT DEFAULT '',
    archives TEXT DEFAULT '[]',
    bytes_total INTEGER DEFAULT 0,
    error TEXT DEFAULT '',
    log TEXT DEFAULT '',
    started_at TEXT,
    completed_at TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (plan_id) REFERENCES backup_plans(id) ON DELETE SET NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
    FOREIGN KEY (provider_id) REFERENCES backup_providers(id) ON DELETE SET NULL,
    FOREIGN KEY (operation_id) REFERENCES operation_logs(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_operation_logs_project ON operation_logs(project_id, id DESC);
  CREATE INDEX IF NOT EXISTS idx_backup_plans_project ON backup_plans(project_id);
  CREATE INDEX IF NOT EXISTS idx_backup_tasks_plan ON backup_tasks(plan_id, id DESC);
`);

// Schema migrations: add columns that may not exist on older installations
function addColumnIfMissing(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.find(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
addColumnIfMissing('projects', 'container_name', "TEXT DEFAULT ''");
addColumnIfMissing('projects', 'reuse_volumes', 'INTEGER DEFAULT 0');
addColumnIfMissing('projects', 'auto_deploy', 'INTEGER DEFAULT 0');
addColumnIfMissing('projects', 'commit_hash', "TEXT DEFAULT ''");
addColumnIfMissing('projects', 'remote_commit', "TEXT DEFAULT ''");
addColumnIfMissing('projects', 'update_available', 'INTEGER DEFAULT 0');
addColumnIfMissing('projects', 'last_update_check', 'TEXT DEFAULT NULL');
addColumnIfMissing('operation_logs', 'commit_hash', "TEXT DEFAULT ''");
addColumnIfMissing('backup_tasks', 'operation_id', 'INTEGER DEFAULT NULL');
addColumnIfMissing('backup_tasks', 'paused_container_ids', "TEXT DEFAULT '[]'");
addColumnIfMissing('backup_tasks', 'previous_project_status', "TEXT DEFAULT ''");
addColumnIfMissing('backup_plans', 'retention_count', 'INTEGER DEFAULT 3');

const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
if (userCount.count === 0) {
  const hashedPassword = bcrypt.hashSync(config.defaultAdmin.password, 10);
  db.prepare('INSERT INTO users (username, password, is_first_login) VALUES (?, ?, 1)').run(
    config.defaultAdmin.username,
    hashedPassword
  );
}

const defaultSettings = {
  'language': 'zh-CN',
  'git_provider': 'github',
  'timezone': 'Asia/Shanghai'
};
const upsertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [key, value] of Object.entries(defaultSettings)) {
  upsertSetting.run(key, value);
}

module.exports = db;
