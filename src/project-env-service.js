const fs = require('fs');
const path = require('path');
const config = require('./config');

function getProjectDir(projectId) {
  return path.join(config.dataDir, 'projects', String(projectId));
}

function getEnvFilePath(projectId) {
  return path.join(getProjectDir(projectId), '.env');
}

function parseProjectEnv(envVars) {
  try {
    const parsed = JSON.parse(envVars || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function renderProjectEnv(envVars) {
  return Object.entries(parseProjectEnv(envVars))
    .map(([key, value]) => `${key}=${value == null ? '' : value}\n`)
    .join('');
}

// The editor stores KEY=VALUE pairs. Keep the value exactly as written after
// the first equals sign so URLs, quoted values, and values containing '=' are
// preserved when a repository .env is imported into the project settings.
function parseEnvFile(contents) {
  const envVars = {};
  for (const rawLine of String(contents || '').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (!match) continue;
    envVars[match[1]] = match[2];
  }
  return envVars;
}

function saveProjectEnv(project, envVars) {
  const serialized = JSON.stringify(envVars);
  const db = require('./database');
  db.prepare('UPDATE projects SET env_vars = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(serialized, project.id);
  return { ...project, env_vars: serialized };
}

// Project settings are the source of truth for a normal deployment/update.
// This deliberately runs immediately before Compose so each invocation sees
// the exact values displayed in the deployment settings.
function syncProjectEnvFile(project) {
  const envPath = getEnvFilePath(project.id);
  fs.writeFileSync(envPath, renderProjectEnv(project.env_vars), 'utf-8');
  return envPath;
}

// A rebuild starts with a fresh clone, so its repository .env (when present)
// is authoritative. If it is absent, retain the configured project values;
// for a newly unconfigured project fall back to the repository .env.example.
function initializeRebuiltProjectEnv(project) {
  const projectDir = getProjectDir(project.id);
  const envPath = getEnvFilePath(project.id);

  if (!fs.existsSync(envPath)) {
    const configuredContents = renderProjectEnv(project.env_vars);
    if (configuredContents) {
      fs.writeFileSync(envPath, configuredContents, 'utf-8');
    } else {
      const examplePath = path.join(projectDir, '.env.example');
      if (fs.existsSync(examplePath)) {
        fs.copyFileSync(examplePath, envPath);
      } else {
        fs.writeFileSync(envPath, '', 'utf-8');
      }
    }
  }

  const imported = parseEnvFile(fs.readFileSync(envPath, 'utf-8'));
  return saveProjectEnv(project, imported);
}

module.exports = {
  getEnvFilePath,
  parseProjectEnv,
  renderProjectEnv,
  parseEnvFile,
  syncProjectEnvFile,
  initializeRebuiltProjectEnv
};
