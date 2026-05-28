const Containers = {
  refreshTimer: null,

  async render(container) {
    container.innerHTML = `
      <div class="card-header" style="margin-bottom:16px">
        <div class="card-title" data-i18n="container.list">容器列表</div>
        <div>
          <label style="font-size:12px;color:var(--text-muted)">
            <input type="checkbox" id="showAllContainers"> <span data-i18n="container.showAll">显示已停止</span>
          </label>
          <button class="btn btn-sm" id="refreshContainers" data-i18n="common.refresh">刷新</button>
        </div>
      </div>
      <div id="containersList" class="table-container"></div>
    `;
    I18n.apply();

    document.getElementById('showAllContainers').addEventListener('change', () => this.loadList());
    document.getElementById('refreshContainers').addEventListener('click', () => this.loadList());

    await this.loadList();
    this.refreshTimer = setInterval(() => this.loadList(), 10000);
  },

  destroy() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  },

  async loadList() {
    const showAll = document.getElementById('showAllContainers')?.checked;
    try {
      const containers = await API.getContainers(showAll);
      const el = document.getElementById('containersList');

      if (!containers || containers.length === 0) {
        el.innerHTML = `<div class="empty-state">
          <div class="empty-icon">&#9635;</div>
          <p data-i18n="container.noContainers">暂无容器</p>
        </div>`;
        I18n.apply();
        return;
      }

      el.innerHTML = `<table>
        <thead><tr>
          <th data-i18n="container.name">名称</th>
          <th data-i18n="container.image">镜像</th>
          <th data-i18n="container.status">状态</th>
          <th data-i18n="container.ports">端口</th>
          <th data-i18n="container.actions">操作</th>
        </tr></thead>
        <tbody>${containers.map(c => `
          <tr>
            <td>${esc((c.Names && c.Names[0]) || '-').replace(/^\//, '')}</td>
            <td><small>${esc(c.Image || '-')}</small></td>
            <td><span class="badge badge-${c.State === 'running' ? 'running' : 'stopped'}">${esc(c.State || '-')}</span></td>
            <td><small>${(c.Ports || []).map(p => `${p.PublicPort}:${p.PrivatePort}`).join(', ') || '-'}</small></td>
            <td>
              ${c.State === 'running' ?
                `<button class="btn btn-sm" onclick="Containers.stop('${c.Id}')" data-i18n="container.stop">停止</button>
                 <button class="btn btn-sm" onclick="Containers.restart('${c.Id}')" data-i18n="container.restart">重启</button>` :
                `<button class="btn btn-sm" onclick="Containers.start('${c.Id}')" data-i18n="container.start">启动</button>`
              }
              <button class="btn btn-sm" onclick="Containers.showLogs('${c.Id}')" data-i18n="container.logs">日志</button>
              <button class="btn btn-sm" onclick="Containers.showStats('${c.Id}')" data-i18n="container.stats">状态</button>
              <button class="btn btn-sm btn-danger" onclick="Containers.remove('${c.Id}')" data-i18n="container.remove">删除</button>
            </td>
          </tr>
        `).join('')}</tbody>
      </table>`;
      I18n.apply();
    } catch (err) {
      Notify.error(err.message);
    }
  },

  async start(id) {
    try {
      await API.startContainer(id);
      Notify.success(I18n.t('container.started') || 'Container started');
      this.loadList();
    } catch (err) { Notify.error(err.message); }
  },

  async stop(id) {
    try {
      await API.stopContainer(id);
      Notify.success(I18n.t('container.stopped') || 'Container stopped');
      this.loadList();
    } catch (err) { Notify.error(err.message); }
  },

  async restart(id) {
    try {
      await API.restartContainer(id);
      Notify.success(I18n.t('container.restarted') || 'Container restarted');
      this.loadList();
    } catch (err) { Notify.error(err.message); }
  },

  async remove(id) {
    if (!confirm(I18n.t('container.confirmRemove') || 'Are you sure?')) return;
    try {
      await API.removeContainer(id, true);
      Notify.success(I18n.t('container.removed') || 'Container removed');
      this.loadList();
    } catch (err) { Notify.error(err.message); }
  },

  async showLogs(id) {
    try {
      const data = await API.getContainerLogs(id, 200);
      Modal.show(I18n.t('container.logs') || 'Logs', `<div class="log-viewer">${esc(data.logs || '')}</div>`, [
        { label: I18n.t('common.close') || '关闭', class: 'btn-secondary' }
      ]);
    } catch (err) { Notify.error(err.message); }
  },

  async showStats(id) {
    try {
      const stats = await API.getContainerStats(id);
      const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
      const sysDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
      const cpuPercent = sysDelta > 0 ? (cpuDelta / sysDelta * stats.cpu_stats.online_cpus * 100).toFixed(2) : 0;
      const memUsage = (stats.memory_stats.usage / 1024 / 1024).toFixed(1);
      const memLimit = (stats.memory_stats.limit / 1024 / 1024).toFixed(1);
      const memPercent = stats.memory_stats.limit > 0 ? (stats.memory_stats.usage / stats.memory_stats.limit * 100).toFixed(2) : 0;

      Modal.show(I18n.t('container.stats') || 'Stats', `
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-label">CPU</div>
            <div class="stat-value">${cpuPercent}%</div>
          </div>
          <div class="stat-card">
            <div class="stat-label" data-i18n="container.memory">内存</div>
            <div class="stat-value">${memUsage} / ${memLimit} MB</div>
            <div class="progress-bar" style="margin-top:8px"><div class="progress-fill" style="width:${memPercent}%"></div></div>
          </div>
        </div>
      `, [{ label: I18n.t('common.close') || '关闭', class: 'btn-secondary' }]);
      I18n.apply();
    } catch (err) { Notify.error(err.message); }
  }
};
