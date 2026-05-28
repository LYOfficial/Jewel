const express = require('express');
const os = require('os');
const db = require('./database');
const { authMiddleware } = require('./auth');
const updateService = require('./update-service');
const dockerService = require('./docker-service');

const router = express.Router();

router.use(authMiddleware);

router.get('/info', async (req, res) => {
  const info = {
    version: require('../package.json').version,
    nodeVersion: process.version,
    platform: process.platform,
    uptime: process.uptime()
  };

  try {
    info.docker = await dockerService.getDockerInfo();
  } catch {
    info.docker = null;
  }

  res.json(info);
});

router.get('/monitor', (req, res) => {
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  // CPU usage: average across all cores
  const cpuUsage = process.cpuUsage();
  const elapsed = process.uptime() * 1000;
  const cpuPercent = Math.min(100, ((cpuUsage.user + cpuUsage.system) / elapsed) * 100);

  res.json({
    hostname: os.hostname(),
    osType: os.type(),
    osRelease: os.release(),
    osArch: os.arch(),
    cpuModel: cpus[0]?.model || 'Unknown',
    cpuCores: cpus.length,
    cpuPercent: Math.round(cpuPercent * 10) / 10,
    memTotal: totalMem,
    memUsed: usedMem,
    memPercent: Math.round((usedMem / totalMem) * 1000) / 10,
    diskInfo: getDiskInfo(),
    network: getNetworkStats(),
    uptime: os.uptime()
  });
});

function getDiskInfo() {
  try {
    const { execSync } = require('child_process');
    let cmd;
    if (process.platform === 'win32') {
      cmd = 'wmic logicaldisk get size,freespace,caption /format:csv';
    } else {
      cmd = "df -k / | tail -1 | awk '{print $2,$3,$4}'";
    }
    const output = execSync(cmd, { timeout: 5000 }).toString().trim();

    if (process.platform === 'win32') {
      const lines = output.split('\n').filter(l => l.trim());
      const disks = [];
      for (const line of lines) {
        const parts = line.split(',').map(s => s.trim());
        if (parts.length >= 3 && parts[1]) {
          const free = parseInt(parts[1]) || 0;
          const total = parseInt(parts[2]) || 0;
          const caption = parts[3] || '';
          if (total > 0) {
            disks.push({ drive: caption, total, used: total - free, percent: Math.round((total - free) / total * 1000) / 10 });
          }
        }
      }
      const totalAll = disks.reduce((s, d) => s + d.total, 0);
      const usedAll = disks.reduce((s, d) => s + d.used, 0);
      return { total: totalAll, used: usedAll, percent: totalAll > 0 ? Math.round(usedAll / totalAll * 1000) / 10 : 0, disks };
    } else {
      const parts = output.split(/\s+/);
      const total = (parseInt(parts[0]) || 0) * 1024;
      const used = (parseInt(parts[1]) || 0) * 1024;
      return { total, used, percent: total > 0 ? Math.round(used / total * 1000) / 10 : 0, disks: [] };
    }
  } catch {
    return { total: 0, used: 0, percent: 0, disks: [] };
  }
}

let prevNetworkStats = null;
function getNetworkStats() {
  const interfaces = os.networkInterfaces();
  const current = { totalRx: 0, totalTx: 0, interfaces: {} };

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (name === 'lo' || name.startsWith('lo')) continue;
    try {
      const { execSync } = require('child_process');
      let cmd;
      if (process.platform === 'win32') {
        cmd = `powershell -command "(Get-NetAdapterStatistics -Name '${name}' -ErrorAction SilentlyContinue) | Select-Object ReceivedBytes,SentBytes | ConvertTo-Json"`;
      } else {
        const rx = parseInt(fs.readFileSync(`/sys/class/net/${name}/statistics/rx_bytes`, 'utf-8')) || 0;
        const tx = parseInt(fs.readFileSync(`/sys/class/net/${name}/statistics/tx_bytes`, 'utf-8')) || 0;
        current.interfaces[name] = { rx, tx };
        current.totalRx += rx;
        current.totalTx += tx;
        continue;
      }
      const output = execSync(cmd, { timeout: 3000 }).toString().trim();
      if (output) {
        const parsed = JSON.parse(output);
        const rx = parsed.ReceivedBytes || 0;
        const tx = parsed.SentBytes || 0;
        current.interfaces[name] = { rx, tx };
        current.totalRx += rx;
        current.totalTx += tx;
      }
    } catch { /* skip interface */ }
  }

  const result = {
    totalRx: current.totalRx,
    totalTx: current.totalTx,
    interfaces: current.interfaces,
    rxRate: 0,
    txRate: 0
  };

  if (prevNetworkStats) {
    const elapsed = (Date.now() - prevNetworkStats.timestamp) / 1000;
    if (elapsed > 0) {
      result.rxRate = Math.max(0, (current.totalRx - prevNetworkStats.totalRx) / elapsed);
      result.txRate = Math.max(0, (current.totalTx - prevNetworkStats.totalTx) / elapsed);
    }
  }

  prevNetworkStats = { ...current, timestamp: Date.now() };
  return result;
}

const fs = require('fs');

router.get('/update/check', (req, res) => {
  res.json(updateService.getUpdateInfo());
});

router.post('/update/apply', async (req, res) => {
  try {
    const result = await updateService.applyUpdate();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/settings', (req, res) => {
  const settings = db.prepare('SELECT * FROM settings').all();
  const obj = {};
  for (const s of settings) obj[s.key] = s.value;
  res.json(obj);
});

router.put('/settings', (req, res) => {
  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(req.body)) {
    upsert.run(key, String(value));
  }
  const settings = db.prepare('SELECT * FROM settings').all();
  const obj = {};
  for (const s of settings) obj[s.key] = s.value;
  res.json(obj);
});

// Notes
router.get('/notes', (req, res) => {
  const upsert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  upsert.run('notes_public', '');
  upsert.run('notes_ports', '');
  upsert.run('notes_daily', '');

  const rows = db.prepare("SELECT value FROM settings WHERE key IN ('notes_public','notes_ports','notes_daily')").all();
  const notes = {};
  for (const r of rows) { /* keys loaded below */ }
  const pub = db.prepare("SELECT value FROM settings WHERE key = 'notes_public'").get();
  const ports = db.prepare("SELECT value FROM settings WHERE key = 'notes_ports'").get();
  const daily = db.prepare("SELECT value FROM settings WHERE key = 'notes_daily'").get();
  res.json({
    public: pub ? pub.value : '',
    ports: ports ? ports.value : '',
    daily: daily ? daily.value : ''
  });
});

router.put('/notes', (req, res) => {
  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const { public: pub, ports, daily } = req.body;
  if (pub !== undefined) upsert.run('notes_public', pub);
  if (ports !== undefined) upsert.run('notes_ports', ports);
  if (daily !== undefined) upsert.run('notes_daily', daily);
  res.json({ message: 'Notes saved' });
});

module.exports = router;
