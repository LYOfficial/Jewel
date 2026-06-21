const Docker = require('dockerode');
const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');
const { exec, execSync } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

let docker = null;
let dockerAvailable = null;

function getDocker() {
  if (!docker) {
    const opts = {};
    if (process.env.DOCKER_HOST) {
      opts.host = process.env.DOCKER_HOST;
    } else if (process.platform === 'win32') {
      opts.socketPath = '//./pipe/docker_engine';
    } else {
      opts.socketPath = '/var/run/docker.sock';
    }
    docker = new Docker(opts);
  }
  return docker;
}

function checkDocker() {
  if (dockerAvailable === null) {
    try {
      const d = getDocker();
      dockerAvailable = typeof d.ping === 'function';
    } catch {
      dockerAvailable = false;
    }
  }
  return dockerAvailable;
}

function isDockerAvailable() {
  try {
    getDocker();
    return true;
  } catch {
    return false;
  }
}

async function listContainers(all = false) {
  const d = getDocker();
  return d.listContainers({ all });
}

async function getContainer(id) {
  const d = getDocker();
  return d.getContainer(id);
}

async function getContainerInfo(id) {
  const container = await getContainer(id);
  return container.inspect();
}

async function startContainer(id) {
  const container = await getContainer(id);
  return container.start();
}

async function stopContainer(id) {
  const container = await getContainer(id);
  return container.stop();
}

async function killContainer(id) {
  const container = await getContainer(id);
  return container.kill();
}

async function restartContainer(id) {
  const container = await getContainer(id);
  return container.restart();
}

async function pauseContainer(id) {
  const container = await getContainer(id);
  return container.pause();
}

async function unpauseContainer(id) {
  const container = await getContainer(id);
  return container.unpause();
}

async function removeContainer(id, force = false, removeVolumes = false) {
  const container = await getContainer(id);
  return container.remove({ force, v: removeVolumes });
}

async function removeContainerAdvanced(id, options = {}) {
  const { force = true, removeVolumes = false, removeImage = false } = options;
  const container = await getContainer(id);
  let imageId = null;

  if (removeImage) {
    const info = await container.inspect();
    imageId = info.Image;
  }

  await container.remove({ force, v: removeVolumes });

  if (removeImage && imageId) {
    try {
      const image = docker.getImage(imageId);
      await image.remove({ force: true });
    } catch { /* image may be in use by other containers */ }
  }
}

async function getContainerLogs(id, tail = 100) {
  const container = await getContainer(id);
  const logs = await container.logs({ stdout: true, stderr: true, tail });
  return logs.toString('utf-8');
}

async function getContainerStats(id) {
  const container = await getContainer(id);
  return new Promise((resolve, reject) => {
    container.stats({ stream: false }, (err, stats) => {
      if (err) reject(err);
      else resolve(stats);
    });
  });
}

function parseEnvFiles(composePath) {
  const files = new Set();
  try {
    const content = fs.readFileSync(composePath, 'utf-8');
    const doc = yaml.load(content);
    const services = doc.services || {};
    for (const svc of Object.values(services)) {
      if (!svc.env_file) continue;
      const entries = Array.isArray(svc.env_file) ? svc.env_file : [svc.env_file];
      for (const entry of entries) {
        // entry can be a string or an object with { path: ..., required: ... }
        const p = typeof entry === 'string' ? entry : (entry.path || '');
        if (p) files.add(p);
      }
    }
  } catch { /* ignore parse errors */ }
  return [...files];
}

function findEnvExample(projectDir, envPath) {
  const basename = path.basename(envPath);
  const dir = path.dirname(path.isAbsolute(envPath) ? envPath : path.join(projectDir, envPath));

  // Look for .env.example, .env.sample, .env.template, .env.example.local, etc.
  const candidates = [
    basename + '.example',
    basename + '.sample',
    basename + '.template',
    'env.example',
    'env.sample'
  ];

  for (const c of candidates) {
    const candidate = path.join(dir, c);
    if (fs.existsSync(candidate)) return candidate;
  }

  // Also check the project root for any file with .env in the name (e.g. .env.production)
  try {
    const rootFiles = fs.readdirSync(projectDir);
    const match = rootFiles.find(f =>
      f.startsWith('.env') && f !== basename && !f.endsWith('.example') && !f.endsWith('.sample')
    );
    if (match) return path.join(projectDir, match);
  } catch { /* ignore */ }

  return null;
}

