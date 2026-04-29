const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./config');
const { readDevices, readSettings } = require('./data');
const { runSnmpGet } = require('./snmp-session');

const UPTIME_FILE = path.join(DATA_DIR, 'uptime.json');
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const PROBE_TIMEOUT = 3000;

let uptimeData = {};
let probeTimer = null;

function loadUptimeData() {
  try { uptimeData = JSON.parse(fs.readFileSync(UPTIME_FILE, 'utf8')); }
  catch { uptimeData = {}; }
}

function saveUptimeData() {
  try { fs.writeFileSync(UPTIME_FILE, JSON.stringify(uptimeData)); } catch {}
}

function pruneOld() {
  const cutoff = Date.now() - MAX_AGE_MS;
  for (const ip of Object.keys(uptimeData)) {
    const entries = uptimeData[ip];
    if (!Array.isArray(entries)) { delete uptimeData[ip]; continue; }
    const idx = entries.findIndex(e => e[0] >= cutoff);
    if (idx > 0) uptimeData[ip] = entries.slice(idx);
    else if (idx === -1) delete uptimeData[ip];
  }
}

async function probeDevice(ip, community, version) {
  try {
    const out = await runSnmpGet(ip, community, version, ['1.3.6.1.2.1.1.3.0'], PROBE_TIMEOUT);
    return out.includes('Timeticks');
  } catch {
    return false;
  }
}

async function runProbes() {
  const devs = readDevices();
  const ips = Object.keys(devs);
  if (!ips.length) return;

  const s = readSettings();
  const community = s.snmpReadCommunity || 'public';
  const version = s.snmpVersion || '2c';
  const now = Date.now();

  const BATCH = 20;
  for (let i = 0; i < ips.length; i += BATCH) {
    const batch = ips.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(ip => probeDevice(ip, community, version)));
    for (let j = 0; j < batch.length; j++) {
      const ip = batch[j];
      if (!uptimeData[ip]) uptimeData[ip] = [];
      uptimeData[ip].push([now, results[j] ? 1 : 0]);
    }
  }

  pruneOld();
  saveUptimeData();
}

function calcAvailability(ip, periodMs) {
  const entries = uptimeData[ip];
  if (!entries?.length) return null;
  const cutoff = Date.now() - periodMs;
  const relevant = entries.filter(e => e[0] >= cutoff);
  if (!relevant.length) return null;
  const up = relevant.filter(e => e[1] === 1).length;
  return { pct: Math.round((up / relevant.length) * 10000) / 100, probes: relevant.length, up, down: relevant.length - up };
}

function getStats(ip, periodMs = 24 * 60 * 60 * 1000) {
  const entries = uptimeData[ip];
  if (!entries?.length) return null;
  const cutoff = Date.now() - periodMs;
  const relevant = entries.filter(e => e[0] >= cutoff);
  if (!relevant.length) return null;

  const up = relevant.filter(e => e[1] === 1).length;
  const pct = Math.round((up / relevant.length) * 10000) / 100;

  let lastDown = null, lastUp = null;
  for (let i = relevant.length - 1; i >= 0; i--) {
    if (!lastDown && relevant[i][1] === 0) lastDown = relevant[i][0];
    if (!lastUp && relevant[i][1] === 1) lastUp = relevant[i][0];
    if (lastDown && lastUp) break;
  }

  let currentStreak = 0;
  const currentState = relevant[relevant.length - 1][1];
  for (let i = relevant.length - 1; i >= 0; i--) {
    if (relevant[i][1] === currentState) currentStreak++;
    else break;
  }

  return { pct, probes: relevant.length, up, down: relevant.length - up, lastDown, lastUp, currentStreak, currentState };
}

function getSparkline(ip, periodMs = 24 * 60 * 60 * 1000, buckets = 48) {
  const entries = uptimeData[ip];
  if (!entries?.length) return [];
  const now = Date.now();
  const cutoff = now - periodMs;
  const relevant = entries.filter(e => e[0] >= cutoff);
  if (!relevant.length) return [];

  const bucketSize = periodMs / buckets;
  const result = [];
  for (let b = 0; b < buckets; b++) {
    const bStart = cutoff + b * bucketSize;
    const bEnd = bStart + bucketSize;
    const inBucket = relevant.filter(e => e[0] >= bStart && e[0] < bEnd);
    if (!inBucket.length) {
      result.push(null);
    } else {
      const up = inBucket.filter(e => e[1] === 1).length;
      result.push(Math.round((up / inBucket.length) * 100));
    }
  }
  return result;
}

function startUptimeProbes(intervalMin = 1) {
  stopUptimeProbes();
  loadUptimeData();
  const ms = Math.max(intervalMin, 1) * 60000;
  // Erste Messung nach dem nächsten Tick — HTTP-Server soll sofort Anfragen annehmen können
  setImmediate(() => { runProbes(); });
  probeTimer = setInterval(runProbes, ms);
  console.log(`[Uptime] Probes alle ${intervalMin} Min gestartet`);
}

function stopUptimeProbes() {
  if (probeTimer) { clearInterval(probeTimer); probeTimer = null; }
}

function getAllUptimeData() { return uptimeData; }

module.exports = { startUptimeProbes, stopUptimeProbes, getAllUptimeData, calcAvailability, getStats, getSparkline, loadUptimeData };
