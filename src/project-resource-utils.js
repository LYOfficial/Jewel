function containerName(container) {
  return ((container.Names && container.Names[0]) || container.Id || '').replace(/^\//, '');
}

function collectContainerMounts(containers) {
  const volumes = new Map();
  const bindMounts = new Map();

  for (const { container, info } of containers) {
    const name = containerName(container);
    // Container summaries normally include Mounts, but Docker does not
    // guarantee it. Inspect data is the authoritative source for both
    // named volumes and host-directory bind mounts.
    const mounts = (info && info.Mounts && info.Mounts.length)
      ? info.Mounts
      : (container.Mounts || []);

    for (const mount of mounts) {
      if (mount.Type === 'volume' && mount.Name) {
        if (!volumes.has(mount.Name)) {
          volumes.set(mount.Name, { name: mount.Name, destinations: [], containers: [] });
        }
        const volume = volumes.get(mount.Name);
        if (mount.Destination && !volume.destinations.includes(mount.Destination)) volume.destinations.push(mount.Destination);
        if (name && !volume.containers.includes(name)) volume.containers.push(name);
      }

      if (mount.Type === 'bind' && mount.Source) {
        // A bind mount represents a host directory. Grouping by Source keeps
        // the dashboard count tied to local directories rather than counting
        // the same directory again for every container that uses it.
        if (!bindMounts.has(mount.Source)) {
          bindMounts.set(mount.Source, { source: mount.Source, destinations: [], containers: [] });
        }
        const bindMount = bindMounts.get(mount.Source);
        if (mount.Destination && !bindMount.destinations.includes(mount.Destination)) bindMount.destinations.push(mount.Destination);
        if (name && !bindMount.containers.includes(name)) bindMount.containers.push(name);
      }
    }
  }

  return {
    volumes: [...volumes.values()].sort((a, b) => a.name.localeCompare(b.name)),
    bindMounts: [...bindMounts.values()].sort((a, b) => a.source.localeCompare(b.source))
  };
}

function mergeNamedVolumes(knownVolumes, discoveredVolumes, project) {
  const volumes = new Map((knownVolumes || []).map(volume => [volume.name, {
    ...volume,
    destinations: [...(volume.destinations || [])],
    containers: [...(volume.containers || [])]
  }]));

  for (const volume of discoveredVolumes || []) {
    if (!volumes.has(volume.name)) {
      volumes.set(volume.name, {
        name: volume.name,
        destinations: [],
        containers: [],
        project_id: project.id,
        project_name: project.name
      });
    }
    const target = volumes.get(volume.name);
    for (const destination of volume.destinations || []) {
      if (!target.destinations.includes(destination)) target.destinations.push(destination);
    }
    for (const container of volume.containers || []) {
      if (!target.containers.includes(container)) target.containers.push(container);
    }
  }

  return [...volumes.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function cpuPercent(stats) {
  const cpu = stats && stats.cpu_stats;
  const previous = stats && stats.precpu_stats;
  if (!cpu || !previous) return 0;
  const cpuDelta = (cpu.cpu_usage && cpu.cpu_usage.total_usage || 0) - (previous.cpu_usage && previous.cpu_usage.total_usage || 0);
  const systemDelta = (cpu.system_cpu_usage || 0) - (previous.system_cpu_usage || 0);
  const cores = cpu.online_cpus || ((cpu.cpu_usage && cpu.cpu_usage.percpu_usage) || []).length || 1;
  if (cpuDelta <= 0 || systemDelta <= 0) return 0;
  return (cpuDelta / systemDelta) * cores * 100;
}

function memoryUsage(stats) {
  const memory = stats && stats.memory_stats;
  if (!memory) return { usage: 0, limit: 0 };
  const rawUsage = Number(memory.usage) || 0;
  const details = memory.stats || {};
  // Docker CLI reports the working set, excluding filesystem cache. The
  // field differs between cgroup versions, so accept either variant.
  const cache = Number(details.total_inactive_file ?? details.inactive_file ?? details.cache) || 0;
  return { usage: Math.max(0, rawUsage - cache), limit: Number(memory.limit) || 0 };
}

function summarizeContainerStats(statsEntries) {
  let cpu = 0;
  let memory = 0;
  let memoryLimit = 0;
  let unavailable = 0;

  for (const stats of statsEntries || []) {
    if (!stats) {
      unavailable += 1;
      continue;
    }
    cpu += cpuPercent(stats);
    const memoryStats = memoryUsage(stats);
    memory += memoryStats.usage;
    memoryLimit += memoryStats.limit;
  }

  return {
    cpu_percent: Math.round(cpu * 10) / 10,
    memory_bytes: memory,
    memory_limit_bytes: memoryLimit,
    memory_percent: memoryLimit > 0 ? Math.round((memory / memoryLimit) * 1000) / 10 : 0,
    unavailable_containers: unavailable
  };
}

module.exports = {
  containerName,
  collectContainerMounts,
  mergeNamedVolumes,
  cpuPercent,
  memoryUsage,
  summarizeContainerStats
};
