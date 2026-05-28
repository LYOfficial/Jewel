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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT DEFAULT ''
  );
`);

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
  'git_provider': 'github'
};
const upsertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [key, value] of Object.entries(defaultSettings)) {
  upsertSetting.run(key, value);
}

module.exports = db;
