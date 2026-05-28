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
  const isDocker = fs.existsSync(composePath);

  if (isDocker) {
    // Phase 1: build the new image without restarting
    try {
      execSync('docker compose build --no-cache 2>/dev/null || docker-compose build --no-cache 2>/dev/null', {
        cwd: appDir, timeout: 600000, stdio: 'pipe'
      });
    } catch (err) {
      updating = false;
      try { fs.unlinkSync(UPDATING_FILE); } catch { /* ignore */ }
      throw new Error('Docker image build failed: ' + err.message);
    }
    // Image built successfully — client will show restart button
    return { success: true, needsRestart: true };
  }

  // Non-Docker: restart the Node process directly
  const child = spawn(process.argv[0], [path.join(appDir, 'src', 'index.js')], {
    detached: true,
    stdio: 'ignore',
    cwd: appDir,
    env: { ...process.env, NODE_ENV: 'production' }
  });
  child.unref();

  updateAvailable = false;
  latestRemoteInfo = null;

  return { success: true, restarting: true };
}

function scheduleRestart() {
  if (!updating) throw new Error('No update in progress');

  const appDir = path.join(__dirname, '..');
  const composePath = path.join(appDir, 'docker-compose.yml');
  if (!fs.existsSync(composePath)) throw new Error('docker-compose.yml not found');

  // We cannot simply spawn a child process with `sleep && docker compose up`
  // because when this container stops, all its child processes are killed too
  // (they share the container's PID namespace).
  //
  // Strategy: use the mounted Docker socket to launch a short-lived "helper"
  // container on the host. That container sleeps briefly (giving this container
  // time to shut down), then runs `docker compose up` to recreate this
  // container with the freshly built image.
  //
  // The helper needs the compose file, which we copy to the shared data volume
  // that both containers can access.

  // 1. Copy compose file to the data volume
  const composeContent = fs.readFileSync(composePath, 'utf-8');
  const composeCopy = path.join(config.dataDir, 'jewel-compose.yml');
  fs.writeFileSync(composeCopy, composeContent, 'utf-8');

  // 2. Detect the compose project name from this container's labels
  let projectName = 'jewel';
  try {
    const hostname = process.env.HOSTNAME;
    if (hostname) {
      const label = execSync(
        `docker inspect ${hostname} --format '{{index .Config.Labels "com.docker.compose.project"}}'`,
        { timeout: 5000 }
      ).toString().trim();
      if (label) projectName = label;
    }
  } catch { /* use default */ }

  // 3. Build the helper command
  const cmd = [
    'sleep 3',
    `docker compose -p ${projectName} -f /data/jewel-compose.yml up -d --no-build --force-recreate`,
    'rm -f /data/jewel-compose.yml'
  ].join(' && ');

  // 4. Launch helper container
  const child = spawn('docker', [
    'run', '--rm',
    '--name', 'jewel-restart-helper',
    '-v', '/var/run/docker.sock:/var/run/docker.sock',
    '-v', 'jewel-data:/data',
    'docker:cli',
    'sh', '-c', cmd
  ], {
    detached: true,
    stdio: 'ignore'
  });
  child.unref();

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
  applyUpdate,
  scheduleRestart
};
