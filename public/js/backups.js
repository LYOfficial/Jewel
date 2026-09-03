const Backups = {
  refreshTimer: null,
  data: { projects: [], providers: [], plans: [], tasks: [] },

  t(key, fallback, values = {}) {
    const translated = I18n.currentLang === 'zh-CN' ? fallback : I18n.t(`backup.${key}`);
    return Object.entries(values).reduce(
      (text, [name, value]) => text.replaceAll(`{${name}}`, value),
      translated === `backup.${key}` ? fallback : translated
    );
  },

  async render(container) {
    container.innerHTML = `
      <div class="page-shell backups-page">
        <div id="backupOverview" class="stats-grid"></div>
        <section class="section-card">
          <div class="section-card-header">
            <div><h3>${this.t('plans', '备份计划')}</h3><p>${this.t('plansDescription', '手动执行，或按小时周期自动执行。')}</p></div>
            <details class="action-menu page-action-menu">
              <summary>${this.t('new', '新建')} <span>⌄</span></summary>
              <div class="action-menu-popover">
                <button class="action-menu-item" id="addBackupPlan"><span class="action-menu-icon">＋</span>${this.t('plan', '备份计划')}</button>
                <button class="action-menu-item" id="addBackupProvider"><span class="action-menu-icon">◇</span>${this.t('provider', '存储目标')}</button>
              </div>
            </details>
          </div>
          <div id="backupPlans" class="table-container"></div>
        </section>
        <div class="resource-grid two-column">
          <section class="section-card">
            <div class="section-card-header"><div><h3>${this.t('providers', '存储目标')}</h3><p>${this.t('providersDescription', '凭据仅用于服务端传输，列表中会自动遮蔽。')}</p></div></div>
            <div id="backupProviders"></div>
          </section>
          <section class="section-card">
            <div class="section-card-header"><div><h3>${this.t('recentTasks', '最近任务')}</h3><p>${this.t('tasksDescription', '任务失败时可直接复制脱敏诊断报告。')}</p></div></div>
            <div id="backupTasks" class="table-container"></div>
          </section>
        </div>
      </div>`;
    document.getElementById('addBackupProvider').addEventListener('click', () => this.showProviderForm());
    document.getElementById('addBackupPlan').addEventListener('click', () => this.showPlanForm());
    await this.loadAll();
    this.refreshTimer = setInterval(() => this.refreshTasks(), 10000);
  },

  destroy() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = null;
  },

  async loadAll() {
    try {
      const [projects, providers, plans, tasks] = await Promise.all([
        API.getProjects(), API.getBackupProviders(), API.getBackupPlans(), API.getBackupTasks(30)
      ]);
      this.data = { projects, providers, plans, tasks };
      this.renderOverview();
      this.renderProviders();
      this.renderPlans();
      this.renderTasks();
    } catch (err) {
      App.showApiError(err, this.t('loadFailed', '加载备份中心失败'));
    }
  },

  async refreshTasks() {
    if (App.currentPage !== 'backups') return;
    try {
      this.data.tasks = await API.getBackupTasks(30);
      this.renderOverview();
      this.renderTasks();
      if (!this.data.tasks.some(task => ['queued', 'running'].includes(task.status))) return;
      this.data.plans = await API.getBackupPlans();
      this.renderPlans();
    } catch { /* background refresh is best effort */ }
  },

  renderOverview() {
    const running = this.data.tasks.filter(task => ['queued', 'running'].includes(task.status)).length;
    const succeeded = this.data.tasks.filter(task => task.status === 'succeeded').length;
    const failed = this.data.tasks.filter(task => task.status === 'failed').length;
    const el = document.getElementById('backupOverview');
    if (!el) return;
    el.innerHTML = [
      [this.t('providers', '存储目标'), this.data.providers.length, this.t('providerHint', '已配置的远端与本地目标')],
      [this.t('plans', '备份计划'), this.data.plans.length, this.t('autoPlanCount', '{count} 个自动计划', { count: this.data.plans.filter(p => p.schedule_enabled).length })],
      [this.t('running', '运行中'), running, running ? this.t('runningActive', '正在暂停、打包或上传') : this.t('runningIdle', '当前没有传输任务')],
      [this.t('recentResults', '近期结果'), `${succeeded}/${failed}`, this.t('successFailure', '成功 / 失败')]
    ].map(([label, value, hint]) => `
      <div class="stat-card fluent-stat">
        <div class="stat-label">${label}</div>
        <div class="stat-value">${value}</div>
        <div class="stat-hint">${hint}</div>
      </div>`).join('');
  },

  renderProviders() {
    const el = document.getElementById('backupProviders');
    if (!el) return;
    if (!this.data.providers.length) {
      el.innerHTML = `<div class="compact-empty">${this.t('noProviders', '尚未配置存储目标。先添加一个本地目录或云存储。')}</div>`;
      return;
    }
    el.innerHTML = `<div class="provider-list">${this.data.providers.map(provider => {
      const menu = App.actionMenu([
        { label: this.t('connectionCheck', '连接检查'), icon: '◇', onclick: `Backups.testProvider(${provider.id})` },
        { label: this.t('edit', '编辑'), icon: '✎', onclick: `Backups.showProviderFormById(${provider.id})` },
        { label: this.t('delete', '删除'), icon: '×', danger: true, onclick: `Backups.removeProvider(${provider.id})` }
      ]);
      return `
        <div class="provider-row">
          <div class="provider-mark">${this.providerInitial(provider.type)}</div>
          <div class="provider-main">
            <strong>${App.escapeHtml(provider.name)}</strong>
            <span>${this.providerLabel(provider.type)} · ${provider.enabled ? this.t('enabled', '已启用') : this.t('disabled', '已停用')}</span>
          </div>
          ${menu}
        </div>`;
    }).join('')}</div>`;
  },

  renderPlans() {
    const el = document.getElementById('backupPlans');
    if (!el) return;
    if (!this.data.plans.length) {
      el.innerHTML = `<div class="empty-state compact"><div class="empty-icon">▣</div><p>${this.t('noPlans', '没有备份计划。创建计划后即可选择卷和卷内文件夹。')}</p></div>`;
      return;
    }
    el.innerHTML = `<table class="resource-table">
      <thead><tr><th>${this.t('plan', '计划')}</th><th>${this.t('project', '项目')}</th><th>${this.t('storage', '存储')}</th><th>${this.t('scope', '范围')}</th><th>${this.t('schedule', '调度')}</th><th>${this.t('latestStatus', '最近状态')}</th><th></th></tr></thead>
      <tbody>${this.data.plans.map(plan => {
        const range = plan.volume_selections.map(item => {
          const paths = (item.paths || ['/']).map(p => p === '/' ? this.t('all', '全部') : p).join(', ');
          return `<span class="resource-chip" title="${App.escapeHtml(paths)}">${App.escapeHtml(item.name)} · ${App.escapeHtml(paths)}</span>`;
        }).join('');
        const schedule = plan.schedule_enabled
          ? `${this.t('everyHours', '每 {hours} 小时', { hours: plan.interval_hours })}<div class="table-subtext">${plan.next_run_at ? this.formatDate(plan.next_run_at) : this.t('waitingSchedule', '等待调度')}</div>`
          : this.t('manualOnly', '仅手动');
        const menu = App.actionMenu([
          { label: this.t('runNow', '立即备份'), icon: '▶', onclick: `Backups.runPlan(${plan.id})` },
          { label: this.t('editPlan', '编辑计划'), icon: '✎', onclick: `Backups.showPlanFormById(${plan.id})` },
          { label: this.t('deletePlan', '删除计划'), icon: '×', danger: true, onclick: `Backups.removePlan(${plan.id})` }
        ]);
        return `<tr>
          <td><strong>${App.escapeHtml(plan.name)}</strong>${plan.pause_project ? `<div class="table-subtext">${this.t('pauseDuringBackup', '备份时暂停项目')}</div>` : `<div class="table-subtext warning-text">${this.t('liveSnapshot', '不停机快照')}</div>`}<div class="table-subtext">${this.t('retentionBatches', '本地缓存保留 {count} 批', { count: plan.retention_count ?? 3 })}</div></td>
          <td>${App.escapeHtml(plan.project_name)}</td>
          <td><span class="provider-pill">${this.providerLabel(plan.provider_type)}</span><div class="table-subtext">${App.escapeHtml(plan.provider_name)}</div></td>
          <td><div class="chip-stack">${range}</div></td>
          <td>${schedule}</td>
          <td>${this.statusBadge(plan.last_status || 'idle')}</td>
          <td class="action-cell">${menu}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;
  },

  renderTasks() {
    const el = document.getElementById('backupTasks');
    if (!el) return;
    if (!this.data.tasks.length) {
      el.innerHTML = `<div class="compact-empty">${this.t('noTasks', '还没有备份任务。')}</div>`;
      return;
    }
    el.innerHTML = `<table class="compact-table">
      <thead><tr><th>${this.t('task', '任务')}</th><th>${this.t('phase', '阶段')}</th><th>${this.t('size', '大小')}</th><th></th></tr></thead>
      <tbody>${this.data.tasks.slice(0, 12).map(task => {
        const menu = App.actionMenu([
          { label: this.t('viewDetails', '查看详情'), icon: '⌕', onclick: `Backups.showTask(${task.id})` },
          { label: this.t('copyDiagnostic', '复制诊断'), icon: '⧉', visible: task.status === 'failed', onclick: `Backups.copyTaskReport(${task.id})` }
        ]);
        return `<tr>
          <td><strong>#${task.id} ${App.escapeHtml(task.project_name || '-')}</strong><div class="table-subtext">${this.formatDate(task.created_at)}</div></td>
          <td>${this.statusBadge(task.status)}<div class="table-subtext">${this.phaseLabel(task.phase)}</div></td>
          <td>${this.formatSize(task.bytes_total || 0)}<div class="table-subtext">${this.t('packageCount', '{count} 个包', { count: (task.archives || []).length })}</div></td>
          <td>${menu}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;
  },

  showProviderFormById(id) {
    this.showProviderForm(this.data.providers.find(item => item.id === id));
  },

  showProviderForm(provider = null) {
    const content = `
      <div class="form-row">
        <div class="form-group"><label>${this.t('name', '名称')}</label><input id="backupProviderName" value="${App.escapeHtml(provider?.name || '')}" placeholder="${this.t('providerNamePlaceholder', '生产备份存储')}"></div>
        <div class="form-group"><label>${this.t('type', '类型')}</label>
          <select id="backupProviderType">
            ${['local', 'r2', 'onedrive', 'baidu', 'anyshare'].map(type => `<option value="${type}" ${provider?.type === type ? 'selected' : ''}>${this.providerLabel(type)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="provider-form-note" id="providerFormNote"></div>
      <div id="backupProviderFields"></div>`;
    Modal.show(provider ? this.t('editProvider', '编辑存储目标') : this.t('newProvider', '新增存储目标'), content, [
      { label: this.t('cancel', '取消'), class: 'btn-secondary' },
      { label: provider ? this.t('save', '保存') : this.t('create', '创建'), class: 'btn-primary', onClick: () => this.saveProvider(provider?.id) }
    ]);
    const select = document.getElementById('backupProviderType');
    const render = () => this.renderProviderFields(select.value, provider && provider.type === select.value ? provider.config : {});
    select.addEventListener('change', render);
    render();
  },

  renderProviderFields(type, config = {}) {
    const el = document.getElementById('backupProviderFields');
    const note = document.getElementById('providerFormNote');
    if (!el) return;
    const val = key => config[key] === '••••••••' ? '' : (config[key] || '');
    const secretPlaceholder = key => config[key] === '••••••••' ? this.t('secretConfigured', '已配置，留空保持不变') : '';
    const input = (label, key, placeholder = '', secret = false, typeName = 'text') => `
      <div class="form-group"><label>${label}</label><input type="${secret ? 'password' : typeName}" data-provider-key="${key}"
        value="${App.escapeHtml(val(key))}" placeholder="${App.escapeHtml(secretPlaceholder(key) || placeholder)}"></div>`;
    const area = (label, key, placeholder = '', secret = false) => `
      <div class="form-group"><label>${label}</label><textarea data-provider-key="${key}" ${secret ? 'class="secret-textarea"' : ''}
        placeholder="${App.escapeHtml(secretPlaceholder(key) || placeholder)}">${App.escapeHtml(val(key))}</textarea></div>`;

    if (type === 'local') {
      note.textContent = this.t('localNote', '适合先验证任务流程，或将归档写入已挂载的 NAS 目录。');
      el.innerHTML = input(this.t('directory', '目录'), 'directory', '/data/backups/export') + input(this.t('basePathOptional', '基础路径（可选）'), 'base_path', 'jewel');
    } else if (type === 'r2') {
      note.textContent = this.t('r2Note', '使用 rclone 的 S3 兼容模式连接 Cloudflare R2。');
      el.innerHTML = `<div class="form-row">${input('R2 Endpoint', 'endpoint', 'https://ACCOUNT.r2.cloudflarestorage.com')}${input('Bucket', 'bucket', 'jewel-backups')}</div>
        <div class="form-row">${input('Access Key ID', 'access_key_id', '', true)}${input('Secret Access Key', 'secret_access_key', '', true)}</div>
        ${input(this.t('basePathOptional', '基础路径（可选）'), 'base_path', 'backups')}`;
    } else if (type === 'onedrive') {
      note.textContent = this.t('oneDriveNote', '可填写现有 rclone remote 名称；如需由 Jewel 注入认证，请同时提供 token JSON。');
      el.innerHTML = `<div class="form-row">${input('rclone Remote 名称', 'remote_name', 'jewelonedrive')}${input('Drive 类型', 'drive_type', 'business / personal')}</div>
        ${input(this.t('driveIdOptional', 'Drive ID（可选）'), 'drive_id')}${area(this.t('tokenJsonOptional', 'rclone Token JSON（可选）'), 'token', '{"access_token":"..."}', true)}${input(this.t('basePathOptional', '基础路径（可选）'), 'base_path', 'Jewel')}`;
    } else if (type === 'baidu') {
      note.textContent = this.t('baiduNote', '百度网盘通过 bypy 工作。首次授权后，配置会保存在指定目录中。');
      el.innerHTML = input(this.t('bypyConfigDirectory', 'bypy 配置目录'), 'config_dir', '/data/provider-config/baidu') + input(this.t('driveBasePathOptional', '网盘基础路径（可选）'), 'base_path', 'backups');
    } else {
      note.textContent = this.t('anyShareNote', '支持允许上传的 AnyShare 公开分享链接；远端子目录须已存在。');
      el.innerHTML = input(this.t('shareLink', '分享链接'), 'share_link', 'https://example.com/link/...', true, 'url') + input(this.t('serviceRootOptional', '服务根地址（可选）'), 'base_url', 'https://example.com', false, 'url') + input(this.t('basePathOptional', '基础路径（可选）'), 'base_path', 'Jewel');
    }
  },

  async saveProvider(id) {
    const name = document.getElementById('backupProviderName').value.trim();
    const type = document.getElementById('backupProviderType').value;
    const config = {};
    document.querySelectorAll('[data-provider-key]').forEach(input => { config[input.dataset.providerKey] = input.value.trim(); });
    if (!name) return Notify.error(this.t('providerNameRequired', '请输入存储目标名称'));
    try {
      if (id) await API.updateBackupProvider(id, { name, type, config });
      else await API.createBackupProvider({ name, type, config });
      Notify.success(id ? this.t('providerUpdated', '存储目标已更新') : this.t('providerCreated', '存储目标已创建'));
      await this.loadAll();
    } catch (err) {
      App.showApiError(err, id ? this.t('providerUpdateFailed', '更新存储目标失败') : this.t('providerCreateFailed', '创建存储目标失败'));
    }
  },

  async testProvider(id) {
    try {
      const result = await API.testBackupProvider(id);
      Notify.success(result.message || this.t('connectionPassed', '存储连接检查通过'));
    } catch (err) {
      App.showApiError(err, this.t('connectionFailed', '存储连接检查失败'));
    }
  },

  async removeProvider(id) {
    const ok = await Modal.confirm({ title: this.t('deleteProvider', '删除存储目标'), body: this.t('deleteProviderHint', '只有未被备份计划使用的存储目标才能删除。'), okLabel: this.t('delete', '删除'), okClass: 'btn-danger' });
    if (!ok) return;
    try { await API.deleteBackupProvider(id); Notify.success(this.t('providerDeleted', '存储目标已删除')); await this.loadAll(); }
    catch (err) { App.showApiError(err, this.t('providerDeleteFailed', '删除存储目标失败')); }
  },

  showPlanFormById(id) {
    this.showPlanForm(this.data.plans.find(item => item.id === id));
  },

  showPlanForm(plan = null) {
    if (!this.data.projects.length) return Notify.error(this.t('createProjectFirst', '请先创建项目'));
    if (!this.data.providers.length) return Notify.error(this.t('addProviderFirst', '请先添加存储目标'));
    const projectId = plan?.project_id || this.data.projects[0].id;
    const content = `
      <div class="form-row">
        <div class="form-group"><label>${this.t('planName', '计划名称')}</label><input id="backupPlanName" value="${App.escapeHtml(plan?.name || '')}" placeholder="${this.t('planNamePlaceholder', '每日数据备份')}"></div>
        <div class="form-group"><label>${this.t('project', '项目')}</label><select id="backupPlanProject">${this.data.projects.map(project => `<option value="${project.id}" ${project.id === projectId ? 'selected' : ''}>${App.escapeHtml(project.name)}</option>`).join('')}</select></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>${this.t('provider', '存储目标')}</label><select id="backupPlanProvider">${this.data.providers.map(provider => `<option value="${provider.id}" ${provider.id === plan?.provider_id ? 'selected' : ''}>${App.escapeHtml(provider.name)} · ${this.providerLabel(provider.type)}</option>`).join('')}</select></div>
        <div class="form-group"><label>${this.t('remoteSubdirectoryOptional', '远端子目录（可选）')}</label><input id="backupPlanRemotePath" value="${App.escapeHtml(plan?.remote_path || '')}" placeholder="production/database"></div>
      </div>
      <div class="form-group"><label>${this.t('volumesAndPaths', '挂载卷与备份路径')}</label><div id="backupPlanVolumes" class="volume-picker"><div class="loading-inline">${this.t('discoveringVolumes', '正在发现项目挂载卷…')}</div></div></div>
      <div class="backup-options-grid">
        <label class="option-card"><input type="checkbox" id="backupPauseProject" ${plan?.pause_project === 0 ? '' : 'checked'}><span><strong>${this.t('consistentPause', '一致性暂停')}</strong><small>${this.t('consistentPauseHint', '打包前暂停项目容器，上传后自动恢复。')}</small></span></label>
        <label class="option-card"><input type="checkbox" id="backupScheduleEnabled" ${plan?.schedule_enabled ? 'checked' : ''}><span><strong>${this.t('automaticBackup', '自动备份')}</strong><small>${this.t('automaticBackupHint', '按固定小时周期运行。')}</small></span></label>
      </div>
      <div class="form-group"><label>${this.t('retentionCount', '本地缓存保留批次')}</label><input type="number" min="0" max="100" id="backupRetentionCount" value="${plan?.retention_count ?? 3}"><small class="form-hint">${this.t('retentionHint', '上传完成后只保留最近批次的本地暂存归档；填 0 可在上传后立即清理。')}</small></div>
      <div class="form-group" id="backupIntervalGroup" style="display:${plan?.schedule_enabled ? 'block' : 'none'}"><label>${this.t('intervalHours', '执行间隔（小时）')}</label><input type="number" min="1" max="8760" id="backupIntervalHours" value="${plan?.interval_hours || 24}"></div>`;
    Modal.show(plan ? this.t('editBackupPlan', '编辑备份计划') : this.t('newBackupPlan', '新建备份计划'), content, [
      { label: this.t('cancel', '取消'), class: 'btn-secondary' },
      { label: plan ? this.t('save', '保存') : this.t('create', '创建'), class: 'btn-primary', onClick: () => this.savePlan(plan?.id) }
    ]);
    const projectSelect = document.getElementById('backupPlanProject');
    projectSelect.addEventListener('change', () => this.loadPlanVolumes(projectSelect.value, []));
    document.getElementById('backupScheduleEnabled').addEventListener('change', event => {
      document.getElementById('backupIntervalGroup').style.display = event.target.checked ? 'block' : 'none';
    });
    this.loadPlanVolumes(projectId, plan?.volume_selections || []);
  },

  async loadPlanVolumes(projectId, selected) {
    const el = document.getElementById('backupPlanVolumes');
    if (!el) return;
    try {
      const volumes = await API.getBackupVolumes(projectId);
      const selectedMap = new Map((selected || []).map(item => [item.name, item.paths || ['/']]));
      if (!volumes.length) {
        el.innerHTML = `<div class="compact-empty">${this.t('noDiscoveredVolumes', '该项目当前没有可发现的 Docker 命名卷。请先至少部署一次项目。')}</div>`;
        return;
      }
      el.innerHTML = volumes.map(volume => {
        const paths = selectedMap.get(volume.name) || ['/'];
        return `<label class="volume-option">
          <input type="checkbox" class="backup-volume-select" data-volume="${App.escapeHtml(volume.name)}" ${selectedMap.has(volume.name) ? 'checked' : ''}>
          <span class="volume-option-main"><strong>${App.escapeHtml(volume.name)}</strong><small>${App.escapeHtml(volume.destinations.join(', ') || this.t('unknownMountPoint', '未知挂载点'))} · ${App.escapeHtml(volume.containers.join(', '))}</small></span>
          <input class="volume-path-input" data-volume-path="${App.escapeHtml(volume.name)}" value="${App.escapeHtml(paths.join(', '))}" placeholder="${this.t('volumePathPlaceholder', '/ 或 uploads, data/db')}">
        </label>`;
      }).join('');
    } catch (err) {
      el.innerHTML = `<div class="inline-error">${App.escapeHtml(err.message)}</div>`;
    }
  },

  async savePlan(id) {
    const selections = [...document.querySelectorAll('.backup-volume-select:checked')].map(checkbox => {
      const name = checkbox.dataset.volume;
      const input = document.querySelector(`[data-volume-path="${CSS.escape(name)}"]`);
      const paths = (input?.value || '/').split(',').map(value => value.trim()).filter(Boolean);
      return { name, paths: paths.length ? paths : ['/'] };
    });
    const data = {
      name: document.getElementById('backupPlanName').value.trim(),
      project_id: Number(document.getElementById('backupPlanProject').value),
      provider_id: Number(document.getElementById('backupPlanProvider').value),
      remote_path: document.getElementById('backupPlanRemotePath').value.trim(),
      volume_selections: selections,
      pause_project: document.getElementById('backupPauseProject').checked,
      retention_count: Math.max(0, Math.min(Number(document.getElementById('backupRetentionCount').value) || 0, 100)),
      schedule_enabled: document.getElementById('backupScheduleEnabled').checked,
      interval_hours: Number(document.getElementById('backupIntervalHours').value) || 24
    };
    if (!data.name) return Notify.error(this.t('planNameRequired', '请输入计划名称'));
    if (!selections.length) return Notify.error(this.t('selectVolume', '至少选择一个挂载卷'));
    try {
      if (id) await API.updateBackupPlan(id, data); else await API.createBackupPlan(data);
      Notify.success(id ? this.t('planUpdated', '备份计划已更新') : this.t('planCreated', '备份计划已创建'));
      await this.loadAll();
    } catch (err) {
      App.showApiError(err, id ? this.t('planUpdateFailed', '更新备份计划失败') : this.t('planCreateFailed', '创建备份计划失败'));
    }
  },

  async runPlan(id) {
    const ok = await Modal.confirm({
      title: this.t('runBackupNow', '立即执行备份'),
      body: this.t('runBackupHint', '任务会按计划暂停项目容器、打包所选卷并上传，完成或失败后都会尝试恢复容器。'),
      okLabel: this.t('startBackup', '开始备份')
    });
    if (!ok) return;
    try {
      const task = await API.runBackupPlan(id);
      Notify.success(this.t('taskQueued', '备份任务 #{id} 已进入队列', { id: task.id }));
      await this.refreshTasks();
    } catch (err) {
      App.showApiError(err, this.t('startBackupFailed', '启动备份失败'));
    }
  },

  async removePlan(id) {
    const ok = await Modal.confirm({ title: this.t('deleteBackupPlan', '删除备份计划'), body: this.t('deletePlanHint', '历史任务记录会保留，但该计划将不再自动运行。'), okLabel: this.t('delete', '删除'), okClass: 'btn-danger' });
    if (!ok) return;
    try { await API.deleteBackupPlan(id); Notify.success(this.t('planDeleted', '备份计划已删除')); await this.loadAll(); }
    catch (err) { App.showApiError(err, this.t('planDeleteFailed', '删除备份计划失败')); }
  },

  async showTask(id) {
    try {
      const task = await API.getBackupTask(id);
      const archives = (task.archives || []).map(item => `
        <div class="archive-row"><span>${App.escapeHtml(item.volume)}:${App.escapeHtml(item.source_path)}</span><strong>${this.formatSize(item.size)}</strong><small>${App.escapeHtml(item.remote || item.name)}${item.local_available === false ? ` · ${this.t('localCacheCleared', '本地缓存已清理')}` : ''}</small></div>`).join('');
      Modal.show(this.t('taskNumber', '备份任务 #{id}', { id: task.id }), `
        <div class="task-detail-grid">
          <div><span>${this.t('project', '项目')}</span><strong>${App.escapeHtml(task.project_name || '-')}</strong></div>
          <div><span>${this.t('status', '状态')}</span>${this.statusBadge(task.status)}</div>
          <div><span>${this.t('phase', '阶段')}</span><strong>${this.phaseLabel(task.phase)}</strong></div>
          <div><span>${this.t('totalSize', '总大小')}</span><strong>${this.formatSize(task.bytes_total)}</strong></div>
        </div>
        ${task.error ? `<div class="inline-error">${App.escapeHtml(task.error)}</div>` : ''}
        <div class="form-group"><label>${this.t('archives', '归档')}</label><div class="archive-list">${archives || `<div class="compact-empty">${this.t('noArchives', '尚未生成归档')}</div>`}</div></div>
        <div class="log-toolbar"><span>${this.t('taskLog', '任务日志')}</span><button class="btn btn-sm" id="copyBackupTaskLog">${this.t('copy', '复制')}</button></div>
        <pre class="log-viewer task-log" id="backupTaskLog">${App.escapeHtml(task.log || this.t('noLogs', '暂无日志'))}</pre>`,
      [
        { label: this.t('close', '关闭'), class: 'btn-secondary' },
        { label: this.t('copyDiagnosticReport', '复制诊断报告'), class: 'btn-primary', close: false, onClick: () => App.copyText(task.diagnostic_report || task.log, this.t('taskDiagnosticCopied', '任务诊断已复制')) }
      ]);
      document.getElementById('copyBackupTaskLog')?.addEventListener('click', () => App.copyText(task.log, this.t('taskLogCopied', '任务日志已复制')));
    } catch (err) {
      App.showApiError(err, this.t('readTaskFailed', '读取备份任务失败'));
    }
  },

  async copyTaskReport(id) {
    try {
      const task = await API.getBackupTask(id);
      await App.copyText(task.diagnostic_report || task.log || task.error, this.t('backupDiagnosticCopied', '备份诊断已复制'));
    } catch (err) {
      App.showApiError(err, this.t('copyDiagnosticFailed', '复制备份诊断失败'));
    }
  },

  statusBadge(status) {
    const value = status || 'idle';
    const labels = {
      queued: this.t('statusQueued', '排队中'), running: this.t('statusRunning', '运行中'),
      succeeded: this.t('statusSucceeded', '成功'), failed: this.t('statusFailed', '失败'), idle: this.t('statusIdle', '未运行')
    };
    const css = { queued: 'deploying', running: 'deploying', succeeded: 'running', failed: 'error', idle: 'idle' }[value] || 'idle';
    return `<span class="badge badge-${css}">${labels[value] || App.escapeHtml(value)}</span>`;
  },

  phaseLabel(phase) {
    return ({
      queued: this.t('phaseQueued', '等待执行'), preparing: this.t('phasePreparing', '准备'),
      pausing: this.t('phasePausing', '暂停项目'), archiving: this.t('phaseArchiving', '打包卷'),
      uploading: this.t('phaseUploading', '上传'), resuming: this.t('phaseResuming', '恢复项目'),
      'recovery-pending': this.t('phaseRecoveryPending', '等待恢复项目'), completed: this.t('phaseCompleted', '完成'),
      failed: this.t('phaseFailed', '失败'), interrupted: this.t('phaseInterrupted', '被重启中断')
    })[phase] || phase || '-';
  },

  providerLabel(type) {
    return ({ local: this.t('providerLocal', '本地 / NAS'), r2: 'Cloudflare R2', onedrive: 'OneDrive', baidu: this.t('providerBaidu', '百度网盘'), anyshare: 'AnyShare' })[type] || type;
  },

  providerInitial(type) {
    return ({ local: 'L', r2: 'R2', onedrive: '1D', baidu: 'B', anyshare: 'AS' })[type] || '?';
  },

  formatDate(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  },

  formatSize(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return `${value} B`;
    if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
    if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
    return `${(value / 1024 ** 3).toFixed(2)} GB`;
  }
};
