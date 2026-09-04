const db = require('./database');
const gitService = require('./git-service');
const dockerService = require('./docker-service');
const projectUpdateService = require('./project-update-service');
const updateService = require('./update-service');
const operationService = require('./operation-service');
const { withProjectOperationLock } = require('./project-operation-lock');
const { redactSecrets, tailLines } = require('./diagnostics');

const MAX_LOG_LINES = 1000;

function projectById(projectId) {
  const id = Number(projectId);
  if (!Number.isInteger(id) || id < 1) throw new Error('project_id must be a positive integer');
  const project = db.prepare('SELECT * FROM projects WHERE id=?').get(id);
  if (!project) throw new Error(`Project ${id} was not found`);
  return project;
}

function publicProject(project) {
  return {
    id: project.id,
    name: project.name,
    git_url: project.git_url,
    git_branch: project.git_branch,
    compose_path: project.compose_path,
    status: project.status,
    auto_deploy: Boolean(project.auto_deploy),
    commit_hash: project.commit_hash || '',
    remote_commit: project.remote_commit || '',
    update_available: Boolean(project.update_available),
    last_update_check: project.last_update_check || null,
    created_at: project.created_at,
    updated_at: project.updated_at
  };
}

function logLines(value, requested) {
  const lines = Math.max(1, Math.min(Number(requested) || 300, MAX_LOG_LINES));
  return tailLines(redactSecrets(value), lines);
}

async function snapshotOperationCommit(operationId, projectId) {
  try {
    const commitHash = await gitService.getRepoCommit(projectId);
    if (commitHash) return operationService.setCommitHash(operationId, commitHash);
  } catch { /* use stored commit below */ }
  const project = db.prepare('SELECT commit_hash FROM projects WHERE id=?').get(projectId);
  return operationService.setCommitHash(operationId, project && project.commit_hash);
}

async function runProjectOperation(project, { action, activeStatus, work, summary }) {
  return withProjectOperationLock(project.id, async () => {
    const operationId = operationService.start({
      projectId: project.id,
      action,
      metadata: { project_name: project.name, trigger: 'mcp' }
    });
    try {
      if (activeStatus) db.prepare('UPDATE projects SET status=? WHERE id=?').run(activeStatus, project.id);
      const result = await work();
      db.prepare('UPDATE projects SET status=? WHERE id=?').run('running', project.id);
      await snapshotOperationCommit(operationId, project.id);
      const operation = operationService.succeed(operationId, {
        summary: typeof summary === 'function' ? summary(result) : summary,
        detail: result && (result.output || result.stdout) ? tailLines(result.output || result.stdout, 80) : ''
      });
      return { operation, result };
    } catch (err) {
      if (activeStatus) db.prepare('UPDATE projects SET status=? WHERE id=?').run('error', project.id);
      await snapshotOperationCommit(operationId, project.id);
      const operation = operationService.fail(operationId, err, {
        summary: `${action} failed for ${project.name}`,
        detail: tailLines(dockerService.readDeployLog(project.id), 400)
      });
      const report = operationService.report(operation, project, dockerService.readDeployLog(project.id));
      const error = new Error(redactSecrets(err && err.message ? err.message : String(err)));
      error.operation = operation;
      error.report = report;
      throw error;
    }
  });
}

async function listProjects() {
  return db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all().map(publicProject);
}

async function getProject(args) {
  const project = projectById(args.project_id);
  return {
    project: publicProject(project),
    recent_operations: operationService.listForProject(project.id, args.operation_limit || 20).map(operation => ({
      ...operation,
      detail: redactSecrets(operation.detail || ''),
      metadata: undefined
    }))
  };
}

async function checkProjectUpdate(args) {
  const project = projectById(args.project_id);
  const updated = await projectUpdateService.checkProjectUpdate(project.id, { waitForLock: true });
  return publicProject(updated || project);
}

async function deployProject(args, { requirePull = false } = {}) {
  const project = projectById(args.project_id);
  const { operation, result } = await runProjectOperation(project, {
    action: requirePull ? 'update' : 'deploy',
    activeStatus: 'deploying',
    work: async () => {
      await gitService.prepareManagedEnvFileForPull(project);
      if (requirePull) {
        await gitService.pullRepo(project.id, project.git_branch);
      } else {
        try { await gitService.pullRepo(project.id, project.git_branch); } catch { /* deploy existing checkout */ }
      }
      const output = await dockerService.deployProject(project);
      await projectUpdateService.updateCommitHash(project.id);
      return { output };
    },
    summary: `${requirePull ? 'Updated' : 'Deployed'} ${project.name}`
  });
  return {
    project: publicProject(db.prepare('SELECT * FROM projects WHERE id=?').get(project.id)),
    operation_id: operation.id,
    output: logLines(result.output, args.log_lines)
  };
}