function ensureEnvFiles(projectDir, composePath) {
  const envFiles = parseEnvFiles(composePath);
  for (const envPath of envFiles) {
    const absPath = path.isAbsolute(envPath) ? envPath : path.join(projectDir, envPath);
    if (fs.existsSync(absPath)) continue;

    const examplePath = findEnvExample(projectDir, envPath);
    if (examplePath) {
      fs.copyFileSync(examplePath, absPath);
    } else {
      fs.writeFileSync(absPath, '', 'utf-8');
    }
  }
}

async function findContainerByName(name) {
  if (!name) return null;
  try {
    const containers = await listContainers(true);
    const match = containers.find(c =>
      (c.Names || []).some(n => n === `/${name}` || n === name)
    );
    return match || null;
  } catch {
    return null;
  }
}

function getDeployLogPath(projectId) {
  return path.join(
    process.env.DATA_DIR || path.join(__dirname, '..', 'data'),
    'projects',
    String(projectId),
    '.jewel-deploy.log'
  );
}

function readDeployLog(projectId) {
  const logPath = getDeployLogPath(projectId);
  try {
    if (fs.existsSync(logPath)) return fs.readFileSync(logPath, 'utf-8');
  } catch { /* ignore */ }
  return '';
}

function appendDeployLog(projectId, text) {
  const logPath = getDeployLogPath(projectId);
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, text, 'utf-8');
  } catch { /* ignore */ }
}

function resetDeployLog(projectId, header) {
  const logPath = getDeployLogPath(projectId);
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.writeFileSync(logPath, header, 'utf-8');
  } catch { /* ignore */ }
}

