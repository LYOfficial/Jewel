const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'public', 'css', 'style.css'), 'utf8');
const projects = fs.readFileSync(path.join(root, 'public', 'js', 'projects.js'), 'utf8');
const containers = fs.readFileSync(path.join(root, 'public', 'js', 'containers.js'), 'utf8');
const images = fs.readFileSync(path.join(root, 'public', 'js', 'images.js'), 'utf8');

test('desktop pages stay fixed while dense card content scrolls internally', () => {
  assert.match(css, /@media \(min-width: 769px\)[\s\S]*?html, body, \.app-layout \{ height: 100%; overflow: hidden; \}/);
  assert.match(css, /\.list-page \.table-container \{[\s\S]*?overflow: auto;/);
  assert.match(css, /\.dashboard-page #recentProjects \{[\s\S]*?overflow: auto;/);
  assert.match(css, /\.dashboard-page \.notebook-card \{ height: auto; max-height: none; \}/);
  assert.match(projects, /page-shell list-page projects-page/);
  assert.match(containers, /page-shell list-page containers-page/);
  assert.match(images, /page-shell list-page images-page/);
});

test('touch-sized viewports fall back to a single natural page scroll', () => {
  assert.match(css, /@media \(max-width: 768px\)[\s\S]*?html, body \{ height: auto; min-height: 100%; overflow: auto; \}/);
});
