const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const projectsSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'projects.js'), 'utf8');

function createProjectsHarness(initialProject, options = {}) {
  let project = { ...initialProject };
  let checkCalls = 0;
  let operationCalls = 0;
  const deployRequests = [];
  let shownError = null;
  const actionMenus = [];
  const notifications = [];
  const projectsList = { innerHTML: '' };
  const projectActionMenu = {
    open: false,
    setAttribute: (name) => {
      if (name === 'open') projectActionMenu.open = true;
    }
  };

  const sandbox = {
    API: {
      getProjects: async () => [project],
      deployProject: async (...args) => {
        deployRequests.push(args);
        if (options.deployError) throw options.deployError;
        return { message: 'Deployed successfully' };
      },
      getProjectOperations: async () => {
        operationCalls += 1;
        return options.operations || [];
      },
      checkProjectUpdate: async (id) => {
        checkCalls += 1;
        project = { ...project, id, update_available: 1 };
        return project;
      }
    },
    I18n: {
      t: (key) => ({
        'project.name': '名称',
        'project.status': '状态',
        'project.branch': '分支',
        'project.commit': 'Commit',
        'project.actions': '操作',
        'project.checkUpdate': '检查更新',
        'project.update': '更新',
        'project.deploy': '部署',
        'project.rebuild': '重构',
        'project.stop': '停止',
        'project.detail': '详情',
        'project.delete': '删除',
        'project.updateAvailable': '有更新',
        'project.upToDate': '已是最新',
        'status.running': '运行中'
      })[key] || key,
      apply: () => {}
    },
    App: {
      actionMenu: (items) => {
        actionMenus.push(items.map((item) => ({ ...item })));
        return '<div class="action-menu"></div>';
      },
      showApiError: (err) => { shownError = err; }
    },
    Notify: {
      info: (message) => notifications.push(message),
      success: (message) => notifications.push(message)
    },
    document: {
      getElementById: (id) => (id === 'projectsList' ? projectsList : null),
      querySelector: () => projectActionMenu
    },
    esc: (value) => String(value == null ? '' : value)
  };

  vm.createContext(sandbox);
  vm.runInContext(`${projectsSource}\nglobalThis.ProjectsUnderTest = Projects;`, sandbox, {
    filename: 'public/js/projects.js'
  });

  return {
    Projects: sandbox.ProjectsUnderTest,
    actionMenus,
    notifications,
    get actionMenuOpen() { return projectActionMenu.open; },
    get checkCalls() { return checkCalls; },
    get operationCalls() { return operationCalls; },
    get deployRequests() { return deployRequests; },
    get shownError() { return shownError; }
  };
}

const project = {
  id: 42,
  name: 'demo',
  status: 'running',
  git_branch: 'main',
  commit_hash: 'abc1234',
  update_available: 0,
  last_operation_status: '',
  last_failure_id: null
};

test('project details split the dashboard from deployment configuration', () => {
  assert.match(projectsSource, /data-project-detail-tab="dashboard"/);
  assert.match(projectsSource, /data-project-detail-tab="deploy"/);
  assert.match(projectsSource, /data-project-detail-panel="dashboard"/);
  assert.match(projectsSource, /data-project-detail-panel="deploy"/);
  assert.match(projectsSource, /projectMetricSummary/);
  assert.match(projectsSource, /loadDashboardResources/);
  assert.match(projectsSource, /operation\.commit_hash/);
});

test('project action menu always includes check update', async () => {
  const harness = createProjectsHarness(project);

  await harness.Projects.loadList();

  const actions = harness.actionMenus.at(-1);
  const checkUpdate = actions.find((action) => action.label === '检查更新');
  const update = actions.find((action) => action.label === '更新');
  assert.equal(checkUpdate.onclick, 'Projects.checkUpdate(42, true)');
  assert.equal(checkUpdate.visible, undefined);
  assert.equal(update.visible, false);
});

test('checking an update refreshes the action menu with update available', async () => {
  const harness = createProjectsHarness(project);

  const updated = await harness.Projects.checkUpdate(project.id, true);

  const actions = harness.actionMenus.at(-1);
  const checkUpdate = actions.find((action) => action.label === '检查更新');
  const update = actions.find((action) => action.label === '更新');
  assert.equal(updated.update_available, 1);
  assert.equal(harness.checkCalls, 1);
  assert.equal(checkUpdate.onclick, 'Projects.checkUpdate(42, true)');
  assert.equal(update.visible, true);
  assert.equal(harness.actionMenuOpen, true);
});

test('a proxy 504 during project update is reconciled with a successful deploy operation', async () => {
  const proxyTimeout = Object.assign(new Error('Request failed (HTTP 504)'), { status: 504 });
  const harness = createProjectsHarness(project, {
    deployError: proxyTimeout,
    operations: [{ action: 'deploy', status: 'succeeded' }]
  });

  await harness.Projects.updateProject(project.id);

  assert.equal(harness.operationCalls, 1);
  assert.equal(harness.shownError, null);
  assert.ok(harness.notifications.includes('project.updateSuccess'));
  assert.equal(harness.deployRequests.length, 1);
  assert.equal(harness.deployRequests[0][0], project.id);
  assert.equal(harness.deployRequests[0][1].require_pull, true);
});
