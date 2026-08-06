const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const installerPath = path.join(root, 'install.sh');
const installer = fs.readFileSync(installerPath, 'utf8');
const updater = fs.readFileSync(path.join(root, 'src', 'update-service.js'), 'utf8');

function findPosixShell() {
  if (process.platform !== 'win32') return 'sh';
  const whereGit = spawnSync('where.exe', ['git'], { encoding: 'utf8' });
  const gitPath = String(whereGit.stdout || '').split(/\r?\n/).find(Boolean);
  if (!gitPath) return null;
  const gitRoot = path.resolve(path.dirname(gitPath), '..');
  return [path.join(gitRoot, 'bin', 'sh.exe'), path.join(gitRoot, 'usr', 'bin', 'sh.exe')]
    .find(candidate => fs.existsSync(candidate)) || null;
}

const posixShell = findPosixShell();

test('install script never continues a command into a comment', () => {
  const lines = installer.split(/\r?\n/);
  for (let index = 0; index < lines.length - 1; index += 1) {
    assert.equal(
      lines[index].trimEnd().endsWith('\\') && lines[index + 1].trimStart().startsWith('#'),
      false,
      `line ${index + 1} continues into a comment and would truncate the shell command`
    );
  }
});

test('installer builds before stopping the current container', () => {
  const build = installer.indexOf('docker build \\');
  const stop = installer.indexOf('docker stop "$CONTAINER"');
  assert.notEqual(build, -1);
  assert.notEqual(stop, -1);
  assert.ok(build < stop, 'candidate image must be built before the current container is stopped');
});

test('installer preserves state and has an automatic rollback path', () => {
  assert.match(installer, /EXISTING_DATA_SOURCE=.*docker inspect/);
  assert.match(installer, /EXISTING_PORT=.*docker inspect/);
  assert.match(installer, /EXISTING_JWT_SECRET=.*read_container_env JWT_SECRET/);
  assert.match(installer, /restore_previous_container\(\)/);
  assert.match(installer, /docker rename "\$ROLLBACK_CONTAINER" "\$CONTAINER"/);
  assert.match(installer, /while \[ "\$ATTEMPT" -lt 30 \]/);
  assert.match(installer, /-v "\$\{DATA_SOURCE\}:\/data"/);
  assert.match(installer, /-e "JWT_SECRET=\$\{JWT_SECRET_VALUE\}"/);
});

test('docker run keeps every required option and the image as its final argument', () => {
  const runBlock = installer.match(/if ! docker run -d \\\n([\s\S]*?)>\/dev\/null; then/);
  assert.ok(runBlock, 'docker run block should be present');
  for (const option of [
    '--name "$CONTAINER"',
    '--restart unless-stopped',
    '-p "${PORT}:330"',
    '-v /var/run/docker.sock:/var/run/docker.sock',
    '-v "${DATA_SOURCE}:/data"',
    '--pids-limit=-1',
    '--ulimit nofile=65536:65536',
    '-e "JEWEL_COMMIT=${COMMIT}"'
  ]) {
    assert.ok(runBlock[1].includes(option), `missing docker run option: ${option}`);
  }
  assert.match(runBlock[1].trimEnd(), /"\$IMAGE"$/);
});

test('self-update downloads the canonical installer with fail-fast curl flags', () => {
  assert.match(updater, /curl -fsSL https:\/\/raw\.githubusercontent\.com\/LYOfficial\/Jewel\/main\/install\.sh \| sh -s -- \$\{hostPort\}/);
  assert.doesNotMatch(updater, /apk add[^\n]+\|\| true/);
});

test('install script passes POSIX shell syntax validation when sh is available', {
  skip: !posixShell
}, () => {
  const result = spawnSync(posixShell, ['-n', installerPath], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
