#!/usr/bin/env node
/**
 * LANCOM OnSite – lokaler SNMP-Server
 * Keine npm-Abhängigkeiten. Erfordert snmpwalk / snmpbulkwalk auf dem System.
 * Start: node server.js [port]
 */

const http   = require('http');
const https  = require('https');
const fs     = require('fs');
const path   = require('path');
const urlMod = require('url');
const { spawn } = require('child_process');

const PORT = parseInt(process.argv[2] || process.env.PORT || '3002', 10);

// ── Datenpersistenz ───────────────────────────────────────────────────────────

const DATA_DIR      = path.join(__dirname, 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const DEVICES_FILE  = path.join(DATA_DIR, 'devices.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DEFAULT_SETTINGS = {
  snmpReadCommunity:  'public',
  snmpWriteCommunity: 'private',
  snmpVersion:        '2c',
  rssiGreen:  200,
  rssiYellow: 150,
  rssiOrange:  80,
  lastScanSubnet: '',
};

function readSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) }; }
  catch { return { ...DEFAULT_SETTINGS }; }
}
function writeSettings(data) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ ...DEFAULT_SETTINGS, ...data }, null, 2));
}
function readDevices() {
  try { return JSON.parse(fs.readFileSync(DEVICES_FILE, 'utf8')); }
  catch { return {}; }
}
function writeDevices(data) {
  fs.writeFileSync(DEVICES_FILE, JSON.stringify(data, null, 2));
}

// ── LMC-Proxy ─────────────────────────────────────────────────────────────────

const LMC_SERVICES = {
  auth:    'https://cloud.lancom.de/cloud-service-auth',
  devices: 'https://cloud.lancom.de/cloud-service-devices',
};

