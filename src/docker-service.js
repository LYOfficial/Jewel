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

async function restartContainer(id) {
  const container = await getContainer(id);
  return container.restart();
}

async function removeContainer(id, force = false) {
  const container = await getContainer(id);
  return container.remove({ force });
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

  let envStr = '';
  try {
    const envVars = JSON.parse(project.env_vars || '{}');
    for (const [key, value] of Object.entries(envVars)) {
      envStr += `${key}=${value}\n`;
    }
  } catch { /* ignore */ }

  const envFile = path.join(projectDir, '.env');
  if (envStr) fs.writeFileSync(envFile, envStr);

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
  isDockerAvailable,
  listContainers,
  getContainer,
  getContainerInfo,
  startContainer,
  stopContainer,
  restartContainer,
  removeContainer,
  getContainerLogs,
  getContainerStats,
  deployProject,
  stopProject,
  getProjectContainers,
  getDockerInfo
};
