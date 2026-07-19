const db = require('./database');
const gitService = require('./git-service');

// Stagger checkProjectUpdates across the periodic interval so we don't
// fork N git+git-remote-https processes back-to-back for every project.
// git-service.js already caps concurrency globally, but spacing the
// checks further cuts peak process count — which is what the PID
// cgroup cares about.
const STAGGER_MS = 1500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkProjectUpdates() {
  const projects = db.prepare('SELECT * FROM projects').all();

  for (let i = 0; i < projects.length; i++) {
    const project = projects[i];
    try {
      const localCommit = await gitService.getRepoCommit(project.id);
      if (!localCommit) continue;

      await gitService.fetchRepo(project.id);

      const remoteCommit = await gitService.getRemoteCommit(project.id, project.git_branch);
      const updateAvailable = remoteCommit && remoteCommit !== localCommit;

      db.prepare(`
        UPDATE projects SET commit_hash=?, remote_commit=?, update_available=?, last_update_check=CURRENT_TIMESTAMP WHERE id=?
      `).run(localCommit, remoteCommit || '', updateAvailable ? 1 : 0, project.id);
    } catch (err) {
      console.error(`Failed to check update for project ${project.id}:`, err.message);
    }

    if (i < projects.length - 1) {
      await sleep(STAGGER_MS);
    }
  }
}

async function updateCommitHash(projectId) {
  try {
    const commit = await gitService.getRepoCommit(projectId);
    if (commit) {
      db.prepare('UPDATE projects SET commit_hash=?, update_available=0, remote_commit=? WHERE id=?')
        .run(commit, commit, projectId);
    }
  } catch { /* ignore */ }
}

module.exports = { checkProjectUpdates, updateCommitHash };
