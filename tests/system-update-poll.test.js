const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'public', 'js', 'app.js'), 'utf8');
const settings = fs.readFileSync(path.join(root, 'public', 'js', 'settings.js'), 'utf8');

test('a page refresh performs a fresh Jewel update check without blocking navigation', () => {
  assert.match(app, /const info = await API\.forceCheckUpdate\(\)/);
  assert.match(app, /this\.pollUpdate\(\);/);
  assert.match(settings, /this\.checkUpdate\(true\);/);
});
