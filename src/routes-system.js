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

  res.json({
    hostname: os.hostname(),
    osType: os.type(),
    osRelease: os.release(),
    osArch: os.arch(),
    cpuModel: cpus[0]?.model || 'Unknown',
    cpuCores: cpus.length,
    cpuPercent: getCpuPercent(),
    memTotal: totalMem,
    memUsed: usedMem,
    memPercent: Math.round((usedMem / totalMem) * 1000) / 10,
    diskInfo: getDiskInfo(),
    network: getNetworkStats(),
    uptime: os.uptime()
  });
});

// Keep Jewel's own Docker metrics separate from the fast host monitor. The
// dashboard loads this endpoint asynchronously, so a slow Docker daemon never
// delays page navigation or host CPU/memory/network rendering.
router.get('/jewel-resources', async (req, res) => {
  // Docker reports container CPU over a short daemon-managed interval. Sample
  // host CPU over the same short interval here, rather than reusing the
  // dashboard monitor's older five-second average. That makes the two values
  // comparable on one screen.
  const before = readCpuTimes();
  await wait(750);
  const hostCpuPercent = cpuPercentBetween(before, readCpuTimes());
  try {
    const resource = await dockerService.getJewelResourceUsage();
    // A container is part of the host total. Docker and /proc are read a few
    // milliseconds apart, so preserve that invariant at the presentation
    // boundary instead of ever rendering an impossible total below Jewel.
    const comparableHostCpuPercent = resource.stats_available
      ? Math.max(hostCpuPercent, Number(resource.cpu_percent) || 0)
      : hostCpuPercent;
    res.json({
      ...resource,
      host_cpu_percent: Math.round(comparableHostCpuPercent * 10) / 10
    });
  } catch {
    res.json({ available: false, reason: 'docker-unavailable', host_cpu_percent: hostCpuPercent });
  }
});

let prevCpuTimes = null;

function readCpuTimes() {
  const cpus = os.cpus();
  let totalIdle = 0, totalTick = 0;
  for (const cpu of cpus) {
    for (const type in cpu.times) {
      totalTick += cpu.times[type];
    }
    totalIdle += cpu.times.idle;
  }
  return { idle: totalIdle, tick: totalTick };
}

function cpuPercentBetween(previous, current) {
  if (!previous || !current) return 0;
  const idleDiff = current.idle - previous.idle;
  const tickDiff = current.tick - previous.tick;
  if (tickDiff <= 0) return 0;
  const used = tickDiff - idleDiff;
  return Math.round((used / tickDiff) * 1000) / 10;
}

function getCpuPercent() {
  const current = readCpuTimes();

  if (!prevCpuTimes) {
    prevCpuTimes = current;
    return 0;
  }

  const result = cpuPercentBetween(prevCpuTimes, current);
  prevCpuTimes = current;
  return result;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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

router.get('/update/check', async (req, res) => {
  // A normal page load reads the most recently cached state. It must not
  // block the settings page or the top-bar poll on an external GitHub call.
  res.json(await updateService.getUpdateInfo());
});

router.post('/update/check', async (req, res) => {
  await updateService.checkForUpdate();
  res.json(await updateService.getUpdateInfo());
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

router.get('/timezone', (req, res) => {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'timezone'").get();
  const tz = row ? row.value : 'Asia/Shanghai';
  try {
    const now = new Date();
    const formatted = now.toLocaleString('en-US', { timeZone: tz, hour12: false });
    const offset = getUTCOffset(tz);
    res.json({ timezone: tz, currentTime: formatted, utcOffset: offset });
  } catch {
    res.json({ timezone: tz, currentTime: new Date().toISOString(), utcOffset: '+00:00' });
  }
});

function getUTCOffset(tz) {
  try {
    const now = new Date();
    const utcStr = now.toLocaleString('en-US', { timeZone: 'UTC', hour12: false });
    const tzStr = now.toLocaleString('en-US', { timeZone: tz, hour12: false });
    const utcDate = new Date(utcStr);
    const tzDate = new Date(tzStr);
    const diffMs = tzDate - utcDate;
    const diffMins = Math.round(diffMs / 60000);
    const sign = diffMins >= 0 ? '+' : '-';
    const absMins = Math.abs(diffMins);
    const h = String(Math.floor(absMins / 60)).padStart(2, '0');
    const m = String(absMins % 60).padStart(2, '0');
    return `UTC${sign}${h}:${m}`;
  } catch {
    return 'UTC+00:00';
  }
}

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
