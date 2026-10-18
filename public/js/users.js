const Users = {
  users: [],
  projects: [],

  async render(container) {
    if (!App.currentUser || App.currentUser.role !== 'admin') {
      container.innerHTML = '<div class="empty-state"><p>只有初始管理员可以管理账号。</p></div>';
      return;
    }
    container.innerHTML = `
      <div class="page-shell list-page">
        <section class="section-card">
          <div class="section-card-header"><div><h3>账号管理</h3><p>创建共同维护者账号，并分派可维护的项目。</p></div></div>
          <form id="createMaintainerForm" class="maintainer-form">
            <div class="form-group"><label>用户名</label><input id="newMaintainerName" type="text" required minlength="3"></div>
            <div class="form-group"><label>初始密码</label><input id="newMaintainerPassword" type="password" required minlength="6"></div>
            <button class="btn btn-primary" type="submit">创建维护者</button>
          </form>
        </section>
        <section class="section-card"><div id="usersList" class="table-container"><div class="loading"><span class="spinner"></span></div></div></section>
      </div>`;
    document.getElementById('createMaintainerForm').addEventListener('submit', e => { e.preventDefault(); this.create(); });
    await this.load();
  },

  async load() {
    try {
      [this.users, this.projects] = await Promise.all([API.getUsers(), API.getProjects()]);
      this.renderList();
    } catch (err) { App.showApiError(err, '加载账号失败'); }
  },

  renderList() {
    const maintainers = this.users.filter(user => user.role === 'maintainer');
    const el = document.getElementById('usersList');
    if (!maintainers.length) { el.innerHTML = '<div class="empty-state"><p>暂无共同维护者账号。</p></div>'; return; }
    el.innerHTML = `<table><thead><tr><th>用户名</th><th>分派项目</th><th>创建时间</th><th>操作</th></tr></thead><tbody>${maintainers.map(user => `
      <tr><td>${esc(user.username)}</td><td>${esc((user.project_ids || []).map(id => (this.projects.find(p => p.id === id) || {}).name || `#${id}`).join('、') || '未分派')}</td>
      <td>${esc(user.created_at || '')}</td><td><button class="btn btn-sm" onclick="Users.assign(${user.id})">分派项目</button> <button class="btn btn-sm btn-danger" onclick="Users.remove(${user.id})">删除</button></td></tr>`).join('')}</tbody></table>`;
  },

  async create() {
    try {
      await API.createUser({ username: document.getElementById('newMaintainerName').value.trim(), password: document.getElementById('newMaintainerPassword').value });
      Notify.success('维护者账号已创建');
      document.getElementById('createMaintainerForm').reset();
      await this.load();
    } catch (err) { Notify.error(err.message); }
  },

  async assign(id) {
    const user = this.users.find(item => item.id === id);
    const selected = new Set(user.project_ids || []);
    const content = `<p class="modal-desc">勾选该维护者可以检查更新、部署、重构、停止和查看详情的项目。</p><div class="form-group">${this.projects.map(project => `<label class="option-card"><input type="checkbox" value="${project.id}" ${selected.has(project.id) ? 'checked' : ''}><span>${esc(project.name)}</span></label>`).join('') || '<p>暂无项目</p>'}</div>`;
    Modal.show(`分派项目：${user.username}`, content, [
      { label: '取消', class: 'btn-secondary' },
      { label: '保存', class: 'btn-primary', onClick: async () => {
        const ids = [...document.querySelectorAll('#modalContainer input[type="checkbox"]:checked')].map(input => Number(input.value));
        try { await API.updateUserProjects(id, ids); Notify.success('项目分派已保存'); await this.load(); } catch (err) { Notify.error(err.message); }
      } }
    ]);
  },

  async remove(id) {
    if (!confirm('确定删除这个维护者账号吗？')) return;
    try { await API.deleteUser(id); Notify.success('账号已删除'); await this.load(); } catch (err) { Notify.error(err.message); }
  }
};
