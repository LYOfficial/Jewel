const db = require('./database');
const gitService = require('./git-service');
const dockerService = require('./docker-service');
const operationService = require('./operation-service');
const { tailLines } = require('./diagnostics');
const { withProjectOperationLock } = require('./project-operation-lock');

// Stagger checkProjectUpdates across the periodic interval so we don't
// fork N git+git-remote-https processes back-to-back for every project.
// git-service.js already caps concurrency globally, but spacing the
// checks further cuts peak process count — which is what the PID
// cgroup cares about.
const STAGGER_MS = 1500;

let updateCheckPromise = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function snapshotOperationCommit(operationId, projectId) {
  try {
    const commit = await gitService.getRepoCommit(projectId);
    if (commit) return operationService.setCommitHash(operationId, commit);
  } catch { /* use the persisted project value below */ }

  const project = db.prepare('SELECT commit_hash FROM projects WHERE id = ?').get(projectId);
  return operationService.setCommitHash(operationId, project && project.commit_hash);
}

async function runAutomaticDeployment(project) {
  const operationId = operationService.start({
    projectId: project.id,
    action: 'auto-deploy',
    metadata: { project_name: project.name, trigger: 'commit-update' }
  });

  try {
    db.prepare('UPDATE projects SET status=? WHERE id=?').run('deploying', project.id);
    await gitService.prepareManagedEnvFileForPull(project);
    await gitService.pullRepo(project.id, project.git_branch);
    const output = await dockerService.deployProject(project);
    await updateCommitHash(project.id);
    db.prepare('UPDATE projects SET status=? WHERE id=?').run('running', project.id);
    await snapshotOperationCommit(operationId, project.id);
    operationService.succeed(operationId, {
      summary: `Automatically updated ${project.name}`,
      detail: tailLines(output, 80)
    });
    return true;
  } catch (err) {
    db.prepare('UPDATE projects SET status=? WHERE id=?').run('error', project.id);
    await snapshotOperationCommit(operationId, project.id);
    operationService.fail(operationId, err, {
      summary: `Automatic update failed for ${project.name}`,
      detail: tailLines(dockerService.readDeployLog(project.id), 400)
    });
    console.error(`Automatic update failed for project ${project.id}:`, err.message);
    return false;
  }
}

async function checkProjectUpdate(projectId, { autoDeploy = false } = {}) {
  return withProjectOperationLock(projectId, async () => {
    const project = db.prepare('SELECT * FROM projects WHERE id=?').get(projectId);
    if (!project) return null;

    try {
      const localCommit = await gitService.getRepoCommit(project.id);
      if (!localCommit) return db.prepare('SELECT * FROM projects WHERE id=?').get(project.id);

      await gitService.fetchRepo(project.id);
      // Read HEAD after fetch so a queued manual deployment cannot leave us
      // persisting the commit value from before it completed.
      const currentCommit = await gitService.getRepoCommit(project.id);
      const remoteCommit = await gitService.getRemoteCommit(project.id, project.git_branch);
      const updateAvailable = Boolean(remoteCommit && remoteCommit !== currentCommit);

      db.prepare(`
        UPDATE projects SET commit_hash=?, remote_commit=?, update_available=?, last_update_check=CURRENT_TIMESTAMP WHERE id=?
      `).run(currentCommit || '', remoteCommit || '', updateAvailable ? 1 : 0, project.id);

      const updated = db.prepare('SELECT * FROM projects WHERE id=?').get(project.id);
      // Do not restart a service the user has intentionally stopped. Its
      // pending update remains visible and can be deployed manually later.
      if (autoDeploy && updateAvailable && updated.auto_deploy && updated.status === 'running') {
        await runAutomaticDeployment(updated);
      }
      return db.prepare('SELECT * FROM projects WHERE id=?').get(project.id);
    } catch (err) {
      console.error(`Failed to check update for project ${project.id}:`, err.message);
      return db.prepare('SELECT * FROM projects WHERE id=?').get(project.id);
    }
  });
}

function checkProjectUpdates() {
  if (updateCheckPromise) return updateCheckPromise;

  updateCheckPromise = (async () => {
    const projects = db.prepare('SELECT id FROM projects').all();

    for (let i = 0; i < projects.length; i++) {
      await checkProjectUpdate(projects[i].id, { autoDeploy: true });

      if (i < projects.length - 1) {
        await sleep(STAGGER_MS);
      }
    }
  })().finally(() => { updateCheckPromise = null; });

  return updateCheckPromise;
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

module.exports = { checkProjectUpdates, checkProjectUpdate, updateCommitHash };
