const https = require('https');
const { spawn } = require('child_process');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const config = require('./config');

let updateAvailable = false;
let latestRemoteCommit = null;
let currentCommit = null;
let updating = false;

const COMMIT_FILE = path.join(config.dataDir, '.jewel-commit');
const UPDATING_FILE = path.join(config.dataDir, '.jewel-updating');

function isUpdating() {
  if (updating) return true;
  try {
    if (fs.existsSync(UPDATING_FILE)) return true;
  } catch { /* ignore */ }
  return false;
}

function clearUpdatingFlag() {
  updating = false;
  try { fs.unlinkSync(UPDATING_FILE); } catch { /* ignore */ }
}

function saveCurrentCommit(sha) {
  currentCommit = sha;
  try {
    fs.writeFileSync(COMMIT_FILE, sha, 'utf-8');
  } catch { /* ignore */ }
}

function loadCurrentCommit() {
  if (currentCommit) return currentCommit;
  try {
    if (fs.existsSync(COMMIT_FILE)) {
      currentCommit = fs.readFileSync(COMMIT_FILE, 'utf-8').trim();
    }
  } catch { /* ignore */ }
  return currentCommit;
}

function detectCurrentCommit() {
  const appDir = path.join(__dirname, '..');

  // 1. Try .git directory (local dev or git-cloned deploy)
  try {
    if (fs.existsSync(path.join(appDir, '.git'))) {
      const sha = execSync('git rev-parse HEAD', { cwd: appDir }).toString().trim();
      if (sha) return sha;
    }
  } catch { /* not a git repo or git not installed */ }

  // 2. Try env variable (set via Dockerfile / docker-compose)
  if (process.env.JEWEL_COMMIT) {
    return process.env.JEWEL_COMMIT.trim();
  }

  // 3. Try saved commit file
  const saved = loadCurrentCommit();
  if (saved) return saved;

  return null;
}

async function getLatestCommit() {
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.github.com',
      path: '/repos/LYOfficial/Jewel/commits/main',
      headers: {
        'User-Agent': 'Jewel-App',
        'Accept': 'application/vnd.github.v3+json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.sha) {
            resolve(parsed.sha);
          } else {
            console.error('GitHub API unexpected response:', data.substring(0, 200));
            resolve(null);
          }
        } catch {
          console.error('GitHub API parse error, response:', data.substring(0, 200));
          resolve(null);
        }
      });
    });

    req.on('error', (err) => {
      console.error('GitHub API request error:', err.message);
      resolve(null);
    });
    req.setTimeout(10000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

async function checkForUpdate() {
  if (isUpdating()) return false;

  try {
    const current = detectCurrentCommit();
    if (!current) {
      const remote = await getLatestCommit();
      if (remote) saveCurrentCommit(remote);
      return false;
    }

    if (!loadCurrentCommit()) {
      saveCurrentCommit(current);
    }

    const remote = await getLatestCommit();
    if (!remote) return false;

    if (remote !== current) {
      updateAvailable = true;
      latestRemoteCommit = remote;
      return true;
    }

    updateAvailable = false;
    latestRemoteCommit = null;
    return false;
  } catch (err) {
    console.error('Check update error:', err.message);
    return false;
  }
}

function getUpdateInfo() {
  const current = detectCurrentCommit();
  return {
    available: updateAvailable,
    currentCommit: current || 'unknown',
    latestCommit: latestRemoteCommit || 'unknown',
    updating: isUpdating()
  };
}

async function applyUpdate() {
  if (updating) {
    throw new Error('Update already in progress');
  }

  const appDir = path.join(__dirname, '..');

  // 1. Git pull latest code
  execSync('git fetch origin main', { cwd: appDir, timeout: 60000 });
  execSync('git reset --hard origin/main', { cwd: appDir, timeout: 30000 });

  // 2. Install dependencies
  try {
    execSync('npm ci --omit=dev', { cwd: appDir, timeout: 120000 });
  } catch {
    try {
      execSync('npm install --omit=dev', { cwd: appDir, timeout: 120000 });
    } catch { /* non-critical */ }
  }

  // 3. Write updating flag so the new process knows to serve upgrading page
  updating = true;
  try {
    fs.writeFileSync(UPDATING_FILE, Date.now().toString(), 'utf-8');
  } catch { /* ignore */ }

  // 4. Spawn detached rebuild process: down -> up
  //    This runs after our process exits, so the old container gets removed.
  const composePath = path.join(appDir, 'docker-compose.yml');
  if (fs.existsSync(composePath)) {
    // Write a shell script to execute the rebuild
    const scriptPath = path.join(config.dataDir, 'jewel-rebuild.sh');
    const script = `#!/bin/sh
cd "${appDir}"
docker compose down 2>/dev/null || docker-compose down 2>/dev/null
docker compose up -d --build 2>/dev/null || docker-compose up -d --build 2>/dev/null
`;
    try {
      fs.writeFileSync(scriptPath, script, 'utf-8');
      fs.chmodSync(scriptPath, 0o755);
    } catch { /* ignore */ }

    const child = spawn('sh', [scriptPath], {
      detached: true,
      stdio: 'ignore',
      cwd: appDir
    });
    child.unref();
  }

  updateAvailable = false;
  latestRemoteCommit = null;

  return { success: true, restarting: true };
}

module.exports = {
  checkForUpdate,
  isUpdateAvailable: () => updateAvailable,
  isUpdating,
  clearUpdatingFlag,
  getUpdateInfo,
  applyUpdate
};
