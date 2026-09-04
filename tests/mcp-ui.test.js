const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('MCP address and token-name fields opt into the shared text-input style', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'mcp.js'), 'utf8');
  assert.match(source, /<input id="mcpEndpoint" type="text" readonly>/);
  assert.match(source, /<input id="newMcpTokenName" type="text" maxlength="100"/);
  assert.match(source, /<input id="createdMcpToken" type="text" readonly/);
});
