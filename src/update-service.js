const https = require('https');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const config = require('./config');

let lastKnownCommit = null;
let updateAvailable = false;
let latestRemoteCommit = null;

async function getLatestCommit() {
  return new Promise((resolve, reject) => {
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
          const commit = JSON.parse(data);
          resolve(commit.sha);
        } catch {
          resolve(null);
        }
      });
    });

    req.on('error', () => resolve(null));
    req.setTimeout(10000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

function getCurrentCommit() {
  try {
    const appDir = path.join(__dirname, '..');
    if (fs.existsSync(path.join(appDir, '.git'))) {
      const result = execSync('git rev-parse HEAD', { cwd: appDir }).toString().trim();
      return result;
    }
  } catch { /* not a git repo */ }
  return null;
}

async function checkForUpdate() {
  try {
    const remote = await getLatestCommit();
    if (!remote) return false;

    const current = getCurrentCommit();
    if (!current) {
      latestRemoteCommit = remote;
      return false;
    }

    if (remote !== current && remote !== lastKnownCommit) {
      updateAvailable = true;
      latestRemoteCommit = remote;
      lastKnownCommit = remote;
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

function isUpdateAvailable() {
  return updateAvailable;
}

function getUpdateInfo() {
  return {
    available: updateAvailable,
    currentCommit: getCurrentCommit(),
    latestCommit: latestRemoteCommit
  };
}

async function applyUpdate() {
  const appDir = path.join(__dirname, '..');

  try {
    execSync('git pull origin main', { cwd: appDir, timeout: 60000 });

    if (fs.existsSync(path.join(appDir, 'docker-compose.yml'))) {
      try {
        execSync('docker compose up -d --build', { cwd: appDir, timeout: 300000 });
      } catch {
        try {
          execSync('docker-compose up -d --build', { cwd: appDir, timeout: 300000 });
        } catch (e) {
          throw new Error('Docker compose rebuild failed: ' + e.message);
        }
      }
    }

    updateAvailable = false;
    latestRemoteCommit = null;
    return { success: true };
  } catch (err) {
    throw new Error('Update failed: ' + err.message);
  }
}

module.exports = {
  checkForUpdate,
  isUpdateAvailable,
  getUpdateInfo,
  applyUpdate
};
