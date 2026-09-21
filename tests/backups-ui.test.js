const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'backups.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');

test('storage target name uses the shared text input style', () => {
  assert.match(source, /<input id="backupProviderName" type="text"/);
});

test('backup plan text fields and daily schedule time use styled input types', () => {
  assert.match(source, /<input id="backupPlanName" type="text"/);
  assert.match(source, /<input id="backupPlanRemotePath" type="text"/);
  assert.match(source, /<input type="text" class="volume-path-input"/);
  assert.match(source, /<input type="time" id="backupScheduleTime"/);
  assert.match(source, /backupRetentionCount/);
  assert.match(source, /不会删除项目容器或挂载卷数据/);
  assert.match(css, /input\[type="time"\]/);
});

test('R2 form identifies the S3 API endpoint and retains required API credentials', () => {
  assert.match(source, /this\.t\('r2Endpoint', 'S3 API Endpoint'\)/);
  assert.match(source, /this\.t\('r2AccessKeyId', 'Access Key ID'\)/);
  assert.match(source, /this\.t\('r2SecretAccessKey', 'Secret Access Key'\)/);
  assert.match(source, /管理 R2 API Token/);
  assert.match(source, /Access Key ID 为 32 位，Secret Access Key 为 64 位/);
});
