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
let currentCommitInfo = null;
let updateCheckPromise = null;

const UPDATE_CHECK_TIMEOUT_MS = 5000;

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

async function getCurrentCommitInfo() {
  const current = detectCurrentCommit();
  if (!current || current === 'unknown') return null;

  // Try to get commit info from GitHub API
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.github.com',
      path: `/repos/LYOfficial/Jewel/commits/${current}`,
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
            resolve(null);
          }
        } catch {
          resolve(null);
        }
      });
    });

    req.on('error', () => resolve(null));
    req.setTimeout(UPDATE_CHECK_TIMEOUT_MS, () => { req.destroy(); resolve(null); });
    req.end();
  });
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
    req.setTimeout(UPDATE_CHECK_TIMEOUT_MS, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

function checkForUpdate() {
  if (isUpdating()) return Promise.resolve(false);
  if (updateCheckPromise) return updateCheckPromise;

  updateCheckPromise = (async () => {
    try {
    const remote = await getLatestCommitInfo();
    lastCheckTime = new Date().toISOString();

    if (!remote) return false;

    const current = detectCurrentCommit();
    if (!current) {
      // First run: save remote as current so we don't falsely report an update
      saveCurrentCommit(remote.sha);
      updateAvailable = false;
      latestRemoteInfo = null;
      return false;
    }

    if (!loadCurrentCommit()) {
      saveCurrentCommit(current);
    }

    // If the persisted commit is stale (doesn't match what git/env reports),
    // update it so we don't show outdated info
    const persisted = loadCurrentCommit();
    if (persisted && persisted !== current) {
      saveCurrentCommit(current);
    }

    if (remote.sha !== current) {
      if (currentCommitInfo?.sha !== current) currentCommitInfo = null;
      updateAvailable = true;
      latestRemoteInfo = remote;
      return true;
    }

    // When current and remote are equal, the remote response is also the
    // current commit metadata. Cache it so status reads remain local.
    currentCommitInfo = remote;
    updateAvailable = false;
    latestRemoteInfo = null;
    return false;
    } catch (err) {
      console.error('Check update error:', err.message);
      return false;
    }
  })().finally(() => { updateCheckPromise = null; });

  return updateCheckPromise;
}

async function getUpdateInfo() {
  const current = detectCurrentCommit();
  const currentDate = detectCurrentDate() || (currentCommitInfo?.sha === current ? currentCommitInfo.date : null);
  const currentMessage = currentCommitInfo?.sha === current ? currentCommitInfo.message : null;
  const currentVersionFromCommit = detectLatestVersion(currentMessage);

  return {
    available: updateAvailable,
    currentVersion: currentVersionFromCommit || detectCurrentVersion(),
    currentCommit: current || 'unknown',
    currentDate: currentDate,
    currentMessage: currentMessage,
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

  // Strategy: spawn a helper container that runs install.sh on the host.
  // install.sh will stop & remove the current container, build a new image,
  // and start a new container — so we don't need a separate restart step.
  //
  // We detect the current container's host port and pass it to install.sh
  // so the new container uses the same port.

  const docker = dockerService.getDocker();
  const hostname = process.env.HOSTNAME;
  if (!hostname) {
    updating = false;
    try { fs.unlinkSync(UPDATING_FILE); } catch { /* ignore */ }
    throw new Error('Cannot detect container hostname (HOSTNAME env not set)');
  }

  let hostPort = '330';
  try {
    const info = await docker.getContainer(hostname).inspect();
    const portBindings = info.HostConfig?.PortBindings || {};
    const binding = portBindings['330/tcp'];
    if (binding && binding[0]?.HostPort) hostPort = binding[0].HostPort;
  } catch { /* fall back to default */ }

  // The helper uses the same canonical installer as a first deployment.
  // install.sh builds before stopping the current container and restores it
  // automatically if the replacement does not become ready.
  const helperScript = `#!/bin/sh
set -e
apk add --no-cache curl docker-cli git >/dev/null
sleep 2
curl -fsSL https://raw.githubusercontent.com/LYOfficial/Jewel/main/install.sh | sh -s -- ${hostPort}
`;

  fs.writeFileSync(path.join(config.dataDir, 'jewel-update.sh'), helperScript, 'utf-8');

  // Find the data volume so the helper can read the script
  let dataVolumeName = null;
  try {
    const info = await docker.getContainer(hostname).inspect();
    const dataMount = (info.Mounts || []).find(m => m.Destination === '/data');
    if (dataMount) dataVolumeName = dataMount.Name || dataMount.Source;
  } catch { /* ignore */ }

  const helperBinds = ['/var/run/docker.sock:/var/run/docker.sock'];
  if (dataVolumeName) helperBinds.push(`${dataVolumeName}:/data`);

  // Launch helper container — alpine + script that installs deps and runs install.sh
  try {
    const helper = await docker.createContainer({
      Image: 'alpine:latest',
      Cmd: ['sh', '/data/jewel-update.sh'],
      name: 'jewel-update-helper',
      HostConfig: {
        AutoRemove: true,
        Binds: helperBinds
      }
    });
    await helper.start();
  } catch (err) {
    // If alpine isn't available locally, try to pull it
    try {
      await new Promise((resolve, reject) => {
        docker.pull('alpine:latest', (err, stream) => {
          if (err) return reject(err);
          docker.modem.followProgress(stream, (e) => e ? reject(e) : resolve());
        });
      });
      const helper = await docker.createContainer({
        Image: 'alpine:latest',
        Cmd: ['sh', '/data/jewel-update.sh'],
        name: 'jewel-update-helper',
        HostConfig: {
          AutoRemove: true,
          Binds: helperBinds
        }
      });
      await helper.start();
    } catch (e) {
      updating = false;
      try { fs.unlinkSync(UPDATING_FILE); } catch { /* ignore */ }
      throw new Error('Failed to start update helper: ' + e.message);
    }
  }

  // Set restart policy to "no" so this container doesn't auto-restart
  // when install.sh stops it.
  try {
    await docker.getContainer(hostname).update({ RestartPolicy: { Name: 'no' } });
  } catch { /* best effort */ }

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
