const path = require('path');

const requestedDeployTimeout = Number(process.env.DEPLOY_TIMEOUT_MS);
const deployTimeoutMs = Number.isSafeInteger(requestedDeployTimeout) && requestedDeployTimeout > 0 && requestedDeployTimeout <= 2147483647
  ? requestedDeployTimeout : 30 * 60 * 1000;

module.exports = {
  port: process.env.PORT || 330,
  dataDir: process.env.DATA_DIR || path.join(__dirname, '..', 'data'),
  deployTimeoutMs,
  jwtSecret: process.env.JWT_SECRET || 'jewel-secret-change-in-production',
  jwtExpiresIn: '24h',
  repoUrl: 'https://github.com/LYOfficial/Jewel',
  defaultAdmin: {
    username: 'admin',
    password: 'adminwithjewel'
  }
};
