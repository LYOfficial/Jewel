const express = require('express');
const { authMiddleware } = require('./auth');
const gitService = require('./git-service');

const router = express.Router();

router.use(authMiddleware);

router.get('/repos', async (req, res) => {
  const { token, provider, host } = req.query;
  if (!token) return res.status(400).json({ error: 'Token is required' });

  try {
    let repos;
    if (provider === 'gitlab') {
      repos = await gitService.listGitLabRepos(token, host || 'gitlab.com');
    } else {
      repos = await gitService.listGitHubRepos(token);
    }
    res.json(repos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
