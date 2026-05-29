const express = require('express');
const path = require('path');
const helmet = require('helmet');
const config = require('./config');
const updateService = require('./update-service');
const projectUpdateService = require('./project-update-service');

const routesAuth = require('./routes-auth');
const routesProjects = require('./routes-projects');
const routesContainers = require('./routes-containers');
const routesGit = require('./routes-git');
const routesSystem = require('./routes-system');
const routesTokens = require('./routes-tokens');

const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// If updating flag is set, serve upgrading page for all non-static requests
app.use((req, res, next) => {
  if (updateService.isUpdating() && !req.path.startsWith('/css') && !req.path.startsWith('/js') && !req.path.startsWith('/img') && !req.path.startsWith('/lang')) {
    return res.status(503).sendFile(path.join(__dirname, '..', 'public', 'upgrading.html'));
  }
  next();
});

app.use('/api/auth', routesAuth);
app.use('/api/projects', routesProjects);
app.use('/api/containers', routesContainers);
app.use('/api/git', routesGit);
app.use('/api/system', routesSystem);
app.use('/api/tokens', routesTokens);

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Periodic checks: Jewel self-update + project commit updates
setInterval(() => {
  updateService.checkForUpdate().catch(() => {});
  projectUpdateService.checkProjectUpdates().catch(() => {});
}, 5 * 60 * 1000);

updateService.checkForUpdate().catch(() => {});
projectUpdateService.checkProjectUpdates().catch(() => {});

// Clear stale updating flag on startup (means we successfully restarted after update)
updateService.clearUpdatingFlag();

app.listen(config.port, () => {
  console.log(`Jewel running on http://localhost:${config.port}`);
});
