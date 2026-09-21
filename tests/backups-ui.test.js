const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'backups.js'), 'utf8');

test('storage target name uses the shared text input style', () => {
  assert.match(source, /<input id="backupProviderName" type="text"/);
});

test('R2 form identifies the S3 API endpoint and retains required API credentials', () => {
  assert.match(source, /this\.t\('r2Endpoint', 'S3 API Endpoint'\)/);
  assert.match(source, /this\.t\('r2AccessKeyId', 'Access Key ID'\)/);
  assert.match(source, /this\.t\('r2SecretAccessKey', 'Secret Access Key'\)/);
  assert.match(source, /管理 R2 API Token/);
});
