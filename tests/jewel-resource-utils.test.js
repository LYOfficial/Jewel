const test = require('node:test');
const assert = require('node:assert/strict');

const { findJewelContainer, summarizeJewelStorage } = require('../src/jewel-resource-utils');
const systemRoutes = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'routes-system.js'), 'utf8');
const dashboard = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'js', 'dashboard.js'), 'utf8');

test('finds the active named Jewel container ahead of a labelled rollback container', () => {
  const container = findJewelContainer([
    { Id: 'old', Names: ['/jewel-rollback'], Labels: { 'io.jewel.managed': 'true' } },
    { Id: 'current', Names: ['/jewel'], Labels: { 'io.jewel.managed': 'true' } }
  ]);

  assert.equal(container.Id, 'current');
});

test('summarizes Jewel image, writable layer, and named data volume without double counting', () => {
  const storage = summarizeJewelStorage(
    { ImageID: 'sha256:image', SizeRw: 15, SizeRootFs: 115 },
    { Image: 'sha256:image', Mounts: [{ Type: 'volume', Name: 'jewel-data', Destination: '/data' }] },
    {
      Images: [{ Id: 'image', Size: 100 }],
      Volumes: [{ Name: 'jewel-data', UsageData: { Size: 250 } }]
    }
  );

  assert.deepEqual(storage, {
    total_bytes: 365,
    image_bytes: 100,
    writable_layer_bytes: 15,
    data_bytes: 250,
    data_included: true,
    data_mount_type: 'volume'
  });
});

test('does not claim an arbitrary bind-mounted data directory is measured', () => {
  const storage = summarizeJewelStorage(
    { SizeRw: 5, SizeRootFs: 45 },
    { Mounts: [{ Type: 'bind', Source: '/srv/jewel-data', Destination: '/data' }] },
    {}
  );

  assert.equal(storage.image_bytes, 40);
  assert.equal(storage.data_bytes, null);
  assert.equal(storage.data_included, false);
  assert.equal(storage.total_bytes, 45);
});

test('dashboard uses the short comparable host CPU sample returned with Jewel stats', () => {
  assert.match(systemRoutes, /const before = readCpuTimes\(\);[\s\S]*?await wait\(750\);[\s\S]*?host_cpu_percent/);
  assert.match(systemRoutes, /Math\.max\(hostCpuPercent, Number\(resource\.cpu_percent\) \|\| 0\)/);
  assert.match(dashboard, /this\.setHostCpu\(resource\.host_cpu_percent\)/);
});

test('Jewel and network metrics use compact inline layouts while host resources retain rings', () => {
  const css = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');
  assert.match(dashboard, /class="jewel-resource-inline"/);
  assert.match(dashboard, /class="network-inline"/);
  assert.match(dashboard, /class="monitor-grid"/);
  assert.match(dashboard, /id="cpuRing"/);
  assert.match(dashboard, /drawRing\(canvasId, percent, color\)/);
  assert.match(css, /\.jewel-resource-inline,[\s\S]*?\.network-inline \{ display: flex; align-items: center;/);
  assert.match(css, /\.jewel-resource-item > small \{ display: none; \}/);
});

test('dashboard labels binary byte values with IEC units', () => {
  assert.match(dashboard, /\['B', 'KiB', 'MiB', 'GiB', 'TiB'\]/);
});
