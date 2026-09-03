const Dashboard = {
  monitorTimer: null,

  async render(container) {
    container.innerHTML = `
      <div class="page-shell dashboard-page">
      <!-- System Info Bar -->
      <div class="card" id="sysInfoCard">
        <div class="card-header">
          <div class="card-title" data-i18n="dashboard.systemInfo">系统信息</div>
          <div class="dashboard-live-status"><span></span><span data-i18n="dashboard.live">实时监控</span></div>
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
        <div class="card dash-half notebook-card">
          <div class="card-header">
            <div class="card-title" data-i18n="dashboard.notebook">备忘本</div>
            <div class="notebook-tabs" id="notebookTabs">
              <button class="notebook-tab active" data-note="public" data-i18n="notes.public">公共</button>
              <button class="notebook-tab" data-note="ports" data-i18n="notes.ports">端口</button>
              <button class="notebook-tab" data-note="calendar" data-i18n="notes.calendar">月历</button>
              <button class="notebook-tab" data-note="daily" data-i18n="notes.daily">日常</button>
            </div>
          </div>
          <div id="notebookContent" class="notebook-content"></div>
        </div>
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
        <span>${esc(m.osType || '-')} ${esc(m.osRelease || '')} · ${esc(m.osArch || '-')}</span>
        <span>CPU: ${esc(m.cpuModel || '-')} x${m.cpuCores || '-'}</span>
        <span data-i18n="dashboard.uptime">运行</span>: ${formatUptime(m.uptime)}
      `;

      // Rings
      this.drawRing('cpuRing', m.cpuPercent, this.themeColor('--ring-accent'));
      document.getElementById('cpuValue').textContent = m.cpuPercent + '%';

      this.drawRing('memRing', m.memPercent, this.themeColor('--ring-accent'));
      document.getElementById('memValue').textContent = formatBytes(m.memUsed) + ' / ' + formatBytes(m.memTotal);

      const diskPct = m.diskInfo?.percent || 0;
      this.drawRing('diskRing', diskPct, this.themeColor('--ring-accent'));
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
    ctx.strokeStyle = this.themeColor('--ring-track');
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

  themeColor(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#3b82f6';
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
  // 'public': plain string. 'ports': array of {id, port, app, note, createdAt}.
  // 'daily': array of {id, content, createdAt}.
  notesData: { public: '', ports: [], daily: [] },

  // Normalize any legacy value into the modern entry list.
  // - For 'ports', convert each old string line into a {port, app, note}
  //   object by splitting on 2+ spaces (or single spaces as a fallback).
  // - For 'daily', each line becomes a single-content entry.
  // - For already-array values, convert old shape (string content) on the fly.
  getNoteEntries(key) {
    const raw = this.notesData[key];
    let arr;
    if (Array.isArray(raw)) {
      arr = raw;
    } else if (typeof raw === 'string' && raw.trim()) {
      try {
        const parsed = JSON.parse(raw);
        arr = Array.isArray(parsed) ? parsed : null;
      } catch { /* fall through */ }
      if (!arr) {
        arr = raw.split('\n').filter(l => l.trim());
      }
    } else {
      return [];
    }
    return arr.map((e, i) => this.normalizeEntry(key, e, i));
  },

  normalizeEntry(key, raw, index) {
    const id = (raw && raw.id) || `legacy-${Date.now()}-${index}`;
    const createdAt = (raw && raw.createdAt) || null;

    if (key === 'ports') {
      if (raw && typeof raw === 'object' && (raw.port || raw.app || raw.note)) {
        return {
          id,
          port: String(raw.port || '').trim(),
          app: String(raw.app || '').trim(),
          note: String(raw.note || '').trim(),
          createdAt
        };
      }
      // Legacy string: "330  Jewel  jewel.example.com"
      const line = String(typeof raw === 'string' ? raw : (raw && raw.content) || '').trim();
      const parts = line.split(/\s{2,}|\s+/).filter(Boolean);
      return {
        id,
        port: parts[0] || '',
        app: parts[1] || '',
        note: parts.slice(2).join(' ') || '',
        createdAt
      };
    }

    // 'daily'
    return {
      id,
      content: String(typeof raw === 'string' ? raw : (raw && raw.content) || ''),
      createdAt
    };
  },

  async persistEntries(key, entries) {
    this.notesData[key] = entries;
    try {
      await API.updateNotes({ [key]: JSON.stringify(entries) });
    } catch (err) {
      Notify.error(err.message);
    }
  },

  async loadNotes() {
    try {
      this.notesData = await API.getNotes();
    } catch { /* ignore */ }
    // Normalize once on load so the rest of the code can trust the shape.
    this.notesData.ports = this.getNoteEntries('ports');
    this.notesData.daily = this.getNoteEntries('daily');
    this.renderNoteTab();
  },

  switchNote(tab) {
    this.saveCurrentNote(true);
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
      el.innerHTML = `<div class="note-body">${this.renderCalendar()}</div>`;
      return;
    }

    if (this.currentNote === 'public') {
      const val = this.notesData.public || '';
      el.innerHTML = `
        <div class="note-body">
          <textarea class="note-editor" id="noteEditor" placeholder="${esc(I18n.t('notes.publicPlaceholder') || '')}">${esc(val)}</textarea>
        </div>
        <div class="note-actions">
          <button class="btn btn-sm" id="saveNoteBtn" data-i18n="common.save">保存</button>
        </div>
      `;
      document.getElementById('saveNoteBtn')?.addEventListener('click', () => this.saveCurrentNote());
      return;
    }

    this.renderEntryList(this.currentNote);
  },

  renderEntryList(key) {
    const el = document.getElementById('notebookContent');
    if (!el) return;

    const entries = this.getNoteEntries(key);
    const isPorts = key === 'ports';
    const emptyKey = isPorts ? 'notes.emptyPorts' : 'notes.emptyDaily';
    const emptyText = I18n.t(emptyKey) || (isPorts ? '暂无端口条目' : '暂无日常条目');

    const body = entries.length
      ? `<ul class="note-entry-list ${isPorts ? 'note-entry-list-ports' : 'note-entry-list-daily'}">
          ${entries.map((e, i) => isPorts ? this.renderPortEntry(e, i) : this.renderDailyEntry(e, i)).join('')}
        </ul>`
      : `<div class="note-empty"><p>${esc(emptyText)}</p></div>`;

    el.innerHTML = `
      <div class="note-body">${body}</div>
      ${isPorts ? this.renderPortAddForm() : this.renderDailyAddForm()}
    `;

    el.querySelectorAll('.note-entry-del').forEach(btn => {
      btn.addEventListener('click', () => this.deleteEntry(key, parseInt(btn.dataset.index, 10)));
    });

    this.wireAddForm(key);
  },

  renderPortEntry(e, i) {
    return `
      <li class="note-entry note-entry-ports" data-index="${i}">
        <div class="note-col note-col-port">${esc(e.port || '—')}</div>
        <div class="note-col note-col-app">${esc(e.app || '—')}</div>
        <div class="note-col note-col-note">${esc(e.note || '—')}</div>
        <div class="note-entry-actions">
          ${e.createdAt ? `<small class="note-entry-time" title="${esc(formatDateShort(new Date(e.createdAt)))}">${esc(formatDateShort(new Date(e.createdAt)))}</small>` : ''}
          <button class="note-entry-del" data-index="${i}" title="${I18n.t('notes.deleteEntry') || '删除'}">×</button>
        </div>
      </li>
    `;
  },

  renderDailyEntry(e, i) {
    return `
      <li class="note-entry note-entry-daily" data-index="${i}">
        <div class="note-col note-col-content">${esc(e.content || '')}</div>
        <div class="note-entry-actions">
          ${e.createdAt ? `<small class="note-entry-time">${esc(formatDateShort(new Date(e.createdAt)))}</small>` : ''}
          <button class="note-entry-del" data-index="${i}" title="${I18n.t('notes.deleteEntry') || '删除'}">×</button>
        </div>
      </li>
    `;
  },

  renderPortAddForm() {
    return `
      <div class="note-add-form note-add-form-ports">
        <input type="text" class="note-add-input note-add-port" id="noteAddPort" maxlength="6"
               placeholder="${esc(I18n.t('notes.portPlaceholder') || '端口')}" />
        <input type="text" class="note-add-input note-add-app" id="noteAddApp"
               placeholder="${esc(I18n.t('notes.appPlaceholder') || '应用名')}" />
        <input type="text" class="note-add-input note-add-note" id="noteAddNote"
               placeholder="${esc(I18n.t('notes.notePlaceholder') || '备注')}" />
        <button class="btn btn-sm" id="noteAddBtn" data-i18n="notes.addEntry">添加</button>
      </div>
    `;
  },

  renderDailyAddForm() {
    return `
      <div class="note-add-form note-add-form-daily">
        <textarea class="note-add-input" id="noteAddInput" rows="2"
                  placeholder="${esc(I18n.t('notes.dailyPlaceholder') || '今天做了什么…')}"></textarea>
        <button class="btn btn-sm" id="noteAddBtn" data-i18n="notes.addEntry">添加</button>
      </div>
    `;
  },

  wireAddForm(key) {
    const addBtn = document.getElementById('noteAddBtn');
    if (!addBtn) return;
    addBtn.addEventListener('click', () => this.addEntry(key));

    if (key === 'ports') {
      const portEl = document.getElementById('noteAddPort');
      const appEl = document.getElementById('noteAddApp');
      const noteEl = document.getElementById('noteAddNote');
      // Tab order is natural; Enter from any field submits.
      [portEl, appEl, noteEl].forEach(el => {
        el?.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') { ev.preventDefault(); this.addEntry(key); }
        });
      });
    } else {
      const input = document.getElementById('noteAddInput');
      input?.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
          ev.preventDefault();
          this.addEntry(key);
        }
      });
    }
  },

  async addEntry(key) {
    if (key === 'ports') {
      const portEl = document.getElementById('noteAddPort');
      const appEl = document.getElementById('noteAddApp');
      const noteEl = document.getElementById('noteAddNote');
      if (!portEl || !appEl) return;
      const port = (portEl.value || '').trim();
      const app = (appEl.value || '').trim();
      const note = (noteEl ? noteEl.value : '').trim();
      if (!port && !app && !note) {
        portEl.focus();
        return;
      }
      const entries = this.getNoteEntries(key).slice();
      entries.unshift({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        port, app, note,
        createdAt: new Date().toISOString()
      });
      await this.persistEntries(key, entries);
      this.renderEntryList(key);
      return;
    }

    const input = document.getElementById('noteAddInput');
    if (!input) return;
    const val = input.value.trim();
    if (!val) { input.focus(); return; }
    const entries = this.getNoteEntries(key).slice();
    entries.unshift({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      content: val,
      createdAt: new Date().toISOString()
    });
    await this.persistEntries(key, entries);
    this.renderEntryList(key);
  },

  async deleteEntry(key, index) {
    const entries = this.getNoteEntries(key).slice();
    if (index < 0 || index >= entries.length) return;
    entries.splice(index, 1);
    await this.persistEntries(key, entries);
    this.renderEntryList(key);
  },

  renderCalendar() {
    const tz = localStorage.getItem('jewel-timezone') || 'Asia/Shanghai';
    const now = new Date();
    let year, month, today;
    try {
      const tzStr = now.toLocaleString('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
      const tzParts = tzStr.split('/');
      month = parseInt(tzParts[0]) - 1;
      today = parseInt(tzParts[1]);
      year = parseInt(tzParts[2]);
    } catch {
      year = now.getFullYear();
      month = now.getMonth();
      today = now.getDate();
    }
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

  async saveCurrentNote(silent = false) {
    const editor = document.getElementById('noteEditor');
    if (!editor) return;
    const key = this.currentNote;
    if (key === 'calendar') return;
    const val = editor.value;
    if (val === this.notesData[key]) {
      if (!silent) Notify.success(I18n.t('common.saved') || 'Saved');
      return;
    }
    this.notesData[key] = val;
    try {
      await API.updateNotes({ [key]: val });
      if (!silent) Notify.success(I18n.t('common.saved') || 'Saved');
    } catch (err) {
      if (!silent) Notify.error(err.message);
    }
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

function formatDateShort(d) {
  if (!d || isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
