const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const installer = fs.readFileSync(path.join(root, 'install.sh'), 'utf8');
const imageRoutes = fs.readFileSync(path.join(root, 'src', 'routes-images.js'), 'utf8');
const imageUi = fs.readFileSync(path.join(root, 'public', 'js', 'images.js'), 'utf8');

test('successful Jewel updates remove stale dangling Jewel images only', () => {
  assert.match(installer, /cleanup_stale_jewel_images\(\)/);
  assert.match(installer, /docker image ls -a --filter dangling=true --quiet/);
  assert.match(installer, /io\.jewel\.managed/);
  assert.match(installer, /JEWEL_COMMIT=/);
  assert.match(installer, /docker image rm "\$image_id"/);
  assert.ok(
    installer.indexOf('cleanup_stale_jewel_images\n\necho') > installer.indexOf('docker rm "$ROLLBACK_CONTAINER"'),
    'cleanup must run only after a healthy update has removed the rollback container'
  );
});

test('image API keeps untagged images out of the normal list but reports them accurately', () => {
  assert.match(imageRoutes, /is_dangling: !hasTag/);
  assert.match(imageRoutes, /danglingCount: danglingImages\.length/);
  assert.match(imageRoutes, /img\.in_use \|\| \(!img\.is_build_cache && !img\.is_dangling\)/);
});

test('untagged images are rendered with a visible prunable label when shown', () => {
  assert.match(imageUi, /I18n\.t\('images\.untagged'\) \|\| '无标签（可清理）'/);
  assert.doesNotMatch(imageUi, /tags\.length \? esc\(tags\[0\]\) : '<none>'/);
});
