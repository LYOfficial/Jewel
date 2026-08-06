const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const roots = ['src', path.join('public', 'js'), 'scripts'];
const files = [];
const jsonFiles = fs.readdirSync(path.join('public', 'lang'))
  .filter(name => name.endsWith('.json'))
  .map(name => path.join('public', 'lang', name));

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(full);
  }
}

for (const root of roots) walk(root);
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status || 1);
  }
}

for (const file of jsonFiles) {
  try {
    JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    process.stderr.write(`${file}: ${err.message}\n`);
    process.exit(1);
  }
}

process.stdout.write(`Syntax OK: ${files.length} JavaScript files, ${jsonFiles.length} language files\n`);
