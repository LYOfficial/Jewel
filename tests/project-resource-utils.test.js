const test = require('node:test');
const assert = require('node:assert/strict');

const {
  collectContainerMounts,
  mergeNamedVolumes,
  summarizeContainerStats
} = require('../src/project-resource-utils');

test('project resource mounts use inspected data and count each host directory once', () => {
  const resources = collectContainerMounts([
    {
      container: { Id: 'one', Names: ['/web'] },
      info: {
        Mounts: [
          { Type: 'bind', Source: '/srv/demo/data', Destination: '/app/data' },
          { Type: 'volume', Name: 'demo_db', Destination: '/var/lib/postgresql/data' }
        ]
      }
    },
    {
      container: { Id: 'two', Names: ['/worker'] },
      info: {
        Mounts: [
          { Type: 'bind', Source: '/srv/demo/data', Destination: '/worker/data' },
          { Type: 'bind', Source: '/srv/demo/cache', Destination: '/worker/cache' }
        ]
      }
    }
  ]);

  assert.equal(resources.bindMounts.length, 2);
  assert.deepEqual(resources.bindMounts[0], {
    source: '/srv/demo/cache', destinations: ['/worker/cache'], containers: ['worker']
  });
  assert.deepEqual(resources.bindMounts[1], {
    source: '/srv/demo/data', destinations: ['/app/data', '/worker/data'], containers: ['web', 'worker']
  });
  assert.deepEqual(resources.volumes, [{
    name: 'demo_db', destinations: ['/var/lib/postgresql/data'], containers: ['web']
  }]);
});

test('project resource merges inspected and compose-labelled named volumes', () => {
  const volumes = mergeNamedVolumes(
    [{ name: 'demo_db', destinations: [], containers: [], project_id: 8, project_name: 'demo' }],
    [{ name: 'demo_db', destinations: ['/var/lib/db'], containers: ['db'] }, { name: 'demo_cache', destinations: ['/cache'], containers: ['web'] }],
    { id: 8, name: 'demo' }
  );

  assert.deepEqual(volumes, [
    { name: 'demo_cache', destinations: ['/cache'], containers: ['web'], project_id: 8, project_name: 'demo' },
    { name: 'demo_db', destinations: ['/var/lib/db'], containers: ['db'], project_id: 8, project_name: 'demo' }
  ]);
});

test('project resource statistics aggregate Docker CPU and working-set memory', () => {
  const stats = summarizeContainerStats([
    {
      cpu_stats: {
        online_cpus: 2,
        cpu_usage: { total_usage: 300, percpu_usage: [150, 150] },
        system_cpu_usage: 1_400
      },
      precpu_stats: {
        cpu_usage: { total_usage: 100 },
        system_cpu_usage: 1_000
      },
      memory_stats: { usage: 1_000, limit: 4_000, stats: { inactive_file: 200 } }
    },
    null
  ]);

  assert.equal(stats.cpu_percent, 100);
  assert.equal(stats.memory_bytes, 800);
  assert.equal(stats.memory_limit_bytes, 4_000);
  assert.equal(stats.memory_percent, 20);
  assert.equal(stats.unavailable_containers, 1);
});
