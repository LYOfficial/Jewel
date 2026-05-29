const Docker = require('dockerode');
const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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

async function deployProject(project) {
  const projectDir = path.join(
    process.env.DATA_DIR || path.join(__dirname, '..', 'data'),
    'projects',
    String(project.id)
  );

  const composePath = path.join(projectDir, project.compose_path);
  if (!fs.existsSync(composePath)) {
    throw new Error(`docker-compose file not found: ${composePath}`);
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

  const composeCmd = process.env.COMPOSE_CMD || 'docker compose';
  const cmd = `${composeCmd} -f "${composePath}" --project-name "${project.name}" up -d --build`;

  try {
    const result = execSync(cmd, {
      cwd: projectDir,
      timeout: 600000,
      env: { ...process.env }
    });
    return result.toString('utf-8');
  } catch (err) {
    throw new Error(`Deploy failed: ${err.message}`);
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
    const result = execSync(cmd, {
      cwd: projectDir,
      timeout: 120000,
      env: { ...process.env }
    });
    return result.toString('utf-8');
  } catch (err) {
    throw new Error(`Stop failed: ${err.message}`);
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
  ensureEnvFiles
};
