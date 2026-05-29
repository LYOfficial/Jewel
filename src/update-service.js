const https = require('https');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const dockerService = require('./docker-service');

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

  updating = true;
  try { fs.writeFileSync(UPDATING_FILE, Date.now().toString(), 'utf-8'); } catch { /* ignore */ }

  // Maintain a git clone in the data volume (/data/jewel-source).
  // This works regardless of how the container was deployed — whether via
  // install.sh (no .git inside container) or docker compose (has .git).
  // The data volume persists across container restarts, so we only clone once
  // and pull on subsequent updates.
  const sourceDir = path.join(config.dataDir, 'jewel-source');
  const repoUrl = 'https://github.com/LYOfficial/Jewel.git';

  try {
    if (fs.existsSync(path.join(sourceDir, '.git'))) {
      execSync('git fetch origin main', { cwd: sourceDir, timeout: 60000 });
      execSync('git reset --hard origin/main', { cwd: sourceDir, timeout: 30000 });
    } else {
      // Clean up any leftover directory, then fresh clone
      try { fs.rmSync(sourceDir, { recursive: true, force: true }); } catch { /* ignore */ }
      execSync(`git clone --depth 1 --branch main ${repoUrl} ${sourceDir}`, { timeout: 120000 });
    }
  } catch (err) {
    updating = false;
    try { fs.unlinkSync(UPDATING_FILE); } catch { /* ignore */ }
    throw new Error('Git pull/clone failed: ' + err.message);
  }

  // Build the new image from the cloned source
  try {
    execSync('docker build --no-cache -t jewel:latest .', {
      cwd: sourceDir, timeout: 600000, stdio: 'pipe'
    });
  } catch (err) {
    updating = false;
    try { fs.unlinkSync(UPDATING_FILE); } catch { /* ignore */ }
    throw new Error('Docker image build failed: ' + err.message);
  }

  return { success: true, needsRestart: true };
}

async function scheduleRestart() {
  if (!updating) throw new Error('No update in progress');

  const docker = dockerService.getDocker();
  const hostname = process.env.HOSTNAME;
  if (!hostname) throw new Error('Cannot detect container hostname (HOSTNAME env not set)');

  const currentContainer = docker.getContainer(hostname);
  const info = await currentContainer.inspect();

  // Extract the current container's config so the helper can recreate it
  // with the exact same settings but the new image.
  const hc = info.HostConfig || {};
  const containerName = (info.Name || '').replace(/^\//, '') || 'jewel';
  const portBindings = hc.PortBindings || {};
  const binds = hc.Binds || [];
  const restartPolicy = (hc.RestartPolicy && hc.RestartPolicy.Name) || 'unless-stopped';
  const envVars = info.Config?.Env || [];

  // Build a `docker run` command that recreates this container
  const parts = ['docker', 'run', '-d'];
  parts.push('--name', shellQ(containerName));
  parts.push('--restart', shellQ(restartPolicy));

  for (const [containerPort, mappings] of Object.entries(portBindings)) {
    for (const m of (mappings || [])) {
      const host = m.HostIp ? `${m.HostIp}:` : '';
      const cp = containerPort.split('/')[0]; // strip /tcp /udp
      parts.push('-p', shellQ(`${host}${m.HostPort}:${cp}`));
    }
  }

  for (const b of binds) {
    parts.push('-v', shellQ(b));
  }

  for (const e of envVars) {
    parts.push('-e', shellQ(e));
  }

  parts.push('jewel:latest');

  const runCmd = parts.join(' ');

  // Write a self-contained helper script to the data volume
  const helperScript = [
    '#!/bin/sh',
    'sleep 3',
    `docker rm -f ${shellQ(containerName)}`,
    runCmd,
    'rm -f /data/jewel-restart.sh'
  ].join('\n');

  fs.writeFileSync(path.join(config.dataDir, 'jewel-restart.sh'), helperScript, 'utf-8');

  // Find the data volume mount so the helper can access the script
  const dataMount = (info.Mounts || []).find(m => m.Destination === '/data');
  const dataVolumeName = dataMount ? (dataMount.Name || dataMount.Source) : null;

  const helperBinds = ['/var/run/docker.sock:/var/run/docker.sock'];
  if (dataVolumeName) helperBinds.push(`${dataVolumeName}:/data`);

  // Launch the helper container using the freshly built jewel:latest image
  const helper = await docker.createContainer({
    Image: 'jewel:latest',
    Cmd: ['sh', '/data/jewel-restart.sh'],
    name: 'jewel-restart-helper',
    HostConfig: {
      AutoRemove: true,
      Binds: helperBinds
    }
  });

  await helper.start();

  // CRITICAL: set restart policy to "no" on the current container.
  // Without this, Docker's "restart: unless-stopped" would restart the OLD
  // container immediately after process.exit(0).
  await currentContainer.update({ RestartPolicy: { Name: 'no' } });

  updateAvailable = false;
  latestRemoteInfo = null;

  return { success: true, restarting: true };
}

function shellQ(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
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
