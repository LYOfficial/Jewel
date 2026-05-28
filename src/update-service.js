const https = require('https');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const config = require('./config');

let updateAvailable = false;
let latestRemoteCommit = null;
let currentCommit = null;

const COMMIT_FILE = path.join(config.dataDir, '.jewel-commit');

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
  try {
    const current = detectCurrentCommit();
    if (!current) {
      // First run or can't detect — fetch remote and save as baseline
      const remote = await getLatestCommit();
      if (remote) {
        saveCurrentCommit(remote);
      }
      return false;
    }

    // Save on first detection
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
    latestCommit: latestRemoteCommit || 'unknown'
  };
}

async function applyUpdate() {
  const appDir = path.join(__dirname, '..');

  try {
    // Fetch latest from remote
    execSync('git fetch origin main', { cwd: appDir, timeout: 60000 });

    // Reset to latest remote commit
    execSync('git reset --hard origin/main', { cwd: appDir, timeout: 30000 });

    // Update npm dependencies
    try {
      execSync('npm ci --production', { cwd: appDir, timeout: 120000 });
    } catch {
      try {
        execSync('npm install --production', { cwd: appDir, timeout: 120000 });
      } catch { /* non-critical */ }
    }

    // Rebuild and restart via docker compose
    const composePath = path.join(appDir, 'docker-compose.yml');
    if (fs.existsSync(composePath)) {
      // Stop and remove old containers first
      try {
        execSync('docker compose down', { cwd: appDir, timeout: 120000 });
      } catch {
        try {
          execSync('docker-compose down', { cwd: appDir, timeout: 120000 });
        } catch { /* ignore */ }
      }

      let composeOk = false;
      try {
        execSync('docker compose up -d --build', { cwd: appDir, timeout: 300000 });
        composeOk = true;
      } catch { /* try v1 command */ }
      if (!composeOk) {
        try {
          execSync('docker-compose up -d --build', { cwd: appDir, timeout: 300000 });
          composeOk = true;
        } catch (e) {
          throw new Error('Docker compose rebuild failed: ' + e.message);
        }
      }
    }

    // Update saved commit
    const newCommit = detectCurrentCommit() || latestRemoteCommit;
    if (newCommit) saveCurrentCommit(newCommit);

    updateAvailable = false;
    latestRemoteCommit = null;

    return { success: true, newCommit };
  } catch (err) {
    throw new Error('Update failed: ' + err.message);
  }
}

module.exports = {
  checkForUpdate,
  isUpdateAvailable: () => updateAvailable,
  getUpdateInfo,
  applyUpdate
};
