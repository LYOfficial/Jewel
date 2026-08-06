const express = require('express');
const path = require('path');
const helmet = require('helmet');
const config = require('./config');
const updateService = require('./update-service');
const projectUpdateService = require('./project-update-service');

const routesAuth = require('./routes-auth');
const routesProjects = require('./routes-projects');
const routesContainers = require('./routes-containers');
const routesImages = require('./routes-images');
const routesGit = require('./routes-git');
const routesSystem = require('./routes-system');
const routesTokens = require('./routes-tokens');
const routesBackups = require('./routes-backups');
const backupService = require('./backup-service');

const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// If updating flag is set, serve upgrading page for all non-static requests
app.use((req, res, next) => {
  if (updateService.isUpdating() && !req.path.startsWith('/css') && !req.path.startsWith('/js') && !req.path.startsWith('/img') && !req.path.startsWith('/lang') && !req.path.startsWith('/api')) {
    return res.status(503).sendFile(path.join(__dirname, '..', 'public', 'upgrading.html'));
  }
  next();
});

app.use('/api/auth', routesAuth);
app.use('/api/projects', routesProjects);
// Mount images router BEFORE containers so that /api/containers/images
// doesn't get caught by containers' /:id wildcard.
app.use('/api/containers/images', routesImages);
app.use('/api/containers', routesContainers);
app.use('/api/git', routesGit);
app.use('/api/system', routesSystem);
app.use('/api/tokens', routesTokens);
app.use('/api/backups', routesBackups);

// Fallback error handler — ensure API errors return JSON, not HTML
app.use((err, req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
  }
  next(err);
});

// SPA catch-all: serve index.html for any non-API, non-static path so that
// deep links like /containers, /project, /settings work after a page refresh.
app.get(/^(?!\/api\/)(?!\/css\/)(?!\/js\/)(?!\/img\/)(?!\/lang\/)(?!\/login\.html)(?!\/upgrading\.html).*/, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Periodic checks: Jewel self-update + project commit updates.
// The project loop staggers per-project on its own (see
// project-update-service.js), so we just need to keep the two
// background tasks from colliding with each other.
const SELF_UPDATE_INTERVAL_MS = 30 * 60 * 1000;
const PROJECT_UPDATE_INTERVAL_MS = 10 * 60 * 1000;

setInterval(() => {
  updateService.checkForUpdate().catch(() => {});
}, SELF_UPDATE_INTERVAL_MS);

setInterval(() => {
  projectUpdateService.checkProjectUpdates().catch(() => {});
}, PROJECT_UPDATE_INTERVAL_MS);

updateService.checkForUpdate().catch(() => {});
projectUpdateService.checkProjectUpdates().catch(() => {});
backupService.startScheduler();

// Clear stale updating flag on startup (means we successfully restarted after update)
updateService.clearUpdatingFlag();

app.listen(config.port, () => {
  console.log(`Jewel running on http://localhost:${config.port}`);
});
