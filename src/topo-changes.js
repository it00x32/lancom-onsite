const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./config');

const TOPO_STATE_FILE   = path.join(DATA_DIR, 'topo-state.json');
const TOPO_CHANGES_FILE = path.join(DATA_DIR, 'topo-changes.json');
const MAX_CHANGES = 500;

let lastState = {};  // { [ip]: [ { localPort, remoteName, remotePort } ] }
let changes = [];

function load() {
  try { if (fs.existsSync(TOPO_STATE_FILE))   lastState = JSON.parse(fs.readFileSync(TOPO_STATE_FILE, 'utf8')); } catch { lastState = {}; }
  try { if (fs.existsSync(TOPO_CHANGES_FILE)) changes   = JSON.parse(fs.readFileSync(TOPO_CHANGES_FILE, 'utf8')); } catch { changes = []; }
}

function save() {
  try { fs.writeFileSync(TOPO_STATE_FILE, JSON.stringify(lastState)); } catch {}
  try { fs.writeFileSync(TOPO_CHANGES_FILE, JSON.stringify(changes)); } catch {}
}

function normalizeNeighbor(e) {
  return {
    localPort:  e.locPortId  || e.locPortDesc || e.localPort || '',
    remoteName: e.remSysName || e.remoteName  || '',
    remotePort: e.remPortId  || e.remPortDesc || e.remotePort || '',
  };
}

function neighborKey(n) {
  return `${n.localPort}|${n.remoteName}|${n.remotePort}`;
}

function compareLldp(deviceStore) {
  const ts = new Date().toISOString();
  const newChanges = [];
  const newState = {};

  for (const [ip, dev] of Object.entries(deviceStore)) {
    if (!dev.lldpData?.length && !lastState[ip]) continue;
    const current  = (dev.lldpData || []).map(normalizeNeighbor);
    const previous = lastState[ip] || [];
    newState[ip] = current;

    const curSet  = new Set(current.map(neighborKey));
    const prevSet = new Set(previous.map(neighborKey));

    for (const n of current) {
      if (!prevSet.has(neighborKey(n))) {
        newChanges.push({
          ts, type: 'added', ip, deviceName: dev.name || ip,
          localPort: n.localPort, remoteName: n.remoteName, remotePort: n.remotePort,
        });
      }
    }
    for (const n of previous) {
      if (!curSet.has(neighborKey(n))) {
        newChanges.push({
          ts, type: 'removed', ip, deviceName: dev.name || ip,
          localPort: n.localPort, remoteName: n.remoteName, remotePort: n.remotePort,
        });
      }
    }
  }

  // Devices that were in lastState but now gone entirely
  for (const ip of Object.keys(lastState)) {
    if (!newState[ip] && !deviceStore[ip]) {
      for (const n of lastState[ip]) {
        newChanges.push({
          ts, type: 'removed', ip, deviceName: ip,
          localPort: n.localPort, remoteName: n.remoteName, remotePort: n.remotePort,
        });
      }
    }
  }

  if (newChanges.length) {
    changes = [...newChanges, ...changes].slice(0, MAX_CHANGES);
  }
  lastState = newState;
  save();
  return newChanges;
}

function getChanges(hours = 24) {
  const cutoff = Date.now() - hours * 3600000;
  return changes.filter(c => new Date(c.ts).getTime() >= cutoff);
}

function clearChanges() {
  changes = [];
  save();
}

function hasState() {
  return Object.keys(lastState).length > 0;
}

load();

module.exports = { compareLldp, getChanges, clearChanges, hasState };