async function rebuildProject(args) {
  const project = projectById(args.project_id);
  const { operation, result } = await runProjectOperation(project, {
    action: 'rebuild',
    activeStatus: 'rebuilding',
    work: async () => {
      const rebuilt = await dockerService.rebuildProject(project);
      await projectUpdateService.updateCommitHash(project.id);
      return rebuilt;
    },
    summary: `Rebuilt ${project.name}`
  });
  return {
    project: publicProject(db.prepare('SELECT * FROM projects WHERE id=?').get(project.id)),
    operation_id: operation.id,
    update: result.update || 'recloned',
    local_commit: result.localCommit || '',
    remote_commit: result.remoteCommit || '',
    output: logLines(result.stdout, args.log_lines)
  };
}

async function restartProject(args) {
  const project = projectById(args.project_id);
  const { operation, result } = await runProjectOperation(project, {
    action: 'restart',
    activeStatus: 'deploying',
    work: async () => {
      await dockerService.stopProject(project);
      return { output: await dockerService.deployProject(project) };
    },
    summary: `Restarted ${project.name}`
  });
  return {
    project: publicProject(db.prepare('SELECT * FROM projects WHERE id=?').get(project.id)),
    operation_id: operation.id,
    output: logLines(result.output, args.log_lines)
  };
}

async function getDeployLog(args) {
  const project = projectById(args.project_id);
  return { project: publicProject(project), log: logLines(dockerService.readDeployLog(project.id), args.lines) };
}

async function getFailureReport(args) {
  const project = projectById(args.project_id);
  const operation = operationService.latestFailure(project.id);
  if (!operation) return { project: publicProject(project), failure: null, report: 'No failed operation has been recorded for this project.' };
  return {
    project: publicProject(project),
    failure: { ...operation, detail: redactSecrets(operation.detail || '') },
    report: operationService.report(operation, project, dockerService.readDeployLog(project.id))
  };
}

