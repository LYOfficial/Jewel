const { simpleGit } = require('simple-git');
const path = require('path');
const fs = require('fs');
const config = require('./config');

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

  const git = simpleGit();
  await git.clone(authUrl, projectDir, ['--branch', branch, '--single-branch', '--depth', '1']);

  return projectDir;
}

async function pullRepo(projectId, branch = 'main') {
  const projectDir = path.join(config.dataDir, 'projects', String(projectId));
  if (!fs.existsSync(projectDir)) {
    throw new Error('Project directory not found');
  }

  const git = simpleGit(projectDir);
  await git.pull('origin', branch);
  return projectDir;
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
    const git = simpleGit(projectDir);
    return git.revparse(['HEAD']);
  } catch {
    return null;
  }
}

module.exports = {
  cloneRepo,
  pullRepo,
  listGitHubRepos,
  listGitLabRepos,
  getRepoCommit
};
