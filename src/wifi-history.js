const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./config');

const WIFI_HISTORY_FILE = path.join(DATA_DIR, 'wifi-history.json');
const MAX_SNAPSHOTS = 288; // 24h at 5min intervals

let history = [];

function loadHistory() {
  try {
    if (fs.existsSync(WIFI_HISTORY_FILE))
      history = JSON.parse(fs.readFileSync(WIFI_HISTORY_FILE, 'utf8'));
  } catch { history = []; }
}

function saveHistory() {
  try { fs.writeFileSync(WIFI_HISTORY_FILE, JSON.stringify(history)); } catch {}
}

function takeSnapshot(deviceStore) {
  const aps = {};
  for (const [ip, dev] of Object.entries(deviceStore)) {
    const clients = dev.wlanClients;
    if (!clients?.length && dev.type !== 'ap') continue;
    const bands = { '2.4': 0, '5': 0, '6': 0 };
    let totalSignal = 0, signalCount = 0;
    (clients || []).forEach(c => {
      const b = c.band || '';
      if (b.includes('2.4') || b === '1') bands['2.4']++;
      else if (b.includes('6')) bands['6']++;
      else if (b.includes('5') || b === '2') bands['5']++;
      const sig = parseInt(c.signal);
      if (!isNaN(sig)) { totalSignal += sig; signalCount++; }
    });
    aps[ip] = {
      name: dev.name || ip,
      clients: clients?.length || 0,
      bands,
      avgSignal: signalCount ? Math.round(totalSignal / signalCount) : null,
    };
  }
  const snapshot = { ts: new Date().toISOString(), aps };
  history.push(snapshot);
  if (history.length > MAX_SNAPSHOTS) history = history.slice(-MAX_SNAPSHOTS);
  saveHistory();
  return snapshot;
}

function getHistory(hours = 24) {
  const cutoff = Date.now() - hours * 3600000;
  return history.filter(s => new Date(s.ts).getTime() >= cutoff);
}

function clearHistory() {
  history = [];
  saveHistory();
}

loadHistory();

module.exports = { takeSnapshot, getHistory, clearHistory };
