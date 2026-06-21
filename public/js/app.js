const App = {
  currentPage: 'dashboard',
  // Map URL sub-paths to internal page names
  pageMap: {
    '/': 'dashboard',
    '/dashboard': 'dashboard',
    '/project': 'project',
    '/projects': 'project',
    '/containers': 'containers',
    '/images': 'images',
    '/tokens': 'tokens',
    '/settings': 'settings'
  },
  // Reverse map: internal page name -> canonical sub-path
  pagePaths: {
    dashboard: '/dashboard',
    project: '/project',
    containers: '/containers',
    images: '/images',
    tokens: '/tokens',
    settings: '/settings'
  },

  async init() {
    const token = localStorage.getItem('jewel-token');
    if (!token) {
      window.location.href = '/login.html';
      return;
    }
    API.token = token;

    try {
      const me = await API.getMe();
      document.getElementById('currentUser').textContent = me.username;
    } catch {
      API.clearToken();
      window.location.href = '/login.html';
      return;
    }

    await I18n.init();
    const savedLang = localStorage.getItem('jewel-lang');
    if (savedLang) {
      document.querySelectorAll('#langSelect').forEach(s => s.value = savedLang);
    }
    I18n.apply();

    // Load timezone from server settings if not cached locally
    if (!localStorage.getItem('jewel-timezone')) {
      try {
        const settings = await API.getSettings();
        if (settings.timezone) localStorage.setItem('jewel-timezone', settings.timezone);
      } catch { /* ignore */ }
    }

    this.bindEvents();

    // Read the current URL path to determine the initial page
    const initialPage = this.pathToPage(window.location.pathname);
    // If user landed on root or an unknown path, replace the URL with the canonical sub-path
    if (!window.location.pathname || window.location.pathname === '/' || !this.pageMap[window.location.pathname]) {
      const canonical = this.pagePaths[initialPage] || '/dashboard';
      window.history.replaceState({ page: initialPage }, '', canonical);
    }
    this.navigate(initialPage, { silent: true });
    this.pollUpdate();
  },

  bindEvents() {
    document.querySelectorAll('.nav-item[data-page]').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const page = item.getAttribute('data-page');
        const path = this.pagePaths[page] || '/';
        // Push state and navigate; do not let the link do a full reload
        window.history.pushState({ page }, '', path);
        this.navigate(page);
      });
    });

    document.querySelectorAll('#langSelect').forEach(sel => {
      sel.addEventListener('change', async (e) => {
        await I18n.setLang(e.target.value);
      });
    });

    document.getElementById('userMenuBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      document.getElementById('userMenuDropdown').classList.toggle('open');
    });

    document.addEventListener('click', () => {
      document.getElementById('userMenuDropdown').classList.remove('open');
    });

    document.getElementById('logoutBtn').addEventListener('click', () => {
      API.clearToken();
      window.location.href = '/login.html';
    });

    document.getElementById('changePasswordBtn').addEventListener('click', () => {
      document.getElementById('userMenuDropdown').classList.remove('open');
      this.showChangePasswordModal();
    });

    document.getElementById('changeUsernameBtn').addEventListener('click', () => {
      document.getElementById('userMenuDropdown').classList.remove('open');
      this.showChangeUsernameModal();
    });

    document.getElementById('updateBanner').addEventListener('click', async () => {
      if (!confirm(I18n.t('update.confirmApply') || 'Update will run install.sh in the background and restart the container. Confirm?')) return;
      try {
        await API.applyUpdate();
        Notify.success(I18n.t('update.applying') || 'Update started. The container will restart in 1-3 minutes. Refresh the page after that.');
      } catch (err) { Notify.error(err.message); }
    });

    // Handle browser back/forward navigation
    window.addEventListener('popstate', (e) => {
      const page = (e.state && e.state.page) || this.pathToPage(window.location.pathname);
      this.navigate(page, { silent: true });
    });
  },

  // Translate a URL path to an internal page name
  pathToPage(path) {
    if (!path) return 'dashboard';
    // Strip trailing slash for comparison
    const p = path.replace(/\/+$/, '') || '/';
    return this.pageMap[p] || 'dashboard';
  },

  navigate(page, options = {}) {
    this.currentPage = page;
    document.querySelectorAll('.nav-item[data-page]').forEach(item => {
      item.classList.toggle('active', item.getAttribute('data-page') === page);
    });

    document.getElementById('pageTitle').textContent = I18n.t(`nav.${page}`) || page;

    const container = document.getElementById('contentArea');
    container.innerHTML = '<div class="loading"><span class="spinner"></span></div>';

    if (Containers.destroy) Containers.destroy();
    if (Dashboard.destroy) Dashboard.destroy();
    if (Images && Images.destroy) Images.destroy();

    switch (page) {
      case 'dashboard': Dashboard.render(container); break;
      case 'project': Projects.render(container); break;
      case 'containers': Containers.render(container); break;
      case 'images':
        if (typeof Images !== 'undefined') {
          Images.render(container);
        } else {
          container.innerHTML = '<div class="empty-state"><p>Images module not loaded.</p></div>';
        }
        break;
      case 'tokens': Tokens.render(container); break;
      case 'settings': Settings.render(container); break;
      default:
        // Unknown page — fall back to dashboard
        Dashboard.render(container);
    }
  },

  showChangePasswordModal() {
    Modal.show(I18n.t('user.changePassword') || 'Change Password', `
      <div class="form-group">
        <label data-i18n="settings.currentPassword">当前密码</label>
        <input type="password" id="modalCurrentPwd">
      </div>
      <div class="form-group">
        <label data-i18n="settings.newPassword">新密码</label>
        <input type="password" id="modalNewPwd">
      </div>
    `, [
      { label: I18n.t('common.cancel') || '取消', class: 'btn-secondary' },
      {
        label: I18n.t('common.save') || '保存',
        class: 'btn-primary',
        onClick: async () => {
          const cur = document.getElementById('modalCurrentPwd').value;
          const newP = document.getElementById('modalNewPwd').value;
          if (!cur || !newP) { Notify.error(I18n.t('settings.fillBoth') || 'Fill both fields'); return; }
          try {
            const res = await API.changePassword(cur, newP);
            API.setToken(res.token);
            Notify.success(I18n.t('settings.passwordChanged') || 'Password changed');
          } catch (err) { Notify.error(err.message); }
        }
      }
    ]);
    I18n.apply();
  },

  showChangeUsernameModal() {
    Modal.show(I18n.t('user.changeUsername') || 'Change Username', `
      <div class="form-group">
        <label data-i18n="login.newUsername">新用户名</label>
        <input type="text" id="modalNewUsername" pattern="[a-zA-Z0-9]+" minlength="3">
        <small style="color:var(--text-muted)" data-i18n="login.usernameHint">用户名只能包含大小写英文和数字</small>
      </div>
    `, [
      { label: I18n.t('common.cancel') || '取消', class: 'btn-secondary' },
      {
        label: I18n.t('common.save') || '保存',
        class: 'btn-primary',
        onClick: async () => {
          const newName = document.getElementById('modalNewUsername').value;
          if (!/^[a-zA-Z0-9]+$/.test(newName)) {
            Notify.error(I18n.t('login.usernameFormat') || 'Invalid username format');
            return;
          }
          try {
            const res = await API.changeUsername(newName);
            API.setToken(res.token);
            document.getElementById('currentUser').textContent = newName;
            Notify.success(I18n.t('common.saved') || 'Saved');
          } catch (err) { Notify.error(err.message); }
        }
      }
    ]);
    I18n.apply();
  },

  async pollUpdate() {
    try {
      const info = await API.checkUpdate();
      const banner = document.getElementById('updateBanner');
      if (info.available) {
        banner.classList.add('show');
      } else {
        banner.classList.remove('show');
      }
    } catch { /* ignore */ }
    setInterval(async () => {
      try {
        const info = await API.checkUpdate();
        const banner = document.getElementById('updateBanner');
        if (info.available) {
          banner.classList.add('show');
        } else {
          banner.classList.remove('show');
        }
      } catch { /* ignore */ }
    }, 5 * 60 * 1000);
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
