const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('Docker multiplexed logs are decoded without control headers', () => {
  const dockerService = require('../src/docker-service');
  const first = Buffer.from('hello\n');
  const second = Buffer.from('world\n');
  const frame = (stream, payload) => Buffer.concat([
    Buffer.from([stream, 0, 0, 0]),
    Buffer.from([(payload.length >>> 24) & 255, (payload.length >>> 16) & 255, (payload.length >>> 8) & 255, payload.length & 255]),
    payload
  ]);
  assert.equal(dockerService.decodeDockerLogStream(Buffer.concat([frame(1, first), frame(2, second)])), 'hello\nworld\n');
});

test('account schema and project assignment API are present', () => {
  const databaseSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'database.js'), 'utf8');
  const usersSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes-users.js'), 'utf8');
  assert.match(databaseSource, /role TEXT NOT NULL DEFAULT 'admin'/);
  assert.match(databaseSource, /project_user_assignments/);
  assert.match(usersSource, /project_ids/);
  assert.match(usersSource, /Only maintainer accounts can receive project assignments/);
});

test('maintainers keep backup and MCP access while platform administration stays restricted', () => {
  const indexSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const backupRoutes = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes-backups.js'), 'utf8');
  const mcpRoutes = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes-mcp-management.js'), 'utf8');
  assert.match(indexSource, /data-page="backups" href="\/backups"/);
  assert.match(indexSource, /data-page="mcp" href="\/mcp"/);
  assert.doesNotMatch(indexSource, /data-page="backups"[^>]*admin-only/);
  assert.doesNotMatch(indexSource, /data-page="mcp"[^>]*admin-only/);
  assert.match(backupRoutes, /router\.use\(authMiddleware\);/);
  assert.match(mcpRoutes, /router\.use\(authMiddleware\);/);
});
