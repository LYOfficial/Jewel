const { simpleGit } = require('simple-git');
const path = require('path');
const fs = require('fs');
const config = require('./config');

// ============================================================
// Concurrency control
// ------------------------------------------------------------
// Git internally forks `git-remote-https` to fetch from HTTPS
// remotes. When the container's PIDs limit is hit, that fork
// fails with `cannot fork() for remote-https: Resource
// temporarily unavailable` and the update aborts — even though
// the auth, URL, and credentials are perfectly fine.
//
// Two layers of defense here:
//   1. A per-repo async mutex: serializes operations on the same
//      project directory so a rebuild + a periodic check + a
//      user-triggered update don't all fork at the same time.
//   2. A small global semaphore: caps total concurrent git
//      operations across the whole process so the periodic loop
//      over every project can't flood the cgroup.
// ============================================================

// Per-project mutex (one chain of operations per projectDir).
const gitLocks = new Map();

function withGitLock(projectDir, fn) {
  const prev = gitLocks.get(projectDir) || Promise.resolve();
  let release;
  const next = new Promise((resolve) => { release = resolve; });
  gitLocks.set(projectDir, prev.then(() => next));
  return prev.then(fn).finally(() => {
    release();
    if (gitLocks.get(projectDir) === next) gitLocks.delete(projectDir);
  });
}

// Global cap on concurrent git operations. 4 is conservative
// enough to stay well below typical container PID limits even
// when git forks its remote-https helper for each call.
const MAX_CONCURRENT_GIT = 4;
let activeGitOps = 0;
const gitWaiters = [];

async function withGitGate(fn) {
  if (activeGitOps >= MAX_CONCURRENT_GIT) {
    await new Promise((resolve) => gitWaiters.push(resolve));
  }
  activeGitOps++;
  try {
    return await fn();
  } finally {
    activeGitOps--;
    const next = gitWaiters.shift();
    if (next) next();
  }
}

// Cache simpleGit instances per project directory. The wrapper
// itself is cheap, but reusing it lets us share output config
// and avoids creating fresh closures on every call.
const gitInstances = new Map();

function getGit(projectDir) {
  let git = gitInstances.get(projectDir);
  if (!git) {
    git = simpleGit({
      baseDir: projectDir,
      maxConcurrentProcesses: 1,
      // Trimming output keeps the in-memory buffer small, which
      // matters when these are spawned frequently.
      trimmed: true
    });
    gitInstances.set(projectDir, git);
  }
  return git;
}

function invalidateGit(projectDir) {
  gitInstances.delete(projectDir);
}

async function cloneRepo(gitUrl, projectId, branch = 'main', token = '') {
  const projectDir = path.join(config.dataDir, 'projects', String(projectId));

  if (fs.existsSync(projectDir)) {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
  fs.mkdirSync(projectDir, { recursive: true });

  let authUrl = gitUrl;
  if (token) {
    if (gitUrl.includes('github.com')) {
      authUrl = gitUrl.replace('https://', `https://${token}@`);
    } else if (gitUrl.includes('gitlab')) {
      authUrl = gitUrl.replace('https://', `https://oauth2:${token}@`);
    }
  }

  // The destination doesn't exist yet, so use a one-off instance.
  return withGitGate(async () => {
    const git = simpleGit({ maxConcurrentProcesses: 1, trimmed: true });
    await git.clone(authUrl, projectDir, ['--branch', branch, '--single-branch', '--depth', '1']);
    invalidateGit(projectDir);
    return projectDir;
  });
}

async function pullRepo(projectId, branch = 'main') {
  const projectDir = path.join(config.dataDir, 'projects', String(projectId));
  if (!fs.existsSync(projectDir)) {
    throw new Error('Project directory not found');
  }

  return withGitLock(projectDir, () => withGitGate(async () => {
    const git = getGit(projectDir);
    await git.pull('origin', branch);
    return projectDir;
  }));
}

async function listGitHubRepos(token) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: '/user/repos?per_page=100&sort=updated',
      headers: {
        'Authorization': `token ${token}`,
        'User-Agent': 'Jewel-App',
        'Accept': 'application/vnd.github.v3+json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const repos = JSON.parse(data);
          resolve(repos.map(r => ({
            name: r.name,
            full_name: r.full_name,
            url: r.clone_url,
            private: r.private,
            owner: r.owner.login,
            default_branch: r.default_branch,
            updated_at: r.updated_at
          })));
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function listGitLabRepos(token, host = 'gitlab.com') {
  const https = require('https');
  return new Promise((resolve, reject) => {
    const options = {
      hostname: host,
      path: '/api/v4/projects?membership=true&per_page=100&order_by=updated_at',
      headers: {
        'PRIVATE-TOKEN': token,
        'User-Agent': 'Jewel-App'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const repos = JSON.parse(data);
          resolve(repos.map(r => ({
            name: r.name,
            full_name: r.path_with_namespace,
            url: r.http_url_to_repo,
            private: !r.public,
            owner: r.namespace.path,
            default_branch: r.default_branch || 'main',
            updated_at: r.last_activity_at
          })));
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

function getRepoCommit(projectId) {
  const projectDir = path.join(config.dataDir, 'projects', String(projectId));
  if (!fs.existsSync(projectDir)) return null;

  try {
    const git = getGit(projectDir);
    return git.revparse(['HEAD']);
  } catch {
    return null;
  }
}

async function fetchRepo(projectId) {
  const projectDir = path.join(config.dataDir, 'projects', String(projectId));
  if (!fs.existsSync(projectDir)) {
    throw new Error('Project directory not found');
  }
  return withGitLock(projectDir, () => withGitGate(async () => {
    const git = getGit(projectDir);
    await git.fetch('origin');
    return projectDir;
  }));
}

async function getRemoteCommit(projectId, branch = 'main') {
  const projectDir = path.join(config.dataDir, 'projects', String(projectId));
  if (!fs.existsSync(projectDir)) return null;
  return withGitLock(projectDir, () => withGitGate(async () => {
    try {
      const git = getGit(projectDir);
      return await git.revparse([`origin/${branch}`]);
    } catch {
      return null;
    }
  }));
}

module.exports = {
  cloneRepo,
  pullRepo,
  listGitHubRepos,
  listGitLabRepos,
  getRepoCommit,
  fetchRepo,
  getRemoteCommit,
  invalidateGit
};