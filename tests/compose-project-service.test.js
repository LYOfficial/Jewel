const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const servicePath = require.resolve('../src/compose-project-service');
const configPath = require.resolve('../src/config');

function loadService(dataDir) {
  const originalDataDir = process.env.DATA_DIR;
  const originalService = require.cache[servicePath];
  const originalConfig = require.cache[configPath];
  process.env.DATA_DIR = dataDir;
  delete require.cache[servicePath];
  delete require.cache[configPath];

  return {
    service: require('../src/compose-project-service'),
    restore() {
      if (originalService) require.cache[servicePath] = originalService;
      else delete require.cache[servicePath];
      if (originalConfig) require.cache[configPath] = originalConfig;
      else delete require.cache[configPath];
      if (originalDataDir === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = originalDataDir;
    }
  };
}

test('writes a validated direct Docker Compose project into its isolated directory', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jewel-compose-project-'));
  const harness = loadService(dataDir);
  const compose = [
    'services:',
    '  core:',
    '    image: sengokucola/maibot:latest',
    '    ports:',
    '      - "18001:8001"'
  ].join('\n');

  try {
    const composePath = harness.service.writeComposeProject(23, compose);
    assert.equal(composePath, path.join(dataDir, 'projects', '23', 'docker-compose.yml'));
    assert.equal(fs.readFileSync(composePath, 'utf8'), compose);
  } finally {
    harness.restore();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('rejects Compose content without services before creating a project directory', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jewel-compose-project-'));
  const harness = loadService(dataDir);

  try {
    assert.throws(
      () => harness.service.writeComposeProject(24, 'name: incomplete'),
      /must define at least one service/
    );
    assert.equal(fs.existsSync(path.join(dataDir, 'projects', '24')), false);
  } finally {
    harness.restore();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