async function deployProject(project) {
  const projectDir = path.join(
    process.env.DATA_DIR || path.join(__dirname, '..', 'data'),
    'projects',
    String(project.id)
  );

  const startTime = new Date().toISOString();
  resetDeployLog(project.id, `=== Deploy started at ${startTime} ===\n[project] ${project.name} (id=${project.id})\n[cwd] ${projectDir}\n\n`);

  const composePath = path.join(projectDir, project.compose_path);
  if (!fs.existsSync(composePath)) {
    const msg = `docker-compose file not found: ${composePath}`;
    appendDeployLog(project.id, `[error] ${msg}\n`);
    throw new Error(msg);
  }

  // Ensure all env_file references exist before compose up
  ensureEnvFiles(projectDir, composePath);

  let envStr = '';
  try {
    const envVars = JSON.parse(project.env_vars || '{}');
    for (const [key, value] of Object.entries(envVars)) {
      envStr += `${key}=${value}\n`;
    }
  } catch { /* ignore */ }

  // Always write .env so docker compose never fails on a missing env_file
  const envFile = path.join(projectDir, '.env');
  fs.writeFileSync(envFile, envStr || '', 'utf-8');

  // If a custom container_name is set, inject it into the compose file.
  // Also: handle reuse_volumes — if an existing container with the same name
  // is running, either fail or remove it (keeping the volumes).
  if (project.container_name) {
    const customName = project.container_name;
    const existing = await findContainerByName(customName);

    if (existing) {
      if (!project.reuse_volumes) {
        const msg = `A container named "${customName}" already exists. ` +
          `Enable "Reuse existing volumes" in the project settings to replace it (volumes will be kept).`;
        appendDeployLog(project.id, `[error] ${msg}\n`);
        throw new Error(msg);
      }
      // Remove the existing container but keep its volumes (v: false)
      try {
        appendDeployLog(project.id, `[info] Removing existing container "${customName}" (keeping volumes)\n`);
        const c = await getContainer(existing.Id);
        await c.remove({ force: true, v: false });
      } catch (err) {
        const msg = `Failed to remove existing container "${customName}": ${err.message}`;
        appendDeployLog(project.id, `[error] ${msg}\n`);
        throw new Error(msg);
      }
    }

    // Inject container_name into the first service of the compose file
    try {
      const composeDoc = yaml.load(fs.readFileSync(composePath, 'utf-8')) || {};
      const services = composeDoc.services || {};
      const firstServiceKey = Object.keys(services)[0];
      if (firstServiceKey) {
        services[firstServiceKey].container_name = customName;
        fs.writeFileSync(composePath, yaml.dump(composeDoc), 'utf-8');
        appendDeployLog(project.id, `[info] Injected container_name="${customName}" into service "${firstServiceKey}"\n`);
      }
    } catch (err) {
      const msg = `Failed to update compose file with container_name: ${err.message}`;
      appendDeployLog(project.id, `[error] ${msg}\n`);
      throw new Error(msg);
    }
  }

  const composeCmd = process.env.COMPOSE_CMD || 'docker compose';
  const cmd = `${composeCmd} -f "${composePath}" --project-name "${project.name}" up -d --build`;

  appendDeployLog(project.id, `\n$ ${cmd}\n`);

  try {
    // Use async exec so the Node.js event loop stays responsive while
    // docker compose runs. Previously this used execSync which blocked
    // the entire server for the duration of the build, making the
    // platform appear frozen until the deploy finished.
    const result = await execAsync(cmd, {
      cwd: projectDir,
      timeout: 600000,
      env: { ...process.env },
      maxBuffer: 50 * 1024 * 1024
    });
    const stdout = (result && result.stdout) ? result.stdout.toString('utf-8') : '';
    appendDeployLog(project.id, stdout);
    appendDeployLog(project.id, `\n=== Deploy succeeded at ${new Date().toISOString()} ===\n`);
    return stdout;
  } catch (err) {
    const stderr = (err.stderr && err.stderr.toString()) || '';
    const stdout = (err.stdout && err.stdout.toString()) || '';
    if (stdout) appendDeployLog(project.id, stdout);
    if (stderr) appendDeployLog(project.id, stderr);
    appendDeployLog(project.id, `\n[error] Command exited with code ${err.code || err.status}\n`);

    // Auto-cleanup: tear down any partial state so the next deploy starts fresh.
    // - down: removes containers
    // - --remove-orphans: removes orphan containers from previous compose runs
    // - --rmi local: removes images built by this compose (those without a custom tag)
    // We intentionally do NOT pass -v so user data in named volumes survives.
    const cleanupCmd = `${composeCmd} -f "${composePath}" --project-name "${project.name}" down --remove-orphans --rmi local`;
    appendDeployLog(project.id, `\n[cleanup] Tearing down partial deploy state\n$ ${cleanupCmd}\n`);
    try {
      const cleanupOut = await execAsync(cleanupCmd, {
        cwd: projectDir,
        timeout: 120000,
        env: { ...process.env },
        maxBuffer: 50 * 1024 * 1024
      });
      appendDeployLog(project.id, (cleanupOut && cleanupOut.stdout) ? cleanupOut.stdout.toString('utf-8') : '');
    } catch (cleanupErr) {
      const cstderr = (cleanupErr.stderr && cleanupErr.stderr.toString()) || '';
      const cstdout = (cleanupErr.stdout && cleanupErr.stdout.toString()) || '';
      if (cstdout) appendDeployLog(project.id, cstdout);
      if (cstderr) appendDeployLog(project.id, cstderr);
    }

    // If a custom container_name was set, the orphan container may have been
    // created with that name — make sure it's also removed.
    if (project.container_name) {
      try {
        const existing = await findContainerByName(project.container_name);
        if (existing) {
          appendDeployLog(project.id, `[cleanup] Removing leftover container "${project.container_name}"\n`);
          const c = await getContainer(existing.Id);
          await c.remove({ force: true, v: false });
        }
      } catch { /* ignore */ }
    }

    appendDeployLog(project.id, `\n=== Deploy failed at ${new Date().toISOString()} ===\n`);

    const detail = (stderr + stdout).trim() || err.message;
    throw new Error(`Deploy failed: ${detail}`);
  }
}

