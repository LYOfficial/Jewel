const path = require('path');

module.exports = {
  port: process.env.PORT || 330,
  dataDir: process.env.DATA_DIR || path.join(__dirname, '..', 'data'),
  jwtSecret: process.env.JWT_SECRET || 'jewel-secret-change-in-production',
  jwtExpiresIn: '24h',
  repoUrl: 'https://github.com/LYOfficial/Jewel',
  defaultAdmin: {
    username: 'admin',
    password: 'adminwithjewel'
  }
};
