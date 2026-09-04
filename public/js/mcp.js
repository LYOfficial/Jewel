const Mcp = {
  accessKey: '',
  accessKeyVisible: false,

  async render(container) {
    container.innerHTML = `
      <div class="page-shell list-page">
        <div class="workspace-hero">
          <div>
            <div class="workspace-eyebrow">MCP</div>
            <h2 data-i18n="mcp.title">MCP 服务</h2>
            <p data-i18n="mcp.workspaceHint">让支持 MCP 的客户端在受限范围内检查、部署和维护 Jewel 项目。</p>
          </div>
        </div>
        <div class="settings-grid">
          <section class="card">
            <div class="card-header"><div class="card-title" data-i18n="mcp.connection">连接信息</div></div>
            <div class="form-group">
              <label data-i18n="mcp.endpoint">MCP 地址</label>
              <div style="display:flex;gap:8px">
                <input id="mcpEndpoint" type="text" readonly>
                <button class="btn btn-secondary" id="copyMcpEndpoint" type="button" data-i18n="mcp.copy">复制</button>
              </div>
            </div>
            <div class="form-group">
              <label data-i18n="mcp.accessKey">平台 Access Key</label>
              <div style="display:flex;gap:8px">
                <input id="mcpAccessKey" readonly type="password">
                <button class="btn btn-secondary" id="toggleMcpAccessKey" type="button" data-i18n="mcp.show">显示</button>
                <button class="btn btn-secondary" id="copyMcpAccessKey" type="button" data-i18n="mcp.copy">复制</button>
              </div>
              <span class="form-hint" data-i18n="mcp.headersHint">客户端必须同时发送 X-Jewel-Access-Key 和 Authorization: Bearer &lt;token&gt;。</span>
            </div>
          </section>
          <section class="card">
            <div class="card-header">
              <div class="card-title" data-i18n="mcp.security">权限范围</div>
            </div>
            <p class="form-hint" style="margin-top:0" data-i18n="mcp.scope">MCP 仅能读取项目与日志，并执行部署、更新、重构、重启和 Jewel 更新；项目、容器、镜像、卷的删除及任意命令执行均不会开放。</p>
          </section>
        </div>
        <section class="card" style="margin-top:16px">
          <div class="card-header">
            <div class="card-title" data-i18n="mcp.tokens">MCP Token</div>
            <button class="btn btn-primary" id="createMcpToken" type="button" data-i18n="mcp.createToken">创建 Token</button>
          </div>
          <div class="table-container" id="mcpTokensTable"><div class="loading"><span class="spinner"></span></div></div>
        </section>
        <section class="card" style="margin-top:16px">
          <div class="card-header">
            <div class="card-title" data-i18n="mcp.audit">Token 操作记录</div>
            <button class="btn btn-secondary" id="refreshMcpAudit" type="button" data-i18n="common.refresh">刷新</button>
          </div>
          <div class="table-container" id="mcpAuditTable"><div class="loading"><span class="spinner"></span></div></div>
        </section>
      </div>`;
    I18n.apply();
    document.getElementById('mcpEndpoint').value = `${window.location.origin}/mcp`;
    document.getElementById('copyMcpEndpoint').addEventListener('click', () => App.copyText(
      document.getElementById('mcpEndpoint').value,
      I18n.t('mcp.copied') || 'Copied'
    ));
    document.getElementById('toggleMcpAccessKey').addEventListener('click', () => this.toggleAccessKey());
    document.getElementById('copyMcpAccessKey').addEventListener('click', () => App.copyText(
      this.accessKey,
      I18n.t('mcp.copied') || 'Copied'
    ));
    document.getElementById('createMcpToken').addEventListener('click', () => this.showCreateToken());
    document.getElementById('refreshMcpAudit').addEventListener('click', () => this.loadAudit());
    await Promise.all([this.loadConfig(), this.loadTokens(), this.loadAudit()]);
  },

  async loadConfig() {
    try {
      const config = await API.getMcpConfig();
      this.accessKey = config.access_key || '';
      this.syncAccessKey();
    } catch (err) { Notify.error(err.message); }
  },

  syncAccessKey() {
    const input = document.getElementById('mcpAccessKey');
    const toggle = document.getElementById('toggleMcpAccessKey');
    if (!input || !toggle) return;
    input.value = this.accessKey;
    input.type = this.accessKeyVisible ? 'text' : 'password';
    toggle.textContent = I18n.t(this.accessKeyVisible ? 'mcp.hide' : 'mcp.show');
  },

  toggleAccessKey() {
    this.accessKeyVisible = !this.accessKeyVisible;
    this.syncAccessKey();
  },

  async loadTokens() {
    const table = document.getElementById('mcpTokensTable');
    if (!table) return;
    try {
      const tokens = await API.getMcpTokens();
      if (!tokens.length) {
        table.innerHTML = `<div class="empty-state compact"><p data-i18n="mcp.noTokens">还没有 MCP Token。</p></div>`;
        I18n.apply();
        return;
      }
      table.innerHTML = `
        <table><thead><tr>
          <th data-i18n="mcp.tokenName">名称</th><th data-i18n="mcp.tokenPrefix">前缀</th>
          <th data-i18n="mcp.expiresAt">到期时间</th><th data-i18n="mcp.lastUsed">最后使用</th>
          <th data-i18n="mcp.status">状态</th><th data-i18n="tokens.actions">操作</th>
        </tr></thead><tbody>${tokens.map(token => `<tr>
          <td>${App.escapeHtml(token.name)}</td><td><code>${App.escapeHtml(token.token_prefix)}…</code></td>
          <td>${this.formatDate(token.expires_at, 'mcp.never')}</td><td>${this.formatDate(token.last_used_at, 'mcp.never')}</td>
          <td>${this.statusLabel(token.status)}</td>
          <td>${token.status === 'active' ? `<button class="btn btn-danger" data-revoke-mcp-token="${token.id}" type="button" data-i18n="mcp.revoke">撤销</button>` : '-'}</td>
        </tr>`).join('')}</tbody></table>`;
      I18n.apply();
      table.querySelectorAll('[data-revoke-mcp-token]').forEach(button => {
        button.addEventListener('click', () => this.revokeToken(Number(button.dataset.revokeMcpToken)));
      });
    } catch (err) { table.innerHTML = `<div class="empty-state compact"><p>${App.escapeHtml(err.message)}</p></div>`; }
  },

  async loadAudit() {
    const table = document.getElementById('mcpAuditTable');
    if (!table) return;
    try {
      const rows = await API.getMcpAuditLogs();
      if (!rows.length) {
        table.innerHTML = `<div class="empty-state compact"><p data-i18n="mcp.noAudit">还没有操作记录。</p></div>`;
        I18n.apply();
        return;
      }
      table.innerHTML = `
        <table><thead><tr>
          <th data-i18n="mcp.time">时间</th><th data-i18n="mcp.token">Token</th>
          <th data-i18n="mcp.event">事件</th><th data-i18n="mcp.tool">工具</th>
          <th data-i18n="mcp.detail">详情</th><th data-i18n="mcp.result">结果</th><th data-i18n="mcp.address">来源</th>
        </tr></thead><tbody>${rows.map(row => `<tr>
          <td>${this.formatDate(row.created_at)}</td>
          <td>${App.escapeHtml(row.token_name || row.token_prefix || '-')}</td>
          <td>${App.escapeHtml(row.event)}</td><td>${App.escapeHtml(row.tool_name || '-')}</td>
          <td>${App.escapeHtml(row.detail || '-')}</td>
          <td>${row.success ? this.statusLabel('active') : this.statusLabel('revoked')}</td>
          <td>${App.escapeHtml(row.client_address || '-')}</td>
        </tr>`).join('')}</tbody></table>`;
      I18n.apply();
    } catch (err) { table.innerHTML = `<div class="empty-state compact"><p>${App.escapeHtml(err.message)}</p></div>`; }
  },

  showCreateToken() {
    const content = `
      <div class="form-group"><label data-i18n="mcp.tokenName">名称</label><input id="newMcpTokenName" type="text" maxlength="100" placeholder="ChatGPT maintenance"></div>
      <div class="form-group"><label data-i18n="mcp.duration">有效时长（小时）</label><input id="newMcpTokenDuration" type="number" min="0" max="87600" step="1" value="720"><span class="form-hint" data-i18n="mcp.durationHint">填 0 表示永不过期；建议为不同客户端创建独立、有限期 Token。</span></div>`;
    Modal.show(I18n.t('mcp.createToken') || 'Create token', content, [
      { label: I18n.t('common.cancel') || 'Cancel', class: 'btn-secondary' },
      { label: I18n.t('common.create') || 'Create', class: 'btn-primary', onClick: () => this.createToken() }
    ]);
    I18n.apply();
  },

  async createToken() {
    const name = document.getElementById('newMcpTokenName').value.trim();
    const duration = document.getElementById('newMcpTokenDuration').value;
    if (!name) { Notify.error(I18n.t('mcp.nameRequired') || 'A name is required'); return; }
    try {
      const result = await API.createMcpToken({ name, expires_in_hours: duration });
      Modal.show(I18n.t('mcp.tokenCreated') || 'Token created', `
        <p data-i18n="mcp.saveTokenWarning">请立即复制此 Token。关闭后无法再次查看完整内容。</p>
        <div class="form-group"><input id="createdMcpToken" type="text" readonly value="${App.escapeHtml(result.value)}"></div>`, [
        { label: I18n.t('common.close') || 'Close', class: 'btn-secondary' },
        { label: I18n.t('mcp.copy') || 'Copy', class: 'btn-primary', onClick: () => App.copyText(result.value, I18n.t('mcp.copied') || 'Copied') }
      ]);
      I18n.apply();
      this.loadTokens();
      this.loadAudit();
    } catch (err) { Notify.error(err.message); }
  },

  async revokeToken(id) {
    if (!confirm(I18n.t('mcp.confirmRevoke') || 'Revoke this MCP token?')) return;
    try {
      await API.revokeMcpToken(id);
      Notify.success(I18n.t('mcp.revoked') || 'Token revoked');
      await Promise.all([this.loadTokens(), this.loadAudit()]);
    } catch (err) { Notify.error(err.message); }
  },

  formatDate(value, emptyKey = null) {
    if (!value) return emptyKey ? I18n.t(emptyKey) : '-';
    try {
      const timezone = localStorage.getItem('jewel-timezone') || 'Asia/Shanghai';
      return new Date(value).toLocaleString('zh-CN', { timeZone: timezone, hour12: false });
    } catch { return value; }
  },

  statusLabel(status) {
    const key = status === 'active' ? 'mcp.active' : status === 'expired' ? 'mcp.expired' : 'mcp.revoked';
    return App.escapeHtml(I18n.t(key));
  }
};