function lmcProxy(service, apiPath, method, token, body) {
  return new Promise((resolve, reject) => {
    const base = LMC_SERVICES[service];
    if (!base) { resolve({ status: 400, body: JSON.stringify({ error: 'Unknown service' }) }); return; }
    const parsed  = new urlMod.URL(base + apiPath);
    const bodyStr = body ? JSON.stringify(body) : '';
    const opts = {
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      method:   (method || 'GET').toUpperCase(),
      headers: {
        'Authorization': `LMC-API-KEY ${token}`,
        'Accept':        'application/json',
        ...(bodyStr ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', d => (data += d));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── SNMP helpers ──────────────────────────────────────────────────────────────

function runSnmpWalk(host, community, version, oid, timeout = 12000) {
  return new Promise((resolve) => {
    const cmd  = version === '1' ? 'snmpwalk' : 'snmpbulkwalk';
    const args = ['-v', version, '-c', community, '-On', '-t', '5', '-r', '1', host, oid];
    const proc = spawn(cmd, args);
    let out = '';
    proc.stdout.on('data', d => (out += d));
    proc.stderr.on('data', () => {});
    const timer = setTimeout(() => { try { proc.kill(); } catch {} }, timeout);
    proc.on('close', () => { clearTimeout(timer); resolve(out); });
    proc.on('error', () => { clearTimeout(timer); resolve(''); });
  });
}

function macFromDecOid(suffix) {
  const parts = suffix.split('.');
  if (parts.length !== 6) return null;
  return parts.map(n => parseInt(n, 10).toString(16).padStart(2, '0')).join(':');
}

function macFromHexStr(str) {
  const hex = str.replace(/[:\s]/g, '').toLowerCase();
  if (hex.length !== 12) return null;
  return hex.match(/.{2}/g).join(':');
}

function snmpVal(raw) {
  const s = raw.trim();
  let m = s.match(/STRING:\s*"(.*)"/);  if (m) return m[1];
      m = s.match(/STRING:\s*(.*)/);    if (m) return m[1].trim();
      m = s.match(/INTEGER:\s*(.*)/);   if (m) return m[1].trim();
      m = s.match(/Gauge32:\s*(\d+)/);  if (m) return m[1];
      m = s.match(/Counter64:\s*(\d+)/);if (m) return m[1];
      m = s.match(/Counter32:\s*(\d+)/);if (m) return m[1];
      m = s.match(/^"(.*)"$/);          if (m) return m[1];
  return s;
}

// OID-string aus length-prefixed OID-Index dekodieren
function decodeOidStr(parts, offset) {
  if (offset >= parts.length) return ['', offset];
  const len = parseInt(parts[offset], 10);
  if (isNaN(len)) return ['', offset + 1];
  let str = '';
  for (let i = 1; i <= len && (offset + i) < parts.length; i++) {
    const code = parseInt(parts[offset + i], 10);
    if (!isNaN(code)) str += String.fromCharCode(code);
  }
  return [str, offset + 1 + len];
}

// ── System Info (MIB-II System Group) ────────────────────────────────────────

async function snmpSystem(host, community, version) {
  const out = await runSnmpWalk(host, community, version, '1.3.6.1.2.1.1');
  const result = {};
  out.split('\n').forEach(line => {
    const m = line.match(/\.1\.3\.6\.1\.2\.1\.1\.(\d+)\.0\s*=\s*(.*)/);
    if (!m) return;
    const val = snmpVal(m[2]);
    switch (m[1]) {
      case '1': result.sysDescr    = val; break;
      case '3': result.sysUpTime   = val; break;  // Timeticks raw string
      case '4': result.sysContact  = val; break;
      case '5': result.sysName     = val; break;
      case '6': result.sysLocation = val; break;
    }
  });
  return result;
}

// ── Interfaces (IF-MIB) ───────────────────────────────────────────────────────

async function snmpInterfaces(host, community, version) {
  const [ifOut, ifxOut] = await Promise.all([
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.2.2.1'),   // ifTable
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.31.1.1.1'),// ifXTable
  ]);

  const ifaces = {};

  // ifTable
  ifOut.split('\n').forEach(line => {
    const m = line.match(/\.2\.2\.1\.(\d+)\.(\d+)\s*=\s*(.*)/);
    if (!m) return;
    const [col, idx, rawVal] = [parseInt(m[1]), m[2], m[3]];
    if (!ifaces[idx]) ifaces[idx] = { idx };
    const val = snmpVal(rawVal);
    switch (col) {
      case 2:  ifaces[idx].descr       = val; break;
      case 5:  ifaces[idx].speed       = parseInt(val) || 0; break;
      case 7:  ifaces[idx].adminStatus = val; break;  // up(1), down(2)
      case 8:  ifaces[idx].operStatus  = val; break;  // up(1), down(2)
      case 10: ifaces[idx].inOctets    = parseInt(val) || 0; break;
      case 16: ifaces[idx].outOctets   = parseInt(val) || 0; break;
    }
  });

  // ifXTable (Namen + 64-bit Counters + HighSpeed)
  ifxOut.split('\n').forEach(line => {
    const m = line.match(/\.31\.1\.1\.1\.(\d+)\.(\d+)\s*=\s*(.*)/);
    if (!m) return;
    const [col, idx, rawVal] = [parseInt(m[1]), m[2], m[3]];
    if (!ifaces[idx]) ifaces[idx] = { idx };
    const val = snmpVal(rawVal);
    switch (col) {
      case 1:  ifaces[idx].name        = val; break;
      case 6:  ifaces[idx].inOctets    = parseInt(val) || ifaces[idx].inOctets  || 0; break;
      case 10: ifaces[idx].outOctets   = parseInt(val) || ifaces[idx].outOctets || 0; break;
      case 15: ifaces[idx].highSpeed   = parseInt(val) || 0; break;  // Mbps
    }
  });

  return Object.values(ifaces)
    .filter(i => i.descr || i.name)
    .sort((a, b) => parseInt(a.idx) - parseInt(b.idx));
}

// ── MAC / ARP Tabelle ─────────────────────────────────────────────────────────

async function snmpMac(host, community, version) {
  const [fdbOut, qfdbOut, bpOut, ifNameOut, arpOut] = await Promise.all([
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.17.4.3.1.2'),    // dot1dTpFdbPort
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.17.7.1.2.2.1.2'),// dot1qTpFdbPort
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.17.1.4.1.2'),    // dot1dBasePortIfIndex
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.31.1.1.1.1'),    // ifName
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.4.22.1.2'),      // ARP ip→mac
  ]);

  const macToBp = {};
  fdbOut.split('\n').forEach(line => {
    const m = line.match(/17\.4\.3\.1\.2\.([\d.]+)\s*=\s*INTEGER:\s*(\d+)/);
    if (m) { const mac = macFromDecOid(m[1]); if (mac) macToBp[mac] = parseInt(m[2]); }
  });
  if (Object.keys(macToBp).length === 0) {
    qfdbOut.split('\n').forEach(line => {
      const m = line.match(/17\.7\.1\.2\.2\.1\.2\.\d+\.([\d.]+)\s*=\s*INTEGER:\s*(\d+)/);
      if (m) { const mac = macFromDecOid(m[1]); if (mac && !macToBp[mac]) macToBp[mac] = parseInt(m[2]); }
    });
  }

  const bpToIf = {};
  bpOut.split('\n').forEach(line => {
    const m = line.match(/17\.1\.4\.1\.2\.(\d+)\s*=\s*INTEGER:\s*(\d+)/);
    if (m) bpToIf[m[1]] = m[2];
  });

  const ifNames = {};
  ifNameOut.split('\n').forEach(line => {
    const m = line.match(/31\.1\.1\.1\.1\.(\d+)\s*=\s*(?:STRING:\s*)?"?([^"\n]+?)"?\s*$/);
    if (m) ifNames[m[1]] = m[2].trim();
  });

  const macToIp = {};
  arpOut.split('\n').forEach(line => {
    const m = line.match(/4\.22\.1\.2\.\d+\.([\d.]+)\s*=\s*(?:Hex-STRING:\s*)?([\dA-Fa-f ]+)\s*$/);
    if (m && m[1].split('.').length === 4) {
      const mac = macFromHexStr(m[2].trim());
      if (mac) macToIp[mac] = m[1];
    }
  });

  const entries = Object.entries(macToBp).map(([mac, bp]) => {
    const ifIdx = bpToIf[String(bp)];
    const port  = ifIdx ? (ifNames[ifIdx] || `Port ${bp}`) : `Port ${bp}`;
    return { mac, port, ip: macToIp[mac] || '' };
  });
  entries.sort((a, b) => a.port.localeCompare(b.port, undefined, { numeric: true }));

  // Fallback: LANCOM WLAN-Clients (LCOS LX)
  if (entries.length === 0) {
    const [clientOut, ssidOut, arpOut2] = await Promise.all([
      runSnmpWalk(host, community, version, '1.3.6.1.4.1.2356.13.1.3.4.1.1'),
      runSnmpWalk(host, community, version, '1.3.6.1.4.1.2356.13.1.3.32.1.3'),
      runSnmpWalk(host, community, version, '1.3.6.1.2.1.4.22.1.2'),
    ]);
    const macToIp2 = {};
    arpOut2.split('\n').forEach(line => {
      const m = line.match(/4\.22\.1\.2\.\d+\.([\d.]+)\s*=\s*(?:Hex-STRING:\s*)?([\dA-Fa-f ]+)\s*$/);
      if (m && m[1].split('.').length === 4) {
        const mac = macFromHexStr(m[2].trim()); if (mac) macToIp2[mac] = m[1];
      }
    });
    const macToSsid = {};
    ssidOut.split('\n').forEach(line => {
      const m = line.match(/2356\.13\.1\.3\.32\.1\.3\.([\d.]+)\s*=\s*(?:STRING:\s*)?\"?([^"\n]+?)\"?\s*$/);
      if (m) { const mac = macFromDecOid(m[1]); if (mac) macToSsid[mac] = m[2].trim(); }
    });
    const wlanClients = {};
    clientOut.split('\n').forEach(line => {
      const m = line.match(/2356\.13\.1\.3\.4\.1\.1\.(\d+)\.([\d.]+)\s*=\s*(.*)/);
      if (!m) return;
      const col = parseInt(m[1]), mac = macFromDecOid(m[2]);
      if (!mac) return;
      if (!wlanClients[mac]) wlanClients[mac] = { mac, channel: null, band: null };
      const n = (m[3].match(/(\d+)/) || [])[1];
      if (col === 2 && n) wlanClients[mac].channel = n;
      if (col === 3 && n) wlanClients[mac].band    = n;
    });
    Object.values(wlanClients).forEach(c => {
      const ssid = macToSsid[c.mac] || '';
      let port = ssid ? `WLAN: ${ssid}` : 'WLAN';
      if (c.band)    port += c.band === '1' ? ' (2.4G)' : c.band === '2' ? ' (5G)' : '';
      if (c.channel) port += ` CH${c.channel}`;
      entries.push({ mac: c.mac, port, ip: macToIp2[c.mac] || '' });
    });
  }

  return { entries, count: entries.length };
}

// ── LLDP Nachbarn ─────────────────────────────────────────────────────────────

async function snmpLldp(host, community, version) {
  const out = await runSnmpWalk(host, community, version, '1.3.6.1.2.1.111.1.4.1.1');
  const neighbors = {};

  out.split('\n').forEach(line => {
    // OID: .1.3.6.1.2.1.111.1.4.1.1.{col}.{timeMark}.{localPortNum}.{remIndex}
    const m = line.match(/111\.1\.4\.1\.1\.(\d+)\.(\d+)\.(\d+)\.(\d+)\s*=\s*(.*)/);
    if (!m) return;
    const col = parseInt(m[1]);
    const key = `${m[3]}_${m[4]}`; // localPort_remIndex
    if (!neighbors[key]) neighbors[key] = { localPort: m[3] };
    const val = snmpVal(m[5]);
    switch (col) {
      case 7:  neighbors[key].remPortId   = val; break;
      case 8:  neighbors[key].remPortDesc = val; break;
      case 9:  neighbors[key].remSysName  = val; break;
      case 10: neighbors[key].remSysDesc  = val; break;
      case 12: neighbors[key].remCaps     = val; break;
    }
  });

  // Lokale Port-Namen per ifName
  const ifNameOut = await runSnmpWalk(host, community, version, '1.3.6.1.2.1.31.1.1.1.1');
  // LLDP local port: .1.3.6.1.2.1.111.1.3.7.1.3.{portNum} = ifName/ifDescr
  const lldpPortOut = await runSnmpWalk(host, community, version, '1.3.6.1.2.1.111.1.3.7.1.3');
  const lldpPortNames = {};
  lldpPortOut.split('\n').forEach(line => {
    const m = line.match(/111\.1\.3\.7\.1\.3\.(\d+)\s*=\s*(.*)/);
    if (m) lldpPortNames[m[1]] = snmpVal(m[2]);
  });
  const ifNames = {};
  ifNameOut.split('\n').forEach(line => {
    const m = line.match(/31\.1\.1\.1\.1\.(\d+)\s*=\s*(?:STRING:\s*)?"?([^"\n]+?)"?\s*$/);
    if (m) ifNames[m[1]] = m[2].trim();
  });

  const entries = Object.values(neighbors).map(n => ({
    ...n,
    localPortName: lldpPortNames[n.localPort] || ifNames[n.localPort] || `Port ${n.localPort}`,
  }));
  entries.sort((a, b) => (a.localPortName || '').localeCompare(b.localPortName || '', undefined, { numeric: true }));
  return { entries, count: entries.length };
}

// ── WiFi Mesh / WDS (LCOS LX) ────────────────────────────────────────────────

function snmpStr(raw) {
  const s = raw.trim();
  let m = s.match(/STRING:\s*"(.*)"/);   if (m) return m[1];
      m = s.match(/STRING:\s*(.*)/);     if (m) return m[1].trim();
      m = s.match(/:\s*(\d+)/);          if (m) return m[1];
      m = s.match(/^"(.*)"$/);           if (m) return m[1];
  return s;
}

// lcosLXSetupWLANWDSLinks config (1.3.6.1.4.1.2356.13.2.20.13.1)
function parseWdsConfig(raw) {
  const links = {};
  raw.split('\n').forEach(line => {
    const m = line.match(/2356\.13\.2\.20\.13\.1\.1\.(\d+)\.([\d.]+)\s*=\s*(.*)/)
           || line.match(/2356\.13\.2\.20\.13\.1\.(\d+)\.([\d.]+)\s*=\s*(.*)/);
    if (!m) return;
    const col = parseInt(m[1], 10);
    const [linkName] = decodeOidStr(m[2].split('.'), 0);
    if (!linkName) return;
    if (!links[linkName]) links[linkName] = { linkName };
    const val = m[3].trim().replace(/^(STRING|INTEGER):\s*/, '').replace(/^"(.*)"$/, '$1');
    if (col === 2) links[linkName].ssid  = val;
    if (col === 4) links[linkName].radio = parseInt(val, 10) || 0;
  });
  return links;
}

// lcosLXStatusWLANWDSLinks status (1.3.6.1.4.1.2356.13.1.3.101.1)
function parseWdsStatus(raw) {
  const entries = {};
  raw.split('\n').forEach(line => {
    const m = line.match(/2356\.13\.1\.3\.101\.1\.1\.(\d+)\.([\d.]+)\s*=\s*(.*)/)
           || line.match(/2356\.13\.1\.3\.101\.1\.(\d+)\.([\d.]+)\s*=\s*(.*)/);
    if (!m) return;
    const col = parseInt(m[1], 10);
    const idxParts = m[2].split('.');
    const [linkName, off2] = decodeOidStr(idxParts, 0);
    const [macRaw]         = decodeOidStr(idxParts, off2);
    const mac = macRaw.length === 6
      ? Array.from(macRaw).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join(':')
      : macRaw;
    const key = `${linkName}|${mac}`;
    if (!entries[key]) entries[key] = { linkName, mac };
    const rawVal = m[3].trim();
    const n = parseInt((rawVal.match(/:\s*(\d+)/) || rawVal.match(/(\d+)/) || [])[1], 10);
    if (col === 3)  entries[key].connected  = n === 1;
    if (col === 4)  entries[key].radio      = n;
    if (col === 5)  entries[key].signal     = n;
    if (col === 7)  entries[key].txRate     = n;
    if (col === 8)  entries[key].rxRate     = n;
    if (col === 13) entries[key].wpaVersion = n;
  });
  return Object.values(entries);
}

async function snmpWds(host, community, version) {
  const cfgRaw    = await runSnmpWalk(host, community, version, '1.3.6.1.4.1.2356.13.2.20.13.1');
  const configMap = parseWdsConfig(cfgRaw);
  if (!Object.keys(configMap).length) return { configured: false, links: [] };
  const staRaw        = await runSnmpWalk(host, community, version, '1.3.6.1.4.1.2356.13.1.3.101.1');
  const statusEntries = parseWdsStatus(staRaw);
  return { configured: true, configLinks: Object.values(configMap), statusEntries };
}

// ── L2TPv3 (LCOS LX) ─────────────────────────────────────────────────────────

// lcosLXSetupL2TPEndpoints config (1.3.6.1.4.1.2356.13.2.61.1)
function parseL2tpConfig(raw) {
  const endpoints = {};
  raw.split('\n').forEach(line => {
    const m = line.match(/2356\.13\.2\.61\.1\.1\.(\d+)\.([\d.]+)\s*=\s*(.*)/);
    if (!m) return;
    const col    = parseInt(m[1], 10);
    const [name] = decodeOidStr(m[2].split('.'), 0);
    if (!name) return;
    if (!endpoints[name]) endpoints[name] = { name };
    const val = snmpStr(m[3]);
    if (col === 2) endpoints[name].remoteIp  = val;
    if (col === 3) endpoints[name].port      = parseInt(val, 10) || 0;
    if (col === 4) endpoints[name].hostname  = val;
    if (col === 8) endpoints[name].operating = parseInt(val, 10);
  });
  return endpoints;
}

// lcosLXStatusL2TPEthernet status (1.3.6.1.4.1.2356.13.1.61.2)
function parseL2tpStatus(raw) {
  const entries = {};
  raw.split('\n').forEach(line => {
    const m = line.match(/2356\.13\.1\.61\.2\.1\.(\d+)\.([\d.]+)\s*=\s*(.*)/);
    if (!m) return;
    const col               = parseInt(m[1], 10);
    const idxParts          = m[2].split('.');
    const [remoteEnd, off2] = decodeOidStr(idxParts, 0);
    const [endpointName]    = decodeOidStr(idxParts, off2);
    const key = `${remoteEnd}|${endpointName}`;
    if (!entries[key]) entries[key] = { remoteEnd, endpointName };
    const val = snmpStr(m[3]);
    if (col === 3) entries[key].state         = val;
    if (col === 4) entries[key].iface         = val;
    if (col === 5) entries[key].bridgeAddr    = val;
    if (col === 7) entries[key].connStartTime = val;
  });
  return Object.values(entries);
}

async function snmpL2tp(host, community, version) {
  const cfgRaw    = await runSnmpWalk(host, community, version, '1.3.6.1.4.1.2356.13.2.61.1');
  const configMap = parseL2tpConfig(cfgRaw);
  if (!Object.keys(configMap).length) return { configured: false };
  const staRaw        = await runSnmpWalk(host, community, version, '1.3.6.1.4.1.2356.13.1.61.2');
  const statusEntries = parseL2tpStatus(staRaw);
  return { configured: true, configEndpoints: Object.values(configMap), statusEntries };
}

// ── WLAN Clients (LCOS LX) ────────────────────────────────────────────────────

async function snmpWlan(host, community, version) {
  const [clientOut, ssidOut, signalOut, arpOut] = await Promise.all([
    runSnmpWalk(host, community, version, '1.3.6.1.4.1.2356.13.1.3.4.1.1'),   // WLAN client table
    runSnmpWalk(host, community, version, '1.3.6.1.4.1.2356.13.1.3.32.1.3'), // SSID per client
    runSnmpWalk(host, community, version, '1.3.6.1.4.1.2356.13.1.3.4.1.1.4'),// Signal?
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.4.22.1.2'),            // ARP
  ]);

  const macToIp = {};
  arpOut.split('\n').forEach(line => {
    const m = line.match(/4\.22\.1\.2\.\d+\.([\d.]+)\s*=\s*(?:Hex-STRING:\s*)?([\dA-Fa-f ]+)\s*$/);
    if (m && m[1].split('.').length === 4) {
      const mac = macFromHexStr(m[2].trim()); if (mac) macToIp[mac] = m[1];
    }
  });

  const macToSsid = {};
  ssidOut.split('\n').forEach(line => {
    const m = line.match(/2356\.13\.1\.3\.32\.1\.3\.([\d.]+)\s*=\s*(?:STRING:\s*)?\"?([^"\n]+?)\"?\s*$/);
    if (m) { const mac = macFromDecOid(m[1]); if (mac) macToSsid[mac] = m[2].trim(); }
  });

  const clients = {};
  clientOut.split('\n').forEach(line => {
    const m = line.match(/2356\.13\.1\.3\.4\.1\.1\.(\d+)\.([\d.]+)\s*=\s*(.*)/);
    if (!m) return;
    const col = parseInt(m[1]), mac = macFromDecOid(m[2]);
    if (!mac) return;
    if (!clients[mac]) clients[mac] = { mac };
    const n = (m[3].match(/(\d+)/) || [])[1];
    if (col === 2 && n) clients[mac].channel = n;
    if (col === 3 && n) clients[mac].band    = n;  // 1=2.4G, 2=5G
    if (col === 4 && n) clients[mac].signal  = n;
  });

  const entries = Object.values(clients).map(c => ({
    mac:    c.mac,
    ip:     macToIp[c.mac] || '',
    ssid:   macToSsid[c.mac] || '',
    band:   c.band === '1' ? '2.4 GHz' : c.band === '2' ? '5 GHz' : c.band === '3' ? '6 GHz' : '',
    channel: c.channel || '',
    signal: c.signal || '',
  }));
  entries.sort((a, b) => (a.ssid || '').localeCompare(b.ssid || ''));
  return { entries, count: entries.length };
}

// ── Netzwerk-Scanner ──────────────────────────────────────────────────────────

function subnetToHosts(input) {
  input = input.trim();

  // Bereich: 192.168.1.1-254  oder  192.168.1.1-192.168.1.254
  const rangeShort = input.match(/^(\d+\.\d+\.\d+)\.(\d+)-(\d+)$/);
  if (rangeShort) {
    const base = rangeShort[1], from = parseInt(rangeShort[2]), to = parseInt(rangeShort[3]);
    if (from > to || to > 255) throw new Error('Ungültiger Bereich');
    const hosts = [];
    for (let i = from; i <= to; i++) hosts.push(`${base}.${i}`);
    return hosts;
  }

  // CIDR: 192.168.1.0/24
  const cidr = input.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)\/(\d+)$/);
  if (!cidr) throw new Error('Ungültiges Format – bitte CIDR (z.B. 192.168.1.0/24) oder Bereich (z.B. 192.168.1.1-254) angeben');
  const [, a, b, c, d, prefix] = cidr;
  const mask = parseInt(prefix, 10);
  if (mask < 16 || mask > 30) throw new Error('Subnetzmaske muss zwischen /16 und /30 liegen');
  const base     = ((+a << 24) | (+b << 16) | (+c << 8) | +d) >>> 0;
  const hostMask = (0xFFFFFFFF >>> mask) >>> 0;
  const net      = (base & ~hostMask) >>> 0;
  const bcast    = (net | hostMask) >>> 0;
  const hosts    = [];
  for (let i = net + 1; i < bcast; i++) {
    hosts.push(`${(i >>> 24) & 0xFF}.${(i >>> 16) & 0xFF}.${(i >>> 8) & 0xFF}.${i & 0xFF}`);
  }
  return hosts;
}

