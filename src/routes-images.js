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
      const shortId = id ? id.replace(/^sha256:/, '').substring(0, 12) : '';
      return {
        ...img,
        shortId,
        in_use: containers.length > 0,
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
    const buildCacheCount = decorated.filter(i => !i.in_use && i.is_build_cache).length;
    const buildCacheSize = decorated.filter(i => !i.in_use && i.is_build_cache).reduce((s, i) => s + (i.Size || 0), 0);

    // Hide pure build-cache intermediates from the default list. These are
    // untagged parents of other images — they cannot be deleted one-by-one
    // (Docker returns 409 "dependent child images"), they're never useful to
    // the user as standalone entries, and they accumulate quickly during
    // iterative `docker build` cycles. The user only needs to see them in
    // the totals and clean them via "Prune Unused" → builder prune.
    //
    // Query opt-out: `?all=true` returns the unfiltered list so /history,
    // /:id and the detail modal keep working for these images.
    const showAll = req.query.show_all === 'true';
    const visibleImages = showAll
      ? decorated
      : decorated.filter(img => img.in_use || !img.is_build_cache);

    res.json({
      images: visibleImages,
      totals: {
        count: decorated.length,
        inUseCount: decorated.filter(i => i.in_use).length,
        unusedCount: decorated.filter(i => !i.in_use).length,
        buildCacheCount,
        buildCacheSize,
        visibleCount: visibleImages.length,
        hiddenCount: decorated.length - visibleImages.length,
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
