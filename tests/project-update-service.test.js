const test = require('node:test');
const assert = require('node:assert/strict');

const servicePath = require.resolve('../src/project-update-service');
const databasePath = require.resolve('../src/database');
const gitServicePath = require.resolve('../src/git-service');
const dockerServicePath = require.resolve('../src/docker-service');
const operationServicePath = require.resolve('../src/operation-service');
const diagnosticsPath = require.resolve('../src/diagnostics');

function createDatabase(projects) {
  const byId = new Map(projects.map(project => [project.id, { ...project }]));
  const getProject = id => {
    const project = byId.get(Number(id));
    return project ? { ...project } : undefined;
  };

  return {
    prepare(sql) {
      const query = sql.replace(/\s+/g, ' ').trim();
      if (query === 'SELECT * FROM projects WHERE id=?') return { get: getProject };
      if (query === 'SELECT id FROM projects WHERE auto_deploy=1') {
        return { all: () => [...byId.values()].filter(project => project.auto_deploy).map(project => ({ id: project.id })) };
      }
      if (query === 'SELECT commit_hash FROM projects WHERE id = ?') {
        return { get: id => {
          const project = getProject(id);
          return project && { commit_hash: project.commit_hash };
        } };
      }
      if (query.startsWith('UPDATE projects SET commit_hash=?, remote_commit=?, update_available=?, last_update_check=')) {
        return { run: (commit, remote, available, id) => {
          Object.assign(byId.get(Number(id)), { commit_hash: commit, remote_commit: remote, update_available: available });
        } };
      }
      if (query === 'UPDATE projects SET status=? WHERE id=?') {
        return { run: (status, id) => { byId.get(Number(id)).status = status; } };
      }
      if (query === 'UPDATE projects SET commit_hash=?, update_available=0, remote_commit=? WHERE id=?') {
        return { run: (commit, remote, id) => {
          Object.assign(byId.get(Number(id)), { commit_hash: commit, remote_commit: remote, update_available: 0 });
        } };
      }
      throw new Error(`Unexpected SQL in project update test: ${query}`);
    }
  };
}

function loadService({ projects, gitService, dockerService }) {
  const operations = [];
  let operationId = 0;
  const operationService = {
    start: data => {
      const operation = { id: ++operationId, ...data, status: 'running', commit_hash: '' };
      operations.push(operation);
      return operation.id;
    },
    setCommitHash: (id, commit) => {
      const operation = operations.find(item => item.id === id);
      if (operation && commit) operation.commit_hash = commit;
      return operation;
    },
    succeed: (id, data) => {
      const operation = operations.find(item => item.id === id);
      Object.assign(operation, data, { status: 'succeeded' });
      return operation;
    },
    fail: (id, error, data) => {
      const operation = operations.find(item => item.id === id);
      Object.assign(operation, data, { status: 'failed', error: error.message });
      return operation;
    }
  };
  const replacements = new Map([
    [databasePath, { exports: createDatabase(projects) }],
    [gitServicePath, { exports: gitService }],
    [dockerServicePath, { exports: dockerService }],
    [operationServicePath, { exports: operationService }],
    [diagnosticsPath, { exports: { tailLines: text => String(text || '') } }]
  ]);
  const originals = new Map([...replacements.keys(), servicePath].map(key => [key, require.cache[key]]));
  for (const [key, value] of replacements) require.cache[key] = value;
  delete require.cache[servicePath];

  return {
    service: require('../src/project-update-service'),
    operations,
    restore() {
      for (const [key, value] of originals) {
        if (value) require.cache[key] = value;
        else delete require.cache[key];
      }
    }
  };
}

test('automatic updates pull and redeploy a running opted-in project', async () => {
  let localCommit = 'local-commit';
  const calls = { fetch: 0, prepare: 0, pull: 0, deploy: 0 };
  const harness = loadService({
    projects: [{
      id: 1, name: 'auto-update-running', git_branch: 'main', auto_deploy: 1,
      status: 'running', commit_hash: 'local-commit', remote_commit: '', update_available: 0
    }],
    gitService: {
      getRepoCommit: async () => localCommit,
      fetchRepo: async () => { calls.fetch += 1; },
      getRemoteCommit: async () => 'remote-commit',
      prepareManagedEnvFileForPull: async () => { calls.prepare += 1; },
      pullRepo: async () => { calls.pull += 1; localCommit = 'remote-commit'; }
    },
    dockerService: {
      deployProject: async () => { calls.deploy += 1; return 'Compose deployment completed'; },
      readDeployLog: () => ''
    }
  });

  try {
    const project = await harness.service.checkProjectUpdate(1, { autoDeploy: true });
    const operation = harness.operations[0];

    assert.deepEqual(calls, { fetch: 1, prepare: 1, pull: 1, deploy: 1 });
    assert.equal(project.status, 'running');
    assert.equal(project.commit_hash, 'remote-commit');
    assert.equal(project.remote_commit, 'remote-commit');
    assert.equal(project.update_available, 0);
    assert.equal(operation.action, 'auto-deploy');
    assert.equal(operation.status, 'succeeded');
    assert.equal(operation.commit_hash, 'remote-commit');
  } finally {
    harness.restore();
  }
});

