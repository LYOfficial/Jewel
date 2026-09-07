const Settings = {
  timezones: [
    { value: 'Pacific/Midway', label: 'UTC-11:00 Midway Island' },
    { value: 'Pacific/Honolulu', label: 'UTC-10:00 Hawaii' },
    { value: 'America/Anchorage', label: 'UTC-09:00 Alaska' },
    { value: 'America/Los_Angeles', label: 'UTC-08:00 Pacific Time' },
    { value: 'America/Denver', label: 'UTC-07:00 Mountain Time' },
    { value: 'America/Chicago', label: 'UTC-06:00 Central Time' },
    { value: 'America/New_York', label: 'UTC-05:00 Eastern Time' },
    { value: 'America/Sao_Paulo', label: 'UTC-03:00 São Paulo' },
    { value: 'Atlantic/Reykjavik', label: 'UTC+00:00 Iceland' },
    { value: 'Europe/London', label: 'UTC+00:00 London' },
    { value: 'Europe/Berlin', label: 'UTC+01:00 Berlin' },
    { value: 'Europe/Paris', label: 'UTC+01:00 Paris' },
    { value: 'Africa/Lagos', label: 'UTC+01:00 Lagos' },
    { value: 'Europe/Helsinki', label: 'UTC+02:00 Helsinki' },
    { value: 'Africa/Cairo', label: 'UTC+02:00 Cairo' },
    { value: 'Europe/Moscow', label: 'UTC+03:00 Moscow' },
    { value: 'Asia/Dubai', label: 'UTC+04:00 Dubai' },
    { value: 'Asia/Karachi', label: 'UTC+05:00 Karachi' },
    { value: 'Asia/Kolkata', label: 'UTC+05:30 Kolkata' },
    { value: 'Asia/Dhaka', label: 'UTC+06:00 Dhaka' },
    { value: 'Asia/Bangkok', label: 'UTC+07:00 Bangkok' },
    { value: 'Asia/Shanghai', label: 'UTC+08:00 北京 / Shanghai' },
    { value: 'Asia/Hong_Kong', label: 'UTC+08:00 Hong Kong' },
    { value: 'Asia/Singapore', label: 'UTC+08:00 Singapore' },
    { value: 'Asia/Taipei', label: 'UTC+08:00 Taipei' },
    { value: 'Asia/Tokyo', label: 'UTC+09:00 東京 / Tokyo' },
    { value: 'Asia/Seoul', label: 'UTC+09:00 Seoul' },
    { value: 'Australia/Sydney', label: 'UTC+10:00 Sydney' },
    { value: 'Pacific/Auckland', label: 'UTC+12:00 Auckland' }
  ],

  async render(container) {
    const tzOptions = this.timezones.map(tz =>
      `<option value="${tz.value}">${esc(tz.label)}</option>`
    ).join('');

    container.innerHTML = `
      <div class="page-shell settings-page">
        <div class="settings-grid">
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
        <div class="form-group">
          <label data-i18n="settings.timezone">时区</label>
          <select id="settingTimezone">
            ${tzOptions}
          </select>
          <div id="timezonePreview" style="color:var(--text-muted);font-size:12px;margin-top:4px"></div>
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
          <div class="card-title">项目资源只读接口</div>
        </div>
        <p style="margin-top:0;color:var(--text-muted);font-size:13px;line-height:1.6">供受信任的站点读取某个 Jewel 项目的汇总 CPU、内存与存储占用；不提供容器、镜像、卷名称或任何操作权限。</p>
        <div class="form-group">
          <label>接口地址模板</label>
          <input id="projectMetricsEndpoint" type="text" readonly>
          <span class="form-hint">将 <code>{project_id}</code> 替换为 Jewel 项目详情页显示的项目编号。</span>
        </div>
        <div class="form-group">
          <label>访问密钥</label>
          <div style="display:flex;gap:8px;align-items:center">
            <input id="projectMetricsAccessKey" type="password" readonly style="min-width:0;flex:1">
            <button class="btn btn-sm" id="toggleProjectMetricsKey" type="button">显示</button>
            <button class="btn btn-sm" id="copyProjectMetricsKey" type="button">复制</button>
          </div>
          <span class="form-hint">只填写到受信任服务的密钥管理页面；轮换后需同步更新所有调用方。</span>
        </div>
        <button class="btn btn-danger btn-sm" id="rotateProjectMetricsKey" type="button">轮换访问密钥</button>
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
        </div>
      </div>
    `;
    I18n.apply();

    try {
      const settings = await API.getSettings();
      document.getElementById('settingLanguage').value = settings.language || 'zh-CN';
      document.getElementById('settingGitProvider').value = settings.git_provider || 'github';
      document.getElementById('settingTimezone').value = settings.timezone || 'Asia/Shanghai';
      this.updateTimezonePreview(settings.timezone || 'Asia/Shanghai');
    } catch { /* ignore */ }

    document.getElementById('saveSettings').addEventListener('click', () => this.saveSettings());
    document.getElementById('changePwdBtn').addEventListener('click', () => this.changePassword());
    document.getElementById('refreshUpdateBtn').addEventListener('click', () => this.checkUpdate(true));
    document.getElementById('toggleProjectMetricsKey').addEventListener('click', () => this.toggleProjectMetricsKey());
    document.getElementById('copyProjectMetricsKey').addEventListener('click', () => this.copyProjectMetricsKey());
    document.getElementById('rotateProjectMetricsKey').addEventListener('click', () => this.rotateProjectMetricsKey());

    document.getElementById('settingTimezone').addEventListener('change', (e) => {
      this.updateTimezonePreview(e.target.value);
    });

    this.loadSystemInfo();
    this.loadProjectMetricsConfig();
    // Entering Settings should show a newly checked version, just like a
    // full page refresh. The server deduplicates it with App.pollUpdate().
    this.checkUpdate(true);
  },

  async loadProjectMetricsConfig() {
    try {
      const config = await API.getProjectMetricsConfig();
      const endpoint = document.getElementById('projectMetricsEndpoint');
      const key = document.getElementById('projectMetricsAccessKey');
      if (endpoint) endpoint.value = `${window.location.origin}${config.endpoint_path_template || '/api/project-metrics/{project_id}'}`;
      if (key) key.value = config.access_key || '';
    } catch (err) {
      Notify.error(err.message);
    }
  },

  toggleProjectMetricsKey() {
    const input = document.getElementById('projectMetricsAccessKey');
    const button = document.getElementById('toggleProjectMetricsKey');
    if (!input || !button) return;
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    button.textContent = showing ? '显示' : '隐藏';
  },

  copyProjectMetricsKey() {
    const value = document.getElementById('projectMetricsAccessKey')?.value || '';
    if (value) App.copyText(value, '已复制访问密钥');
  },

  async rotateProjectMetricsKey() {
    if (!confirm('轮换后，当前使用此密钥的站点将立即无法读取资源数据。确定继续？')) return;
    try {
      const config = await API.rotateProjectMetricsKey();
      const key = document.getElementById('projectMetricsAccessKey');
      if (key) {
        key.value = config.access_key || '';
        key.type = 'text';
      }
      const button = document.getElementById('toggleProjectMetricsKey');
      if (button) button.textContent = '隐藏';
      Notify.success('访问密钥已轮换，请立即复制并更新调用方');
    } catch (err) { Notify.error(err.message); }
  },

  updateTimezonePreview(tz) {
    const el = document.getElementById('timezonePreview');
    if (!el) return;
    try {
      const now = new Date();
      const formatted = now.toLocaleString('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      el.textContent = `${I18n.t('settings.currentTime') || 'Current time'}: ${formatted}`;
    } catch {
      el.textContent = '';
    }
  },

  async saveSettings() {
    try {
      const tz = document.getElementById('settingTimezone').value;
      await API.updateSettings({
        language: document.getElementById('settingLanguage').value,
        git_provider: document.getElementById('settingGitProvider').value,
        timezone: tz
      });
      localStorage.setItem('jewel-timezone', tz);
      const lang = document.getElementById('settingLanguage').value;
      await I18n.setLang(lang);
      Notify.success(I18n.t('common.saved') || 'Saved');
      // Reload system info to reflect new timezone
      this.loadSystemInfo();
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
      const [info, tzInfo] = await Promise.all([API.getSystemInfo(), API.getTimezone()]);
      el.innerHTML = `<table>
        <tr><td style="color:var(--text-muted)">Version</td><td>${info.version || '-'}</td></tr>
        <tr><td style="color:var(--text-muted)">Node.js</td><td>${info.nodeVersion || '-'}</td></tr>
        <tr><td style="color:var(--text-muted)">Platform</td><td>${info.platform || '-'}</td></tr>
        <tr><td style="color:var(--text-muted)">Uptime</td><td>${Math.floor(info.uptime / 60)} min</td></tr>
        <tr><td style="color:var(--text-muted)" data-i18n="settings.timezone">时区</td><td>${esc(tzInfo.timezone)} (${esc(tzInfo.utcOffset)})</td></tr>
        <tr><td style="color:var(--text-muted)" data-i18n="settings.currentTime">当前时间</td><td>${esc(tzInfo.currentTime)}</td></tr>
        ${info.docker ? `
        <tr><td style="color:var(--text-muted)">Docker</td><td>Connected</td></tr>
        <tr><td style="color:var(--text-muted)">Containers</td><td>${info.docker.Containers || '-'}</td></tr>
        <tr><td style="color:var(--text-muted)">Images</td><td>${info.docker.Images || '-'}</td></tr>
        ` : `<tr><td style="color:var(--text-muted)">Docker</td><td style="color:var(--warning)">Not Connected</td></tr>`}
      </table>`;
      I18n.apply();
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

      if (info.currentMessage) {
        html += `
          <tr>
            <td style="color:var(--text-muted)" data-i18n="update.commitMessage">提交信息</td>
            <td>${esc(info.currentMessage)}</td>
          </tr>`;
      }

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
    if (!confirm(I18n.t('update.confirmApply') || 'Update will run install.sh in the background and restart the container. Confirm?')) return;
    try {
      await API.applyUpdate();
      Notify.success(I18n.t('update.applying') || 'Update started. The container will restart in 1-3 minutes. Refresh the page after that.');
    } catch (err) { Notify.error(err.message); }
  }
};

function formatDate(dateStr) {
  try {
    const d = new Date(dateStr);
    const tz = localStorage.getItem('jewel-timezone') || 'Asia/Shanghai';
    return d.toLocaleString('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch { return dateStr; }
}
