const Containers = {
  refreshTimer: null,

  async render(container) {
    container.innerHTML = `
      <div class="card-header" style="margin-bottom:16px">
        <div class="card-title" data-i18n="container.list">容器列表</div>
        <div>
          <button class="btn btn-sm" id="refreshContainers" data-i18n="common.refresh">刷新</button>
        </div>
      </div>
      <div id="containersList" class="table-container"></div>
    `;
    I18n.apply();

    document.getElementById('refreshContainers').addEventListener('click', () => this.loadList());

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.status-dropdown')) this.closeAllMenus();
    });

    await this.loadList();
    this.refreshTimer = setInterval(() => this.loadList(), 30000);
  },

  destroy() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  },

  async loadList() {
    try {
      const [containers, projects] = await Promise.all([API.getContainers(true), API.getProjects().catch(() => [])]);
      const projectByName = new Map(projects.map(project => [project.name, project]));
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
          <th>项目</th>
          <th data-i18n="container.image">镜像</th>
          <th data-i18n="container.status">状态</th>
          <th data-i18n="container.ports">端口</th>
          <th data-i18n="container.mounts">挂载</th>
          <th data-i18n="container.actions">操作</th>
        </tr></thead>
        <tbody>${containers.map(c => {
          const ports = (c.Ports || []).map(p => p.PublicPort ? `${p.PublicPort}:${p.PrivatePort}` : '').filter(Boolean).join(', ');
          const mountCount = (c.Mounts || []).length;
          const state = c.State || 'unknown';
          const badgeClass = state === 'running' ? 'running' : state === 'paused' ? 'paused' : 'stopped';
          const composeProject = c.Labels && c.Labels['com.docker.compose.project'];
          const project = composeProject ? projectByName.get(composeProject) : null;
          return `
          <tr>
            <td>${esc((c.Names && c.Names[0]) || '-').replace(/^\//, '')}</td>
            <td>${project ? `<a href="#" onclick="Projects.showDetail(${project.id});return false">${esc(project.name)}</a>` : `<span class="text-muted">${esc(composeProject || '独立容器')}</span>`}</td>
            <td><small>${esc(c.Image || '-')}</small></td>
            <td><span class="badge badge-${badgeClass}"><span class="status-dot dot-${badgeClass}"></span>${esc(state)}</span></td>
            <td><small>${ports || '-'}</small></td>
            <td>${mountCount > 0 ? `<span class="badge badge-ready">${mountCount}</span>` : '-'}</td>
            <td class="action-cell">${App.actionMenu([
              { label: I18n.t('container.start') || '启动', icon: '▶', visible: state !== 'running' && state !== 'paused', onclick: `Containers.start('${c.Id}')` },
              { label: I18n.t('container.stop') || '停止', icon: '■', visible: state === 'running' || state === 'paused', onclick: `Containers.stop('${c.Id}')` },
              { label: I18n.t('container.forceStop') || '强制停止', icon: '■', danger: true, visible: state === 'running' || state === 'paused', onclick: `Containers.forceStop('${c.Id}')` },
              { label: I18n.t('container.restart') || '重启', icon: '↻', visible: state === 'running', onclick: `Containers.restart('${c.Id}')` },
              { label: I18n.t('container.pause') || '暂停', icon: 'Ⅱ', visible: state === 'running', onclick: `Containers.pause('${c.Id}')` },
              { label: I18n.t('container.unpause') || '恢复', icon: '▶', visible: state === 'paused', onclick: `Containers.unpause('${c.Id}')` },
              { label: I18n.t('container.logs') || '日志', icon: '≡', onclick: `Containers.showLogs('${c.Id}')` },
              { label: I18n.t('container.terminal') || '终端', icon: '>_', onclick: `Containers.showTerminal('${c.Id}')` },
              { label: I18n.t('container.files') || '文件', icon: '□', onclick: `Containers.showFileManager('${c.Id}')` },
              { label: I18n.t('container.mounts') || '挂载', icon: '◇', onclick: `Containers.showMounts('${c.Id}')` },
              { label: I18n.t('container.remove') || '删除', icon: '×', danger: true, onclick: `Containers.remove('${c.Id}')` }
            ])}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>`;
      I18n.apply();
    } catch (err) {
      Notify.error(err.message);
    }
  },

  async start(id) {
    this.closeAllMenus();
    try { await API.startContainer(id); Notify.success(I18n.t('container.started') || 'Container started'); this.loadList(); } catch (err) { Notify.error(err.message); }
  },
  async stop(id) {
    this.closeAllMenus();
    try { await API.stopContainer(id); Notify.success(I18n.t('container.stopped') || 'Container stopped'); this.loadList(); } catch (err) { Notify.error(err.message); }
  },
  async forceStop(id) {
    this.closeAllMenus();
    try { await API.killContainer(id); Notify.success(I18n.t('container.forceStopped') || 'Container force stopped'); this.loadList(); } catch (err) { Notify.error(err.message); }
  },
  async restart(id) {
    this.closeAllMenus();
    try { await API.restartContainer(id); Notify.success(I18n.t('container.restarted') || 'Container restarted'); this.loadList(); } catch (err) { Notify.error(err.message); }
  },
  async pause(id) {
    this.closeAllMenus();
    try { await API.pauseContainer(id); Notify.success(I18n.t('container.paused') || 'Container paused'); this.loadList(); } catch (err) { Notify.error(err.message); }
  },
  async unpause(id) {
    this.closeAllMenus();
    try { await API.unpauseContainer(id); Notify.success(I18n.t('container.resumed') || 'Container resumed'); this.loadList(); } catch (err) { Notify.error(err.message); }
  },
  async remove(id) {
    let info = null;
    try {
      info = await API.getContainer(id);
    } catch (err) {
      Notify.error(err.message);
      return;
    }

    const name = (info.Name || '').replace(/^\//, '') || id.substring(0, 12);
    const image = info.Config?.Image || '-';
    const allMounts = info.Mounts || [];
    const mountSummary = allMounts.map(m => {
      const label = m.Type === 'volume' ? (m.Name || '<anonymous>') : m.Source;
      return `${label} → ${m.Destination}`;
    });

    const content = `
      <div class="rm-info">
        <div class="rm-row"><span class="rm-label">${I18n.t('container.name') || '名称'}</span><span class="rm-value">${esc(name)}</span></div>
        <div class="rm-row"><span class="rm-label">${I18n.t('container.image') || '镜像'}</span><span class="rm-value"><small>${esc(image)}</small></span></div>
        ${mountSummary.length ? `<div class="rm-row"><span class="rm-label">${I18n.t('container.mounts') || '挂载'}</span><span class="rm-value"><small>${mountSummary.map(esc).join('<br>')}</small></span></div>` : ''}
      </div>
      <div class="rm-options">
        <label class="rm-check">
          <input type="checkbox" id="rmVolumes">
          <span>${I18n.t('container.removeVolumes') || '同时删除挂载卷（数据将永久丢失）'}</span>
        </label>
        <label class="rm-check">
          <input type="checkbox" id="rmImage">
          <span>${I18n.t('container.removeImage') || '同时删除镜像（其他容器仍在使用时跳过）'}</span>
        </label>
      </div>
      <p class="rm-warn">${I18n.t('container.removeWarn') || '此操作不可撤销。'}</p>
    `;

    Modal.show(I18n.t('container.confirmRemoveTitle') || '删除容器', content, [
      { label: I18n.t('common.cancel') || '取消', class: 'btn-secondary' },
      {
        label: I18n.t('common.confirm') || '确定',
        class: 'btn-danger',
        onClick: async () => {
          const removeVolumes = document.getElementById('rmVolumes')?.checked || false;
          const removeImage = document.getElementById('rmImage')?.checked || false;
          try {
            await API.removeContainer(id, { force: true, removeVolumes, removeImage });
            Notify.success(I18n.t('container.removed') || 'Container removed');
            this.loadList();
          } catch (err) {
            Notify.error(err.message);
          }
        }
      }
    ]);
  },

  toggleMenu(id) {
    const menu = document.getElementById(`menu-${id}`);
    if (!menu) return;
    const isOpen = menu.classList.contains('open');
    this.closeAllMenus();
    if (!isOpen) menu.classList.add('open');
  },

  closeAllMenus() {
    document.querySelectorAll('.status-menu.open').forEach(m => m.classList.remove('open'));
  },

  async showLogs(id) {
    try {
      const data = await API.getContainerLogs(id, 200);
      Modal.show(I18n.t('container.logs') || 'Logs', `<div class="log-viewer" style="max-height:500px">${esc(data.logs || '')}</div>`, [
        { label: I18n.t('common.close') || 'Close', class: 'btn-secondary' }
      ]);
    } catch (err) { Notify.error(err.message); }
  },

  // ===== Terminal =====
  showTerminal(id) {
    const content = `
      <div class="term-bar">
        <span id="termCwd">/</span>
      </div>
      <div class="term-output" id="termOutput"></div>
      <div class="term-input-row">
        <span class="term-prompt">$</span>
        <input type="text" id="termInput" class="term-input" placeholder="Enter command..." autofocus>
        <button class="btn btn-sm" id="termRun" data-i18n="container.run">执行</button>
      </div>
    `;
    Modal.show(I18n.t('container.terminal') || 'Terminal', content, [
      { label: I18n.t('common.close') || 'Close', class: 'btn-secondary' }
    ]);
    I18n.apply();

    const input = document.getElementById('termInput');
    const runBtn = document.getElementById('termRun');
    const output = document.getElementById('termOutput');
    let cwd = '/';

    async function runCmd() {
      const cmd = input.value.trim();
      if (!cmd) return;
      input.value = '';
      output.textContent += `$ ${cmd}\n`;

      try {
        // Handle cd internally
        if (cmd.startsWith('cd ')) {
          const target = cmd.substring(3).trim();
          if (target === '/') cwd = '/';
          else if (target === '..') cwd = cwd.split('/').slice(0, -1).join('/') || '/';
          else if (target.startsWith('/')) cwd = target;
          else cwd = cwd === '/' ? `/${target}` : `${cwd}/${target}`;
          document.getElementById('termCwd').textContent = cwd;
          output.textContent += `\n`;
          return;
        }

        const fullCmd = `cd "${cwd}" && ${cmd}`;
        const res = await API.execInContainer(id, fullCmd);
        output.textContent += (res.output || '') + '\n';
      } catch (err) {
        output.textContent += `Error: ${err.message}\n`;
      }
      output.scrollTop = output.scrollHeight;
    }

    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') runCmd(); });
    runBtn.addEventListener('click', runCmd);
    setTimeout(() => input.focus(), 100);
  },

  // ===== File Manager =====
  fileContainerId: null,
  filePath: '/',

  async showFileManager(id) {
    this.fileContainerId = id;
    this.filePath = '/';
    await this.loadFileList(id, '/');
  },

  async loadFileList(id, dirPath) {
    this.filePath = dirPath;
    try {
      const data = await API.getContainerFiles(id, dirPath);
      const parentPath = dirPath === '/' ? '/' : dirPath.split('/').slice(0, -1).join('/') || '/';

      let html = `<div class="fm-breadcrumb">${esc(dirPath)}</div>`;
      html += `<div class="fm-actions">
        <button class="btn btn-sm" onclick="Containers.navFile('${id}','${esc(parentPath)}')" data-i18n="container.upDir">上级</button>
        <button class="btn btn-sm" onclick="Containers.refreshFiles('${id}')" data-i18n="common.refresh">刷新</button>
        <button class="btn btn-sm" onclick="Containers.uploadFile('${id}')" data-i18n="container.upload">上传</button>
        <button class="btn btn-sm" onclick="Containers.newFile('${id}')" data-i18n="container.newFile">新建</button>
      </div>`;
      html += '<div class="fm-list">';

      if (dirPath !== '/') {
        html += `<div class="fm-row fm-dir" onclick="Containers.navFile('${id}','${esc(parentPath)}')">📁 ..</div>`;
      }

      for (const f of (data.files || [])) {
        if (f.isDirectory) {
          html += `<div class="fm-row fm-dir" onclick="Containers.navFile('${id}','${esc(f.path)}')">📁 ${esc(f.name)}</div>`;
        } else {
          html += `<div class="fm-row fm-file" onclick="Containers.openFile('${id}','${esc(f.path)}')">📄 ${esc(f.name)} <span class="fm-size">${formatFileSize(f.size)}</span></div>`;
        }
      }

      html += '</div>';
      Modal.show(I18n.t('container.files') || 'Files', html, [
        { label: I18n.t('common.close') || 'Close', class: 'btn-secondary' }
      ]);
      I18n.apply();
    } catch (err) {
      Notify.error(err.message);
    }
  },

  navFile(id, path) { this.loadFileList(id, path); },
  refreshFiles(id) { this.loadFileList(id, this.filePath); },

  async openFile(id, filePath) {
    try {
      const data = await API.getContainerFile(id, filePath);
      const isBinary = /[\x00-\x08\x0E-\x1F]/.test(data.content.substring(0, 1024));

      if (isBinary) {
        Modal.show(path.basename(filePath), `
          <p style="color:var(--text-muted);margin-bottom:12px" data-i18n="container.binaryFile">二进制文件，无法编辑</p>
          <div class="fm-actions">
            <button class="btn btn-sm" onclick="Containers.downloadFile('${id}','${esc(filePath)}')" data-i18n="container.download">下载</button>
          </div>
        `, [{ label: I18n.t('common.close') || 'Close', class: 'btn-secondary' }]);
        I18n.apply();
        return;
      }

      Modal.show(path.basename(filePath), `
        <textarea class="note-editor" id="fileContent" rows="16">${esc(data.content)}</textarea>
        <div class="fm-actions" style="margin-top:8px">
          <button class="btn btn-sm btn-primary" id="saveFileBtn" data-i18n="common.save">保存</button>
          <button class="btn btn-sm" onclick="Containers.downloadFile('${id}','${esc(filePath)}')" data-i18n="container.download">下载</button>
          <button class="btn btn-sm btn-danger" onclick="Containers.deleteFile('${id}','${esc(filePath)}')" data-i18n="container.deleteFile">删除</button>
        </div>
      `, [{ label: I18n.t('common.close') || 'Close', class: 'btn-secondary' }]);
      I18n.apply();

      document.getElementById('saveFileBtn').addEventListener('click', async () => {
        try {
          const content = document.getElementById('fileContent').value;
          await API.saveContainerFile(id, filePath, content);
          Notify.success(I18n.t('common.saved') || 'Saved');
        } catch (err) { Notify.error(err.message); }
      });
    } catch (err) { Notify.error(err.message); }
  },

  async downloadFile(id, filePath) {
    try {
      window.open(`/api/containers/${id}/download?path=${encodeURIComponent(filePath)}`, '_blank');
    } catch (err) { Notify.error(err.message); }
  },

  async deleteFile(id, filePath) {
    if (!confirm(I18n.t('container.confirmDeleteFile') || 'Confirm delete? This cannot be undone!')) return;
    try {
      await API.deleteContainerFile(id, filePath);
      Notify.success(I18n.t('container.fileDeleted') || 'File deleted');
      this.refreshFiles(id);
    } catch (err) { Notify.error(err.message); }
  },

  uploadFile(id) {
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const reader = new FileReader();
        reader.onload = async (ev) => {
          const b64 = btoa(new Uint8Array(ev.target.result).reduce((s, b) => s + String.fromCharCode(b), ''));
          const destPath = this.filePath === '/' ? `/${file.name}` : `${this.filePath}/${file.name}`;
          await API.uploadToContainer(id, destPath, b64);
          Notify.success(I18n.t('container.uploaded') || 'File uploaded');
          this.refreshFiles(id);
        };
        reader.readAsArrayBuffer(file);
      } catch (err) { Notify.error(err.message); }
    };
    input.click();
  },

  async newFile(id) {
    const name = prompt(I18n.t('container.newFileName') || 'File name:');
    if (!name) return;
    try {
      const filePath = this.filePath === '/' ? `/${name}` : `${this.filePath}/${name}`;
      await API.saveContainerFile(id, filePath, '');
      Notify.success(I18n.t('container.fileCreated') || 'File created');
      this.refreshFiles(id);
    } catch (err) { Notify.error(err.message); }
  },

  // ===== Mounts =====
  async showMounts(id) {
    try {
      const data = await API.getContainerMounts(id);
      const mounts = data.mounts || [];

      let html = '';
      if (mounts.length === 0) {
        html = `<p style="color:var(--text-muted)" data-i18n="container.noMounts">暂无挂载</p>`;
      } else {
        html = `<table>
          <thead><tr>
            <th data-i18n="container.mountType">类型</th>
            <th data-i18n="container.hostPath">主机路径</th>
            <th data-i18n="container.containerPath">容器路径</th>
            <th data-i18n="container.access">权限</th>
            <th></th>
          </tr></thead>
          <tbody>${mounts.map(m => `
            <tr>
              <td><span class="badge badge-${m.type === 'volume' ? 'ready' : 'running'}">${esc(m.type)}</span></td>
              <td class="fm-path">${esc(m.source)}</td>
              <td class="fm-path">${esc(m.destination)}</td>
              <td>${m.rw ? 'RW' : 'RO'}</td>
              <td><button class="btn btn-sm" onclick="Containers.browseHost('${esc(m.source)}')" data-i18n="container.browse">浏览</button></td>
            </tr>
          `).join('')}</tbody>
        </table>`;
      }

      Modal.show(I18n.t('container.mounts') || 'Mounts', html, [
        { label: I18n.t('common.close') || 'Close', class: 'btn-secondary' }
      ]);
      I18n.apply();
    } catch (err) { Notify.error(err.message); }
  },

  async browseHost(dirPath) {
    try {
      const data = await API.browseHost(dirPath);
      let html = `<div class="fm-breadcrumb">${esc(dirPath)}</div>`;
      html += '<div class="fm-list">';
      if (dirPath !== '/') {
        const parent = dirPath.split('/').slice(0, -1).join('/') || '/';
        html += `<div class="fm-row fm-dir" onclick="Containers.browseHost('${esc(parent)}')">📁 ..</div>`;
      }
      for (const f of (data.files || [])) {
        if (f.isDirectory) {
          html += `<div class="fm-row fm-dir" onclick="Containers.browseHost('${esc(data.path === '/' ? '/' + f.name : data.path + '/' + f.name)}')">📁 ${esc(f.name)}</div>`;
        } else {
          html += `<div class="fm-row fm-file">📄 ${esc(f.name)}</div>`;
        }
      }
      html += '</div>';

      Modal.show(I18n.t('container.hostBrowse') || 'Host Browser', html, [
        { label: I18n.t('common.close') || 'Close', class: 'btn-secondary' }
      ]);
    } catch (err) { Notify.error(err.message); }
  }
};

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
  return (bytes / 1073741824).toFixed(1) + ' GB';
}
