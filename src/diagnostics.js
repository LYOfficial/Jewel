const SECRET_PATTERNS = [
  /(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s,;]+/gi,
  /((?:access[_-]?key|secret[_-]?key|api[_-]?key|token|password|passwd|pwd|cookie|bduss)\s*[:=]\s*)[^\s,;]+/gi,
  /(https?:\/\/)([^\s/@:]+):([^\s/@]+)@/gi,
  /([?&](?:token|access_token|secret|password|key)=)[^&\s]+/gi,
  /\b(ghp|glpat|github_pat)_[A-Za-z0-9_-]+\b/g
];

function redactSecrets(value) {
  let text = String(value == null ? '' : value);
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, (match, prefix) => {
      if (/^https?:\/\//i.test(match)) return `${prefix}***:***@`;
      if (/^(ghp|glpat|github_pat)_/i.test(match)) return '[REDACTED_TOKEN]';
      return `${prefix || ''}[REDACTED]`;
    });
  }
  return text;
}

function tailLines(value, limit = 300) {
  const lines = String(value || '').split(/\r?\n/);
  return lines.slice(Math.max(0, lines.length - limit)).join('\n');
}

function buildDiagnosticReport({ operation, project, deployLog = '', extra = '' }) {
  const meta = parseJson(operation && operation.metadata, {});
  const lines = [
    '# Jewel diagnostic report',
    '',
    `Generated: ${new Date().toISOString()}`,
    `Operation ID: ${operation && operation.id ? operation.id : '-'}`,
    `Action: ${(operation && operation.action) || '-'}`,
    `Status: ${(operation && operation.status) || '-'}`,
    `Started: ${(operation && operation.started_at) || '-'}`,
    `Finished: ${(operation && operation.finished_at) || '-'}`,
    '',
    '## Project',
    `Name: ${(project && project.name) || meta.project_name || '-'}`,
    `ID: ${(project && project.id) || (operation && operation.project_id) || '-'}`,
    `Git branch: ${(project && project.git_branch) || '-'}`,
    `Compose path: ${(project && project.compose_path) || '-'}`,
    `Commit: ${(operation && operation.commit_hash) || (project && project.commit_hash) || '-'}`,
    '',
    '## Failure summary',
    (operation && operation.summary) || 'No summary was recorded.',
    '',
    '## Error detail',
    (operation && operation.detail) || 'No detail was recorded.'
  ];

  if (extra) lines.push('', '## Additional context', extra);
  if (deployLog) lines.push('', '## Recent deploy log', '```text', tailLines(deployLog, 400), '```');
  lines.push('', 'Sensitive values were automatically redacted by Jewel.');
  return redactSecrets(lines.join('\n'));
}

function parseJson(value, fallback) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}

module.exports = { redactSecrets, tailLines, buildDiagnosticReport, parseJson };
