const express = require('express');
const db = require('./database');
const dockerService = require('./docker-service');
const backupService = require('./backup-service');
const projectMetricsAuth = require('./project-metrics-auth-service');
const { containerName, summarizeContainerStats } = require('./project-resource-utils');

const router = express.Router();
const DOCKER_READ_TIMEOUT_MS = Math.max(1000, Number(process.env.DOCKER_READ_TIMEOUT_MS) || 8000);

function withDockerReadTimeout(promise, label) {
  let timeout;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error(`${label} timed out after ${DOCKER_READ_TIMEOUT_MS}ms`)), DOCKER_READ_TIMEOUT_MS);
      if (timeout.unref) timeout.unref();
    })
  ]).finally(() => clearTimeout(timeout));
}

function deny(res) {
  res.set('WWW-Authenticate', 'JewelProjectMetrics');
  return res.status(401).json({ error: 'Invalid project metrics access key' });
}

// This endpoint intentionally returns only aggregate usage. It must never
// become a lower-privilege variant of Jewel's authenticated project-detail API.
router.get('/:projectId', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('Pragma', 'no-cache');
  if (!projectMetricsAuth.authenticate(req)) return deny(res);

  const projectId = Number(req.params.projectId);
  if (!Number.isSafeInteger(projectId) || projectId < 1) {
    return res.status(400).json({ error: 'Invalid project id' });
  }
  const project = db.prepare('SELECT id, name FROM projects WHERE id=?').get(projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  try {
    const containers = await withDockerReadTimeout(
      dockerService.getProjectContainers(project.name),
      'Reading project containers'
    );
    const [volumesResult, imagesResult, diskUsageResult, statsResult] = await Promise.allSettled([
      withDockerReadTimeout(backupService.getProjectVolumeResources(project, containers), 'Reading project volumes'),
      withDockerReadTimeout(dockerService.getDocker().listImages({ all: true }), 'Reading Docker images'),
      typeof dockerService.getDocker().df === 'function'
        ? withDockerReadTimeout(dockerService.getDocker().df(), 'Reading Docker disk usage')
        : Promise.resolve({}),
      Promise.all(containers.filter(container => container.State === 'running').map(async container => {
        try {
          return await withDockerReadTimeout(
            dockerService.getContainerStats(container.Id),
            `Reading stats for ${containerName(container) || container.Id}`
          );
        } catch {
          return null;
        }
      }))
    ]);

    const volumes = volumesResult.status === 'fulfilled' ? volumesResult.value : [];
    const dockerImages = imagesResult.status === 'fulfilled' ? imagesResult.value : [];
    const diskUsage = diskUsageResult.status === 'fulfilled' ? diskUsageResult.value : {};
    const imageById = new Map(dockerImages.map(image => [image.Id, image]));
    const imageByTag = new Map();
    for (const image of dockerImages) {
      for (const tag of image.RepoTags || []) imageByTag.set(tag, image);
    }
    const uniqueImages = new Map();
    for (const container of containers) {
      const imageKey = container.ImageID || container.Image;
      if (imageKey && !uniqueImages.has(imageKey)) {
        const image = imageById.get(container.ImageID) || imageByTag.get(container.Image);
        uniqueImages.set(imageKey, Math.max(0, Number(image && image.Size) || 0));
      }
    }
    const volumeSizeByName = new Map(((diskUsage && diskUsage.Volumes) || []).map(volume => [
      volume.Name,
      Math.max(0, Number(volume.UsageData && volume.UsageData.Size) || 0)
    ]));
    const imageBytes = [...uniqueImages.values()].reduce((total, size) => total + size, 0);
    const writableLayerBytes = containers.reduce((total, container) => total + Math.max(0, Number(container.SizeRw) || 0), 0);
    const volumeBytes = volumes.reduce((total, volume) => total + (volumeSizeByName.get(volume.name) || 0), 0);
    const stats = summarizeContainerStats(statsResult.status === 'fulfilled' ? statsResult.value : []);

    return res.json({
      api_version: 1,
      storage: {
        total_bytes: imageBytes + writableLayerBytes + volumeBytes,
        image_bytes: imageBytes,
        writable_layer_bytes: writableLayerBytes,
        volume_bytes: volumeBytes,
        bind_mounts_included: false
      },
      cpu: {
        percent: stats.cpu_percent,
        running_containers: containers.filter(container => container.State === 'running').length,
        unavailable_containers: stats.unavailable_containers
      },
      memory: {
        usage_bytes: stats.memory_bytes,
        limit_bytes: stats.memory_limit_bytes,
        percent: stats.memory_percent
      },
      sampled_at: new Date().toISOString()
    });
  } catch {
    return res.status(502).json({ error: 'Project metrics are temporarily unavailable' });
  }
});

module.exports = router;
