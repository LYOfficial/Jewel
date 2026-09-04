const express = require('express');
const mcpAuth = require('./mcp-auth-service');
const mcpService = require('./mcp-service');
const pkg = require('../package.json');

const router = express.Router();
const supportedProtocolVersions = new Set(['2025-06-18', '2025-03-26', '2024-11-05']);

function jsonRpc(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: '2.0', id: id === undefined ? null : id, error };
}

function send(res, payload, status = 200, sessionId = null) {
  res.status(status);
  res.type('application/json');
  res.set('Cache-Control', 'no-store');
  if (sessionId) res.set('Mcp-Session-Id', sessionId);
  res.json(payload);
}

function selectedProtocolVersion(value) {
  return supportedProtocolVersions.has(value) ? value : '2025-03-26';
}

router.options('/', (req, res) => {
  res.set('Allow', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, X-Jewel-Access-Key, Mcp-Session-Id');
  res.status(204).end();
});

function authenticateRequest(req, res) {
  const auth = mcpAuth.authenticate(req);
  if (!auth.ok) {
    res.set('WWW-Authenticate', 'Bearer realm="Jewel MCP"');
    res.status(401).json({ error: auth.error });
    return null;
  }
  return auth;
}

// Some Streamable HTTP clients probe the MCP endpoint with a GET before
// issuing initialize. Keep an authenticated SSE stream open so those clients
// can discover the endpoint instead of treating a 405 as a failed connector.
router.get('/', (req, res) => {
  if (!authenticateRequest(req, res)) return;
  res.status(200);
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders();
  res.write(': Jewel MCP stream ready\n\n');
  const heartbeat = setInterval(() => res.write(': keepalive\n\n'), 25000);
  if (heartbeat.unref) heartbeat.unref();
  req.on('close', () => clearInterval(heartbeat));
});

router.post('/', async (req, res) => {
  const auth = authenticateRequest(req, res);
  if (!auth) return;

  const message = req.body;
  if (!message || Array.isArray(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return send(res, jsonRpcError(message && message.id, -32600, 'Invalid JSON-RPC request'), 400);
  }
  const id = message.id;

  // JSON-RPC notifications intentionally have no response body.
  if (id === undefined) return res.status(202).end();

  try {
    if (message.method === 'initialize') {
      const sessionId = `jwl_mcp_${require('crypto').randomBytes(18).toString('base64url')}`;
      return send(res, jsonRpc(id, {
        protocolVersion: selectedProtocolVersion(message.params && message.params.protocolVersion),
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'Jewel MCP', version: pkg.version },
        instructions: 'Use existing Jewel projects only. Destructive delete, container/image removal, arbitrary command execution, and secret reads are not exposed.'
      }), 200, sessionId);
    }

    if (message.method === 'ping') return send(res, jsonRpc(id, {}));
    if (message.method === 'tools/list') return send(res, jsonRpc(id, { tools: mcpService.tools }));
    if (message.method !== 'tools/call') return send(res, jsonRpcError(id, -32601, 'Method not found'));

    const toolName = message.params && message.params.name;
    if (typeof toolName !== 'string') return send(res, jsonRpcError(id, -32602, 'tools/call requires a tool name'));
    try {
      const output = await mcpService.callTool(toolName, message.params.arguments || {});
      mcpAuth.audit({ tokenId: auth.token.id, event: 'tool_called', toolName, detail: 'Tool completed', req });
      return send(res, jsonRpc(id, {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        structuredContent: output
      }));
    } catch (err) {
      const detail = err && err.report
        ? `${err.message}\n\n${err.report}`
        : (err && err.message ? err.message : 'Tool execution failed');
      mcpAuth.audit({ tokenId: auth.token.id, event: 'tool_called', toolName, success: false, detail, req });
      return send(res, jsonRpc(id, {
        content: [{ type: 'text', text: detail }],
        isError: true
      }));
    }
  } catch (err) {
    return send(res, jsonRpcError(id, -32603, 'Internal MCP error'));
  }
});

module.exports = router;
