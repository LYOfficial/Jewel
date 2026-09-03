const express = require('express');
const { authMiddleware } = require('./auth');
const dockerService = require('./docker-service');

// This router is mounted at /api/containers/images in index.js — BEFORE the
// main /api/containers router. Doing so ensures that paths like
// /api/containers/images never get matched by the main router's
// /:id wildcard (which would otherwise call Docker's
// `GET /containers/images/json` and produce the confusing
// "no such container: images" 404).

const router = express.Router();
router.use(authMiddleware);

router.get('/', async (req, res) => {
  try {
    const all = req.query.all !== 'false';
    const [images, usage, buildCache] = await Promise.all([
      dockerService.listImages(all),
      dockerService.getContainerUsageByImage(all),
      dockerService.getBuildCacheByImage(all)
    ]);

    const decorated = images.map(img => {
      const id = img.Id;
      const containers = usage[id] || [];
      const childCount = buildCache[id] || 0;
      const hasTag = (img.RepoTags || []).some(tag => tag && tag !== '<none>:<none>');
      const shortId = id ? id.replace(/^sha256:/, '').substring(0, 12) : '';
      return {
        ...img,
        shortId,
        in_use: containers.length > 0,
        // Docker denotes an image with no remaining repository tag as
        // `<none>:<none>`.  These are real but normally disposable old
        // builds; they should not look like blank or missing table rows.
        is_dangling: !hasTag,
        is_build_cache: childCount > 0,
        child_count: childCount,
        containers
      };
    });

    decorated.sort((a, b) => {
      if (a.in_use !== b.in_use) return a.in_use ? -1 : 1;
      return (b.Size || 0) - (a.Size || 0);
    });

    const totalSize = decorated.reduce((s, i) => s + (i.Size || 0), 0);
    const inUseSize = decorated.filter(i => i.in_use).reduce((s, i) => s + (i.Size || 0), 0);
    const unusedImages = decorated.filter(i => !i.in_use);
    const buildCacheImages = unusedImages.filter(i => i.is_build_cache);
    // Keep the categories mutually exclusive in the summary: an untagged
    // parent image belongs to build cache rather than being counted twice.
    const danglingImages = unusedImages.filter(i => i.is_dangling && !i.is_build_cache);
    const standaloneUnusedImages = unusedImages.filter(i => !i.is_build_cache && !i.is_dangling);
    const buildCacheCount = buildCacheImages.length;
    const buildCacheSize = buildCacheImages.reduce((s, i) => s + (i.Size || 0), 0);

    // Hide internal build artifacts from the default list. This covers both
    // build-cache parents and dangling (`<none>`) images left after a build
    // or retag. They remain available through `show_all` for diagnosis, but
    // the normal list stays focused on named images the user can recognize.
    //
    // Query opt-out: `?all=true` returns the unfiltered list so /history,
    // /:id and the detail modal keep working for these images.
    const showAll = req.query.show_all === 'true';
    const visibleImages = showAll
      ? decorated
      : decorated.filter(img => img.in_use || (!img.is_build_cache && !img.is_dangling));

    res.json({
      images: visibleImages,
      totals: {
        count: decorated.length,
        inUseCount: decorated.filter(i => i.in_use).length,
        unusedCount: unusedImages.length,
        standaloneUnusedCount: standaloneUnusedImages.length,
        danglingCount: danglingImages.length,
        buildCacheCount,
        buildCacheSize,
        visibleCount: visibleImages.length,
        hiddenCount: decorated.length - visibleImages.length,
        hiddenDanglingCount: danglingImages.length,
        totalSize,
        inUseSize,
        unusedSize: totalSize - inUseSize
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const info = await dockerService.getImageInfo(req.params.id);
    res.json(info);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

router.get('/:id/history', async (req, res) => {
  try {
    const history = await dockerService.getImageHistory(req.params.id);
    res.json({ history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const force = req.query.force === 'true';
    const noprune = req.query.noprune === 'true';
    const result = await dockerService.removeImage(req.params.id, { force, noprune });
    res.json({ message: 'Image removed', result });
  } catch (err) {
    // Docker returns 409 "image has dependent child images" when the
    // user tries to remove a build-cache intermediate. Surface a clean,
    // actionable error instead of leaking the raw Docker message.
    const raw = (err && err.message) || '';
    if (/dependent child images|cannot be forced/i.test(raw)) {
      return res.status(409).json({
        error: 'image has dependent child images',
        hint: 'This image is a Docker build-cache intermediate. Use "Prune Unused" to clean it as part of the build cache.',
        code: 'HAS_CHILD_IMAGES'
      });
    }
    res.status(500).json({ error: raw || 'remove failed' });
  }
});

router.post('/prune', async (req, res) => {
  try {
    const result = await dockerService.pruneImages();
    res.json({ message: 'Unused images pruned', result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
