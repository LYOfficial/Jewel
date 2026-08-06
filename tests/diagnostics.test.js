const test = require('node:test');
const assert = require('node:assert/strict');
const { redactSecrets, tailLines, buildDiagnosticReport } = require('../src/diagnostics');

test('redacts common credentials from diagnostics', () => {
  const source = [
    'Authorization: Bearer abc.def.ghi',
    'token=super-secret',
    'password: hunter2',
    'https://user:pass@example.com/repo.git',
    'https://example.com/?access_token=secret-value',
    'ghp_abcdefghijklmnopqrstuvwxyz'
  ].join('\n');
  const redacted = redactSecrets(source);
  assert.doesNotMatch(redacted, /abc\.def\.ghi|super-secret|hunter2|user:pass|secret-value|ghp_abcdefghijklmnopqrstuvwxyz/);
  assert.match(redacted, /REDACTED/);
});

test('keeps only the requested number of tail lines', () => {
  assert.equal(tailLines('1\n2\n3\n4', 2), '3\n4');
});

test('builds a copy-ready project report', () => {
  const report = buildDiagnosticReport({
    operation: { id: 8, action: 'deploy', status: 'failed', summary: 'Build failed', detail: 'token=secret', started_at: 'now' },
    project: { id: 3, name: 'demo', git_branch: 'main', compose_path: 'compose.yml', commit_hash: 'abc' },
    deployLog: 'line 1\npassword=secret\nline 3'
  });
  assert.match(report, /Jewel diagnostic report/);
  assert.match(report, /Build failed/);
  assert.doesNotMatch(report, /token=secret|password=secret/);
});
