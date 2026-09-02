const Docker = require('dockerode');
const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');
const { exec, execSync } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const gitService = require('./git-service');

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

// Capture logs from every container belonging to a compose project, regardless
// of state (running, exited, dead, created, restarting). Used on deploy failure
// to salvage diagnostics before `compose down` tears the containers down.
//
// Returns a string ready to be appended to the deploy log, or an empty string
// if the Docker API is unreachable or no containers were found.
async function captureComposeProjectLogs(projectName, tail = 500) {
  let containers = [];
  try {
    const all = await listContainers(true);
    containers = all.filter(c =>
      c.Labels && c.Labels['com.docker.compose.project'] === projectName
    );
  } catch (err) {
    return `[failed-container-logs] Could not list containers: ${err.message}\n`;
  }
  if (!containers.length) {
    return '[failed-container-logs] No containers were found for this compose project.\n';
  }

  const out = [];
  out.push(`[failed-container-logs] Captured ${containers.length} container(s) at ${new Date().toISOString()}`);
  out.push('');

  // Sort by name for stable output across runs.
  containers.sort((a, b) => {
    const an = (a.Names && a.Names[0]) || '';
    const bn = (b.Names && b.Names[0]) || '';
    return an.localeCompare(bn);
  });

  for (const c of containers) {
    const name = (c.Names && c.Names[0]) || c.Id;
    const state = c.State || 'unknown';
    const status = c.Status || '';
    out.push(`----- container: ${name} (state=${state}, status="${status}") -----`);
    try {
      const logs = await getContainerLogs(c.Id, tail);
      out.push(logs && logs.length ? logs : '(no log output)');
    } catch (err) {
      out.push(`(failed to read logs: ${err.message})`);
    }
    out.push('');
  }
  out.push('[failed-container-logs] End of captured logs');
  out.push('');
  return out.join('\n');
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

async function deployProject(project, { appendLog = false } = {}) {
  const projectDir = path.join(
    process.env.DATA_DIR || path.join(__dirname, '..', 'data'),
    'projects',
    String(project.id)
  );

  const startTime = new Date().toISOString();
  const logHeader = `=== Deploy started at ${startTime} ===\n[project] ${project.name} (id=${project.id})\n[cwd] ${projectDir}\n\n`;
  if (appendLog) appendDeployLog(project.id, `\n${logHeader}`);
  else resetDeployLog(project.id, logHeader);

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

    // Salvage container logs BEFORE the cleanup teardown removes them. This
    // makes it possible to diagnose health-check timeouts, entrypoint hangs,
    // and other container-level failures even after `compose down` has run.
    try {
      appendDeployLog(
        project.id,
        '\n[recovery] Capturing container logs before teardown (deploy failed; containers will be removed next)…\n'
      );
      const recovered = await captureComposeProjectLogs(project.name, 500);
      appendDeployLog(project.id, recovered);
    } catch (recoveryErr) {
      appendDeployLog(project.id, `[recovery] Failed to capture container logs: ${recoveryErr.message}\n`);
    }

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


async function rebuildProject(project) {
  const projectDir = path.join(
    process.env.DATA_DIR || path.join(__dirname, '..', 'data'),
    'projects',
    String(project.id)
  );

  const startTime = new Date().toISOString();
  resetDeployLog(project.id, `=== Rebuild started at ${startTime} ===\n[project] ${project.name} (id=${project.id})\n[cwd] ${projectDir}\n\n`);

  // 1) Stop — use `compose down` (no -v) so named/bind volumes survive.
  try {
    appendDeployLog(project.id, `[rebuild] Step 1/4 — stopping compose project\n`);
    await stopProject(project);
    appendDeployLog(project.id, `[rebuild] Stop complete\n\n`);
  } catch (err) {
    // Stop failure should not abort the rebuild — log it and continue.
    appendDeployLog(project.id, `[rebuild] Stop failed (continuing): ${err.message}\n\n`);
  }


  try {
    appendDeployLog(project.id, `[rebuild] Step 2/4 — pruning unused images\n`);
    const pruneResult = await pruneImages();
    const summary = pruneResult && pruneResult.output ? pruneResult.output.trim() : '';
    if (summary) appendDeployLog(project.id, summary + '\n');
    appendDeployLog(
      project.id,
      `[rebuild] Prune complete: ${pruneResult.deleted || 0} image(s) removed, ` +
      `reclaimed ${pruneResult.SpaceReclaimed || 0} bytes\n\n`
    );
  } catch (err) {
    // Prune failure is non-fatal — log it and continue to deploy.
    appendDeployLog(project.id, `[rebuild] Prune failed (continuing): ${err.message}\n\n`);
  }


  let localCommit = null;
  let remoteCommit = null;
  let rebuildLog = '';
  try {
    appendDeployLog(project.id, `[rebuild] Step 3/4 — deleting and recloning repository\n`);
    // cloneRepo removes the existing checkout first. Preserve the rebuild
    // output written so far because that log lives inside the checkout.
    rebuildLog = readDeployLog(project.id);
    await gitService.cloneRepo(project.git_url, project.id, project.git_branch, project.git_token);
    resetDeployLog(project.id, rebuildLog);
    localCommit = await gitService.getRepoCommit(project.id);
    remoteCommit = localCommit;
    appendDeployLog(project.id, `[rebuild] Repository recloned at ${localCommit || '(unknown)'}\n\n`);
  } catch (err) {
    if (rebuildLog) resetDeployLog(project.id, rebuildLog);
    appendDeployLog(project.id, `[error] Repository reclone failed: ${err.message}\n`);
    throw err;
  }


  appendDeployLog(project.id, `[rebuild] Step 4/4 — deploying\n`);
  try {
    const stdout = await deployProject(project, { appendLog: true });
    appendDeployLog(project.id, `\n=== Rebuild succeeded at ${new Date().toISOString()} ===\n`);
    return { stdout, update: 'recloned', localCommit, remoteCommit };
  } catch (err) {
    // deployProject already wrote "=== Deploy failed at ... ===" to the log.
    appendDeployLog(project.id, `\n=== Rebuild failed at ${new Date().toISOString()} ===\n`);
    throw err;
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
  // Request writable-layer sizes alongside the regular summary so project
  // dashboards can report the storage consumed by their containers.
  const containers = await getDocker().listContainers({ all: true, size: true });
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

// Return a map of parentImageId -> number of direct child images.
// An image with a non-zero child count is part of the Docker build cache:
// even though no container references it as its ImageID, it is still in
// use as a parent layer of other images and therefore `docker image
// prune -a` will not delete it (the user sees this as "0 deleted" while
// the UI still lists it as unused). `docker builder prune -a -f` is what
// actually removes these.
//
// Implementation note: `dockerode.listImages` does not include ParentId
// in the basic listing, so we have to inspect every image individually.
// This is O(n) inspect calls — acceptable for the typical Jewel use case
// (a few dozen images) and keeps us from depending on the docker buildx
// or engine v1.40+ history APIs.
async function getBuildCacheByImage(all = true) {
  const d = getDocker();
  let images;
  try {
    images = await d.listImages({ all });
  } catch {
    return {};
  }

  const childCounts = {};
  await Promise.all(images.map(async (img) => {
    if (!img.Id) return;
    try {
      const info = await d.getImage(img.Id).inspect();
      const parentId = info && info.ParentId;
      if (parentId && parentId !== 'sha256:' + '0'.repeat(64) /* no parent */) {
        childCounts[parentId] = (childCounts[parentId] || 0) + 1;
      }
    } catch {
      // Inspect can fail for images that vanish between list and inspect;
      // skip them rather than aborting the whole listing.
    }
  }));

  return childCounts;
}

async function pruneImages() {
  // Two-phase cleanup:
  //   1. `docker image prune -a -f` removes unused images (tagged or
  //      dangling) that aren't referenced as a parent by any other image.
  //   2. `docker builder prune -a -f` removes the build cache, including
  //      intermediate layers that ARE parents of other images. These show
  //      up in `docker image ls -a` as `<none>:<none>` and the user thinks
  //      they should be prunable, but `image prune -a` silently skips them
  //      because they're parents — that is exactly the case where we must
  //      fall back to `builder prune`.
  //
  // We run both unconditionally and combine the results so the user sees
  // a single "freed X / reclaimed Y" number.
  //
  // The Docker CLI is used directly (instead of dockerode filters) because
  // the Engine API filter shape `{"dangling":["false"]}` is finicky to send
  // through dockerode, and the wrong shape silently degrades to
  // dangling-only — which is the original bug we're fixing here.
  const imageOut = await runPruneCmd('docker image prune -a -f');
  const builderOut = await runPruneCmd('docker builder prune -a -f');

  const totalDeleted = (imageOut.deleted || 0) + (builderOut.deleted || 0);
  const totalReclaimed = (imageOut.SpaceReclaimed || 0) + (builderOut.SpaceReclaimed || 0);

  return {
    imagesDeleted: imageOut.deleted || 0,
    imagesReclaimed: imageOut.SpaceReclaimed || 0,
    builderDeleted: builderOut.deleted || 0,
    builderReclaimed: builderOut.SpaceReclaimed || 0,
    deleted: totalDeleted,
    SpaceReclaimed: totalReclaimed,
    output: [
      '--- docker image prune -a -f ---',
      imageOut.output || '',
      '--- docker builder prune -a -f ---',
      builderOut.output || ''
    ].join('\n')
  };
}

// Run one prune command. Treat exit-non-zero with parseable output as
// success (some Docker versions exit non-zero when there's nothing to
// prune).
async function runPruneCmd(cmd) {
  try {
    const { stdout } = await execAsync(cmd, {
      timeout: 300000,
      maxBuffer: 10 * 1024 * 1024
    });
    return parsePruneOutput(stdout || '');
  } catch (err) {
    const out = (err && err.stdout && err.stdout.toString()) || '';
    if (out) {
      const parsed = parsePruneOutput(out);
      if (parsed.deleted >= 0) return parsed;
    }
    // Surface a useful error to the caller
    const stderr = (err && err.stderr && err.stderr.toString()) || '';
    throw new Error((stderr || err.message || 'prune failed').trim());
  }
}

function parsePruneOutput(stdout) {
  // Docker CLI output looks like:
  //   Deleted Images:
  //   untagged: alpine:latest
  //   deleted: sha256:e7d88de73db3d3fd9b2d63aa7b447f8ddee1df756afcfe7d0e6c5127d1bb2d24
  //   ...
  //   Total reclaimed space: 7.794MB
  // We must NOT count `untagged: ...@sha256:...` lines as deletions
  // (their sha256 part is a digest, not a deletion marker). Only count
  // lines that look like `deleted: sha256:<64 hex>`.
  let reclaimed = 0;
  const reclaimedMatch = stdout.match(/Total Reclaimed Space:\s*([0-9.]+)\s*([A-Za-z]+)/i);
  if (reclaimedMatch) {
    reclaimed = sizeToBytes(parseFloat(reclaimedMatch[1]), reclaimedMatch[2]);
  }
  const idLines = stdout.split('\n').filter(l => /\bdeleted:\s*sha256:[0-9a-f]{64}/.test(l));
  const deleted = idLines.length;
  return { SpaceReclaimed: reclaimed, ImagesDeleted: idLines, deleted, output: stdout };
}

function sizeToBytes(value, unit) {
  const u = (unit || '').toUpperCase();
  const multipliers = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };
  return Math.round((value || 0) * (multipliers[u] || 1));
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
  rebuildProject,
  stopProject,
  getProjectContainers,
  captureComposeProjectLogs,
  getDockerInfo,
  ensureEnvFiles,
  findContainerByName,
  readDeployLog,
  appendDeployLog,
  listImages,
  getImageInfo,
  getImageHistory,
  removeImage,
  getContainerUsageByImage,
  getBuildCacheByImage,
  pruneImages
};