function runSnmpGet(host, community, version, oids, timeout = 2000) {
  return new Promise((resolve) => {
    const args = ['-v', version, '-c', community, '-t', '1', '-r', '0', '-On', host, ...oids];
    const proc = spawn('snmpget', args);
    let out = '';
    proc.stdout.on('data', d => (out += d));
    proc.stderr.on('data', () => {});
    const timer = setTimeout(() => { try { proc.kill(); } catch {} }, timeout);
    proc.on('close', () => { clearTimeout(timer); resolve(out); });
    proc.on('error', () => { clearTimeout(timer); resolve(''); });
  });
}

function detectLancomOs(sysDescr, sysObjectId) {
  const desc = (sysDescr || '').toUpperCase();
  if (desc.includes('LCOS LX')) return 'LCOS LX';
  if (desc.includes('LCOS SX')) return 'LCOS SX';
  if (desc.includes('LCOS FX')) return 'LCOS FX';
  if (desc.includes('LCOS'))    return 'LCOS';
  if ((sysObjectId || '').includes('.2356.')) return 'LANCOM';
  return null;
}

async function scanHost(host, community, version) {
  const out = await runSnmpGet(host, community, version, [
    '1.3.6.1.2.1.1.1.0', // sysDescr
    '1.3.6.1.2.1.1.2.0', // sysObjectID
    '1.3.6.1.2.1.1.5.0', // sysName
    '1.3.6.1.2.1.1.6.0', // sysLocation
  ]);
  if (!out.trim()) return null;

  let sysDescr = '', sysObjectId = '', sysName = '', sysLocation = '';
  out.split('\n').forEach(line => {
    if (/\.1\.1\.0\s*=/.test(line)) sysDescr    = snmpVal(line.split('=').slice(1).join('='));
    if (/\.1\.2\.0\s*=/.test(line)) sysObjectId = (line.match(/OID:\s*(.+)/) || [])[1]?.trim() || '';
    if (/\.1\.5\.0\s*=/.test(line)) sysName     = snmpVal(line.split('=').slice(1).join('='));
    if (/\.1\.6\.0\s*=/.test(line)) sysLocation = snmpVal(line.split('=').slice(1).join('='));
  });

  const os = detectLancomOs(sysDescr, sysObjectId);
  if (!os) return null;

  return { ip: host, sysName, sysDescr, sysLocation, os };
}

