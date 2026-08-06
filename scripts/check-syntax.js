const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const yaml = require('js-yaml');

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

function findPosixShell() {
  if (process.platform !== 'win32') return 'sh';
  const whereGit = spawnSync('where.exe', ['git'], { encoding: 'utf8' });
  const gitPath = String(whereGit.stdout || '').split(/\r?\n/).find(Boolean);
  if (!gitPath) return null;
  const gitRoot = path.resolve(path.dirname(gitPath), '..');
  return [path.join(gitRoot, 'bin', 'sh.exe'), path.join(gitRoot, 'usr', 'bin', 'sh.exe')]
    .find(candidate => fs.existsSync(candidate)) || null;
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

const installerPath = 'install.sh';
const installerLines = fs.readFileSync(installerPath, 'utf8').split(/\r?\n/);
for (let index = 0; index < installerLines.length - 1; index += 1) {
  if (installerLines[index].trimEnd().endsWith('\\') && installerLines[index + 1].trimStart().startsWith('#')) {
    process.stderr.write(`${installerPath}:${index + 1}: continued command is truncated by the following comment\n`);
    process.exit(1);
  }
}

const posixShell = findPosixShell();
if (posixShell) {
  const shellCheck = spawnSync(posixShell, ['-n', installerPath], { encoding: 'utf8' });
  if (shellCheck.status !== 0) {
    process.stderr.write(shellCheck.stderr || shellCheck.stdout || 'install.sh failed shell syntax validation\n');
    process.exit(shellCheck.status || 1);
  }
}

try {
  const compose = yaml.load(fs.readFileSync('docker-compose.yml', 'utf8'));
  if (!compose || !compose.services || !compose.services.jewel) throw new Error('services.jewel is required');
} catch (err) {
  process.stderr.write(`docker-compose.yml: ${err.message}\n`);
  process.exit(1);
}

process.stdout.write(`Syntax OK: ${files.length} JavaScript files, ${jsonFiles.length} language files, install.sh, docker-compose.yml\n`);
