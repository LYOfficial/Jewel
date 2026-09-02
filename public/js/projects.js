const Projects = {
  async render(container) {
    container.innerHTML = `
      <div class="card-header" style="margin-bottom:16px">
        <div class="card-title" data-i18n="project.list">项目列表</div>
        <button class="btn btn-primary btn-sm" id="addProjectBtn" data-i18n="project.add">添加项目</button>
      </div>
      <div id="projectsList" class="table-container"></div>
    `;
    I18n.apply();
    document.getElementById('addProjectBtn').addEventListener('click', () => this.showAddForm());
    await this.loadList();
  },

  async loadList() {
    try {
      const projects = await API.getProjects();
      const el = document.getElementById('projectsList');

      if (projects.length === 0) {
        el.innerHTML = `<div class="empty-state">
          <div class="empty-icon">&#9654;</div>
          <p data-i18n="project.noProjects">暂无项目，点击上方按钮添加</p>
        </div>`;
        I18n.apply();
        return;
      }

      el.innerHTML = `<table>
        <thead><tr>
          <th data-i18n="project.name">名称</th>
          <th data-i18n="project.status">状态</th>
          <th data-i18n="project.branch">分支</th>
          <th data-i18n="project.commit">Commit</th>
          <th data-i18n="project.actions">操作</th>
        </tr></thead>
        <tbody>${projects.map(p => `
          <tr data-project-id="${p.id}">
            <td><a href="#" onclick="Projects.showDetail(${p.id});return false">${esc(p.name)}</a></td>
            <td>
              <span class="badge badge-${p.status}">${esc(I18n.t(`status.${p.status}`) || p.status)}</span>
              ${p.last_operation_status === 'failed' ? `<div class="table-subtext error-text" title="${esc(p.last_operation_summary || '')}">最近操作失败</div>` : ''}
            </td>
            <td>${esc(p.git_branch)}</td>
            <td>
              ${p.commit_hash ? `<span class="commit-sha">${esc(p.commit_hash.substring(0,7))}</span>` : '<span class="text-muted">-</span>'}
              ${p.update_available ? `<span class="badge badge-update" data-i18n="project.updateAvailable">有更新</span>` : ''}
            </td>
            <td class="action-cell" data-project-actions="${p.id}">
              ${App.actionMenu([
                { label: I18n.t('project.checkUpdate') || '检查更新', icon: '⌕', onclick: `Projects.checkUpdate(${p.id}, true)` },
                { label: I18n.t('project.update') || '更新', icon: '↥', visible: !!p.update_available, onclick: `Projects.updateProject(${p.id})` },
                { label: I18n.t('project.deploy') || '部署', icon: '▶', onclick: `Projects.deploy(${p.id})` },
                { label: I18n.t('project.rebuild') || '重构', icon: '↻', onclick: `Projects.rebuild(${p.id})` },
                { label: I18n.t('project.stop') || '停止', icon: '■', onclick: `Projects.stop(${p.id})` },
                { label: I18n.t('project.detail') || '详情', icon: '⌕', onclick: `Projects.showDetail(${p.id})` },
                { label: '复制最近失败诊断', icon: '⧉', visible: !!p.last_failure_id, onclick: `Projects.copyLatestError(${p.id})` },
                { label: I18n.t('project.delete') || '删除', icon: '×', danger: true, onclick: `Projects.remove(${p.id})` }
              ])}
            </td>
          </tr>
        `).join('')}</tbody>
      </table>`;
      I18n.apply();
    } catch (err) {
      App.showApiError(err, '加载项目列表失败');
    }
  },

  async showAddForm() {
    let tokenOptions = '';
    try {
      const savedTokens = await API.getTokens();
      if (savedTokens.length > 0) {
        tokenOptions = savedTokens.map(t =>
          `<option value="${t.id}">${esc(t.name)} (${t.provider}${t.host ? ' - ' + esc(t.host) : ''})</option>`
        ).join('');
      }
    } catch { /* ignore */ }

    const content = `
      <div class="form-group">
        <label data-i18n="project.name">名称</label>
        <input type="text" id="projName" required>
      </div>
      <div class="form-group">
        <label data-i18n="project.containerName">容器名（选填）</label>
        <input type="text" id="projContainerName" placeholder="e.g. my-app (留空使用默认)">
      </div>
      <div class="form-group">
        <label data-i18n="project.gitUrl">Git 仓库 URL</label>
        <input type="url" id="projGitUrl" placeholder="https://github.com/user/repo.git" required>
      </div>
      <div class="form-group">
        <label data-i18n="project.selectToken">选择已保存的令牌</label>
        <select id="projTokenSelect">
          <option value="" data-i18n="project.noToken">不使用令牌</option>
          <option value="__manual__" data-i18n="project.manualInput">手动输入...</option>
          ${tokenOptions}
        </select>
      </div>
      <div class="form-group" id="projManualTokenGroup" style="display:none">
        <label data-i18n="project.gitToken">Git Token</label>
        <input type="text" id="projGitToken" placeholder="ghp_xxxx">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label data-i18n="project.branch">分支</label>
          <input type="text" id="projBranch" value="main">
        </div>
        <div class="form-group">
          <label data-i18n="project.composePath">Compose 路径</label>
          <input type="text" id="projCompose" value="docker-compose.yml">
        </div>
      </div>
      <div class="form-group">
        <label class="experimental-label">
          <input type="checkbox" id="projReuseVolumes">
          <span data-i18n="project.reuseVolumes">复用本地挂载卷</span>
          <span class="experimental-badge" data-i18n="common.experimental">测试性功能</span>
        </label>
        <small class="experimental-hint" data-i18n="project.reuseVolumesHint">
          勾选后，若主机上已有同名容器，将先删除该容器（仅删容器，保留挂载卷），然后用新配置创建容器并复用原数据。
        </small>
      </div>
    `;
    Modal.show(I18n.t('project.add') || '添加项目', content, [
      { label: I18n.t('common.cancel') || '取消', class: 'btn-secondary' },
      {
        label: I18n.t('common.create') || '创建',
        class: 'btn-primary',
        onClick: () => this.createProject()
      }
    ]);
    I18n.apply();

    document.getElementById('projTokenSelect').addEventListener('change', (e) => {
      document.getElementById('projManualTokenGroup').style.display =
        e.target.value === '__manual__' ? 'block' : 'none';
    });
  },

  async createProject() {
    // IMPORTANT: collect all form values synchronously first. The modal
    // auto-closes as soon as this handler returns, so any DOM read that
    // happens after an `await` will see an empty form.
    const tokenSelect = document.getElementById('projTokenSelect').value;
    const data = {
      name: document.getElementById('projName').value,
      container_name: document.getElementById('projContainerName').value.trim(),
      git_url: document.getElementById('projGitUrl').value,
      git_token: '',
      git_branch: document.getElementById('projBranch').value || 'main',
      compose_path: document.getElementById('projCompose').value || 'docker-compose.yml',
      reuse_volumes: document.getElementById('projReuseVolumes').checked
    };

    if (tokenSelect === '__manual__') {
      data.git_token = document.getElementById('projGitToken').value;
    } else if (tokenSelect) {
      // Resolve the saved token's secret by id (sync in id, async in value).
      // We don't need any other DOM values at this point.
      try {
        const fullToken = await API.getToken(tokenSelect);
        data.git_token = (fullToken && fullToken.token) || '';
      } catch { /* ignore — leave token empty */ }
    }

    if (!data.name || !data.git_url) {
      Notify.error(I18n.t('project.nameAndUrlRequired') || 'Name and URL are required');
      return;
    }

    try {
      Notify.info(I18n.t('project.creating') || 'Creating project...');
      await API.createProject(data);
      Notify.success(I18n.t('project.created') || 'Project created');
      this.loadList();
    } catch (err) {
      App.showApiError(err, '创建项目失败');
      this.loadList();
    }
  },

  async deploy(id) {
    let project = null;
    try {
      project = await API.getProject(id);
    } catch (err) {
      Notify.error(err.message);
      return;
    }

    // If reuse_volumes is enabled, show a warning modal first
    if (project.reuse_volumes && project.container_name) {
      const warningContent = `
        <div class="rm-warn" style="font-size:14px;margin-bottom:12px">
          <strong data-i18n="project.reuseVolumesWarning">⚠ 即将复用本地挂载卷</strong>
        </div>
        <p style="color:#ccc;font-size:13px;line-height:1.6;margin-bottom:12px" data-i18n="project.reuseVolumesWarning1">
          此项目配置为复用宿主机上的现有挂载卷。如果当前主机上存在名为
          <strong>${esc(project.container_name)}</strong>
          的容器，将先删除该容器（仅删容器，保留卷），然后用新镜像创建容器并复用原数据。
        </p>
        <p style="color:#fa0;font-size:13px;line-height:1.6" data-i18n="project.reuseVolumesWarning2">
          <strong>请先备份好挂载卷内的数据，防止数据丢失！</strong>
          此功能为测试性功能，请谨慎使用。
        </p>
      `;

      Modal.show(I18n.t('project.deploy') || '部署', warningContent, [
        { label: I18n.t('common.cancel') || '取消', class: 'btn-secondary' },
        {
          label: I18n.t('project.confirmDeploy') || '我已备份，继续部署',
          class: 'btn-danger',
          onClick: () => this.doDeploy(id)
        }
      ]);
      I18n.apply();
      return;
    }

    await this.doDeploy(id);
  },

  async doDeploy(id) {
    Projects.setRowStatus(id, 'deploying');
    try {
      Notify.info(I18n.t('project.deploying') || 'Deploying...');
      await API.deployProject(id);
      Notify.success(I18n.t('project.deploySuccess') || 'Deployed');
      this.loadList();
    } catch (err) {
      const state = await this.reconcileGatewayTimedOutDeploy(id, err);
      if (state === 'succeeded') {
        Notify.success(I18n.t('project.deploySuccess') || 'Deployed');
        this.loadList();
        return;
      }
      if (state === 'pending') {
        Notify.info(I18n.t('project.deployStillRunning') || 'The request timed out at the proxy, but deployment is still running in Jewel. Refresh later to check its result.');
        this.loadList();
        return;
      }
      App.showApiError(err, '部署失败');
      this.loadList();
    } finally {
      // Refresh deploy log if the detail modal is currently open for this project
      try {
        const deployEl = document.getElementById('projectDeployLog');
        if (deployEl) {
          const resp = await API.getProjectDeployLog(id);
          const text = (resp && resp.log) || '';
          deployEl.textContent = text.trim() ? text : (I18n.t('project.noDeployLog') || 'No deploy log yet.');
          deployEl.scrollTop = deployEl.scrollHeight;
        }
      } catch { /* ignore */ }
    }
  },

  async updateProject(id) {
    // The update button only appears when `update_available` is true, so
    // clicking it means "we know there's a new commit — pull + redeploy".
    // We hide the button immediately and flip the status badge to
    // "部署中" so the user gets instant feedback even before the server
    // has had time to write `status='deploying'` to the DB.
    Projects.setRowStatus(id, 'deploying');
    Projects.hideRowAction(id, 'update');
    try {
      Notify.info(I18n.t('project.updating') || 'Updating project...');
      // An update must never fall back to deploying the old checkout. The
      // server will fail this operation if it cannot pull the new revision.
      await API.deployProject(id, { require_pull: true });
      Notify.success(I18n.t('project.updateSuccess') || 'Project updated');
      this.loadList();
    } catch (err) {
      const state = await this.reconcileGatewayTimedOutDeploy(id, err);
      if (state === 'succeeded') {
        Notify.success(I18n.t('project.updateSuccess') || 'Project updated');
        this.loadList();
        return;
      }
      if (state === 'pending') {
        Notify.info(I18n.t('project.deployStillRunning') || 'The request timed out at the proxy, but deployment is still running in Jewel. Refresh later to check its result.');
        this.loadList();
        return;
      }
      App.showApiError(err, '更新项目失败');
      this.loadList();
    }
  },

  // OpenResty (or another reverse proxy) may return 504 before a Compose
  // build finishes. The HTTP connection is gone, but the server-side async
  // route keeps running. Check the persisted operation record before showing
  // a failure notification so a successful deployment is not misreported.
  async reconcileGatewayTimedOutDeploy(id, err) {
    if (!err || Number(err.status) !== 504) return 'not-applicable';

    Notify.info(I18n.t('project.confirmingDeploy') || 'The proxy timed out; confirming deployment status...');
    const deadline = Date.now() + 5 * 60 * 1000;
    while (Date.now() < deadline) {
      try {
        const operations = await API.getProjectOperations(id, 1);
        const operation = operations && operations[0];
        if (operation && operation.action === 'deploy') {
          if (operation.status === 'succeeded') return 'succeeded';
          if (operation.status === 'failed') return 'failed';
        }
      } catch {
        // The proxy may still be recovering. Keep checking until the window
        // expires rather than converting a transport timeout into a failure.
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    return 'pending';
  },

  async rebuild(id) {
    const ok = await Modal.confirm({
      title: I18n.t('project.rebuild') || '重构',
      body: I18n.t('project.rebuildConfirm') || '即将停止容器、清理未使用的镜像、然后重新部署。挂载卷中的数据会保留。是否继续？',
      okLabel: I18n.t('project.rebuild') || '重构',
      okClass: 'btn-warning'
    });
    if (!ok) return;

    Projects.setRowStatus(id, 'rebuilding');
    try {
      Notify.info(I18n.t('project.rebuilding') || 'Rebuilding...');
      await API.rebuildProject(id);
      Notify.success(I18n.t('project.rebuildSuccess') || 'Rebuilt successfully');
      this.loadList();
    } catch (err) {
      App.showApiError(err, '重构失败');
      this.loadList();
    }
  },

  // Update the status badge of a single project row in-place, without
  // re-rendering the entire list. Called by deploy/update/rebuild right
  // after the user clicks a button so the badge flips to "部署中" / "重构中"
  // immediately, before the server has even acknowledged the request.
  // The trailing loadList() in each handler will reconcile any drift.
  setRowStatus(id, status) {
    try {
      const row = document.querySelector(`tr[data-project-id="${id}"]`);
      if (!row) return;
      const badge = row.querySelector('td:nth-child(2) .badge');
      if (badge) {
        badge.className = `badge badge-${status}`;
        badge.textContent = I18n.t(`status.${status}`) || status;
      }
    } catch { /* ignore — best-effort UI update */ }
  },

  // Hide a single action button in a project row by data-action. Used to
  // make the "更新" button vanish the moment the user clicks it (its
  // precondition — `update_available` — is no longer true once the new
  // commit has been pulled and deployed).
  hideRowAction(id, action) {
    try {
      const row = document.querySelector(`tr[data-project-id="${id}"]`);
      if (!row) return;
      const btn = row.querySelector(`[data-action="${action}"]`);
      if (btn) btn.style.display = 'none';
    } catch { /* ignore */ }
  },

  async checkUpdate(id, revealUpdateAction = false) {
    try {
      Notify.info(I18n.t('project.checkUpdate') || 'Checking for updates...');
      const updated = await API.checkProjectUpdate(id);
      if (updated.update_available) {
        Notify.info(I18n.t('project.updateAvailable') || 'Update available');
      } else {
        Notify.success(I18n.t('project.upToDate') || 'Up to date');
      }
      // Refresh the current row so a newly available "更新" action is
      // immediately shown in the same 操作 menu.
      await this.loadList();
      if (revealUpdateAction && updated.update_available) {
        const menu = document.querySelector(`tr[data-project-id="${id}"] details.action-menu`);
        if (menu) menu.setAttribute('open', '');
      }
      return updated;
    } catch (err) {
      App.showApiError(err, '检查项目更新失败');
    }
  },

  async stop(id) {
    try {
      await API.stopProject(id);
      Notify.success(I18n.t('project.stopped') || 'Stopped');
      this.loadList();
    } catch (err) {
      App.showApiError(err, '停止项目失败');
    }
  },

  async remove(id) {
    if (!confirm(I18n.t('project.confirmDelete') || 'Are you sure?')) return;
    try {
      await API.deleteProject(id);
      Notify.success(I18n.t('project.deleted') || 'Deleted');
      this.loadList();
    } catch (err) {
      App.showApiError(err, '删除项目失败');
    }
  },

  async copyLatestError(id) {
    try {
      const result = await API.getProjectErrorReport(id);
      await App.copyText(result.report, '项目诊断报告已复制');
    } catch (err) {
      App.showApiError(err, '读取项目诊断失败');
    }
  },

  async showDetail(id) {
    try {
      const project = await API.getProject(id);
      const envVars = JSON.parse(project.env_vars || '{}');
      const envText = Object.entries(envVars).map(([k, v]) => `${k}=${v}`).join('\n');

      let tokenOptions = '';
      let hasMatchingToken = false;
      try {
        const savedTokens = await API.getTokens();
        if (savedTokens.length > 0) {
          tokenOptions = savedTokens.map(t => {
            const selected = project.git_token && String(t.id) === project.git_token_id ? ' selected' : '';
            if (selected) hasMatchingToken = true;
            return `<option value="${t.id}"${selected}>${esc(t.name)} (${t.provider}${t.host ? ' - ' + esc(t.host) : ''})</option>`;
          }).join('');
        }
      } catch { /* ignore */ }

      const commitShort = project.commit_hash ? project.commit_hash.substring(0, 7) : '-';
      const remoteShort = project.remote_commit ? project.remote_commit.substring(0, 7) : '';

      const content = `
        <div class="project-detail-tabs" role="tablist" aria-label="${esc(I18n.t('project.detail') || '项目详情')}">
          <button class="project-detail-tab active" type="button" role="tab" aria-selected="true" data-project-detail-tab="dashboard">${esc(I18n.t('project.dashboard') || '仪表盘')}</button>
          <button class="project-detail-tab" type="button" role="tab" aria-selected="false" data-project-detail-tab="deploy">${esc(I18n.t('project.deployment') || '部署')}</button>
        </div>
        <section class="project-detail-panel" data-project-detail-panel="dashboard">
        <div class="project-detail-hero">
          <div>
            <span class="badge badge-${project.status}">${esc(I18n.t(`status.${project.status}`) || project.status)}</span>
            <strong>${esc(project.name)}</strong>
            <small>${esc(project.git_branch)} · ${esc(commitShort)}</small>
          </div>
          <button class="btn btn-sm" type="button" onclick="Modal.close();App.navigate('backups')">打开备份中心</button>
        </div>
        <div class="project-dashboard-toolbar">
          <div><strong>${esc(I18n.t('project.resourceOverview') || '资源概览')}</strong><small>${esc(I18n.t('project.dashboardHint') || '实时汇总项目关联的 Docker 资源')}</small></div>
          <button class="btn btn-sm" type="button" id="refreshProjectDashboard">${esc(I18n.t('common.refresh') || '刷新')}</button>
        </div>
        <div id="projectMetricSummary" class="project-metric-summary loading-inline">${esc(I18n.t('project.loadingDashboard') || '正在读取项目资源使用情况…')}</div>
        <div id="projectResourceSummary" class="resource-summary loading-inline">${esc(I18n.t('project.loadingResources') || '正在关联容器、镜像与挂载卷…')}</div>
        </section>
        <section class="project-detail-panel" data-project-detail-panel="deploy" hidden>
        <div class="form-group">
          <label data-i18n="project.name">名称</label>
          <input type="text" id="detailName" value="${esc(project.name)}">
        </div>
        <div class="form-group">
          <label data-i18n="project.containerName">容器名（选填）</label>
          <input type="text" id="detailContainerName" value="${esc(project.container_name || '')}" placeholder="e.g. my-app (留空使用默认)">
        </div>
        <div class="form-group">
          <label data-i18n="project.gitUrl">Git 仓库 URL</label>
          <input type="url" id="detailGitUrl" value="${esc(project.git_url)}">
        </div>
        <div class="form-group">
          <label data-i18n="project.selectToken">选择已保存的令牌</label>
          <select id="detailTokenSelect">
            <option value="" ${!project.git_token ? 'selected' : ''} data-i18n="project.noToken">不使用令牌</option>
            <option value="__manual__" ${project.git_token && !hasMatchingToken ? 'selected' : ''} data-i18n="project.manualInput">手动输入...</option>
            ${tokenOptions}
          </select>
        </div>
        <div class="form-group" id="detailManualTokenGroup" style="display:${project.git_token && !hasMatchingToken ? 'block' : 'none'}">
          <label data-i18n="project.gitToken">Git Token</label>
          <input type="text" id="detailGitToken" value="${esc(project.git_token)}" placeholder="ghp_xxxx">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label data-i18n="project.branch">分支</label>
            <input type="text" id="detailBranch" value="${esc(project.git_branch)}">
          </div>
          <div class="form-group">
            <label data-i18n="project.composePath">Compose 路径</label>
            <input type="text" id="detailCompose" value="${esc(project.compose_path)}">
          </div>
        </div>
        <div class="form-group">
          <label data-i18n="project.commit">Commit</label>
          <div class="commit-info">
            <span class="commit-sha">${esc(commitShort)}</span>
            ${project.update_available ? `
              <span class="badge badge-update" data-i18n="project.updateAvailable">有更新</span>
              <span class="text-muted">→ ${esc(remoteShort)}</span>
            ` : ''}
            <button class="btn btn-sm" onclick="Projects.checkUpdate(${project.id})" data-i18n="project.checkUpdate">检查更新</button>
          </div>
        </div>
        <div class="form-group">
          <label class="experimental-label">
            <input type="checkbox" id="detailReuseVolumes" ${project.reuse_volumes ? 'checked' : ''}>
            <span data-i18n="project.reuseVolumes">复用本地挂载卷</span>
            <span class="experimental-badge" data-i18n="common.experimental">测试性功能</span>
          </label>
          <small class="experimental-hint" data-i18n="project.reuseVolumesHint">
            勾选后，若主机上已有同名容器，将先删除该容器（仅删容器，保留挂载卷），然后用新配置创建容器并复用原数据。
          </small>
        </div>
        <div class="form-group">
          <label data-i18n="project.envVars">环境变量</label>
          <textarea id="envEditor" rows="8" placeholder="KEY=VALUE&#10;PORT=3000&#10;DB_HOST=localhost">${esc(envText)}</textarea>
        </div>
        <div class="form-group">
          <div class="log-toolbar"><label data-i18n="project.deployLog">部署日志</label><button class="btn btn-sm" type="button" id="copyDeployLogBtn">复制</button></div>
          <div class="log-viewer" id="projectDeployLog">${I18n.t('common.loading') || 'Loading...'}</div>
        </div>
        <div class="form-group">
          <div class="log-toolbar"><label data-i18n="project.failedContainerLogs">失败时的容器日志</label><button class="btn btn-sm" type="button" id="copyFailedLogsBtn">复制</button></div>
          <div class="log-viewer-toolbar">
            <button class="btn btn-sm" id="captureFailedLogsBtn" data-i18n="project.captureFailedLogs">重新捕获容器日志</button>
            <span class="log-viewer-hint" id="captureFailedLogsHint" data-i18n="project.captureFailedLogsHint">仅捕获当前残留的容器日志（部署失败后的容器可能已被自动清理）</span>
          </div>
          <div class="log-viewer" id="projectFailedContainerLogs">${I18n.t('common.loading') || 'Loading...'}</div>
        </div>
        <div class="form-group">
          <div class="log-toolbar"><label data-i18n="project.logs">日志</label><button class="btn btn-sm" type="button" id="copyRuntimeLogsBtn">复制</button></div>
          <div class="log-viewer" id="projectLogs">${I18n.t('common.loading') || 'Loading...'}</div>
        </div>
        <div class="form-group">
          <div class="log-toolbar"><label>操作历史</label>${project.last_failure_id ? `<button class="btn btn-sm" type="button" onclick="Projects.copyLatestError(${project.id})">复制最近失败诊断</button>` : ''}</div>
          <div id="projectOperationTimeline" class="operation-timeline"><div class="loading-inline">正在加载操作记录…</div></div>
        </div>
        </section>
      `;

      Modal.show(project.name, content, [
        { label: I18n.t('common.cancel') || '取消', class: 'btn-secondary' },
        { label: I18n.t('common.save') || '保存', class: 'btn-primary', onClick: () => this.saveProject(project.id) }
      ]);
      I18n.apply();

      document.querySelectorAll('[data-project-detail-tab]').forEach(tab => {
        tab.addEventListener('click', () => this.setDetailTab(tab.dataset.projectDetailTab));
      });
      this.setDetailTab('dashboard');
      document.getElementById('refreshProjectDashboard')?.addEventListener('click', () => this.loadDashboardResources(id));

      document.getElementById('detailTokenSelect').addEventListener('change', (e) => {
        document.getElementById('detailManualTokenGroup').style.display =
          e.target.value === '__manual__' ? 'block' : 'none';
      });

      const copyPanel = (buttonId, panelId, message) => {
        document.getElementById(buttonId)?.addEventListener('click', () => {
          const text = document.getElementById(panelId)?.textContent || '';
          App.copyText(text, message);
        });
      };
      copyPanel('copyDeployLogBtn', 'projectDeployLog', '部署日志已复制');
      copyPanel('copyFailedLogsBtn', 'projectFailedContainerLogs', '失败日志已复制');
      copyPanel('copyRuntimeLogsBtn', 'projectLogs', '运行日志已复制');

      this.loadDashboardResources(id);

      try {
        const operations = await API.getProjectOperations(id, 12);
        const timeline = document.getElementById('projectOperationTimeline');
        if (timeline) {
          timeline.innerHTML = operations.length ? operations.map(operation => `
            <div class="operation-row ${operation.status}">
              <span class="operation-dot"></span>
              <div>
                <strong>${esc(operation.action)}</strong>
                <small>
                  <span>${esc(operation.summary || operation.status)}</span>
                  <span class="operation-commit">${esc(I18n.t('project.commit') || 'Commit')}: <code>${esc(operation.commit_hash || '-')}</code></span>
                </small>
              </div>
              <time>${esc(operation.finished_at || operation.started_at || '')}</time>
            </div>`).join('') : '<div class="compact-empty">暂无操作记录</div>';
        }
      } catch (err) {
        const timeline = document.getElementById('projectOperationTimeline');
        if (timeline) timeline.innerHTML = `<div class="compact-empty">操作记录读取失败：${esc(err.message)}</div>`;
      }

      try {
        const deployLogResp = await API.getProjectDeployLog(id);
        const deployEl = document.getElementById('projectDeployLog');
        if (deployEl) {
          const text = (deployLogResp && deployLogResp.log) || '';
          deployEl.textContent = text.trim() ? text : (I18n.t('project.noDeployLog') || 'No deploy log yet. Click deploy to see full terminal output.');
          deployEl.scrollTop = deployEl.scrollHeight;
        }
      } catch { /* ignore */ }

      // Render the failed-container-logs section by extracting the
      // [failed-container-logs] / [manual-capture] sections out of the
      // deploy log. This way, every failed deploy from now on leaves a
      // permanent trace in the deploy log, and the user doesn't have to
      // dig through the entire log to find it.
      try {
        const failedEl = document.getElementById('projectFailedContainerLogs');
        if (failedEl) {
          const deployLogResp = await API.getProjectDeployLog(id);
          const fullLog = (deployLogResp && deployLogResp.log) || '';
          const blocks = extractFailedContainerBlocks(fullLog);
          if (blocks.length) {
            failedEl.textContent = blocks.join('\n\n' + '='.repeat(60) + '\n\n');
            failedEl.scrollTop = failedEl.scrollHeight;
          } else {
            failedEl.textContent = I18n.t('project.noFailedContainerLogs') || 'No captured container logs from failed deploys yet. Failed deploys will save container logs here automatically; you can also click the button above to capture logs from any containers still around.';
          }
        }
      } catch { /* ignore */ }

      // Wire up the "重新捕获容器日志" button. It re-reads logs from any
      // containers still around for this compose project and appends the
      // snapshot to the deploy log + refreshes the panel.
      try {
        const captureBtn = document.getElementById('captureFailedLogsBtn');
        if (captureBtn) {
          captureBtn.addEventListener('click', async () => {
            const original = captureBtn.textContent;
            captureBtn.disabled = true;
            captureBtn.textContent = I18n.t('project.capturingFailedLogs') || 'Capturing…';
            try {
              const resp = await API.captureProjectFailedLogs(id, 500);
              const failedEl = document.getElementById('projectFailedContainerLogs');
              const captured = (resp && resp.captured) || '';
              if (failedEl) {
                const blocks = extractFailedContainerBlocks(captured);
                failedEl.textContent = blocks.length
                  ? blocks.join('\n\n' + '='.repeat(60) + '\n\n')
                  : (I18n.t('project.noFailedContainerLogs') || 'No captured container logs from failed deploys yet.');
                failedEl.scrollTop = failedEl.scrollHeight;
              }
              Notify.success(I18n.t('project.capturedFailedLogs') || 'Captured container logs');
            } catch (err) {
              Notify.error(err.message);
            } finally {
              captureBtn.disabled = false;
              captureBtn.textContent = original;
            }
          });
        }
      } catch { /* ignore */ }

      try {
        const logs = await API.getProjectLogs(id);
        const logEl = document.getElementById('projectLogs');
        if (logEl) {
          const entries = Object.entries(logs);
          logEl.textContent = entries.length ? entries.map(([n, l]) => `=== ${n} ===\n${l}`).join('\n\n') : I18n.t('project.noLogs') || 'No logs available';
        }
      } catch (err) {
        const logEl = document.getElementById('projectLogs');
        if (logEl) logEl.textContent = `运行日志暂不可用：${err.message}`;
      }

    } catch (err) {
      App.showApiError(err, '读取项目详情失败');
    }
  },

  setDetailTab(tabName) {
    document.querySelectorAll('[data-project-detail-tab]').forEach(tab => {
      const active = tab.dataset.projectDetailTab === tabName;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('[data-project-detail-panel]').forEach(panel => {
      panel.hidden = panel.dataset.projectDetailPanel !== tabName;
    });
    // The save action only applies to deployment configuration. Keeping it
    // out of the dashboard prevents a misleading no-op action there.
    const actions = document.querySelector('.modal .modal-actions');
    if (actions) actions.hidden = tabName !== 'deploy';
  },

  async loadDashboardResources(id) {
    const metricEl = document.getElementById('projectMetricSummary');
    const resourceEl = document.getElementById('projectResourceSummary');
    if (metricEl) {
      metricEl.classList.add('loading-inline');
      metricEl.textContent = I18n.t('project.loadingDashboard') || '正在读取项目资源使用情况…';
    }
    if (resourceEl) {
      resourceEl.classList.add('loading-inline');
      resourceEl.textContent = I18n.t('project.loadingResources') || '正在关联容器、镜像与挂载卷…';
    }

    try {
      const resources = await API.getProjectResources(id);
      const containers = resources.containers || [];
      const images = resources.images || [];
      const volumes = resources.volumes || [];
      const bindMounts = resources.bind_mounts || [];
      const storage = resources.storage || {};
      const cpu = resources.cpu || {};
      const memory = resources.memory || {};
      const cpuPercent = Number(cpu.percent) || 0;
      const memoryPercent = Number(memory.percent) || 0;
      const cpuMeter = Math.min(100, Math.max(0, cpuPercent));
      const memoryMeter = Math.min(100, Math.max(0, memoryPercent));

      if (metricEl) {
        metricEl.classList.remove('loading-inline');
        metricEl.innerHTML = `
          <article class="project-metric-card storage">
            <span class="project-metric-icon">▣</span>
            <div><span>${esc(I18n.t('project.storageUsage') || '占用空间')}</span><strong>${esc(formatProjectBytes(storage.total_bytes))}</strong><small>${esc(I18n.t('project.storageBreakdown') || '镜像、容器可写层和命名卷；不含目录挂载')}</small></div>
          </article>
          <article class="project-metric-card cpu">
            <span class="project-metric-meter" style="--meter-value:${cpuMeter}%"><i></i><b>${esc(formatProjectPercent(cpuPercent))}</b></span>
            <div><span>${esc(I18n.t('project.cpuUsage') || 'CPU 占用')}</span><strong>${esc(formatProjectPercent(cpuPercent))}</strong><small>${esc((I18n.t('project.runningContainers') || '{count} 个运行中容器').replace('{count}', cpu.running_containers || 0))}</small></div>
          </article>
          <article class="project-metric-card memory">
            <span class="project-metric-meter" style="--meter-value:${memoryMeter}%"><i></i><b>${esc(formatProjectPercent(memoryPercent))}</b></span>
            <div><span>${esc(I18n.t('project.memoryUsage') || '内存占用')}</span><strong>${esc(formatProjectBytes(memory.usage_bytes))}</strong><small>${esc(memory.limit_bytes ? (I18n.t('project.memoryLimit') || '占容器内存上限的 {percent}').replace('{percent}', formatProjectPercent(memoryPercent)) : (I18n.t('project.memoryLimitUnavailable') || '未设置可用内存上限'))}</small></div>
          </article>`;
      }

      if (resourceEl) {
        resourceEl.classList.remove('loading-inline');
        resourceEl.innerHTML = `
          <div class="resource-summary-item"><span>${esc(I18n.t('project.resourceContainers') || '容器')}</span><strong>${containers.length}</strong><small>${containers.map(c => esc(((c.Names || [c.Id])[0] || '').replace(/^\//, ''))).join(', ') || esc(I18n.t('project.notDeployed') || '尚未部署')}</small></div>
          <div class="resource-summary-item"><span>${esc(I18n.t('project.resourceImages') || '镜像')}</span><strong>${images.length}</strong><small>${images.map(image => esc(image.name || image.id.substring(0, 12))).join(', ') || esc(I18n.t('project.none') || '无')}</small></div>
          <div class="resource-summary-item"><span>${esc(I18n.t('project.resourceVolumes') || '命名卷')}</span><strong>${volumes.length}</strong><small>${volumes.map(item => esc(item.name)).join(', ') || esc(I18n.t('project.none') || '无')}</small></div>
          <div class="resource-summary-item"><span>${esc(I18n.t('project.resourceBindMounts') || '目录挂载')}</span><strong>${bindMounts.length}</strong><small>${bindMounts.map(item => esc(item.source)).join(', ') || esc(I18n.t('project.none') || '无')}</small></div>`;
      }
    } catch (err) {
      const message = esc(err.message || I18n.t('project.readTimeout') || '读取超时');
      if (metricEl) {
        metricEl.classList.remove('loading-inline');
        metricEl.innerHTML = `<div class="compact-empty">${esc(I18n.t('project.resourcesUnavailable') || 'Docker 资源暂不可用')}：${message}</div>`;
      }
      if (resourceEl) {
        resourceEl.classList.remove('loading-inline');
        resourceEl.innerHTML = '';
      }
    }
  },

  async saveProject(id) {
    // Collect DOM values synchronously before any await — the modal
    // closes as soon as this handler returns.
    const tokenSelect = document.getElementById('detailTokenSelect').value;
    const data = {
      name: document.getElementById('detailName').value,
      container_name: document.getElementById('detailContainerName').value.trim(),
      git_url: document.getElementById('detailGitUrl').value,
      git_token: '',
      git_branch: document.getElementById('detailBranch').value,
      compose_path: document.getElementById('detailCompose').value,
      reuse_volumes: document.getElementById('detailReuseVolumes').checked
    };

    if (tokenSelect === '__manual__') {
      data.git_token = document.getElementById('detailGitToken').value;
    } else if (tokenSelect) {
      try {
        const fullToken = await API.getToken(tokenSelect);
        data.git_token = (fullToken && fullToken.token) || '';
      } catch { /* ignore */ }
    }

    const envVars = {};
    const envText = document.getElementById('envEditor').value;
    envText.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) return;
      const key = trimmed.substring(0, eqIdx).trim();
      const val = trimmed.substring(eqIdx + 1);
      if (key) envVars[key] = val;
    });

    try {
      await API.updateProject(id, data);
      await API.updateProjectEnv(id, envVars);
      Notify.success(I18n.t('common.saved') || 'Saved');
      this.loadList();
    } catch (err) {
      App.showApiError(err, '保存项目失败');
    }
  }
};

// Pull out every [failed-container-logs] / [manual-capture] block from a
// deploy log so the "失败时的容器日志" panel can show them in chronological
// order without dragging in the surrounding compose output.
function extractFailedContainerBlocks(logText) {
  if (!logText) return [];
  const blocks = [];
  // Capture everything between the opening marker and its matching
  // "End of captured logs" footer (or the next blank-line + marker).
  const startRe = /\[(failed-container-logs|manual-capture)\][^\n]*\n/g;
  let m;
  while ((m = startRe.exec(logText)) !== null) {
    const start = m.index;
    const after = logText.slice(start);
    const endMatch = after.match(/\n\[failed-container-logs\] End of captured logs\n/);
    const end = endMatch ? start + endMatch.index + endMatch[0].length : after.length;
    blocks.push(logText.slice(start, end).trim());
  }
  return blocks;
}

function formatProjectBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

function formatProjectPercent(value) {
  const percent = Number(value) || 0;
  return `${percent.toFixed(percent >= 10 || Number.isInteger(percent) ? 0 : 1)}%`;
}
