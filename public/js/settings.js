const Settings = {
  async render(container) {
    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div class="card-title" data-i18n="settings.general">通用设置</div>
        </div>
        <div class="form-group">
          <label data-i18n="settings.language">语言</label>
          <select id="settingLanguage">
            <option value="zh-CN">简体中文</option>
            <option value="zh-TW">繁體中文</option>
            <option value="en">English</option>
            <option value="ja">日本語</option>
          </select>
        </div>
        <div class="form-group">
          <label data-i18n="settings.gitProvider">Git 服务商</label>
          <select id="settingGitProvider">
            <option value="github">GitHub</option>
            <option value="gitlab">GitLab</option>
          </select>
        </div>
        <button class="btn btn-primary" id="saveSettings" data-i18n="common.save">保存</button>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title" data-i18n="settings.systemInfo">系统信息</div>
        </div>
        <div id="systemInfo" class="loading"><span class="spinner"></span></div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title" data-i18n="settings.update">系统更新</div>
        </div>
        <div id="updateInfo" class="loading"><span class="spinner"></span></div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title" data-i18n="settings.account">账户管理</div>
        </div>
        <div class="form-group">
          <label data-i18n="settings.currentPassword">当前密码</label>
          <input type="password" id="settingsCurrentPwd">
        </div>
        <div class="form-group">
          <label data-i18n="settings.newPassword">新密码</label>
          <input type="password" id="settingsNewPwd">
        </div>
        <button class="btn btn-primary" id="changePwdBtn" data-i18n="user.changePassword">修改密码</button>
      </div>
    `;
    I18n.apply();

    try {
      const settings = await API.getSettings();
      document.getElementById('settingLanguage').value = settings.language || 'zh-CN';
      document.getElementById('settingGitProvider').value = settings.git_provider || 'github';
    } catch { /* ignore */ }

    document.getElementById('saveSettings').addEventListener('click', () => this.saveSettings());
    document.getElementById('changePwdBtn').addEventListener('click', () => this.changePassword());

    this.loadSystemInfo();
    this.checkUpdate();
  },

  async saveSettings() {
    try {
      await API.updateSettings({
        language: document.getElementById('settingLanguage').value,
        git_provider: document.getElementById('settingGitProvider').value
      });
      const lang = document.getElementById('settingLanguage').value;
      await I18n.setLang(lang);
      Notify.success(I18n.t('common.saved') || 'Saved');
    } catch (err) { Notify.error(err.message); }
  },

  async changePassword() {
    const current = document.getElementById('settingsCurrentPwd').value;
    const newPwd = document.getElementById('settingsNewPwd').value;
    if (!current || !newPwd) {
      Notify.error(I18n.t('settings.fillBoth') || 'Fill both fields');
      return;
    }
    try {
      const res = await API.changePassword(current, newPwd);
      API.setToken(res.token);
      Notify.success(I18n.t('settings.passwordChanged') || 'Password changed');
      document.getElementById('settingsCurrentPwd').value = '';
      document.getElementById('settingsNewPwd').value = '';
    } catch (err) { Notify.error(err.message); }
  },

  async loadSystemInfo() {
    const el = document.getElementById('systemInfo');
    try {
      const info = await API.getSystemInfo();
      el.innerHTML = `<table>
        <tr><td style="color:var(--text-muted)">Version</td><td>${info.version || '-'}</td></tr>
        <tr><td style="color:var(--text-muted)">Node.js</td><td>${info.nodeVersion || '-'}</td></tr>
        <tr><td style="color:var(--text-muted)">Platform</td><td>${info.platform || '-'}</td></tr>
        <tr><td style="color:var(--text-muted)">Uptime</td><td>${Math.floor(info.uptime / 60)} min</td></tr>
        ${info.docker ? `
        <tr><td style="color:var(--text-muted)">Docker</td><td>Connected</td></tr>
        <tr><td style="color:var(--text-muted)">Containers</td><td>${info.docker.Containers || '-'}</td></tr>
        <tr><td style="color:var(--text-muted)">Images</td><td>${info.docker.Images || '-'}</td></tr>
        ` : `<tr><td style="color:var(--text-muted)">Docker</td><td style="color:var(--warning)">Not Connected</td></tr>`}
      </table>`;
    } catch {
      el.innerHTML = `<p style="color:var(--text-muted)">Unable to load system info</p>`;
    }
  },

  async checkUpdate() {
    const el = document.getElementById('updateInfo');
    try {
      const info = await API.checkUpdate();
      if (info.available) {
        el.innerHTML = `
          <p style="color:var(--warning);margin-bottom:12px" data-i18n="update.available">发现新版本</p>
          <button class="btn btn-primary" id="applyUpdateBtn" data-i18n="update.apply">立即更新</button>
        `;
        I18n.apply();
        document.getElementById('applyUpdateBtn').addEventListener('click', () => this.applyUpdate());
      } else {
        el.innerHTML = `<p style="color:var(--success)" data-i18n="update.upToDate">已是最新版本</p>`;
        I18n.apply();
      }
    } catch {
      el.innerHTML = `<p style="color:var(--text-muted)" data-i18n="update.checkFailed">检查更新失败</p>`;
    }
  },

  async applyUpdate() {
    if (!confirm(I18n.t('update.confirmApply') || 'Confirm update? The service will restart.')) return;
    try {
      Notify.info(I18n.t('update.applying') || 'Updating...');
      const res = await API.applyUpdate();
      if (res.restarting) {
        window.location.href = '/upgrading.html';
      } else {
        Notify.success(I18n.t('update.applied') || 'Update applied');
      }
    } catch (err) { Notify.error(err.message); }
  }
};