async function getRuntimeLogs(args) {
  const project = projectById(args.project_id);
  const tail = Math.max(1, Math.min(Number(args.lines) || 200, MAX_LOG_LINES));
  const containers = await dockerService.getProjectContainers(project.name);
  const logs = {};
  for (const container of containers) {
    const name = ((container.Names || [])[0] || container.Id || 'container').replace(/^\//, '');
    try { logs[name] = logLines(await dockerService.getContainerLogs(container.Id, tail), tail); }
    catch (err) { logs[name] = `Unable to fetch logs: ${redactSecrets(err.message)}`; }
  }
  return { project: publicProject(project), logs };
}

async function getProjectOperations(args) {
  const project = projectById(args.project_id);
  return operationService.listForProject(project.id, args.limit || 50).map(operation => ({
    id: operation.id,
    action: operation.action,
    status: operation.status,
    summary: operation.summary,
    detail: logLines(operation.detail, args.detail_lines || 120),
    commit_hash: operation.commit_hash,
    started_at: operation.started_at,
    finished_at: operation.finished_at
  }));
}

async function checkSelfUpdate() {
  await updateService.checkForUpdate();
  return updateService.getUpdateInfo();
}

async function applySelfUpdate() {
  return updateService.applyUpdate();
}

const PROJECT_ID_SCHEMA = {
  type: 'object',
  properties: { project_id: { type: 'integer', minimum: 1, description: 'Jewel project ID from jewel_list_projects.' } },
  required: ['project_id'],
  additionalProperties: false
};

function projectActionSchema(extra = {}) {
  return {
    type: 'object',
    properties: {
      ...PROJECT_ID_SCHEMA.properties,
      log_lines: { type: 'integer', minimum: 1, maximum: MAX_LOG_LINES, description: 'Maximum returned output lines (default 300).' },
      ...extra
    },
    required: ['project_id'],
    additionalProperties: false
  };
}

const tools = [
  {
    name: 'jewel_list_projects',
    description: 'List Jewel projects and deployment/update state. This never exposes Git credentials or environment secrets.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false }
  },
  {
    name: 'jewel_get_project',
    description: 'Read one project and its recent deployment operation history.',
    inputSchema: { ...PROJECT_ID_SCHEMA, properties: { ...PROJECT_ID_SCHEMA.properties, operation_limit: { type: 'integer', minimum: 1, maximum: 100 } } },
    annotations: { readOnlyHint: true, destructiveHint: false }
  },
  {
    name: 'jewel_check_project_update',
    description: 'Fetch the configured Git branch and report whether an existing project has an update. Does not deploy it.',
    inputSchema: PROJECT_ID_SCHEMA,
    annotations: { readOnlyHint: false, destructiveHint: false }
  },
  {
    name: 'jewel_deploy_project',
    description: 'Deploy an existing project using its current checkout. Jewel tries to pull first, but can deploy the existing checkout if the remote is unavailable.',
    inputSchema: projectActionSchema(),
    annotations: { readOnlyHint: false, destructiveHint: false }
  },
  {
    name: 'jewel_update_project',
    description: 'Pull the configured Git branch and deploy an existing project. Fails rather than deploying stale code when the pull fails.',
    inputSchema: projectActionSchema(),
    annotations: { readOnlyHint: false, destructiveHint: false }
  },
  {
    name: 'jewel_rebuild_project',
    description: 'Rebuild an existing project: stop Compose, prune unused images, replace the local checkout, clone the configured branch, then deploy. Named volumes are retained.',
    inputSchema: projectActionSchema(),
    annotations: { readOnlyHint: false, destructiveHint: false }
  },
  {
    name: 'jewel_restart_project',
    description: 'Restart an existing Compose project. It stops the project and starts it again without deleting projects, containers, images, or volumes outside the project lifecycle.',
    inputSchema: projectActionSchema(),
    annotations: { readOnlyHint: false, destructiveHint: false }
  },
  {
    name: 'jewel_get_deploy_log',
    description: 'Read a redacted tail of an existing project deployment/rebuild log.',
    inputSchema: { ...PROJECT_ID_SCHEMA, properties: { ...PROJECT_ID_SCHEMA.properties, lines: { type: 'integer', minimum: 1, maximum: MAX_LOG_LINES } } },
    annotations: { readOnlyHint: true, destructiveHint: false }
  },
  {
    name: 'jewel_get_failure_report',
    description: 'Read the latest failed deployment operation and a redacted diagnostic report for an existing project.',
    inputSchema: PROJECT_ID_SCHEMA,
    annotations: { readOnlyHint: true, destructiveHint: false }
  },
  {
    name: 'jewel_get_runtime_logs',
    description: 'Read redacted recent stdout/stderr logs from the containers of an existing project.',
    inputSchema: { ...PROJECT_ID_SCHEMA, properties: { ...PROJECT_ID_SCHEMA.properties, lines: { type: 'integer', minimum: 1, maximum: MAX_LOG_LINES } } },
    annotations: { readOnlyHint: true, destructiveHint: false }
  },
  {
    name: 'jewel_get_project_operations',
    description: 'Read recent deployment operation records for an existing project.',
    inputSchema: { ...PROJECT_ID_SCHEMA, properties: { ...PROJECT_ID_SCHEMA.properties, limit: { type: 'integer', minimum: 1, maximum: 100 }, detail_lines: { type: 'integer', minimum: 1, maximum: MAX_LOG_LINES } } },
    annotations: { readOnlyHint: true, destructiveHint: false }
  },
  {
    name: 'jewel_check_self_update',
    description: 'Check whether a newer Jewel release is available. This does not install it.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false }
  },
  {
    name: 'jewel_apply_self_update',
    description: 'Start Jewel’s built-in self-update. The Jewel container will restart; it does not delete user projects or volumes.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false }
  }
];

const handlers = {
  jewel_list_projects: () => listProjects(),
  jewel_get_project: getProject,
  jewel_check_project_update: checkProjectUpdate,
  jewel_deploy_project: args => deployProject(args),
  jewel_update_project: args => deployProject(args, { requirePull: true }),
  jewel_rebuild_project: rebuildProject,
  jewel_restart_project: restartProject,
  jewel_get_deploy_log: getDeployLog,
  jewel_get_failure_report: getFailureReport,
  jewel_get_runtime_logs: getRuntimeLogs,
  jewel_get_project_operations: getProjectOperations,
  jewel_check_self_update: checkSelfUpdate,
  jewel_apply_self_update: applySelfUpdate
};

async function callTool(name, args) {
  if (!Object.prototype.hasOwnProperty.call(handlers, name)) throw new Error(`Unknown tool: ${name}`);
  return handlers[name](args || {});
}

module.exports = { tools, callTool };