// ── HTTP Server ───────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // ── REST-API: Settings & Devices & LMC ────────────────────────────────────

  if (req.url === '/api/settings') {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(readSettings())); return;
    }
    if (req.method === 'POST') {
      let b = ''; req.on('data', d => (b += d));
      req.on('end', () => {
        try { writeSettings(JSON.parse(b)); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); }
        catch (e) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); }
      }); return;
    }
  }

  if (req.url === '/api/devices') {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(readDevices())); return;
    }
    if (req.method === 'POST') {
      let b = ''; req.on('data', d => (b += d));
      req.on('end', () => {
        try {
          const patch = JSON.parse(b);
          const merged = { ...readDevices(), ...patch };
          writeDevices(merged);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, count: Object.keys(merged).length }));
        } catch (e) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); }
      }); return;
    }
    if (req.method === 'DELETE') {
      let b = ''; req.on('data', d => (b += d));
      req.on('end', () => {
        try {
          const { ip } = JSON.parse(b || '{}');
          const devs = readDevices();
          if (ip) delete devs[ip]; else Object.keys(devs).forEach(k => delete devs[k]);
          writeDevices(devs);
          res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}');
        } catch (e) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); }
      }); return;
    }
  }

  if (req.method === 'POST' && req.url === '/api/lmc') {
    let b = ''; req.on('data', d => (b += d));
    req.on('end', async () => {
      try {
        const { service, path: apiPath, method = 'GET', token, body: reqBody } = JSON.parse(b);
        if (!token) throw new Error('token fehlt');
        const result = await lmcProxy(service, apiPath, method, token, reqBody || null);
        res.writeHead(result.status, { 'Content-Type': 'application/json' });
        res.end(result.body);
      } catch (e) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); }
    }); return;
  }

  // Netzwerk-Scanner (SSE-Stream)
  if (req.method === 'POST' && req.url === '/scan') {
    let body = '';
    req.on('data', d => (body += d));
    req.on('end', async () => {
      let hosts, community, version;
      try {
        const parsed = JSON.parse(body);
        if (!parsed.subnet) throw new Error('subnet fehlt');
        community = parsed.community || 'public';
        version   = parsed.version   || '2c';
        hosts     = subnetToHosts(parsed.subnet);
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection':    'keep-alive',
      });

      const send = (obj) => { try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch {} };

      send({ type: 'start', total: hosts.length });

      const CONCURRENCY = 30;
      let idx = 0, done = 0, found = 0;

      async function worker() {
        while (idx < hosts.length) {
          const host = hosts[idx++];
          const device = await scanHost(host, community, version);
          done++;
          if (device) {
            found++;
            send({ type: 'found', device, scanned: done, total: hosts.length, found });
          } else if (done % 5 === 0 || done === hosts.length) {
            send({ type: 'progress', scanned: done, total: hosts.length, found });
          }
        }
      }

      await Promise.all(Array(Math.min(CONCURRENCY, hosts.length)).fill(null).map(() => worker()));
      send({ type: 'done', total: hosts.length, found });
      res.end();
    });
    return;
  }

  // SNMP endpoint
  if (req.method === 'POST' && req.url === '/snmp') {
    let body = '';
    req.on('data', d => (body += d));
    req.on('end', async () => {
      try {
        const { host, community = 'public', version = '2c', type } = JSON.parse(body);
        if (!host) throw new Error('host fehlt');

        let result;
        switch (type) {
          case 'system':     result = await snmpSystem(host, community, version);     break;
          case 'interfaces': result = await snmpInterfaces(host, community, version); break;
          case 'mac':        result = await snmpMac(host, community, version);        break;
          case 'lldp':       result = await snmpLldp(host, community, version);       break;
          case 'wlan':       result = await snmpWlan(host, community, version);       break;
          case 'wds':        result = await snmpWds(host, community, version);        break;
          case 'l2tp':       result = await snmpL2tp(host, community, version);       break;
          default:           throw new Error(`Unbekannter Typ: ${type}`);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Static file serving (nur index.html)
  if (req.method === 'GET') {
    const file = path.join(__dirname, 'index.html');
    try {
      const data = fs.readFileSync(file);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(data);
    } catch {
      res.writeHead(404); res.end('Not found');
    }
    return;
  }

  res.writeHead(405); res.end();
});

server.listen(PORT, () => {
  console.log(`LANCOM OnSite läuft auf http://localhost:${PORT}`);
  console.log('Voraussetzung: snmpwalk / snmpbulkwalk muss installiert sein');
});
