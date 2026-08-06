const Tokens = {
  async render(container) {
    container.innerHTML = `
      <div class="card-header" style="margin-bottom:16px">
        <div class="card-title" data-i18n="tokens.list">Git 令牌列表</div>
        <button class="btn btn-primary btn-sm" id="addTokenBtn" data-i18n="tokens.add">添加令牌</button>
      </div>
      <div id="tokensList" class="table-container"></div>
    `;
    I18n.apply();
    document.getElementById('addTokenBtn').addEventListener('click', () => this.showAddForm());
    await this.loadList();
  },

  async loadList() {
    try {
      const tokens = await API.getTokens();
      const el = document.getElementById('tokensList');

      if (tokens.length === 0) {
        el.innerHTML = `<div class="empty-state">
          <div class="empty-icon">&#9919;</div>
          <p data-i18n="tokens.noTokens">暂无 Git 令牌，点击上方按钮添加</p>
        </div>`;
        I18n.apply();
        return;
      }

      el.innerHTML = `<table>
        <thead><tr>
          <th data-i18n="tokens.name">名称</th>
          <th data-i18n="tokens.provider">服务商</th>
          <th data-i18n="tokens.host">主机</th>
          <th data-i18n="tokens.createdAt">创建时间</th>
          <th data-i18n="tokens.actions">操作</th>
        </tr></thead>
        <tbody>${tokens.map(t => `
          <tr>
            <td>${esc(t.name)}</td>
            <td>${esc(t.provider === 'github' ? 'GitHub' : t.provider === 'gitlab' ? 'GitLab' : t.provider)}</td>
            <td><small>${esc(t.host || '-')}</small></td>
            <td><small>${t.created_at || '-'}</small></td>
            <td class="action-cell">${App.actionMenu([
              { label: I18n.t('tokens.edit') || '编辑', icon: '✎', onclick: `Tokens.showEditForm(${t.id})` },
              { label: I18n.t('tokens.delete') || '删除', icon: '×', danger: true, onclick: `Tokens.remove(${t.id})` }
            ])}</td>
          </tr>
        `).join('')}</tbody>
      </table>`;
      I18n.apply();
    } catch (err) {
      Notify.error(err.message);
    }
  },

  showAddForm() {
    const content = `
      <div class="form-group">
        <label data-i18n="tokens.name">名称</label>
        <input type="text" id="tokenName" placeholder="My GitHub Token" required>
      </div>
      <div class="form-group">
        <label data-i18n="tokens.provider">服务商</label>
        <select id="tokenProvider">
          <option value="github">GitHub</option>
          <option value="gitlab">GitLab</option>
        </select>
      </div>
      <div class="form-group" id="tokenHostGroup" style="display:none">
        <label data-i18n="tokens.host">GitLab 主机</label>
        <input type="text" id="tokenHost" placeholder="gitlab.example.com">
      </div>
      <div class="form-group">
        <label data-i18n="tokens.token">令牌</label>
        <input type="password" id="tokenValue" placeholder="ghp_xxxx / glpat-xxxx" required>
      </div>
    `;
    Modal.show(I18n.t('tokens.add') || '添加令牌', content, [
      { label: I18n.t('common.cancel') || '取消', class: 'btn-secondary' },
      { label: I18n.t('common.create') || '创建', class: 'btn-primary', onClick: () => this.createToken() }
    ]);
    I18n.apply();

    document.getElementById('tokenProvider').addEventListener('change', (e) => {
      document.getElementById('tokenHostGroup').style.display = e.target.value === 'gitlab' ? 'block' : 'none';
    });
  },

  async showEditForm(id) {
    try {
      const token = await API.getToken(id);
      const content = `
        <div class="form-group">
          <label data-i18n="tokens.name">名称</label>
          <input type="text" id="editTokenName" value="${esc(token.name)}" required>
        </div>
        <div class="form-group">
          <label data-i18n="tokens.provider">服务商</label>
          <select id="editTokenProvider">
            <option value="github" ${token.provider === 'github' ? 'selected' : ''}>GitHub</option>
            <option value="gitlab" ${token.provider === 'gitlab' ? 'selected' : ''}>GitLab</option>
          </select>
        </div>
        <div class="form-group" id="editTokenHostGroup" style="display:${token.provider === 'gitlab' ? 'block' : 'none'}">
          <label data-i18n="tokens.host">GitLab 主机</label>
          <input type="text" id="editTokenHost" value="${esc(token.host)}" placeholder="gitlab.example.com">
        </div>
        <div class="form-group">
          <label data-i18n="tokens.token">令牌</label>
          <input type="password" id="editTokenValue" placeholder="${I18n.t('tokens.leaveEmpty') || '留空则不修改'}">
        </div>
      `;
      Modal.show(I18n.t('tokens.edit') || '编辑令牌', content, [
        { label: I18n.t('common.cancel') || '取消', class: 'btn-secondary' },
        { label: I18n.t('common.save') || '保存', class: 'btn-primary', onClick: () => this.saveToken(id) }
      ]);
      I18n.apply();

      document.getElementById('editTokenProvider').addEventListener('change', (e) => {
        document.getElementById('editTokenHostGroup').style.display = e.target.value === 'gitlab' ? 'block' : 'none';
      });
    } catch (err) {
      Notify.error(err.message);
    }
  },

  async createToken() {
    const name = document.getElementById('tokenName').value;
    const provider = document.getElementById('tokenProvider').value;
    const host = document.getElementById('tokenHost')?.value || '';
    const token = document.getElementById('tokenValue').value;

    if (!name || !token) {
      Notify.error(I18n.t('tokens.nameAndTokenRequired') || '名称和令牌为必填项');
      return;
    }

    try {
      await API.createToken({ name, provider, host, token });
      Notify.success(I18n.t('tokens.created') || '令牌已添加');
      this.loadList();
    } catch (err) {
      Notify.error(err.message);
    }
  },

  async saveToken(id) {
    const name = document.getElementById('editTokenName').value;
    const provider = document.getElementById('editTokenProvider').value;
    const host = document.getElementById('editTokenHost')?.value || '';
    const token = document.getElementById('editTokenValue').value;

    if (!name) {
      Notify.error(I18n.t('tokens.nameRequired') || '名称为必填项');
      return;
    }

    try {
      const data = { name, provider, host };
      if (token) data.token = token;
      await API.updateToken(id, data);
      Notify.success(I18n.t('common.saved') || '已保存');
      this.loadList();
    } catch (err) {
      Notify.error(err.message);
    }
  },

  async remove(id) {
    if (!confirm(I18n.t('tokens.confirmDelete') || '确定删除此令牌？')) return;
    try {
      await API.deleteToken(id);
      Notify.success(I18n.t('tokens.deleted') || '令牌已删除');
      this.loadList();
    } catch (err) {
      Notify.error(err.message);
    }
  }
};
