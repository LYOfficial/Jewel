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
          <button class="btn btn-sm" id="refreshUpdateBtn" data-i18n="common.refresh">刷新</button>
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
    document.getElementById('refreshUpdateBtn').addEventListener('click', () => this.checkUpdate(true));

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

  async checkUpdate(force = false) {
    const el = document.getElementById('updateInfo');
    el.innerHTML = '<span class="spinner"></span>';

    try {
      const info = force ? await API.forceCheckUpdate() : await API.checkUpdate();

      const curCommitShort = info.currentCommit !== 'unknown' ? info.currentCommit.substring(0, 7) : 'unknown';
      const curDate = info.currentDate ? formatDate(info.currentDate) : '-';

      let html = `
        <table class="update-table">
          <tr>
            <td style="color:var(--text-muted)" data-i18n="update.currentVersion">当前版本</td>
            <td>v${esc(info.currentVersion)} <span class="commit-sha">${curCommitShort}</span> <span class="commit-date">${curDate}</span></td>
          </tr>`;

      if (info.available) {
        const latCommitShort = info.latestCommit ? info.latestCommit.substring(0, 7) : 'unknown';
        const latDate = info.latestDate ? formatDate(info.latestDate) : '-';
        html += `
          <tr>
            <td style="color:var(--warning)" data-i18n="update.latestVersion">最新版本</td>
            <td>v${esc(info.latestVersion || '?')} <span class="commit-sha">${latCommitShort}</span> <span class="commit-date">${latDate}</span></td>
          </tr>`;
        if (info.latestMessage) {
          html += `
          <tr>
            <td style="color:var(--text-muted)" data-i18n="update.commitMessage">提交信息</td>
            <td>${esc(info.latestMessage)}</td>
          </tr>`;
        }
        html += `</table>
          <div style="margin-top:16px">
            <button class="btn btn-primary" id="applyUpdateBtn" data-i18n="update.apply">立即更新</button>
          </div>`;
      } else {
        html += `</table>
          <p style="color:var(--success);margin-top:12px" data-i18n="update.upToDate">已是最新版本</p>`;
      }

      if (info.lastCheckTime) {
        html += `<p style="color:var(--text-muted);font-size:11px;margin-top:8px">${I18n.t('update.lastCheck') || '上次检查'}: ${formatDate(info.lastCheckTime)}</p>`;
      }

      el.innerHTML = html;
      I18n.apply();

      const btn = document.getElementById('applyUpdateBtn');
      if (btn) btn.addEventListener('click', () => this.applyUpdate());
    } catch {
      el.innerHTML = `<p style="color:var(--text-muted)" data-i18n="update.checkFailed">检查更新失败</p>`;
    }
  },

  async applyUpdate() {
    if (!confirm(I18n.t('update.confirmApply') || 'Confirm update? The service will restart.')) return;
    try {
      Notify.info(I18n.t('update.applying') || 'Updating...');
      const res = await API.applyUpdate();
      if (res.needsRestart) {
        window.location.href = '/upgrading.html?phase=built';
      } else if (res.restarting) {
        window.location.href = '/upgrading.html?phase=restart';
      } else {
        Notify.success(I18n.t('update.applied') || 'Update applied');
      }
    } catch (err) { Notify.error(err.message); }
  }
};

function formatDate(dateStr) {
  try {
    const d = new Date(dateStr);
    return d.toLocaleString();
  } catch { return dateStr; }
}
