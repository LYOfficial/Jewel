const Dashboard = {
  async render(container) {
    container.innerHTML = `
      <div class="stats-grid" id="dashboardStats">
        <div class="stat-card">
          <div class="stat-label" data-i18n="dashboard.projects">项目</div>
          <div class="stat-value" id="statProjects">-</div>
        </div>
        <div class="stat-card">
          <div class="stat-label" data-i18n="dashboard.runningContainers">运行中容器</div>
          <div class="stat-value" id="statRunning">-</div>
        </div>
        <div class="stat-card">
          <div class="stat-label" data-i18n="dashboard.stoppedContainers">已停止容器</div>
          <div class="stat-value" id="statStopped">-</div>
        </div>
        <div class="stat-card">
          <div class="stat-label" data-i18n="dashboard.system">系统</div>
          <div class="stat-value" id="statSystem" style="font-size:16px">-</div>
        </div>
      </div>
      <div class="card">
        <div class="card-header">
          <div class="card-title" data-i18n="dashboard.recentProjects">最近项目</div>
        </div>
        <div id="recentProjects" class="table-container"></div>
      </div>
    `;
    I18n.apply();
    await this.loadData();
  },

  async loadData() {
    try {
      const [projects, containers, info] = await Promise.all([
        API.getProjects().catch(() => []),
        API.getContainers().catch(() => []),
        API.getSystemInfo().catch(() => null)
      ]);

      document.getElementById('statProjects').textContent = projects.length;
      const running = containers.filter(c => c.State === 'running').length;
      const stopped = containers.length - running;
      document.getElementById('statRunning').textContent = running;
      document.getElementById('statStopped').textContent = stopped;

      if (info) {
        document.getElementById('statSystem').textContent =
          `Node ${info.nodeVersion?.replace('v', '') || '-'}`;
      }

      const recentEl = document.getElementById('recentProjects');
      if (projects.length === 0) {
        recentEl.innerHTML = `<div class="empty-state">
          <div class="empty-icon">&#9654;</div>
          <p data-i18n="dashboard.noProjects">暂无项目</p>
          <button class="btn btn-primary" onclick="App.navigate('projects')" data-i18n="dashboard.addProject">添加项目</button>
        </div>`;
        I18n.apply();
      } else {
        recentEl.innerHTML = `<table>
          <thead><tr>
            <th data-i18n="project.name">名称</th>
            <th data-i18n="project.status">状态</th>
            <th data-i18n="project.gitUrl">Git 仓库</th>
            <th data-i18n="project.actions">操作</th>
          </tr></thead>
          <tbody>${projects.slice(0, 5).map(p => `
            <tr>
              <td>${esc(p.name)}</td>
              <td><span class="badge badge-${p.status}">${esc(I18n.t(`status.${p.status}`) || p.status)}</span></td>
              <td><small>${esc(p.git_url)}</small></td>
              <td>
                <button class="btn btn-sm" onclick="Dashboard.deployProject(${p.id})" data-i18n="project.deploy">部署</button>
                <button class="btn btn-sm" onclick="App.navigate('projects')" data-i18n="project.detail">详情</button>
              </td>
            </tr>
          `).join('')}</tbody>
        </table>`;
        I18n.apply();
      }
    } catch (err) {
      Notify.error(err.message);
    }
  },

  async deployProject(id) {
    try {
      Notify.info(I18n.t('project.deploying') || 'Deploying...');
      await API.deployProject(id);
      Notify.success(I18n.t('project.deploySuccess') || 'Deployed');
      this.loadData();
    } catch (err) {
      Notify.error(err.message);
    }
  }
};

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}
