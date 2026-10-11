const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');

const root = path.resolve(__dirname, '..');
const servicePath = path.join(root, 'src', 'docker-service.js');
const requireFromService = createRequire(servicePath);

function loadConfig(value) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'src', 'config.js'), 'utf8'), {
    module, require, __dirname: path.join(root, 'src'),
    process: { env: value === undefined ? {} : { DEPLOY_TIMEOUT_MS: value } }
  });
  return module.exports;
}

async function withDeployment({ timeout, fail = false }, verify) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jewel-deployment-timeout-'));
  const projectDir = path.join(dataDir, 'projects', '27');
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'docker-compose.yml'), 'services:\n  app:\n    image: example/app\n');
  const calls = [];
  const config = loadConfig(timeout);
  const module = { exports: {} };
  const replacements = {
    dockerode: class { async listContainers() { return []; } },
    child_process: { exec() {}, execSync() {} },
    util: { promisify: () => async (command, options) => {
      calls.push({ command, options });
      if (fail && command.includes('up -d --build')) {
        throw Object.assign(new Error('command terminated'), {
          killed: true, signal: 'SIGTERM', code: 255, stderr: 'pip is downloading dependencies'
        });
      }
      return { stdout: 'completed' };
    } },
    './config': config,
    './git-service': {},
    './project-env-service': { syncProjectEnvFile() {} },
    './project-resource-utils': {},
    './jewel-resource-utils': {}
  };
  vm.runInNewContext(fs.readFileSync(servicePath, 'utf8'), {
    module, require: name => replacements[name] || requireFromService(name),
    __dirname: path.dirname(servicePath), Buffer,
    process: { env: { DATA_DIR: dataDir }, platform: 'linux' }
  });
  try {
    await verify(module.exports, calls);
  } finally {
    assert.equal(path.dirname(path.resolve(dataDir)), path.resolve(os.tmpdir()));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

const project = { id: 27, name: 'vustb', compose_path: 'docker-compose.yml' };

test('cold Compose builds receive thirty minutes by default', async () => {
  await withDeployment({}, async (service, calls) => {
    await service.deployProject(project);
    assert.equal(calls[0].options.timeout, 1800000);
    assert.match(service.readDeployLog(27), /Command timeout: 1800000 ms/);
  });
});

test('configured deployment timeout reaches the Compose command', async () => {
  await withDeployment({ timeout: '2700000' }, async (service, calls) => {
    await service.deployProject(project);
    assert.equal(calls[0].options.timeout, 2700000);
  });
});

test('invalid timeout configuration keeps the default instead of disabling the limit', () => {
  for (const value of ['0', '-1', 'invalid', 'Infinity', '2147483648']) {
    assert.equal(loadConfig(value).deployTimeoutMs, 1800000);
  }
});

test('terminated builds report the timeout and preserve normal cleanup', async () => {
  await withDeployment({ fail: true }, async (service, calls) => {
    await assert.rejects(service.deployProject(project), /Command timed out after 1800000 ms/);
    assert.match(service.readDeployLog(27), /timed out after 1800000 ms/);
    assert.match(calls[1].command, /down --remove-orphans --rmi local/);
  });
});
