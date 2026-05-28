(async function() {
  await I18n.init();
  I18n.apply();

  const savedLang = localStorage.getItem('jewel-lang');
  if (savedLang) document.getElementById('langSelect').value = savedLang;

  document.getElementById('langSelect').addEventListener('change', async (e) => {
    await I18n.setLang(e.target.value);
  });

  const token = localStorage.getItem('jewel-token');
  if (token) {
    try {
      API.token = token;
      const me = await API.getMe();
      window.location.href = '/';
      return;
    } catch { API.clearToken(); }
  }

  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const errEl = document.getElementById('loginError');

    try {
      errEl.style.display = 'none';
      const res = await API.login(username, password);
      API.setToken(res.token);

      if (res.user.is_first_login) {
        showChangePasswordModal();
      } else {
        window.location.href = '/';
      }
    } catch (err) {
      errEl.textContent = I18n.t('login.invalidCredentials') || err.message;
      errEl.style.display = 'block';
    }
  });

  function showChangePasswordModal() {
    document.getElementById('changePasswordModal').style.display = 'flex';
  }

  document.getElementById('changePasswordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const newPwd = document.getElementById('newPassword').value;
    const confirmPwd = document.getElementById('confirmPassword').value;
    const errEl = document.getElementById('changePasswordError');

    if (newPwd !== confirmPwd) {
      errEl.textContent = I18n.t('login.passwordMismatch') || 'Passwords do not match';
      errEl.style.display = 'block';
      return;
    }

    try {
      errEl.style.display = 'none';
      const res = await API.changePassword('', newPwd);
      API.setToken(res.token);
      document.getElementById('changePasswordModal').style.display = 'none';
      showChangeUsernameModal();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = 'block';
    }
  });

  function showChangeUsernameModal() {
    document.getElementById('changeUsernameModal').style.display = 'flex';
  }

  document.getElementById('changeUsernameForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const newUsername = document.getElementById('newUsername').value;
    const errEl = document.getElementById('changeUsernameError');

    if (!/^[a-zA-Z0-9]+$/.test(newUsername)) {
      errEl.textContent = I18n.t('login.usernameFormat') || 'Username can only contain letters and numbers';
      errEl.style.display = 'block';
      return;
    }

    try {
      errEl.style.display = 'none';
      const res = await API.changeUsername(newUsername);
      API.setToken(res.token);
      window.location.href = '/';
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = 'block';
    }
  });

  document.getElementById('skipUsername').addEventListener('click', () => {
    window.location.href = '/';
  });
})();
