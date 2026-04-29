const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./config');
const { readDevices } = require('./data');
const { isRoamingSyslogEntry, extractMacKeysFromSyslogEntry } = require('./roaming-syslog-parse');

const ROAMING_FILE  = path.join(DATA_DIR, 'roaming.json');
const LASTSEEN_FILE = path.join(DATA_DIR, 'roaming-state.json');
const MAX_EVENTS = 2000;
const MAX_CLIENTS = 5000;

let events = [];    // [{ ts, mac, fromIp, fromName, toIp, toName, signal, band, ssid, source? }]
let lastSeen = {};  // { [mac]: { ip, name, signal, band, ssid, ts } }

function load() {
  try { if (fs.existsSync(ROAMING_FILE))  events   = JSON.parse(fs.readFileSync(ROAMING_FILE, 'utf8')); }  catch { events = []; }
  try { if (fs.existsSync(LASTSEEN_FILE)) lastSeen = JSON.parse(fs.readFileSync(LASTSEEN_FILE, 'utf8')); } catch { lastSeen = {}; }
}

function save() {
  try { fs.writeFileSync(ROAMING_FILE, JSON.stringify(events)); }   catch {}
  try { fs.writeFileSync(LASTSEEN_FILE, JSON.stringify(lastSeen)); } catch {}
}

function apNameForIp(ip) {
  try {
    const devs = readDevices();
    const d = Object.values(devs).find((x) => x.ip === ip);
    return d ? (d.name || ip) : ip;
  } catch {
    return ip;
  }
}

function pruneLastSeen() {
  const cutoff24h = Date.now() - 86400000;
  for (const mac of Object.keys(lastSeen)) {
    if (new Date(lastSeen[mac].ts).getTime() < cutoff24h) delete lastSeen[mac];
  }
  if (Object.keys(lastSeen).length > MAX_CLIENTS) {
    const sorted = Object.entries(lastSeen).sort((a, b) => new Date(b[1].ts) - new Date(a[1].ts));
    lastSeen = Object.fromEntries(sorted.slice(0, MAX_CLIENTS));
  }
}

/**
 * Eine Syslog-Zeile verarbeiten: Roaming-Heuristik + MAC-Wechsel des Syslog-Absenders.
 * @param {object} opts
 * @param {boolean} [opts.skipPrune] — bei Massen-Rebuild (chronologisch), Prune erst am Ende
 */
function trackFromSyslogEntry(entry, opts = {}) {
  const skipPrune = opts.skipPrune === true;
  const skipSave = opts.skipSave === true;
  if (!isRoamingSyslogEntry(entry)) return [];
  const macs = extractMacKeysFromSyslogEntry(entry);
  if (!macs.length) return [];

  const reporterIp = entry.from;
  const ts = entry.ts;
  const toName = apNameForIp(reporterIp);
  const newEvents = [];

  for (const mac of macs) {
    const prev = lastSeen[mac];
    if (prev && prev.ip !== reporterIp) {
      newEvents.push({
        ts,
        mac,
        hostname: '',
        fromIp: prev.ip,
        fromName: prev.name || apNameForIp(prev.ip),
        fromSignal: prev.signal != null ? prev.signal : null,
        toIp: reporterIp,
        toName,
        toSignal: null,
        band: '',
        ssid: '',
        source: 'syslog',
      });
    }
    lastSeen[mac] = {
      ip: reporterIp,
      name: toName,
      signal: null,
      band: '',
      ssid: '',
      ts,
    };
  }

  if (!skipPrune) pruneLastSeen();

  if (newEvents.length) {
    events = [...newEvents, ...events].slice(0, MAX_EVENTS);
  }
  if (!skipSave) save();
  return newEvents;
}

/** Roaming-Historie komplett aus dem Syslog-Puffer neu berechnen (chronologisch). */
function rebuildFromSyslogEntries(entries) {
  events = [];
  lastSeen = {};
  const sorted = [...entries].sort((a, b) => new Date(a.ts) - new Date(b.ts));
  for (const e of sorted) trackFromSyslogEntry(e, { skipPrune: true, skipSave: true });
  pruneLastSeen();
  save();
}

function getEvents(hours = 24) {
  const cutoff = Date.now() - hours * 3600000;
  return events.filter(e => new Date(e.ts).getTime() >= cutoff);
}

function getClientHistory(mac, hours = 24) {
  const cutoff = Date.now() - hours * 3600000;
  return events.filter(e => e.mac.toUpperCase() === mac.toUpperCase() && new Date(e.ts).getTime() >= cutoff);
}

function getStats(hours = 24) {
  const relevant = getEvents(hours);
  const byMac = {};
  relevant.forEach(e => {
    if (!byMac[e.mac]) byMac[e.mac] = { mac: e.mac, hostname: e.hostname || '', count: 0, aps: new Set() };
    byMac[e.mac].count++;
    byMac[e.mac].aps.add(e.fromName);
    byMac[e.mac].aps.add(e.toName);
  });
  const clients = Object.values(byMac)
    .map(c => ({ mac: c.mac, hostname: c.hostname, roamCount: c.count, apCount: c.aps.size, aps: [...c.aps] }))
    .sort((a, b) => b.roamCount - a.roamCount);

  const byAp = {};
  relevant.forEach(e => {
    byAp[e.toName] = (byAp[e.toName] || 0) + 1;
    byAp[e.fromName] = (byAp[e.fromName] || 0) + 1;
  });
  const apActivity = Object.entries(byAp)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  return {
    totalEvents: relevant.length,
    uniqueClients: clients.length,
    clients: clients.slice(0, 50),
    apActivity: apActivity.slice(0, 20),
    trackedClients: Object.keys(lastSeen).length,
  };
}

function clearEvents() {
  events = [];
  lastSeen = {};
  save();
}

load();

module.exports = {
  trackFromSyslogEntry,
  rebuildFromSyslogEntries,
  getEvents,
  getClientHistory,
  getStats,
  clearEvents,
};
