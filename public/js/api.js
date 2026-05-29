const API = {
  baseUrl: '/api',
  token: localStorage.getItem('jewel-token'),

  setToken(token) {
    this.token = token;
    localStorage.setItem('jewel-token', token);
  },

  clearToken() {
    this.token = null;
    localStorage.removeItem('jewel-token');
  },

  async request(method, path, body = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    const options = { method, headers };
    if (body) options.body = JSON.stringify(body);

    const res = await fetch(`${this.baseUrl}${path}`, options);

    if (res.status === 401) {
      this.clearToken();
      window.location.href = '/login.html';
      throw new Error('Unauthorized');
    }

    if (res.status === 503) {
      window.location.href = '/upgrading.html';
      throw new Error('Service upgrading');
    }

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  },

  get(path) { return this.request('GET', path); },
  post(path, body) { return this.request('POST', path, body); },
  put(path, body) { return this.request('PUT', path, body); },
  del(path) { return this.request('DELETE', path); },

  // Auth
  login(username, password) { return this.post('/auth/login', { username, password }); },
  getMe() { return this.get('/auth/me'); },
  changePassword(current_password, new_password) { return this.post('/auth/change-password', { current_password, new_password }); },
  changeUsername(new_username) { return this.post('/auth/change-username', { new_username }); },

  // Projects
  getProjects() { return this.get('/projects'); },
  getProject(id) { return this.get(`/projects/${id}`); },
  createProject(data) { return this.post('/projects', data); },
  updateProject(id, data) { return this.put(`/projects/${id}`, data); },
  updateProjectEnv(id, env_vars) { return this.put(`/projects/${id}/env`, { env_vars }); },
  deleteProject(id) { return this.del(`/projects/${id}`); },
  deployProject(id) { return this.post(`/projects/${id}/deploy`); },
  stopProject(id) { return this.post(`/projects/${id}/stop`); },
  restartProject(id) { return this.post(`/projects/${id}/restart`); },
  getProjectContainers(id) { return this.get(`/projects/${id}/containers`); },
  getProjectLogs(id) { return this.get(`/projects/${id}/logs`); },

  // Containers
  getContainers(all = false) { return this.get(`/containers?all=${all}`); },
  getContainer(id) { return this.get(`/containers/${id}`); },
  startContainer(id) { return this.post(`/containers/${id}/start`); },
  stopContainer(id) { return this.post(`/containers/${id}/stop`); },
  killContainer(id) { return this.post(`/containers/${id}/kill`); },
  restartContainer(id) { return this.post(`/containers/${id}/restart`); },
  pauseContainer(id) { return this.post(`/containers/${id}/pause`); },
  unpauseContainer(id) { return this.post(`/containers/${id}/unpause`); },
  removeContainer(id, force = false) { return this.del(`/containers/${id}?force=${force}`); },
  getContainerLogs(id, tail = 100) { return this.get(`/containers/${id}/logs?tail=${tail}`); },
  getContainerStats(id) { return this.get(`/containers/${id}/stats`); },
  getContainerMounts(id) { return this.get(`/containers/${id}/mounts`); },
  execInContainer(id, cmd) { return this.post(`/containers/${id}/exec`, { cmd }); },
  getContainerFiles(id, p = '/') { return this.get(`/containers/${id}/files?path=${encodeURIComponent(p)}`); },
  getContainerFile(id, p) { return this.get(`/containers/${id}/file?path=${encodeURIComponent(p)}`); },
  saveContainerFile(id, p, content) { return this.put(`/containers/${id}/file`, { path: p, content }); },
  deleteContainerFile(id, p) { return this.del(`/containers/${id}/file?path=${encodeURIComponent(p)}`); },
  uploadToContainer(id, p, b64) { return this.post(`/containers/${id}/upload`, { path: p, content: b64 }); },
  browseHost(p = '/') { return this.get(`/containers/host/browse?path=${encodeURIComponent(p)}`); },

  // Git
  getGitRepos(token, provider, host) {
    return this.get(`/git/repos?token=${token}&provider=${provider || 'github'}&host=${host || ''}`);
  },

  // Git Tokens
  getTokens() { return this.get('/tokens'); },
  getToken(id) { return this.get(`/tokens/${id}`); },
  createToken(data) { return this.post('/tokens', data); },
  updateToken(id, data) { return this.put(`/tokens/${id}`, data); },
  deleteToken(id) { return this.del(`/tokens/${id}`); },

  // System
  getSystemInfo() { return this.get('/system/info'); },
  getMonitor() { return this.get('/system/monitor'); },
  checkUpdate() { return this.get('/system/update/check'); },
  forceCheckUpdate() { return this.post('/system/update/check'); },
  applyUpdate() { return this.post('/system/update/apply'); },
  getSettings() { return this.get('/system/settings'); },
  updateSettings(data) { return this.put('/system/settings', data); },
  getNotes() { return this.get('/system/notes'); },
  updateNotes(data) { return this.put('/system/notes', data); }
};
