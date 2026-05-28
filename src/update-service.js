const https = require('https');
const { spawn } = require('child_process');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const config = require('./config');

let updateAvailable = false;
let latestRemoteInfo = null;
let currentCommit = null;
let updating = false;
let lastCheckTime = null;

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
  try { fs.writeFileSync(COMMIT_FILE, sha, 'utf-8'); } catch { /* ignore */ }
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
  try {
    if (fs.existsSync(path.join(appDir, '.git'))) {
      const sha = execSync('git rev-parse HEAD', { cwd: appDir }).toString().trim();
      if (sha) return sha;
    }
  } catch { /* not a git repo */ }
  if (process.env.JEWEL_COMMIT) return process.env.JEWEL_COMMIT.trim();
  const saved = loadCurrentCommit();
  if (saved) return saved;
  return null;
}

function detectCurrentDate() {
  const appDir = path.join(__dirname, '..');
  try {
    if (fs.existsSync(path.join(appDir, '.git'))) {
      const date = execSync('git log -1 --format=%cI', { cwd: appDir }).toString().trim();
      if (date) return date;
    }
  } catch { /* ignore */ }
  return null;
}

function detectCurrentVersion() {
  try {
    const pkg = require('../package.json');
    return pkg.version || 'unknown';
  } catch { return 'unknown'; }
}

async function getLatestCommitInfo() {
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
            resolve({
              sha: parsed.sha,
              date: parsed.commit?.committer?.date || null,
              message: (parsed.commit?.message || '').split('\n')[0]
            });
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
    const remote = await getLatestCommitInfo();
    lastCheckTime = new Date().toISOString();

    if (!remote) return false;

    const current = detectCurrentCommit();
    if (!current) {
      saveCurrentCommit(remote.sha);
      latestRemoteInfo = remote;
      return false;
    }

    if (!loadCurrentCommit()) {
      saveCurrentCommit(current);
    }

    if (remote.sha !== current) {
      updateAvailable = true;
      latestRemoteInfo = remote;
      return true;
    }

    updateAvailable = false;
    latestRemoteInfo = null;
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
    currentVersion: detectCurrentVersion(),
    currentCommit: current || 'unknown',
    currentDate: detectCurrentDate(),
    latestVersion: latestRemoteInfo ? detectLatestVersion(latestRemoteInfo.message) : null,
    latestCommit: latestRemoteInfo?.sha || null,
    latestDate: latestRemoteInfo?.date || null,
    latestMessage: latestRemoteInfo?.message || null,
    lastCheckTime: lastCheckTime,
    updating: isUpdating()
  };
}

function detectLatestVersion(message) {
  if (!message) return null;
  const match = message.match(/v?(\d+\.\d+\.\d+)/);
  return match ? match[1] : null;
}

async function applyUpdate() {
  if (updating) throw new Error('Update already in progress');

  const appDir = path.join(__dirname, '..');

  execSync('git fetch origin main', { cwd: appDir, timeout: 60000 });
  execSync('git reset --hard origin/main', { cwd: appDir, timeout: 30000 });

  try {
    execSync('npm ci --omit=dev', { cwd: appDir, timeout: 120000 });
  } catch {
    try { execSync('npm install --omit=dev', { cwd: appDir, timeout: 120000 }); } catch { /* non-critical */ }
  }

  updating = true;
  try { fs.writeFileSync(UPDATING_FILE, Date.now().toString(), 'utf-8'); } catch { /* ignore */ }

  const composePath = path.join(appDir, 'docker-compose.yml');
  if (fs.existsSync(composePath)) {
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
  latestRemoteInfo = null;

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
