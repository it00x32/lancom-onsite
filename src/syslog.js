const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./config');
const { trackFromSyslogEntry, rebuildFromSyslogEntries } = require('./roaming');

const SYSLOG_FILE = path.join(DATA_DIR, 'syslog.json');
const SYSLOG_PORT = 1514;
const MAX_ENTRIES = 2000;

let syslogEntries = [];
let syslogServer = null;

const FACILITY_NAMES = [
  'kern', 'user', 'mail', 'daemon', 'auth', 'syslog', 'lpr', 'news',
  'uucp', 'cron', 'authpriv', 'ftp', 'ntp', 'audit', 'alert', 'clock',
  'local0', 'local1', 'local2', 'local3', 'local4', 'local5', 'local6', 'local7',
];

const SEVERITY_NAMES = ['emerg', 'alert', 'crit', 'err', 'warning', 'notice', 'info', 'debug'];

function parseSyslog(msg, rinfo) {
  const str = msg.toString('utf8').trim();
  const entry = {
    ts: new Date().toISOString(),
    from: rinfo.address,
    port: rinfo.port,
    raw: str,
  };

  const m = str.match(/^<(\d{1,3})>(.*)$/s);
  if (m) {
    const pri = parseInt(m[1], 10);
    entry.facility = FACILITY_NAMES[Math.floor(pri / 8)] || String(Math.floor(pri / 8));
    entry.severity = SEVERITY_NAMES[pri % 8] || String(pri % 8);
    entry.message = m[2].trim();

    const tm = entry.message.match(/^(\w{3}\s+\d+\s+\d+:\d+:\d+)\s+(\S+)\s+(.*)/s);
    if (tm) {
      entry.timestamp = tm[1];
      entry.hostname = tm[2];
      entry.message = tm[3];
    }

    const pm = entry.message.match(/^(\S+?)(?:\[(\d+)\])?:\s*(.*)/s);
    if (pm) {
      entry.program = pm[1];
      if (pm[2]) entry.pid = pm[2];
      entry.message = pm[3];
    }
  } else {
    entry.message = str;
    entry.severity = 'info';
    entry.facility = 'user';
  }

  return entry;
}

function loadSyslog() {
  try { syslogEntries = JSON.parse(fs.readFileSync(SYSLOG_FILE, 'utf8')); }
  catch { syslogEntries = []; }
}

function saveSyslog() {
  try { fs.writeFileSync(SYSLOG_FILE, JSON.stringify(syslogEntries)); } catch {}
}

function createSyslogServer() {
  loadSyslog();
  try {
    syslogServer = dgram.createSocket('udp4');
    syslogServer.on('message', (msg, rinfo) => {
      const entry = parseSyslog(msg, rinfo);
      syslogEntries.unshift(entry);
      if (syslogEntries.length > MAX_ENTRIES) syslogEntries.length = MAX_ENTRIES;
      try { trackFromSyslogEntry(entry); } catch (e) { console.error('[Roaming/Syslog]', e.message); }
    });
    syslogServer.on('error', (err) => {
      console.error('[Syslog]', err.message);
    });
    syslogServer.bind(SYSLOG_PORT, () => {
      console.log(`[Syslog] Lauscht auf UDP/${SYSLOG_PORT}`);
    });

    setInterval(saveSyslog, 30000);
  } catch (e) {
    console.error('[Syslog] bind', e.message);
  }
}

function getSyslogEntries() { return syslogEntries; }
function clearSyslogEntries() {
  syslogEntries.length = 0;
  saveSyslog();
  try { rebuildFromSyslogEntries([]); } catch (e) { console.error('[Roaming/Syslog]', e.message); }
}
function flushSyslogSync() { try { fs.writeFileSync(SYSLOG_FILE, JSON.stringify(syslogEntries)); } catch {} }

/** Entfernt genau einen Eintrag (Zeitstempel + Absender + Nachricht müssen übereinstimmen). */
function deleteSyslogEntryMatch({ ts, from, message }) {
  const msg = message == null ? '' : String(message);
  const i = syslogEntries.findIndex(
    (e) => e.ts === ts && e.from === from && String(e.message || '') === msg,
  );
  if (i < 0) return false;
  syslogEntries.splice(i, 1);
  saveSyslog();
  try { rebuildFromSyslogEntries(syslogEntries); } catch (e) { console.error('[Roaming/Syslog]', e.message); }
  return true;
}

function normMacHex(m) {
  return String(m || '').replace(/-/g, ':').toUpperCase();
}

/** Entfernt alle Syslog-Zeilen, in denen die vollständige MAC vorkommt (Doppelpunkt oder Bindestrich). */
function deleteSyslogEntriesForMac(mac) {
  const M = normMacHex(mac);
  if (!/^(?:[0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(M)) return 0;
  const dash = M.replace(/:/g, '-');
  const before = syslogEntries.length;
  syslogEntries = syslogEntries.filter((e) => {
    const t = `${e.message || ''}\n${e.raw || ''}`.toUpperCase();
    return !t.includes(M) && !t.includes(dash);
  });
  const removed = before - syslogEntries.length;
  if (removed) {
    saveSyslog();
    try { rebuildFromSyslogEntries(syslogEntries); } catch (e) { console.error('[Roaming/Syslog]', e.message); }
  }
  return removed;
}

module.exports = {
  createSyslogServer,
  getSyslogEntries,
  clearSyslogEntries,
  flushSyslogSync,
  deleteSyslogEntryMatch,
  deleteSyslogEntriesForMac,
  SYSLOG_PORT,
};
