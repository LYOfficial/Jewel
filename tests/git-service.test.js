const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

function loadGitService(dataDir, raw) {
  const originalLoad = Module._load;
  const servicePath = require.resolve('../src/git-service');
  const configPath = require.resolve('../src/config');
  delete require.cache[servicePath];
  delete require.cache[configPath];
  process.env.DATA_DIR = dataDir;
  Module._load = function (request, parent, isMain) {
    if (request === 'simple-git') return { simpleGit: () => ({ raw }) };
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require('../src/git-service');
  } finally {
    Module._load = originalLoad;
  }
}

test('prepares only Jewel-managed .env files for a Git pull', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jewel-git-service-'));
  const projectDir = path.join(dataDir, 'projects', '7');
  const envPath = path.join(projectDir, '.env');
  fs.mkdirSync(projectDir, { recursive: true });
  const rawCalls = [];
  let envIsTracked = false;
  const gitService = loadGitService(dataDir, async args => {
    rawCalls.push(args);
    if (args[0] === 'ls-files' && !envIsTracked) throw new Error('pathspec .env is not tracked');
    if (args[0] === 'checkout') fs.writeFileSync(envPath, 'FROM_REPOSITORY=1\n', 'utf8');
  });
  const project = { id: 7, env_vars: JSON.stringify({ API_KEY: 'saved-value' }) };

  try {
    fs.writeFileSync(envPath, 'API_KEY=manual-value\n', 'utf8');
    assert.equal(await gitService.prepareManagedEnvFileForPull(project), false);
    assert.equal(fs.existsSync(envPath), true);
    assert.deepEqual(rawCalls, []);

    fs.writeFileSync(envPath, 'API_KEY=saved-value\n', 'utf8');
    assert.equal(await gitService.prepareManagedEnvFileForPull(project), true);
    assert.equal(fs.existsSync(envPath), false);
    assert.deepEqual(rawCalls, [['ls-files', '--error-unmatch', '--', '.env']]);

    envIsTracked = true;
    rawCalls.length = 0;
    fs.writeFileSync(envPath, 'API_KEY=saved-value\n', 'utf8');
    assert.equal(await gitService.prepareManagedEnvFileForPull(project), true);
    assert.equal(fs.readFileSync(envPath, 'utf8'), 'FROM_REPOSITORY=1\n');
    assert.deepEqual(rawCalls, [
      ['ls-files', '--error-unmatch', '--', '.env'],
      ['checkout', 'HEAD', '--', '.env']
    ]);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
