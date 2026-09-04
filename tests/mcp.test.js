const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

let hasSqlite = true;
try { require.resolve('better-sqlite3'); } catch { hasSqlite = false; }

test('MCP authenticates an access-key/token pair and serves Streamable HTTP tools', { skip: !hasSqlite }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jewel-mcp-'));
  process.env.DATA_DIR = dataDir;
  const db = require('../src/database');
  const mcpAuth = require('../src/mcp-auth-service');
  const express = require('express');
  const routesMcp = require('../src/routes-mcp');
  const app = express();
  app.use(express.json());
  app.use('/mcp-server', routesMcp);
  const server = http.createServer(app);

  try {
    const accessKey = mcpAuth.getAccessKey();
    assert.match(accessKey, /^jwl_ak_/);
    assert.equal(mcpAuth.getAccessKey(), accessKey, 'access key is stable for this platform');
    const created = mcpAuth.createToken({ name: 'test client', expiresInHours: 1 });
    assert.match(created.value, /^jwl_mcp_/);
    assert.equal(mcpAuth.listTokens()[0].status, 'active');

    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const endpoint = `http://127.0.0.1:${port}/mcp-server`;
    const request = async (body, headers = {}) => fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body)
    });
    const credentials = {
      'X-Jewel-Access-Key': accessKey,
      Authorization: `Bearer ${created.value}`
    };

    const denied = await request({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    assert.equal(denied.status, 401);

    const stream = await fetch(endpoint, { headers: credentials });
    assert.equal(stream.status, 200);
    assert.match(stream.headers.get('content-type'), /^text\/event-stream/);
    await stream.body.cancel();

    const initialized = await request({
      jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2025-03-26' }
    }, credentials);
    assert.equal(initialized.status, 200);
    assert.equal((await initialized.json()).result.serverInfo.name, 'Jewel MCP');
    assert.match(initialized.headers.get('mcp-session-id'), /^jwl_mcp_/);

    const tools = await request({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, credentials);
    const toolsResult = await tools.json();
    assert.equal(toolsResult.result.tools.some(tool => tool.name === 'jewel_update_project'), true);
    assert.equal(toolsResult.result.tools.some(tool => /delete|remove|exec/.test(tool.name)), false);

    const projects = await request({
      jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'jewel_list_projects', arguments: {} }
    }, credentials);
    const projectsResult = await projects.json();
    assert.equal(projectsResult.result.content[0].type, 'text');
    assert.deepEqual(JSON.parse(projectsResult.result.content[0].text), []);

    const revoked = mcpAuth.revokeToken(created.token.id);
    assert.ok(revoked.revoked_at);
    const revokedRequest = await request({ jsonrpc: '2.0', id: 5, method: 'tools/list' }, credentials);
    assert.equal(revokedRequest.status, 401);
    assert.equal(mcpAuth.listAuditLogs().some(row => row.event === 'tool_called'), true);
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
