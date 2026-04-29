const { readSettings, readDevices, writeDevices } = require('./data');
const { subnetToHosts, scanHost, extractModel } = require('./scanner');
const { detectOsViaHttp } = require('./detect');

let scheduleTimer = null;
let lastScanResult = { ts: null, newDevices: [], scanned: 0 };
let onNewDeviceCallback = null;

function setOnNewDevice(fn) { onNewDeviceCallback = fn; }

async function runScheduledScan() {
  const s = readSettings();
  const subnet = s.scheduledScanSubnet || s.lastScanSubnet;
  if (!subnet) return;

  const community = s.snmpReadCommunity || 'public';
  const version = s.snmpVersion || '2c';
  const existingDevs = readDevices();
  const existingIps = new Set(Object.keys(existingDevs));

  let hosts;
  try { hosts = subnetToHosts(subnet); } catch { return; }

  console.log(`[Scheduler] Scan gestartet: ${subnet} (${hosts.length} Hosts)`);
  const BATCH = 30;
  const newFound = [];
  let scannedCnt = 0;

  for (let i = 0; i < hosts.length; i += BATCH) {
    const batch = hosts.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(async host => {
      try { return await scanHost(host, community, version); } catch { return null; }
    }));
    for (const dev of results) {
      scannedCnt++;
      if (!dev) continue;
      if (!existingIps.has(dev.ip)) {
        let httpOs = null;
        try { httpOs = await detectOsViaHttp(dev.ip); } catch {}
        const newDev = {
          ip: dev.ip,
          sysName: dev.sysName || '',
          sysDescr: dev.sysDescr || '',
          sysLocation: dev.sysLocation || '',
          os: httpOs || dev.os || '',
          mac: dev.mac || '',
          serial: dev.serial || '',
          model: extractModel(dev.sysDescr) || dev.lcosLxName || '',
          discoveredAt: new Date().toISOString(),
          autoDiscovered: true,
        };
        newFound.push(newDev);
      }
    }
  }

  lastScanResult = { ts: new Date().toISOString(), newDevices: newFound, scanned: scannedCnt, subnet };

  if (newFound.length && s.scheduledAutoSave) {
    const devs = readDevices();
    for (const d of newFound) {
      if (!devs[d.ip]) {
        devs[d.ip] = {
          ip: d.ip, name: d.sysName || d.model || d.ip, sysDescr: d.sysDescr,
          sysLocation: d.sysLocation, os: d.os, mac: d.mac, serial: d.serial,
          online: true, discoveredAt: d.discoveredAt,
        };
      }
    }
    writeDevices(devs);
    console.log(`[Scheduler] ${newFound.length} neue Geräte automatisch gespeichert`);
  } else if (newFound.length) {
    console.log(`[Scheduler] ${newFound.length} neue Geräte entdeckt (nicht auto-gespeichert)`);
  }

  if (newFound.length && onNewDeviceCallback) {
    onNewDeviceCallback(newFound);
  }

  console.log(`[Scheduler] Scan fertig: ${scannedCnt} geprüft, ${newFound.length} neu`);
}

function startScheduler() {
  stopScheduler();
  const s = readSettings();
  const hours = parseInt(s.scheduledScanHours || '0', 10);
  if (!hours || hours < 1) return;
  const ms = hours * 60 * 60 * 1000;
  scheduleTimer = setInterval(runScheduledScan, ms);
  console.log(`[Scheduler] Geplanter Scan alle ${hours}h`);
  if (s.scheduledScanSubnet || s.lastScanSubnet) {
    setTimeout(runScheduledScan, 30000);
  }
}

function stopScheduler() {
  if (scheduleTimer) { clearInterval(scheduleTimer); scheduleTimer = null; }
}

function getLastScanResult() { return lastScanResult; }

function restartScheduler() { startScheduler(); }

module.exports = { startScheduler, stopScheduler, restartScheduler, runScheduledScan, getLastScanResult, setOnNewDevice };
