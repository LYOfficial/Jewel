const App = {
  currentPage: 'dashboard',

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

    this.bindEvents();
    this.navigate('dashboard');
    this.pollUpdate();
  },

  bindEvents() {
    document.querySelectorAll('.nav-item[data-page]').forEach(item => {
      item.addEventListener('click', () => {
        this.navigate(item.getAttribute('data-page'));
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
  },

  navigate(page) {
    this.currentPage = page;
    document.querySelectorAll('.nav-item[data-page]').forEach(item => {
      item.classList.toggle('active', item.getAttribute('data-page') === page);
    });

    document.getElementById('pageTitle').textContent = I18n.t(`nav.${page}`) || page;

    const container = document.getElementById('contentArea');
    container.innerHTML = '<div class="loading"><span class="spinner"></span></div>';

    if (Containers.destroy) Containers.destroy();
    if (Dashboard.destroy) Dashboard.destroy();

    switch (page) {
      case 'dashboard': Dashboard.render(container); break;
      case 'projects': Projects.render(container); break;
      case 'containers': Containers.render(container); break;
      case 'tokens': Tokens.render(container); break;
      case 'settings': Settings.render(container); break;
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
