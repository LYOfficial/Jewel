const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const settings = new Map();
const databaseStub = {
  prepare() {
    return {
      get(key) {
        return settings.has(key) ? { value: settings.get(key) } : undefined;
      },
      run(key, value) {
        settings.set(key, value);
      }
    };
  }
};

const originalLoad = Module._load;
Module._load = function loadProjectMetricsDatabase(request, parent, isMain) {
  if (request === './database' && parent?.filename.endsWith('project-metrics-auth-service.js')) {
    return databaseStub;
  }
  return originalLoad.call(this, request, parent, isMain);
};
const metricsAuth = require('../src/project-metrics-auth-service');
Module._load = originalLoad;

test('project metrics access key is independent, authenticates header requests, and can rotate', () => {
  const initial = metricsAuth.getAccessKey();
  assert.match(initial, /^jwl_pm_[A-Za-z0-9_-]{43}$/);
  assert.equal(metricsAuth.authenticate({ headers: { 'x-jewel-project-metrics-key': initial } }), true);
  assert.equal(metricsAuth.authenticate({ headers: { 'x-jewel-project-metrics-key': 'wrong' } }), false);

  const rotated = metricsAuth.rotateAccessKey();
  assert.notEqual(rotated, initial);
  assert.equal(metricsAuth.authenticate({ headers: { 'x-jewel-project-metrics-key': initial } }), false);
  assert.equal(metricsAuth.authenticate({ headers: { 'x-jewel-project-metrics-key': rotated } }), true);
});
