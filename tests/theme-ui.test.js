const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const login = fs.readFileSync(path.join(root, 'public', 'login.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public', 'js', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'css', 'style.css'), 'utf8');

test('the workspace exposes a persistent light and dark theme switch', () => {
  assert.match(index, /id="themeToggle"/);
  assert.match(index, /localStorage\.getItem\('jewel-theme'\)/);
  assert.match(login, /localStorage\.getItem\('jewel-theme'\)/);
  assert.match(app, /applyTheme\(theme\)/);
  assert.match(app, /localStorage\.setItem\('jewel-theme', nextTheme\)/);
  assert.match(css, /html\[data-theme="light"\]/);
  assert.match(css, /html\[data-theme="dark"\]/);
});
