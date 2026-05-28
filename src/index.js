const express = require('express');
const path = require('path');
const helmet = require('helmet');
const db = require('./database');
const config = require('./config');
const updateService = require('./update-service');

const routesAuth = require('./routes-auth');
const routesProjects = require('./routes-projects');
const routesContainers = require('./routes-containers');
const routesGit = require('./routes-git');
const routesSystem = require('./routes-system');

const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api/auth', routesAuth);
app.use('/api/projects', routesProjects);
app.use('/api/containers', routesContainers);
app.use('/api/git', routesGit);
app.use('/api/system', routesSystem);

app.post('/api/webhook/:id/:secret', (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (project.webhook_secret !== req.params.secret) return res.status(403).json({ error: 'Invalid secret' });
  if (!project.auto_deploy) return res.status(400).json({ error: 'Auto-deploy not enabled' });

  const gitService = require('./git-service');
  const dockerService = require('./docker-service');

  res.json({ message: 'Webhook received, deploying...' });

  (async () => {
    try {
      db.prepare('UPDATE projects SET status = ? WHERE id = ?').run('deploying', project.id);
      await gitService.pullRepo(project.id, project.git_branch);
      await dockerService.deployProject(project);
      db.prepare('UPDATE projects SET status = ? WHERE id = ?').run('running', project.id);
    } catch (err) {
      console.error('Webhook deploy error:', err.message);
      db.prepare('UPDATE projects SET status = ? WHERE id = ?').run('error', project.id);
    }
  })();
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

setInterval(() => {
  updateService.checkForUpdate().catch(() => {});
}, 5 * 60 * 1000);

updateService.checkForUpdate().catch(() => {});

app.listen(config.port, () => {
  console.log(`Jewel running on http://localhost:${config.port}`);
});
