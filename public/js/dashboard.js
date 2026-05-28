const Dashboard = {
  monitorTimer: null,

  async render(container) {
    container.innerHTML = `
      <!-- System Info Bar -->
      <div class="card" id="sysInfoCard">
        <div class="card-header">
          <div class="card-title" data-i18n="dashboard.systemInfo">系统信息</div>
        </div>
        <div id="sysInfoContent" class="sys-info-bar"><span class="spinner"></span></div>
      </div>

      <!-- Monitor Rings -->
      <div class="monitor-grid" id="monitorGrid">
        <div class="ring-card">
          <div class="ring-wrap"><canvas id="cpuRing" width="120" height="120"></canvas></div>
          <div class="ring-label">CPU</div>
          <div class="ring-value" id="cpuValue">--</div>
        </div>
        <div class="ring-card">
          <div class="ring-wrap"><canvas id="memRing" width="120" height="120"></canvas></div>
          <div class="ring-label" data-i18n="dashboard.memory">内存</div>
          <div class="ring-value" id="memValue">--</div>
        </div>
        <div class="ring-card">
          <div class="ring-wrap"><canvas id="diskRing" width="120" height="120"></canvas></div>
          <div class="ring-label" data-i18n="dashboard.storage">存储</div>
          <div class="ring-value" id="diskValue">--</div>
        </div>
      </div>

      <!-- Network Stats -->
      <div class="card">
        <div class="card-header">
          <div class="card-title" data-i18n="dashboard.network">网络流量</div>
        </div>
        <div class="net-stats" id="netStats">--</div>
      </div>

      <!-- Projects + Notes Row -->
      <div class="dash-row">
        <div class="card dash-half">
          <div class="card-header">
            <div class="card-title" data-i18n="dashboard.recentProjects">最近项目</div>
          </div>
          <div id="recentProjects"></div>
        </div>
        <div class="card dash-half">
          <div class="card-header">
            <div class="card-title" data-i18n="dashboard.notebook">备忘本</div>
            <div class="notebook-tabs" id="notebookTabs">
              <button class="notebook-tab active" data-note="public" data-i18n="notes.public">公共</button>
              <button class="notebook-tab" data-note="ports" data-i18n="notes.ports">端口</button>
              <button class="notebook-tab" data-note="calendar" data-i18n="notes.calendar">月历</button>
              <button class="notebook-tab" data-note="daily" data-i18n="notes.daily">日常</button>
            </div>
          </div>
          <div id="notebookContent"></div>
        </div>
      </div>
    `;
    I18n.apply();

    document.querySelectorAll('.notebook-tab').forEach(tab => {
      tab.addEventListener('click', () => this.switchNote(tab.dataset.note));
    });

    await Promise.all([
      this.loadMonitor(),
      this.loadProjects(),
      this.loadNotes()
    ]);

    this.monitorTimer = setInterval(() => this.loadMonitor(), 5000);
  },

  destroy() {
    if (this.monitorTimer) clearInterval(this.monitorTimer);
  },

  // ===== Monitor =====
  async loadMonitor() {
    try {
      const m = await API.getMonitor();

      // System info bar
      const si = document.getElementById('sysInfoContent');
      if (si) si.innerHTML = `
        <span>${esc(m.hostname || '-')} · ${esc(m.osType || '-')} ${esc(m.osRelease || '')} · ${esc(m.osArch || '-')}</span>
        <span>CPU: ${esc(m.cpuModel || '-')} x${m.cpuCores || '-'}</span>
        <span data-i18n="dashboard.uptime">运行</span>: ${formatUptime(m.uptime)}
      `;

      // Rings
      this.drawRing('cpuRing', m.cpuPercent, '#ffffff');
      document.getElementById('cpuValue').textContent = m.cpuPercent + '%';

      this.drawRing('memRing', m.memPercent, '#ffffff');
      document.getElementById('memValue').textContent = formatBytes(m.memUsed) + ' / ' + formatBytes(m.memTotal);

      const diskPct = m.diskInfo?.percent || 0;
      this.drawRing('diskRing', diskPct, '#ffffff');
      document.getElementById('diskValue').textContent = formatBytes(m.diskInfo?.used || 0) + ' / ' + formatBytes(m.diskInfo?.total || 0);

      // Network
      const net = m.network || {};
      document.getElementById('netStats').innerHTML = `
        <div class="net-item"><span class="net-label">↓ RX</span><span class="net-val">${formatBytes(net.rxRate || 0)}/s</span></div>
        <div class="net-item"><span class="net-label">↑ TX</span><span class="net-val">${formatBytes(net.txRate || 0)}/s</span></div>
        <div class="net-item"><span class="net-label">↓ Total</span><span class="net-val">${formatBytes(net.totalRx || 0)}</span></div>
        <div class="net-item"><span class="net-label">↑ Total</span><span class="net-val">${formatBytes(net.totalTx || 0)}</span></div>
      `;
    } catch { /* ignore */ }
  },

  drawRing(canvasId, percent, color) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const size = 120;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    ctx.scale(dpr, dpr);

    const cx = size / 2, cy = size / 2, r = 48, lw = 8;
    const start = -Math.PI / 2;
    const end = start + (Math.PI * 2 * Math.min(percent, 100) / 100);

    ctx.clearRect(0, 0, size, size);

    // Background ring
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = '#2a2a2a';
    ctx.lineWidth = lw;
    ctx.stroke();

    // Value ring
    ctx.beginPath();
    ctx.arc(cx, cy, r, start, end);
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.stroke();
  },

  // ===== Projects =====
  async loadProjects() {
    try {
      const projects = await API.getProjects();
      const el = document.getElementById('recentProjects');
      if (!el) return;

      if (projects.length === 0) {
        el.innerHTML = `<div class="empty-state" style="padding:20px"><p data-i18n="dashboard.noProjects">暂无项目</p></div>`;
        return;
      }

      el.innerHTML = `<table><thead><tr>
        <th data-i18n="project.name">名称</th>
        <th data-i18n="project.status">状态</th>
        <th></th>
      </tr></thead><tbody>${projects.slice(0, 5).map(p => `
        <tr>
          <td>${esc(p.name)}</td>
          <td><span class="badge badge-${p.status}">${esc(I18n.t('status.' + p.status) || p.status)}</span></td>
          <td><button class="btn btn-sm" onclick="Dashboard.deployProject(${p.id})" data-i18n="project.deploy">部署</button></td>
        </tr>`).join('')}</tbody></table>`;
    } catch { /* ignore */ }
  },

  async deployProject(id) {
    try {
      Notify.info(I18n.t('project.deploying') || 'Deploying...');
      await API.deployProject(id);
      Notify.success(I18n.t('project.deploySuccess') || 'Deployed');
      this.loadProjects();
    } catch (err) { Notify.error(err.message); }
  },

  // ===== Notes =====
  currentNote: 'public',
  notesData: { public: '', ports: '', daily: '' },

  async loadNotes() {
    try {
      this.notesData = await API.getNotes();
    } catch { /* ignore */ }
    this.renderNoteTab();
  },

  switchNote(tab) {
    // Auto-save current before switching
    this.saveCurrentNote();
    this.currentNote = tab;
    document.querySelectorAll('.notebook-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.note === tab)
    );
    this.renderNoteTab();
  },

  renderNoteTab() {
    const el = document.getElementById('notebookContent');
    if (!el) return;

    if (this.currentNote === 'calendar') {
      el.innerHTML = this.renderCalendar();
      return;
    }

    const key = this.currentNote;
    const val = this.notesData[key] || '';
    const placeholder = key === 'ports'
      ? 'PORT  PROJECT  DOMAIN\n330   Jewel    jewel.example.com\n8080  MyApp    app.example.com'
      : key === 'daily'
        ? '2026-01-01  Did something...\n2026-01-02  Todo: fix bug'
        : '';

    el.innerHTML = `<textarea class="note-editor" id="noteEditor" placeholder="${placeholder}">${esc(val)}</textarea>`;
  },

  renderCalendar() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const today = now.getDate();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const monthNames = [
      I18n.t('calendar.jan') || '1月', I18n.t('calendar.feb') || '2月',
      I18n.t('calendar.mar') || '3月', I18n.t('calendar.apr') || '4月',
      I18n.t('calendar.may') || '5月', I18n.t('calendar.jun') || '6月',
      I18n.t('calendar.jul') || '7月', I18n.t('calendar.aug') || '8月',
      I18n.t('calendar.sep') || '9月', I18n.t('calendar.oct') || '10月',
      I18n.t('calendar.nov') || '11月', I18n.t('calendar.dec') || '12月'
    ];
    const dayNames = ['Su','Mo','Tu','We','Th','Fr','Sa'];

    let html = `<div class="calendar"><div class="cal-header">${year} ${monthNames[month]}</div>`;
    html += '<div class="cal-grid">';
    for (const d of dayNames) html += `<div class="cal-dayname">${d}</div>`;
    for (let i = 0; i < firstDay; i++) html += '<div class="cal-empty"></div>';
    for (let d = 1; d <= daysInMonth; d++) {
      const cls = d === today ? 'cal-today' : '';
      html += `<div class="cal-day ${cls}">${d}</div>`;
    }
    html += '</div></div>';
    return html;
  },

  async saveCurrentNote() {
    const editor = document.getElementById('noteEditor');
    if (!editor) return;
    const key = this.currentNote;
    if (key === 'calendar') return;
    const val = editor.value;
    if (val === this.notesData[key]) return;
    this.notesData[key] = val;
    try {
      await API.updateNotes({ [key]: val });
    } catch { /* ignore */ }
  }
};

// ===== Helpers =====
function esc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

function formatUptime(seconds) {
  if (!seconds) return '--';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return d + 'd ' + h + 'h';
  if (h > 0) return h + 'h ' + m + 'm';
  return m + 'm';
}