async function stopProject(project) {
  const projectDir = path.join(
    process.env.DATA_DIR || path.join(__dirname, '..', 'data'),
    'projects',
    String(project.id)
  );

  const composePath = path.join(projectDir, project.compose_path);
  const composeCmd = process.env.COMPOSE_CMD || 'docker compose';
  const cmd = `${composeCmd} -f "${composePath}" --project-name "${project.name}" down`;

  try {
    const result = await execAsync(cmd, {
      cwd: projectDir,
      timeout: 120000,
      env: { ...process.env },
      maxBuffer: 10 * 1024 * 1024
    });
    return (result && result.stdout) ? result.stdout.toString('utf-8') : '';
  } catch (err) {
    const detail = (err && err.message) || 'unknown error';
    throw new Error(`Stop failed: ${detail}`);
  }
}

async function getProjectContainers(projectName) {
  const containers = await listContainers(true);
  return containers.filter(c =>
    c.Labels && c.Labels['com.docker.compose.project'] === projectName
  );
}

async function getDockerInfo() {
  const d = getDocker();
  const info = await d.info();
  return info;
}

// ===== Images =====

async function listImages(all = true) {
  const d = getDocker();
  return d.listImages({ all });
}

async function getImageInfo(id) {
  const d = getDocker();
  const image = d.getImage(id);
  return image.inspect();
}

async function getImageHistory(id) {
  const d = getDocker();
  const image = d.getImage(id);
  return image.history();
}

async function removeImage(id, options = {}) {
  const d = getDocker();
  const image = d.getImage(id);
  const params = {};
  if (options.force) params.force = true;
  if (options.noprune) params.noprune = true;
  return image.remove(params);
}

// Return a map of imageId -> array of {Id, Names, State, Status}
async function getContainerUsageByImage(all = true) {
  const d = getDocker();
  const [containers, images] = await Promise.all([
    d.listContainers({ all }),
    d.listImages({ all })
  ]);

  // Build a lookup of imageId -> the canonical ImageId for each image
  // (an image may be known by RepoDigests or just its Id).
  const imageIds = new Set();
  for (const img of images) {
    if (img.Id) imageIds.add(img.Id);
  }

  const byImage = {};
  for (const c of containers) {
    const key = c.ImageID || c.Image || null;
    if (!key) continue;
    // Try direct match; otherwise try matching by repo:tag
    let matchId = key;
    if (!imageIds.has(key)) {
      const found = images.find(img => (img.RepoTags || []).some(t => t === key));
      if (found) matchId = found.Id;
    }
    if (!byImage[matchId]) byImage[matchId] = [];
    byImage[matchId].push({
      Id: c.Id,
      Names: c.Names || [],
      State: c.State,
      Status: c.Status,
      Image: c.Image
    });
  }
  return byImage;
}

async function pruneImages() {
  const d = getDocker();
  // Prune only "dangling" filter is too aggressive (skips any image with a tag,
  // even if no container is using it). Use {dangling: false, label: ''} by
  // passing filters: [] which Docker API treats as "all unused".
  return d.pruneImages({ filters: { dangling: { false: true } } });
}

module.exports = {
  getDocker,
  isDockerAvailable,
  listContainers,
  getContainer,
  getContainerInfo,
  startContainer,
  stopContainer,
  killContainer,
  restartContainer,
  pauseContainer,
  unpauseContainer,
  removeContainer,
  removeContainerAdvanced,
  getContainerLogs,
  getContainerStats,
  deployProject,
  stopProject,
  getProjectContainers,
  getDockerInfo,
  ensureEnvFiles,
  findContainerByName,
  readDeployLog,
  listImages,
  getImageInfo,
  getImageHistory,
  removeImage,
  getContainerUsageByImage,
  pruneImages
};