test('automatic updates never restart a manually stopped project', async () => {
  const calls = { fetch: 0, prepare: 0, pull: 0, deploy: 0 };
  const harness = loadService({
    projects: [{
      id: 2, name: 'auto-update-stopped', git_branch: 'main', auto_deploy: 1,
      status: 'stopped', commit_hash: 'local-commit', remote_commit: '', update_available: 0
    }],
    gitService: {
      getRepoCommit: async () => 'local-commit',
      fetchRepo: async () => { calls.fetch += 1; },
      getRemoteCommit: async () => 'remote-commit',
      prepareManagedEnvFileForPull: async () => { calls.prepare += 1; },
      pullRepo: async () => { calls.pull += 1; }
    },
    dockerService: {
      deployProject: async () => { calls.deploy += 1; },
      readDeployLog: () => ''
    }
  });

  try {
    const project = await harness.service.checkProjectUpdate(2, { autoDeploy: true });

    assert.deepEqual(calls, { fetch: 1, prepare: 0, pull: 0, deploy: 0 });
    assert.equal(project.status, 'stopped');
    assert.equal(project.update_available, 1);
    assert.equal(harness.operations.length, 0);
  } finally {
    harness.restore();
  }
});

test('a project with automatic updates disabled only records the available commit', async () => {
  const calls = { fetch: 0, prepare: 0, pull: 0, deploy: 0 };
  const harness = loadService({
    projects: [{
      id: 3, name: 'auto-update-disabled', git_branch: 'main', auto_deploy: 0,
      status: 'running', commit_hash: 'local-commit', remote_commit: '', update_available: 0
    }],
    gitService: {
      getRepoCommit: async () => 'local-commit',
      fetchRepo: async () => { calls.fetch += 1; },
      getRemoteCommit: async () => 'remote-commit',
      prepareManagedEnvFileForPull: async () => { calls.prepare += 1; },
      pullRepo: async () => { calls.pull += 1; }
    },
    dockerService: {
      deployProject: async () => { calls.deploy += 1; },
      readDeployLog: () => ''
    }
  });

  try {
    const project = await harness.service.checkProjectUpdate(3, { autoDeploy: true });

    assert.deepEqual(calls, { fetch: 1, prepare: 0, pull: 0, deploy: 0 });
    assert.equal(project.status, 'running');
    assert.equal(project.update_available, 1);
    assert.equal(harness.operations.length, 0);
  } finally {
    harness.restore();
  }
});

test('the automatic scheduler only fetches projects that opted in', async () => {
  const fetched = [];
  const harness = loadService({
    projects: [
      { id: 4, name: 'automatic', git_branch: 'main', auto_deploy: 1, status: 'running', commit_hash: 'same', remote_commit: '', update_available: 0 },
      { id: 5, name: 'manual-only', git_branch: 'main', auto_deploy: 0, status: 'running', commit_hash: 'same', remote_commit: '', update_available: 0 }
    ],
    gitService: {
      getRepoCommit: async () => 'same',
      fetchRepo: async id => { fetched.push(id); },
      getRemoteCommit: async () => 'same',
      prepareManagedEnvFileForPull: async () => {},
      pullRepo: async () => {}
    },
    dockerService: { deployProject: async () => '', readDeployLog: () => '' }
  });

  try {
    await harness.service.checkProjectUpdates();
    assert.deepEqual(fetched, [4]);
  } finally {
    harness.restore();
  }
});

test('a manual check immediately returns cached state when a project is busy', async () => {
  const lock = require('../src/project-operation-lock');
  let release;
  const blocker = lock.withProjectOperationLock(6, () => new Promise(resolve => { release = resolve; }));
  const harness = loadService({
    projects: [{ id: 6, name: 'busy', git_branch: 'main', auto_deploy: 1, status: 'deploying', commit_hash: 'local', remote_commit: '', update_available: 0 }],
    gitService: {
      getRepoCommit: async () => 'local',
      fetchRepo: async () => { throw new Error('manual check should not fetch'); },
      getRemoteCommit: async () => 'local',
      prepareManagedEnvFileForPull: async () => {},
      pullRepo: async () => {}
    },
    dockerService: { deployProject: async () => '', readDeployLog: () => '' }
  });

  try {
    const project = await harness.service.checkProjectUpdate(6, { waitForLock: false });
    assert.equal(project.update_check_pending, true);
    assert.equal(project.status, 'deploying');
  } finally {
    await Promise.resolve();
    release();
    await blocker;
    harness.restore();
  }
});
