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

    let res;
    try {
      res = await fetch(`${this.baseUrl}${path}`, options);
    } catch (err) {
      throw new Error('Network error: ' + (err && err.message ? err.message : 'fetch failed'));
    }

    if (res.status === 401) {
      this.clearToken();
      window.location.href = '/login.html';
      throw new Error('Unauthorized');
    }

    if (res.status === 503) {
      window.location.href = '/upgrading.html';
      throw new Error('Service upgrading');
    }

    // Read the response body as text first, then try to parse it as JSON.
    // The server should always return JSON for /api/* routes, but in
    // practice it sometimes returns HTML (e.g. when the SPA catch-all
    // serves index.html for an unknown path, or when an unhandled
    // exception escapes to Express's default error handler). Trying to
    // parse such responses with res.json() throws a confusing
    // "Unexpected token <" SyntaxError that the user sees as
    // "缺少 '<'" / "缺少 ','".
    let text = '';
    try { text = await res.text(); } catch (err) { /* ignore */ }

    let data = null;
    if (text) {
      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      if (contentType.includes('application/json') || text.trim().startsWith('{') || text.trim().startsWith('[')) {
        try {
          data = JSON.parse(text);
        } catch (err) {
          // Fall through; we'll build a clearer error below.
        }
      }
    }

    if (data === null) {
      // Not JSON. Build a useful message from the first chunk of the body.
      const snippet = (text || '').replace(/\s+/g, ' ').trim().substring(0, 160);
      const msg = snippet
        ? `Request failed (HTTP ${res.status}): ${snippet}`
        : `Request failed (HTTP ${res.status})`;
      throw new Error(msg);
    }

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
  rebuildProject(id) { return this.post(`/projects/${id}/rebuild`); },
  stopProject(id) { return this.post(`/projects/${id}/stop`); },
  restartProject(id) { return this.post(`/projects/${id}/restart`); },
  getProjectContainers(id) { return this.get(`/projects/${id}/containers`); },
  getProjectLogs(id) { return this.get(`/projects/${id}/logs`); },
  getProjectDeployLog(id) { return this.get(`/projects/${id}/deploy-log`); },
  captureProjectFailedLogs(id, tail = 500) {
    return this.post(`/projects/${id}/capture-failed-logs?tail=${encodeURIComponent(tail)}`);
  },
  checkProjectUpdate(id) { return this.post(`/projects/${id}/check-update`); },

  // Containers
  getContainers(all = false) { return this.get(`/containers?all=${all}`); },
  getContainer(id) { return this.get(`/containers/${id}`); },
  startContainer(id) { return this.post(`/containers/${id}/start`); },
  stopContainer(id) { return this.post(`/containers/${id}/stop`); },
  killContainer(id) { return this.post(`/containers/${id}/kill`); },
  restartContainer(id) { return this.post(`/containers/${id}/restart`); },
  pauseContainer(id) { return this.post(`/containers/${id}/pause`); },
  unpauseContainer(id) { return this.post(`/containers/${id}/unpause`); },
  removeContainer(id, options = {}) {
    const params = new URLSearchParams();
    if (options.force !== undefined) params.set('force', options.force);
    if (options.removeVolumes) params.set('removeVolumes', 'true');
    if (options.removeImage) params.set('removeImage', 'true');
    return this.del(`/containers/${id}?${params.toString()}`);
  },
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

  // Images
  getImages(all = true, showAll = false) {
    const params = new URLSearchParams();
    params.set('all', all);
    if (showAll) params.set('show_all', 'true');
    return this.get(`/containers/images?${params.toString()}`);
  },
  getImage(id) { return this.get(`/containers/images/${id}`); },
  removeImage(id, options = {}) {
    const params = new URLSearchParams();
    if (options.force !== undefined) params.set('force', options.force);
    if (options.noprune !== undefined) params.set('noprune', options.noprune);
    return this.del(`/containers/images/${id}?${params.toString()}`);
  },
  pruneImages() { return this.post('/containers/images/prune'); },
  getImageHistory(id) { return this.get(`/containers/images/${id}/history`); },

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
  getTimezone() { return this.get('/system/timezone'); },
  getNotes() { return this.get('/system/notes'); },
  updateNotes(data) { return this.put('/system/notes', data); }
};
