const fs = require('fs');
const { TRAFFIC_HISTORY_FILE } = require('./config');

// ── In-memory traffic history ────────────────────────────────────────────────
// Structure: { "ip": { "ifName": { samples: [{ts,in,out}], hourly: [{ts,inAvg,outAvg,inMax,outMax}] } } }
let history = {};
let dirty = false;

function loadHistory() {
  try {
    history = JSON.parse(fs.readFileSync(TRAFFIC_HISTORY_FILE, 'utf8'));
  } catch {
    history = {};
  }
}

function saveHistory() {
  if (!dirty) return;
  try {
    fs.writeFileSync(TRAFFIC_HISTORY_FILE, JSON.stringify(history));
    dirty = false;
  } catch { /* ignore write errors */ }
}

// Extract LLDP uplink interface names per device from stored device data
function getLldpInterfaces(devs) {
  const result = {}; // ip → Set<ifName>
  for (const d of Object.values(devs)) {
    if (!d.lldpData?.length) continue;
    result[d.ip] = new Set(d.lldpData.map(e => e.localPortName).filter(Boolean));
  }
  return result;
}

// Add a traffic sample (called from /api/iftraffic)
// trafficOut = { ip: { ifName: { inBps, outBps, speedBps, utilPct } } }
// lldpIfaces = { ip: Set<ifName> }
function recordSamples(trafficOut, lldpIfaces) {
  const ts = Math.floor(Date.now() / 1000);
  for (const [ip, ifMap] of Object.entries(trafficOut)) {
    const allowedSet = lldpIfaces[ip];
    if (!allowedSet) continue;
    if (!history[ip]) history[ip] = {};

    for (const [ifName, data] of Object.entries(ifMap)) {
      if (!allowedSet.has(ifName) && !matchLldpIface(ifName, allowedSet)) continue;
      const resolvedName = allowedSet.has(ifName) ? ifName : matchLldpIface(ifName, allowedSet);
      if (!resolvedName) continue;

      if (!history[ip][resolvedName]) history[ip][resolvedName] = { samples: [], hourly: [] };
      const entry = history[ip][resolvedName];
      entry.samples.push({ ts, in: Math.round(data.inBps), out: Math.round(data.outBps) });
    }
  }
  dirty = true;
}

// Fuzzy-match: SNMP ifName may differ from LLDP localPortName
function matchLldpIface(snmpName, lldpSet) {
  const norm = s => (s || '').toLowerCase().replace(/[\s\-_]/g, '');
  const sn = norm(snmpName);
  for (const lp of lldpSet) {
    if (norm(lp) === sn) return lp;
  }
  const extractNum = s => { const m = (s || '').match(/(\d+)\s*[a-z]?\s*$/i); return m ? parseInt(m[1], 10) : null; };
  const num = extractNum(snmpName);
  if (num !== null) {
    const physRe = /^(port|gigabit|switch|ethernet|eth|ge|fe|te|lan)/i;
    for (const lp of lldpSet) {
      if (physRe.test(lp) && extractNum(lp) === num) return lp;
    }
    // Reverse: LLDP "9A" → 9, SNMP "Port 9" → 9
    for (const lp of lldpSet) {
      if (extractNum(lp) === num) return lp;
    }
  }
  return null;
}

// Trim samples older than retentionHours, aggregate hourly
function trimAndAggregate(retentionHours) {
  const cutoff = Math.floor(Date.now() / 1000) - retentionHours * 3600;
  const hourlyCutoff = cutoff;

  for (const [ip, ifMap] of Object.entries(history)) {
    for (const [ifName, entry] of Object.entries(ifMap)) {
      // Trim old samples
      entry.samples = (entry.samples || []).filter(s => s.ts >= cutoff);

      // Trim old hourly
      entry.hourly = (entry.hourly || []).filter(h => h.ts >= hourlyCutoff);

      // Clean up empty entries
      if (!entry.samples.length && !entry.hourly.length) {
        delete ifMap[ifName];
      }
    }
    if (!Object.keys(ifMap).length) delete history[ip];
  }
  dirty = true;
}

// Aggregate raw samples into hourly buckets
function buildHourly() {
  for (const ifMap of Object.values(history)) {
    for (const entry of Object.values(ifMap)) {
      if (!entry.samples?.length) continue;
      const buckets = {};
      for (const s of entry.samples) {
        const hourTs = Math.floor(s.ts / 3600) * 3600;
        if (!buckets[hourTs]) buckets[hourTs] = { ins: [], outs: [] };
        buckets[hourTs].ins.push(s.in);
        buckets[hourTs].outs.push(s.out);
      }
      const existingHrs = new Set((entry.hourly || []).map(h => h.ts));
      for (const [tsStr, b] of Object.entries(buckets)) {
        const ts = parseInt(tsStr, 10);
        if (existingHrs.has(ts)) continue;
        const avg = arr => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
        entry.hourly.push({
          ts,
          inAvg: avg(b.ins), outAvg: avg(b.outs),
          inMax: Math.max(...b.ins), outMax: Math.max(...b.outs),
        });
      }
      entry.hourly.sort((a, b) => a.ts - b.ts);
    }
  }
  dirty = true;
}

function getHistoryData(ip, ifName, hours) {
  if (ip && ifName) {
    return history[ip]?.[ifName] || { samples: [], hourly: [] };
  }
  if (ip) {
    return history[ip] || {};
  }
  // Summary: return all with latest sample info
  const summary = {};
  for (const [devIp, ifMap] of Object.entries(history)) {
    summary[devIp] = {};
    for (const [name, entry] of Object.entries(ifMap)) {
      const samples = entry.samples || [];
      const last = samples[samples.length - 1];
      summary[devIp][name] = {
        sampleCount: samples.length,
        hourlyCount: (entry.hourly || []).length,
        lastTs: last?.ts || 0,
        lastIn: last?.in || 0,
        lastOut: last?.out || 0,
      };
    }
  }
  return summary;
}

function getFullHistory() { return history; }

function clearHistory() {
  history = {};
  dirty = true;
  saveHistory();
}

// Auto-save every 5 minutes
setInterval(saveHistory, 5 * 60 * 1000);
// Aggregate hourly every 10 minutes
setInterval(buildHourly, 10 * 60 * 1000);

// Load on require
loadHistory();

module.exports = {
  loadHistory,
  saveHistory,
  getLldpInterfaces,
  recordSamples,
  trimAndAggregate,
  buildHourly,
  getHistoryData,
  getFullHistory,
  clearHistory,
};
