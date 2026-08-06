const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const testFiles = fs.readdirSync('tests')
  .filter(name => name.endsWith('.test.js'))
  .sort()
  .map(name => path.resolve('tests', name));

if (!testFiles.length) {
  process.stderr.write('No test files were found.\n');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...testFiles], {
  stdio: 'inherit',
  env: process.env
});

if (result.error) {
  process.stderr.write(`${result.error.message}\n`);
  process.exit(1);
}
process.exit(result.status == null ? 1 : result.status);
