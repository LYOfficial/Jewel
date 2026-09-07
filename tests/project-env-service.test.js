const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const servicePath = require.resolve('../src/project-env-service');
const configPath = require.resolve('../src/config');
const databasePath = require.resolve('../src/database');

function loadService(dataDir) {
  const originalDataDir = process.env.DATA_DIR;
  const originals = new Map([
    [servicePath, require.cache[servicePath]],
    [configPath, require.cache[configPath]],
    [databasePath, require.cache[databasePath]]
  ]);
  const writes = [];

  process.env.DATA_DIR = dataDir;
  delete require.cache[servicePath];
  delete require.cache[configPath];
  require.cache[databasePath] = {
    exports: {
      prepare(sql) {
        assert.equal(sql, 'UPDATE projects SET env_vars = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
        return { run: (envVars, id) => writes.push({ envVars, id }) };
      }
    }
  };

  return {
    service: require('../src/project-env-service'),
    writes,
    restore() {
      for (const [modulePath, cached] of originals) {
        if (cached) require.cache[modulePath] = cached;
        else delete require.cache[modulePath];
      }
      if (originalDataDir === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = originalDataDir;
    }
  };
}

test('normal deployment synchronization writes the project setting values to .env', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jewel-project-env-'));
  const projectDir = path.join(dataDir, 'projects', '11');
  fs.mkdirSync(projectDir, { recursive: true });
  const harness = loadService(dataDir);

  try {
    harness.service.syncProjectEnvFile({
      id: 11,
      env_vars: JSON.stringify({ SITE_URL: 'https://jewel.example', TOKEN: 'abc=123' })
    });

    assert.equal(
      fs.readFileSync(path.join(projectDir, '.env'), 'utf8'),
      'SITE_URL=https://jewel.example\nTOKEN=abc=123\n'
    );
  } finally {
    harness.restore();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('rebuild imports a cloned .env into the persisted project environment settings', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jewel-project-env-'));
  const projectDir = path.join(dataDir, 'projects', '12');
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, '.env'), '# Repository values\nSITE_URL=https://app.example\nexport TRUSTED_HOSTS=app.example\n', 'utf8');
  const harness = loadService(dataDir);

  try {
    const synced = harness.service.initializeRebuiltProjectEnv({
      id: 12,
      env_vars: JSON.stringify({ SITE_URL: 'https://stale.example' })
    });

    const expected = JSON.stringify({ SITE_URL: 'https://app.example', TRUSTED_HOSTS: 'app.example' });
    assert.equal(synced.env_vars, expected);
    assert.deepEqual(harness.writes, [{ id: 12, envVars: expected }]);
  } finally {
    harness.restore();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('rebuild creates .env from configured settings when the clone has no .env', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jewel-project-env-'));
  const projectDir = path.join(dataDir, 'projects', '13');
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, '.env.example'), 'SITE_URL=https://example-should-not-win\n', 'utf8');
  const harness = loadService(dataDir);

  try {
    const synced = harness.service.initializeRebuiltProjectEnv({
      id: 13,
      env_vars: JSON.stringify({ SITE_URL: 'https://configured.example', TRUSTED_HOSTS: 'configured.example' })
    });

    assert.equal(
      fs.readFileSync(path.join(projectDir, '.env'), 'utf8'),
      'SITE_URL=https://configured.example\nTRUSTED_HOSTS=configured.example\n'
    );
    assert.equal(synced.env_vars, JSON.stringify({ SITE_URL: 'https://configured.example', TRUSTED_HOSTS: 'configured.example' }));
  } finally {
    harness.restore();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('rebuild copies .env.example and imports it when neither source has values', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jewel-project-env-'));
  const projectDir = path.join(dataDir, 'projects', '14');
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, '.env.example'), '# Configure this value\nSITE_URL=https://example.example\nTRUSTED_HOSTS=example.example\n', 'utf8');
  const harness = loadService(dataDir);

  try {
    const synced = harness.service.initializeRebuiltProjectEnv({ id: 14, env_vars: '{}' });

    assert.equal(
      fs.readFileSync(path.join(projectDir, '.env'), 'utf8'),
      '# Configure this value\nSITE_URL=https://example.example\nTRUSTED_HOSTS=example.example\n'
    );
    assert.equal(synced.env_vars, JSON.stringify({ SITE_URL: 'https://example.example', TRUSTED_HOSTS: 'example.example' }));
  } finally {
    harness.restore();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
