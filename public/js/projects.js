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
          <th data-i18n="project.autoDeploy">自动部署</th>
          <th data-i18n="project.actions">操作</th>
        </tr></thead>
        <tbody>${projects.map(p => `
          <tr>
            <td><a href="#" onclick="Projects.showDetail(${p.id});return false">${esc(p.name)}</a></td>
            <td><span class="badge badge-${p.status}">${esc(I18n.t(`status.${p.status}`) || p.status)}</span></td>
            <td>${esc(p.git_branch)}</td>
            <td>${p.auto_deploy ? '&#10003;' : '&#10005;'}</td>
            <td>
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
        <label><input type="checkbox" id="projAutoDeploy"> <span data-i18n="project.autoDeploy">自动部署</span></label>
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
      git_url: document.getElementById('projGitUrl').value,
      git_token: gitToken,
      git_branch: document.getElementById('projBranch').value || 'main',
      compose_path: document.getElementById('projCompose').value || 'docker-compose.yml',
      auto_deploy: document.getElementById('projAutoDeploy').checked
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
    try {
      Notify.info(I18n.t('project.deploying') || 'Deploying...');
      await API.deployProject(id);
      Notify.success(I18n.t('project.deploySuccess') || 'Deployed');
      this.loadList();
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
      const envRows = Object.entries(envVars).map(([k, v]) =>
        `<div class="env-row"><input value="${esc(k)}" data-env-key><input value="${esc(v)}" data-env-val><span class="env-remove" onclick="this.parentElement.remove()">&times;</span></div>`
      ).join('');

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

      const content = `
        <div class="form-group">
          <label data-i18n="project.name">名称</label>
          <input type="text" id="detailName" value="${esc(project.name)}">
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
          <label><input type="checkbox" id="detailAutoDeploy" ${project.auto_deploy ? 'checked' : ''}> <span data-i18n="project.autoDeploy">自动部署</span></label>
        </div>
        ${project.webhook_secret ? `
        <div class="form-group">
          <label data-i18n="project.webhookUrl">Webhook URL</label>
          <input type="text" readonly value="${window.location.origin}/api/webhook/${project.id}/${project.webhook_secret}" onclick="this.select()">
        </div>` : ''}
        <div class="form-group">
          <label data-i18n="project.envVars">环境变量</label>
          <div class="env-editor" id="envEditor">${envRows}</div>
          <button class="btn btn-sm" onclick="Projects.addEnvRow()" style="margin-top:8px" data-i18n="project.addEnv">添加变量</button>
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

  addEnvRow() {
    const editor = document.getElementById('envEditor');
    if (!editor) return;
    const row = document.createElement('div');
    row.className = 'env-row';
    row.innerHTML = `<input placeholder="KEY" data-env-key><input placeholder="VALUE" data-env-val><span class="env-remove" onclick="this.parentElement.remove()">&times;</span>`;
    editor.appendChild(row);
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
      git_url: document.getElementById('detailGitUrl').value,
      git_token: gitToken,
      git_branch: document.getElementById('detailBranch').value,
      compose_path: document.getElementById('detailCompose').value,
      auto_deploy: document.getElementById('detailAutoDeploy').checked
    };

    const envVars = {};
    document.querySelectorAll('#envEditor .env-row').forEach(row => {
      const key = row.querySelector('[data-env-key]').value.trim();
      const val = row.querySelector('[data-env-val]').value;
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
