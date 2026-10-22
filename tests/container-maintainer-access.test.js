const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { Readable } = require('stream');

test('maintainers operate assigned containers without access to other containers or host tools', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jewel-container-access-'));
  process.env.DATA_DIR = dataDir;
  const db = require('../src/database');
  const { generateToken } = require('../src/auth');
  const dockerService = require('../src/docker-service');
  const original = {
    listContainers: dockerService.listContainers,
    getContainerInfo: dockerService.getContainerInfo,
    getContainer: dockerService.getContainer,
    startContainer: dockerService.startContainer
  };
  const express = require('express');
  const childProcess = require('child_process');
  const originalExecFileSync = childProcess.execFileSync;
  const containerFiles = new Map();
  childProcess.execFileSync = (binary, args) => {
    assert.equal(binary, 'docker');
    assert.equal(args[0], 'cp');
    if (args[1].startsWith('owned-id:')) {
      fs.writeFileSync(args[2], containerFiles.get(args[1].slice('owned-id:'.length)));
    } else {
      containerFiles.set(args[2].slice('owned-id:'.length), fs.readFileSync(args[1]));
    }
  };
  const app = express();
  app.use(express.json());
  app.use('/api/containers', require('../src/routes-containers'));
  childProcess.execFileSync = originalExecFileSync;
  const server = http.createServer(app);

  const userId = Number(db.prepare("INSERT INTO users (username, password, role) VALUES ('operator', 'unused', 'maintainer')").run().lastInsertRowid);
  const projectId = Number(db.prepare("INSERT INTO projects (name, git_url) VALUES ('owned', 'unused')").run().lastInsertRowid);
  db.prepare('INSERT INTO project_user_assignments (user_id, project_id) VALUES (?, ?)').run(userId, projectId);
  db.prepare("INSERT INTO projects (name, git_url) VALUES ('other', 'unused')").run();
  const token = generateToken({ id: userId, username: 'operator', role: 'maintainer' });
  const admin = db.prepare("SELECT id, username, role FROM users WHERE role='admin' LIMIT 1").get();
  const adminToken = generateToken(admin);
  const containers = [
    { Id: 'owned-id', Labels: { 'com.docker.compose.project': 'owned' }, Mounts: [{ Type: 'bind', Source: '/secret/host', Destination: '/data' }] },
    { Id: 'other-id', Labels: { 'com.docker.compose.project': 'other' } },
    { Id: 'standalone-id', Labels: {} },
    { Id: 'socket-id', Labels: { 'com.docker.compose.project': 'owned' } },
    { Id: 'socket-dir-id', Labels: { 'com.docker.compose.project': 'owned' } },
    { Id: 'host-root-id', Labels: { 'com.docker.compose.project': 'owned' } },
    { Id: 'host-network-id', Labels: { 'com.docker.compose.project': 'owned' } },
    { Id: 'spoofed-id', Labels: { 'com.docker.compose.project': 'owned' } },
    { Id: 'jewel-id', Labels: { 'com.docker.compose.project': 'owned', 'io.jewel.managed': 'true' } }
  ];
  let starts = 0;
  dockerService.listContainers = async () => containers;
  dockerService.getContainerInfo = async id => ({
    Id: id,
    Name: `/${id}`,
    Config: { Image: 'example', Env: ['TOKEN=hidden'], Labels: id === 'spoofed-id'
      ? { 'com.docker.compose.project': 'other' }
      : containers.find(item => item.Id === id)?.Labels || {} },
    Mounts: id === 'socket-id'
      ? [{ Source: '/var/run/docker.sock', Destination: '/var/run/docker.sock' }]
      : id === 'socket-dir-id' ? [{ Type: 'bind', Source: '/var/run', Destination: '/host-run' }]
      : id === 'host-root-id' ? [{ Type: 'bind', Source: '/', Destination: '/host' }]
      : id === 'owned-id' ? [{ Type: 'bind', Source: '/secret/host', Destination: '/data', Mode: 'rw', RW: true }] : [],
    HostConfig: { Privileged: false, NetworkMode: id === 'host-network-id' ? 'host' : 'bridge' }
  });
  dockerService.getContainer = async () => ({
    exec: async options => ({ start: async () => Readable.from([Buffer.from(options.Cmd[0] === 'ls'
      ? '-rw-r--r-- 1 root root 12 Oct 22 12:00 example.txt\ndrwxr-xr-x 2 root root 4096 Oct 22 12:00 folder with spaces\n' : 'ok')]) })
  });
  dockerService.startContainer = async () => { starts += 1; };

  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/containers`;
    const request = (route, method = 'GET', body, bearer = token) => fetch(base + route, {
      method,
      headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    const list = await request('/?all=true');
    assert.equal(list.status, 200);
    const listed = await list.json();
    assert.deepEqual(listed.map(item => item.Id), ['owned-id']);
    assert.equal(listed[0].Config, undefined);
    assert.equal(listed[0].Mounts[0].Source, undefined);
    const adminList = await request('/', 'GET', null, adminToken);
    assert.equal((await adminList.json()).length, containers.length);

    const details = await request('/owned-id');
    assert.equal(details.status, 200);
    assert.equal((await details.json()).Config.Env, undefined);
    const mounts = await request('/owned-id/mounts');
    assert.equal((await mounts.json()).mounts[0].source, '');
    assert.equal((await request('/owned-id/start', 'POST')).status, 200);
    assert.equal(starts, 1);
    assert.equal((await request('/owned-id/exec', 'POST', { cmd: 'pwd' })).status, 200);
    const files = await request('/owned-id/files');
    assert.equal(files.status, 200);
    assert.deepEqual((await files.json()).files.map(item => item.name), ['example.txt', 'folder with spaces']);
    const filePath = "/tmp/a'$(whoami).txt";
    const upload = await fetch(`${base}/owned-id/upload?path=${encodeURIComponent(filePath)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
      body: Buffer.from([0, 1, 2, 255])
    });
    assert.equal(upload.status, 200);
    assert.deepEqual(containerFiles.get(filePath), Buffer.from([0, 1, 2, 255]));
    assert.equal((await request('/owned-id/file', 'PUT', { path: filePath, content: 'JEWEL_EOF\nhello' })).status, 200);
    assert.equal(containerFiles.get(filePath).toString(), 'JEWEL_EOF\nhello');
    const download = await request(`/owned-id/download?path=${encodeURIComponent(filePath)}`);
    assert.equal(download.status, 200);
    assert.equal(await download.text(), 'JEWEL_EOF\nhello');
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM operation_logs WHERE resource_id='owned-id' AND action='container-exec'").get().count, 1);

    for (const id of ['other-id', 'standalone-id', 'socket-id', 'socket-dir-id', 'host-root-id', 'host-network-id', 'spoofed-id', 'jewel-id']) {
      assert.equal((await request(`/${id}/exec`, 'POST', { cmd: 'pwd' })).status, 403);
    }
    assert.equal((await request('/owned-id', 'DELETE')).status, 403);
    assert.equal((await request('/host/browse')).status, 403);
    db.prepare('DELETE FROM project_user_assignments WHERE user_id=?').run(userId);
    assert.equal((await request('/owned-id/exec', 'POST', { cmd: 'pwd' })).status, 403);
  } finally {
    await new Promise(resolve => server.close(resolve));
    Object.assign(dockerService, original);
    childProcess.execFileSync = originalExecFileSync;
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
