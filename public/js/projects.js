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
          <tr>
            <td><a href="#" onclick="Projects.showDetail(${p.id});return false">${esc(p.name)}</a></td>
            <td><span class="badge badge-${p.status}">${esc(I18n.t(`status.${p.status}`) || p.status)}</span></td>
            <td>${esc(p.git_branch)}</td>
            <td>
              ${p.commit_hash ? `<span class="commit-sha">${esc(p.commit_hash.substring(0,7))}</span>` : '<span class="text-muted">-</span>'}
              ${p.update_available ? `<span class="badge badge-update" data-i18n="project.updateAvailable">有更新</span>` : ''}
            </td>
            <td>
              ${p.update_available ? `<button class="btn btn-sm btn-update" onclick="Projects.updateProject(${p.id})" data-i18n="project.update">更新</button>` : ''}
              <button class="btn btn-sm" onclick="Projects.deploy(${p.id})" data-i18n="project.deploy">部署</button>
              <button class="btn btn-sm" onclick="Projects.stop(${p.id})" data-i18n="project.stop">停止</button>
              <button class="btn btn-sm" onclick="Projects.showDetail(${p.id})" data-i18n="project.detail">详情</button>
              <button class="btn btn-sm btn-danger" onclick="Projects.remove(${p.id})" data-i18n="project.delete">删除</button>
            </td>
          </tr>
        `).join('')}</tbody>
      </table>`;
      I18n.apply();
    } catch (err) {
      Notify.error(err.message);
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
    const tokenSelect = document.getElementById('projTokenSelect').value;
    let gitToken = '';
    if (tokenSelect === '__manual__') {
      gitToken = document.getElementById('projGitToken').value;
    } else if (tokenSelect) {
      try {
        const savedTokens = await API.getTokens();
        const selected = savedTokens.find(t => String(t.id) === tokenSelect);
        if (selected) {
          const fullToken = await API.getToken(selected.id);
          gitToken = fullToken.token || '';
        }
      } catch { /* ignore */ }
    }

    const data = {
      name: document.getElementById('projName').value,
      container_name: document.getElementById('projContainerName').value.trim(),
      git_url: document.getElementById('projGitUrl').value,
      git_token: gitToken,
      git_branch: document.getElementById('projBranch').value || 'main',
      compose_path: document.getElementById('projCompose').value || 'docker-compose.yml',
      reuse_volumes: document.getElementById('projReuseVolumes').checked
    };

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
      Notify.error(err.message);
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
    try {
      Notify.info(I18n.t('project.deploying') || 'Deploying...');
      await API.deployProject(id);
      Notify.success(I18n.t('project.deploySuccess') || 'Deployed');
      this.loadList();
    } catch (err) {
      Notify.error(err.message);
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
    try {
      Notify.info(I18n.t('project.updating') || 'Updating project...');
      await API.deployProject(id);
      Notify.success(I18n.t('project.updateSuccess') || 'Project updated');
      this.loadList();
    } catch (err) {
      Notify.error(err.message);
    }
  },

  async checkUpdate(id) {
    try {
      Notify.info(I18n.t('project.checkUpdate') || 'Checking for updates...');
      const updated = await API.checkProjectUpdate(id);
      if (updated.update_available) {
        Notify.info(I18n.t('project.updateAvailable') || 'Update available');
      } else {
        Notify.success(I18n.t('project.upToDate') || 'Up to date');
      }
      this.loadList();
      return updated;
    } catch (err) {
      Notify.error(err.message);
    }
  },

  async stop(id) {
    try {
      await API.stopProject(id);
      Notify.success(I18n.t('project.stopped') || 'Stopped');
      this.loadList();
    } catch (err) {
      Notify.error(err.message);
    }
  },

  async remove(id) {
    if (!confirm(I18n.t('project.confirmDelete') || 'Are you sure?')) return;
    try {
      await API.deleteProject(id);
      Notify.success(I18n.t('project.deleted') || 'Deleted');
      this.loadList();
    } catch (err) {
      Notify.error(err.message);
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
          <label data-i18n="project.deployLog">部署日志</label>
          <div class="log-viewer" id="projectDeployLog">${I18n.t('common.loading') || 'Loading...'}</div>
        </div>
        <div class="form-group">
          <label data-i18n="project.logs">日志</label>
          <div class="log-viewer" id="projectLogs">${I18n.t('common.loading') || 'Loading...'}</div>
        </div>
      `;

      Modal.show(project.name, content, [
        { label: I18n.t('common.cancel') || '取消', class: 'btn-secondary' },
        { label: I18n.t('common.save') || '保存', class: 'btn-primary', onClick: () => this.saveProject(project.id) }
      ]);
      I18n.apply();

      document.getElementById('detailTokenSelect').addEventListener('change', (e) => {
        document.getElementById('detailManualTokenGroup').style.display =
          e.target.value === '__manual__' ? 'block' : 'none';
      });

      try {
        const deployLogResp = await API.getProjectDeployLog(id);
        const deployEl = document.getElementById('projectDeployLog');
        if (deployEl) {
          const text = (deployLogResp && deployLogResp.log) || '';
          deployEl.textContent = text.trim() ? text : (I18n.t('project.noDeployLog') || 'No deploy log yet. Click deploy to see full terminal output.');
          deployEl.scrollTop = deployEl.scrollHeight;
        }
      } catch { /* ignore */ }

      try {
        const logs = await API.getProjectLogs(id);
        const logEl = document.getElementById('projectLogs');
        if (logEl) {
          const entries = Object.entries(logs);
          logEl.textContent = entries.length ? entries.map(([n, l]) => `=== ${n} ===\n${l}`).join('\n\n') : I18n.t('project.noLogs') || 'No logs available';
        }
      } catch { /* ignore */ }

    } catch (err) {
      Notify.error(err.message);
    }
  },

  async saveProject(id) {
    const tokenSelect = document.getElementById('detailTokenSelect').value;
    let gitToken = '';
    if (tokenSelect === '__manual__') {
      gitToken = document.getElementById('detailGitToken').value;
    } else if (tokenSelect) {
      try {
        const fullToken = await API.getToken(tokenSelect);
        gitToken = fullToken.token || '';
      } catch { /* ignore */ }
    }

    const data = {
      name: document.getElementById('detailName').value,
      container_name: document.getElementById('detailContainerName').value.trim(),
      git_url: document.getElementById('detailGitUrl').value,
      git_token: gitToken,
      git_branch: document.getElementById('detailBranch').value,
      compose_path: document.getElementById('detailCompose').value,
      reuse_volumes: document.getElementById('detailReuseVolumes').checked
    };

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
      Notify.error(err.message);
    }
  }
};
