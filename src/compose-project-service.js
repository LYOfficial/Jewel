const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const config = require('./config');

function validateComposeContent(content) {
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('docker-compose.yml content is required');
  }

  let compose;
  try {
    compose = yaml.load(content);
  } catch (err) {
    throw new Error(`Invalid docker-compose.yml: ${err.message}`);
  }

  if (!compose || typeof compose !== 'object' || Array.isArray(compose) ||
    !compose.services || typeof compose.services !== 'object' || Array.isArray(compose.services) ||
    Object.keys(compose.services).length === 0) {
    throw new Error('docker-compose.yml must define at least one service');
  }
}

function writeComposeProject(projectId, content) {
  validateComposeContent(content);
  const projectDir = path.join(config.dataDir, 'projects', String(projectId));
  const composePath = path.join(projectDir, 'docker-compose.yml');
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(composePath, content, 'utf-8');
  return composePath;
}

module.exports = { validateComposeContent, writeComposeProject };
