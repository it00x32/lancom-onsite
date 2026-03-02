#!/usr/bin/env node
/**
 * OnSite – lokaler SNMP-Server
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

// ── Statische Assets ──────────────────────────────────────────────────────────

const STATIC_FILES = {
  '/styles.css': { file: path.join(__dirname, 'styles.css'), mime: 'text/css; charset=utf-8' },
  '/app.js':     { file: path.join(__dirname, 'app.js'),     mime: 'application/javascript; charset=utf-8' },
  '/index.html': { file: path.join(__dirname, 'index.html'), mime: 'text/html; charset=utf-8' },
};

function sendJson(req, res, statusCode, obj) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

// ── Datenpersistenz ───────────────────────────────────────────────────────────

const DATA_DIR       = path.join(__dirname, 'data');
const SETTINGS_FILE  = path.join(DATA_DIR, 'settings.json');
const DEVICES_FILE   = path.join(DATA_DIR, 'devices.json');
const CRITERIA_FILE  = path.join(DATA_DIR, 'criteria.json');
const SDN_FILE       = path.join(DATA_DIR, 'sdn.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DEFAULT_SDN = {
  vlans: [{ name: 'Management', vlanId: 1, isManagement: true }],
};
function readSdn()      { try { return JSON.parse(fs.readFileSync(SDN_FILE,'utf8')); } catch { return JSON.parse(JSON.stringify(DEFAULT_SDN)); } }
function writeSdn(data) { fs.writeFileSync(SDN_FILE, JSON.stringify(data, null, 2)); }

const DEFAULT_CRITERIA = {
  osCriteria: [
    { os: 'LCOS LX',   match: ['LCOS LX', 'LCOS-LX', 'LX-', 'LW-', 'OW-', 'OX-'] },
    { os: 'LCOS FX',   match: ['LCOS FX', 'LCOS-FX'] },
    { os: 'LCOS SX 3', match: ['LCOS SX 3.', 'LCOS-SX 3.', 'GS-2'] },
    { os: 'LCOS SX 4', match: ['LCOS SX 4.', 'LCOS-SX 4.', 'GS-3'] },
    { os: 'LCOS SX 5', match: ['LCOS SX 5.', 'LCOS-SX 5.'] },
    { os: 'LCOS',      match: ['LCOS'] },
  ],
  typeCriteria: [
    { type: 'Access Point', keywords: ['OAP', 'IAP', 'LN'] },
    { type: 'Router',       keywords: [] },
  ],
};

const DEFAULT_SETTINGS = {
  snmpReadCommunity:  'public',
  snmpWriteCommunity: 'private',
  snmpVersion:        '2c',
  rssiGreen:  80,
  rssiYellow: 50,
  rssiOrange:  0,
  lastScanSubnet: '',
  snmpV3SecurityName:  '',
  snmpV3SecurityLevel: 'authPriv',
  snmpV3AuthProtocol:  'SHA',
  snmpV3AuthPassword:  '',
  snmpV3PrivProtocol:  'AES',
  snmpV3PrivPassword:  '',
  filterOS:   [],
  filterType: [],
};

let _settingsCache  = null;
let _deviceCache    = null;
let _criteriaCache  = null;

function readCriteria() {
  if (_criteriaCache) return _criteriaCache;
  try { _criteriaCache = JSON.parse(fs.readFileSync(CRITERIA_FILE, 'utf8')); }
  catch { _criteriaCache = JSON.parse(JSON.stringify(DEFAULT_CRITERIA)); }
  return _criteriaCache;
}
function writeCriteria(data) {
  _criteriaCache = data;
  fs.writeFileSync(CRITERIA_FILE, JSON.stringify(data, null, 2));
}

function readSettings() {
  if (_settingsCache) return _settingsCache;
  try { _settingsCache = { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) }; }
  catch { _settingsCache = { ...DEFAULT_SETTINGS }; }
  return _settingsCache;
}
function writeSettings(data) {
  _settingsCache = { ...DEFAULT_SETTINGS, ...data };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(_settingsCache, null, 2));
}
function readDevices() {
  if (_deviceCache) return _deviceCache;
  try { _deviceCache = JSON.parse(fs.readFileSync(DEVICES_FILE, 'utf8')); }
  catch { _deviceCache = {}; }
  return _deviceCache;
}
function writeDevices(data) {
  _deviceCache = data;
  fs.writeFileSync(DEVICES_FILE, JSON.stringify(data, null, 2));
}

// ── LMC-Proxy ─────────────────────────────────────────────────────────────────

const LMC_SERVICES = {
  auth:              'https://cloud.lancom.de/cloud-service-auth',
  devices:           'https://cloud.lancom.de/cloud-service-devices',
  configapplication: 'https://cloud.lancom.de/cloud-service-config',
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

function buildSnmpAuthArgs(version, community) {
  if (version === '3') {
    const s = readSettings();
    const secName   = s.snmpV3SecurityName  || '';
    const secLevel  = s.snmpV3SecurityLevel || 'authPriv';
    const authProto = s.snmpV3AuthProtocol  || 'SHA';
    const authPass  = s.snmpV3AuthPassword  || '';
    const privProto = s.snmpV3PrivProtocol  || 'AES';
    const privPass  = s.snmpV3PrivPassword  || '';
    const args = ['-v', '3', '-u', secName, '-l', secLevel];
    if (secLevel === 'authNoPriv' || secLevel === 'authPriv') {
      args.push('-a', authProto, '-A', authPass);
    }
    if (secLevel === 'authPriv') {
      args.push('-x', privProto, '-X', privPass);
    }
    return args;
  }
  return ['-v', version, '-c', community];
}

function runSnmpWalk(host, community, version, oid, timeout = 12000) {
  return new Promise((resolve) => {
    const cmd  = (version === '1') ? 'snmpwalk' : 'snmpbulkwalk';
    const args = [...buildSnmpAuthArgs(version, community), '-On', '-t', '5', '-r', '1', host, oid];
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
  // Colon-separated, possibly unpadded: "0:a0:57:36:f1:96" or "00:a0:57:36:f1:96"
  const parts = str.trim().split(':');
  if (parts.length === 6 && parts.every(p => /^[0-9a-fA-F]{1,2}$/.test(p))) {
    return parts.map(p => p.padStart(2, '0').toLowerCase()).join(':');
  }
  // Space-separated: "00 a0 57 36 f1 96"
  const hex = str.replace(/\s/g, '').toLowerCase();
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
  // LANCOM LCOS verwendet den IEEE-Pfad (1.0.8802.1.1.2), nicht den IANA-Pfad (1.3.6.1.2.1.111).
  // Beide OIDs werden parallel abgefragt; der erste mit Daten gewinnt.
  const [outIeee, outIana] = await Promise.all([
    runSnmpWalk(host, community, version, '1.0.8802.1.1.2.1.4.1.1'),
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.111.1.4.1.1'),
  ]);
  const out = outIeee.trim() ? outIeee : outIana;
  const useIeee = !!outIeee.trim();

  const neighbors = {};

  out.split('\n').forEach(line => {
    // IEEE OID: .1.0.8802.1.1.2.1.4.1.1.{col}.{timeMark}.{localPortNum}.{remIndex}
    // IANA OID: .1.3.6.1.2.1.111.1.4.1.1.{col}.{timeMark}.{localPortNum}.{remIndex}
    const m = line.match(/(?:8802\.1\.1\.2\.1\.4\.1\.1|111\.1\.4\.1\.1)\.(\d+)\.(\d+)\.(\d+)\.(\d+)\s*=\s*(.*)/);
    if (!m) return;
    const col = parseInt(m[1]);
    const key = `${m[3]}_${m[4]}`; // localPort_remIndex
    if (!neighbors[key]) neighbors[key] = { localPort: m[3] };
    const val = snmpVal(m[5]);
    switch (col) {
      case 1:  neighbors[key].remChassisSubtype = parseInt(val) || 0; break;
      case 2:  neighbors[key].remChassisIdRaw   = m[5].trim(); break; // raw for MAC parsing
      case 7:  neighbors[key].remPortId   = val; break;
      case 8:  neighbors[key].remPortDesc = val; break;
      case 9:  neighbors[key].remSysName  = val; break;
      case 10: neighbors[key].remSysDesc  = val; break;
      case 12: neighbors[key].remCaps     = val; break;
    }
  });

  // Lokale Port-Namen per ifName
  const lldpPortOid = useIeee ? '1.0.8802.1.1.2.1.3.7.1.3' : '1.3.6.1.2.1.111.1.3.7.1.3';
  const [ifNameOut, lldpPortOut] = await Promise.all([
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.31.1.1.1.1'),
    runSnmpWalk(host, community, version, lldpPortOid),
  ]);
  const lldpPortNames = {};
  lldpPortOut.split('\n').forEach(line => {
    const m = line.match(/(?:8802\.1\.1\.2\.1\.3\.7\.1\.3|111\.1\.3\.7\.1\.3)\.(\d+)\s*=\s*(.*)/);
    if (m) lldpPortNames[m[1]] = snmpVal(m[2]);
  });
  const ifNames = {};
  ifNameOut.split('\n').forEach(line => {
    const m = line.match(/31\.1\.1\.1\.1\.(\d+)\s*=\s*(?:STRING:\s*)?"?([^"\n]+?)"?\s*$/);
    if (m) ifNames[m[1]] = m[2].trim();
  });

  const entries = Object.values(neighbors).map(n => {
    // Chassis-ID als MAC extrahieren wenn Subtype=6 (macAddress)
    let remMac = null;
    if (n.remChassisSubtype === 6) {
      const hx = (n.remChassisIdRaw||'').match(/Hex-STRING:\s*([\da-fA-F ]+)/i);
      if (hx) remMac = macFromHexStr(hx[1].trim());
    }
    return {
      ...n,
      remMac,
      localPortName: lldpPortNames[n.localPort] || ifNames[n.localPort] || `Port ${n.localPort}`,
    };
  });
  entries.sort((a, b) => (a.localPortName || '').localeCompare(b.localPortName || '', undefined, { numeric: true }));
  return { entries, count: entries.length };
}

// ── WiFi Mesh / WDS (LCOS LX) ────────────────────────────────────────────────

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
    if (col === 2) links[linkName].ssid   = val;
    if (col === 3) links[linkName].remote = parseInt(val, 10) === 1; // 1 = STA/remote side
    if (col === 4) links[linkName].radio  = parseInt(val, 10) || 0;
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
    const val = snmpVal(m[3]);
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
    const val = snmpVal(m[3]);
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

// ── VLAN (Q-BRIDGE-MIB, IEEE 802.1Q) ─────────────────────────────────────────
// LCOS SX:   dot1qVlanStaticName (1.3.6.1.2.1.17.7.1.4.3.1.1) — vollständig unterstützt
// LCOS LX:   Q-BRIDGE-MIB unterstützt (802.1Q VLAN-Tagging per SSID/Bridge-Interface)
// LCOS/FX:   Q-BRIDGE-MIB ggf. teilweise unterstützt

async function snmpVlan(host, community, version, os, devType) {
  const [nameOut, statusOut] = await Promise.all([
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.17.7.1.4.3.1.1'), // dot1qVlanStaticName
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.17.7.1.4.3.1.5'), // dot1qVlanStaticRowStatus
  ]);

  const names = {};
  nameOut.split('\n').forEach(line => {
    const m = line.match(/17\.7\.1\.4\.3\.1\.1\.(\d+)\s*=\s*(.*)/);
    if (m) names[m[1]] = snmpVal(m[2]);
  });

  const statuses = {};
  statusOut.split('\n').forEach(line => {
    const m = line.match(/17\.7\.1\.4\.3\.1\.5\.(\d+)\s*=\s*(.*)/);
    if (m) statuses[m[1]] = snmpVal(m[2]);
  });

  const entries = Object.keys(names).map(id => {
    const st = statuses[id] || '';
    const active = st === '1' || st.startsWith('active');
    return { vlanId: parseInt(id), name: names[id] || '', active };
  });
  entries.sort((a, b) => a.vlanId - b.vlanId);
  return { entries, count: entries.length };
}

// ── Port-Einstellungen ────────────────────────────────────────────────────────

async function snmpPortSettings(host, community, version) {
  const [ifOut, ifxOut, pvidOut] = await Promise.all([
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.2.2.1'),
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.31.1.1.1'),
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.17.7.1.4.5.1.1'), // dot1qPvid
  ]);
  const ports = {};
  ifOut.split('\n').forEach(line => {
    const m = line.match(/\.2\.2\.1\.(\d+)\.(\d+)\s*=\s*(.*)/);
    if (!m) return;
    const col = parseInt(m[1]), idx = m[2], val = snmpVal(m[3]);
    if (!ports[idx]) ports[idx] = { idx };
    if (col === 2) ports[idx].descr       = val;
    if (col === 5) ports[idx].speed       = parseInt(val) || 0;
    if (col === 7) ports[idx].adminStatus = val;
    if (col === 8) ports[idx].operStatus  = val;
  });
  ifxOut.split('\n').forEach(line => {
    const m = line.match(/\.31\.1\.1\.1\.(\d+)\.(\d+)\s*=\s*(.*)/);
    if (!m) return;
    const col = parseInt(m[1]), idx = m[2], val = snmpVal(m[3]);
    if (!ports[idx]) ports[idx] = { idx };
    if (col === 1)  ports[idx].name      = val;
    if (col === 15) ports[idx].highSpeed = parseInt(val) || 0;
  });
  pvidOut.split('\n').forEach(line => {
    const m = line.match(/17\.7\.1\.4\.5\.1\.1\.(\d+)\s*=\s*(.*)/);
    if (m) { const idx = m[1]; if (!ports[idx]) ports[idx] = { idx }; ports[idx].pvid = parseInt(snmpVal(m[2])) || 0; }
  });
  const entries = Object.values(ports).filter(p => p.descr || p.name)
    .sort((a, b) => parseInt(a.idx) - parseInt(b.idx));
  return { entries };
}

// ── STP (IEEE 802.1D/RSTP) ────────────────────────────────────────────────────

async function snmpStpPrivate(host, community, version) {
  // LANCOM private MIB für LCOS SX 4+ (Vitesse-Chipset, kein Standard-dot1dStp)
  const PFX = '1.3.6.1.4.1.2356.14.2.18';
  const [globalOut, statusOut, portCfgOut, ifNameOut] = await Promise.all([
    runSnmpWalk(host, community, version, `${PFX}.1`),        // global config
    runSnmpWalk(host, community, version, `${PFX}.2`),        // CIST status (bridge MAC, root cost)
    runSnmpWalk(host, community, version, `${PFX}.5.10.1`),   // port config table (cols 2-10)
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.31.1.1.1.1'),
  ]);
  const STP_MODE = { '0':'Disabled', '1':'STP', '2':'RSTP', '3':'MSTP' };
  const global = {};
  globalOut.split('\n').forEach(line => {
    const m = line.match(/14\.2\.18\.1\.(\d+)\.0\s*=\s*(.*)/);
    if (!m) return;
    const v = snmpVal(m[2]);
    switch (parseInt(m[1])) {
      case 1:  global.mode      = v; global.modeLabel = STP_MODE[v]||v; break;
      case 2:  global.priority  = v; break;
      case 3:  global.fwdDelay  = v; break;  // fwdDelay (15s standard)
      case 4:  global.maxAge    = v; break;  // maxAge (20s standard)
      case 10: global.helloTime = v; break;  // helloTime (2s standard)
    }
  });
  statusOut.split('\n').forEach(line => {
    const m = line.match(/14\.2\.18\.2\.(\d+)\.0\s*=\s*(.*)/);
    if (!m) return;
    const v = snmpVal(m[2]);
    switch (parseInt(m[1])) {
      case 1: global.bridgeMac = v; break;  // own bridge MAC "00-a0-57-xx-xx-xx"
      case 2: global.rootCost  = v; break;  // root path cost (0 = this IS root)
    }
  });
  // Designated root = priority + bridge MAC (since rootCost=0 means this switch IS root)
  if (global.bridgeMac) {
    const prio = parseInt(global.priority || '32768');
    global.designatedRoot = `${prio} / ${global.bridgeMac}`;
    global.rootPort = global.rootCost === '0' ? '— (Root)' : '—';
  }
  const ifNames = {};
  ifNameOut.split('\n').forEach(line => {
    const m = line.match(/31\.1\.1\.1\.1\.(\d+)\s*=\s*(?:STRING:\s*)?"?([^"\n]+?)"?\s*$/);
    if (m) ifNames[m[1]] = m[2].trim();
  });
  const ports = {};
  portCfgOut.split('\n').forEach(line => {
    // 18.5.10.1.{col}.{port}
    const m = line.match(/18\.5\.10\.1\.(\d+)\.(\d+)\s*=\s*(.*)/);
    if (!m) return;
    const col = parseInt(m[1]), port = m[2], v = snmpVal(m[3]);
    if (!ports[port]) ports[port] = { port };
    switch (col) {
      case 2: ports[port].portEnabled = (v === '1'); break; // 1=on 0=off
      case 3: ports[port].edgeAdmin   = v; break;           // 0=no 1=yes
      case 4: ports[port].priority    = v; break;           // 128 default
      case 5: ports[port].pathCost    = v === '0' ? 'Auto' : v; break; // 0=auto
    }
  });
  const portEntries = Object.values(ports).map(p => ({
    ...p,
    portName: ifNames[p.port] || 'Port ' + p.port,
  })).sort((a, b) => parseInt(a.port) - parseInt(b.port));
  return {
    global, portEntries,
    _meta: {
      mibType: 'private',
      oidBase: `${PFX}.5.10.1.2`, enableValue: 1, disableValue: 0,
      globalOid: `${PFX}.1.1.0`,
      modes: [
        { label: 'RSTP', value: 2 },
        { label: 'MSTP', value: 3 },
      ],
    },
  };
}

async function snmpStp(host, community, version) {
  // Prüfen ob Standard-Bridge-MIB verfügbar (LCOS SX 3, LCOS)
  const probe = await runSnmpGet(host, community, version, ['1.3.6.1.2.1.17.2.1.0'], 3000);
  if (!probe.includes('INTEGER') || probe.includes('No Such Object')) {
    return await snmpStpPrivate(host, community, version);
  }
  const [globalOut, portOut, bpIfOut, ifNameOut] = await Promise.all([
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.17.2'),
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.17.2.15.1'),
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.17.1.4.1.2'),
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.31.1.1.1.1'),
  ]);
  const global = {};
  globalOut.split('\n').forEach(line => {
    const m = line.match(/17\.2\.(\d+)\.0\s*=\s*(.*)/);
    if (!m) return;
    const v = snmpVal(m[2]);
    switch (parseInt(m[1])) {
      case 2:  global.priority   = v; break;
      case 3:  global.timeSince  = v; break;
      case 4:  global.topChanges = v; break;
      case 5:  global.designatedRoot = m[2].trim(); break;
      case 6:  global.rootCost   = v; break;
      case 7:  global.rootPort   = v; break;
      case 8:  global.maxAge     = v; break;
      case 9:  global.helloTime  = v; break;
      case 15: global.fwdDelay   = v; break;
    }
  });
  const bpToIf = {};
  bpIfOut.split('\n').forEach(line => {
    const m = line.match(/17\.1\.4\.1\.2\.(\d+)\s*=\s*INTEGER:\s*(\d+)/);
    if (m) bpToIf[m[1]] = m[2];
  });
  const ifNames = {};
  ifNameOut.split('\n').forEach(line => {
    const m = line.match(/31\.1\.1\.1\.1\.(\d+)\s*=\s*(?:STRING:\s*)?"?([^"\n]+?)"?\s*$/);
    if (m) ifNames[m[1]] = m[2].trim();
  });
  const ports = {};
  portOut.split('\n').forEach(line => {
    const m = line.match(/17\.2\.15\.1\.(\d+)\.(\d+)\s*=\s*(.*)/);
    if (!m) return;
    const col = parseInt(m[1]), port = m[2], v = snmpVal(m[3]);
    if (!ports[port]) ports[port] = { port };
    if (col === 2)  ports[port].priority   = v;
    if (col === 3)  ports[port].state      = v;
    if (col === 4)  ports[port].portEnabled = (v !== '2');  // 1=en, 2=dis
    if (col === 5)  ports[port].pathCost   = v;
    if (col === 10) ports[port].fwdTrans   = v;
  });
  const portEntries = Object.values(ports).map(p => {
    const ifIdx = bpToIf[p.port];
    return { ...p, portName: ifIdx ? (ifNames[ifIdx] || 'If'+ifIdx) : 'Port '+p.port };
  }).sort((a, b) => parseInt(a.port) - parseInt(b.port));
  return {
    global, portEntries,
    _meta: { mibType: 'standard', oidBase: '1.3.6.1.2.1.17.2.15.1.4', enableValue: 1, disableValue: 2, globalOid: null, modes: [] },
  };
}

// ── PoE (POWER-ETHERNET-MIB, RFC 3621) ───────────────────────────────────────

async function snmpPoe(host, community, version) {
  const [portOut, mainOut] = await Promise.all([
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.105.1.1.1'), // pethPsePortTable
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.105.1.3.1'), // pethMainPseTable
  ]);
  const main = {};
  mainOut.split('\n').forEach(line => {
    const m = line.match(/105\.1\.3\.1\.(\d+)\.(\d+)\s*=\s*(.*)/);
    if (!m) return;
    const v = snmpVal(m[3]);
    if (m[1] === '2') main.power       = parseInt(v) || 0;
    if (m[1] === '3') main.operStatus  = v;
    if (m[1] === '4') main.consumption = parseInt(v) || 0;
  });
  const ports = {};
  portOut.split('\n').forEach(line => {
    const m = line.match(/105\.1\.1\.1\.(\d+)\.(\d+)\.(\d+)\s*=\s*(.*)/);
    if (!m) return;
    const col = m[1], group = m[2], port = m[3], key = `${group}.${port}`;
    if (!ports[key]) ports[key] = { group: parseInt(group), port: parseInt(port) };
    const v = snmpVal(m[4]);
    if (col === '3') ports[key].adminEnable     = v;
    if (col === '6') ports[key].detectionStatus = v;
    if (col === '7') ports[key].powerClass      = v;
  });
  const portEntries = Object.values(ports).sort((a, b) =>
    a.group !== b.group ? a.group - b.group : a.port - b.port);
  return { main, portEntries };
}

// ── Loop-Protection (STP-Portzustände als Indikator) ─────────────────────────
// LCOS SX: Loop Protection via STP-Blocking (dot1dStpPortState) + RSTP port roles
// dot1dStpPortState: 1=disabled 2=blocking 3=listening 4=learning 5=forwarding 6=broken

async function snmpLoopProtection(host, community, version) {
  // Prüfen ob Standard-Bridge-MIB verfügbar
  const probe = await runSnmpGet(host, community, version, ['1.3.6.1.2.1.17.2.1.0'], 3000);
  if (!probe.includes('INTEGER') || probe.includes('No Such Object')) {
    // LCOS SX 4+: private MIB, selbe OIDs wie snmpStpPrivate
    const PFX = '1.3.6.1.4.1.2356.14.2.18';
    const [enableOut, stateOut, ifNameOut] = await Promise.all([
      runSnmpWalk(host, community, version, `${PFX}.5.10.1.2`),
      runSnmpWalk(host, community, version, `${PFX}.6.2.1.3.1`),
      runSnmpWalk(host, community, version, '1.3.6.1.2.1.31.1.1.1.1'),
    ]);
    const ifNames = {};
    ifNameOut.split('\n').forEach(line => {
      const m = line.match(/31\.1\.1\.1\.1\.(\d+)\s*=\s*(?:STRING:\s*)?"?([^"\n]+?)"?\s*$/);
      if (m) ifNames[m[1]] = m[2].trim();
    });
    const portMap = {};
    enableOut.split('\n').forEach(line => {
      const m = line.match(/18\.5\.10\.1\.2\.(\d+)\s*=\s*(.*)/);
      if (!m) return;
      const port = m[1];
      if (!portMap[port]) portMap[port] = { port };
      portMap[port].portEnabled = snmpVal(m[2]) === '1';
    });
    stateOut.split('\n').forEach(line => {
      const m = line.match(/18\.6\.2\.1\.3\.1\.(\d+)\s*=\s*(.*)/);
      if (!m) return;
      const port = m[1];
      if (!portMap[port]) portMap[port] = { port };
      const sv = snmpVal(m[2]);
      const stateMap = { '0':'2', '1':'4', '2':'5' };
      portMap[port].state = stateMap[sv] || '1';
    });
    const ports = Object.values(portMap).map(p => ({
      ...p, portName: ifNames[p.port] || 'Port ' + p.port,
    })).sort((a, b) => parseInt(a.port) - parseInt(b.port));
    return { ports, _meta: { oidBase: `${PFX}.5.10.1.2`, enableValue: 1, disableValue: 0 } };
  }

  // Standard-MIB (LCOS SX 3, LCOS)
  const [stpOut, enableOut, bpIfOut, ifNameOut] = await Promise.all([
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.17.2.15.1.3'),
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.17.2.15.1.4'),
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.17.1.4.1.2'),
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.31.1.1.1.1'),
  ]);
  const bpToIf = {};
  bpIfOut.split('\n').forEach(line => {
    const m = line.match(/17\.1\.4\.1\.2\.(\d+)\s*=\s*INTEGER:\s*(\d+)/);
    if (m) bpToIf[m[1]] = m[2];
  });
  const ifNames = {};
  ifNameOut.split('\n').forEach(line => {
    const m = line.match(/31\.1\.1\.1\.1\.(\d+)\s*=\s*(?:STRING:\s*)?"?([^"\n]+?)"?\s*$/);
    if (m) ifNames[m[1]] = m[2].trim();
  });
  const portMap = {};
  stpOut.split('\n').forEach(line => {
    const m = line.match(/17\.2\.15\.1\.3\.(\d+)\s*=\s*(.*)/);
    if (!m) return;
    const port = m[1];
    if (!portMap[port]) portMap[port] = { port };
    portMap[port].state = snmpVal(m[2]);
  });
  enableOut.split('\n').forEach(line => {
    const m = line.match(/17\.2\.15\.1\.4\.(\d+)\s*=\s*(.*)/);
    if (!m) return;
    const port = m[1];
    if (!portMap[port]) portMap[port] = { port };
    portMap[port].portEnabled = snmpVal(m[2]) !== '2'; // 1=en, 2=dis
  });
  const ports = Object.values(portMap).map(p => {
    const ifIdx = bpToIf[p.port];
    return { ...p, portName: ifIdx ? (ifNames[ifIdx] || 'If'+ifIdx) : 'Port '+p.port };
  }).sort((a, b) => parseInt(a.port) - parseInt(b.port));
  return { ports, _meta: { oidBase: '1.3.6.1.2.1.17.2.15.1.4', enableValue: 1, disableValue: 2 } };
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
    const args = [...buildSnmpAuthArgs(version, community), '-t', '1', '-r', '0', '-On', host, ...oids];
    const proc = spawn('snmpget', args);
    let out = '';
    proc.stdout.on('data', d => (out += d));
    proc.stderr.on('data', () => {});
    const timer = setTimeout(() => { try { proc.kill(); } catch {} }, timeout);
    proc.on('close', () => { clearTimeout(timer); resolve(out); });
    proc.on('error', () => { clearTimeout(timer); resolve(''); });
  });
}

function runSnmpSet(host, community, version, oid, type, value, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const args = [...buildSnmpAuthArgs(version, community), '-t', '5', '-r', '1', host, oid, type, String(value)];
    const proc = spawn('snmpset', args);
    let out = '', err = '';
    proc.stdout.on('data', d => (out += d));
    proc.stderr.on('data', d => (err += d));
    const timer = setTimeout(() => { try { proc.kill(); } catch {} reject(new Error('Timeout')); }, timeout);
    proc.on('close', code => { clearTimeout(timer); if (code === 0) resolve(out.trim()); else reject(new Error(err.trim() || `Exit ${code}`)); });
    proc.on('error', e => { clearTimeout(timer); reject(e); });
  });
}

function detectDeviceOs(sysDescr, sysObjectId) {
  const desc = (sysDescr || '').toUpperCase();
  const { osCriteria } = readCriteria();
  for (const rule of osCriteria) {
    if (rule.match.some(kw => desc.includes(kw.toUpperCase()))) return rule.os;
  }
  if ((sysObjectId || '').includes('.2356.')) return 'LANCOM';
  return null;
}

async function scanHost(host, community, version) {
  const out = await runSnmpGet(host, community, version, [
    '1.3.6.1.2.1.1.1.0',        // sysDescr
    '1.3.6.1.2.1.1.2.0',        // sysObjectID
    '1.3.6.1.2.1.1.5.0',        // sysName
    '1.3.6.1.2.1.1.6.0',        // sysLocation
    '1.3.6.1.2.1.2.2.1.6.1',    // ifPhysAddress.1 (Management-MAC, Interface 1)
    '1.3.6.1.2.1.47.1.1.1.1.11.1',    // entPhysicalSerialNum.1 (FX)
    '1.3.6.1.4.1.2356.11.1.47.7.0',   // LANCOM LCOS Seriennummer (Status/Hardware-Info)
    '1.3.6.1.4.1.2356.13.1.47.7.0',   // LANCOM LCOS LX Seriennummer
    '1.3.6.1.4.1.2356.14.1.1.1.13.0', // LANCOM LCOS SX Seriennummer
  ]);
  if (!out.trim()) return null;

  let sysDescr = '', sysObjectId = '', sysName = '', sysLocation = '', mac = '', serial = '';
  out.split('\n').forEach(line => {
    if (/\.2\.1\.1\.1\.0\s*=/.test(line))  sysDescr    = snmpVal(line.split('=').slice(1).join('='));
    if (/\.2\.1\.1\.2\.0\s*=/.test(line))  sysObjectId = (line.match(/OID:\s*(.+)/) || [])[1]?.trim() || '';
    if (/\.2\.1\.1\.5\.0\s*=/.test(line))  sysName     = snmpVal(line.split('=').slice(1).join('='));
    if (/\.2\.1\.1\.6\.0\s*=/.test(line))  sysLocation = snmpVal(line.split('=').slice(1).join('='));
    if (/\.2\.2\.1\.6\.1\s*=/.test(line)) {
      const hx = line.match(/(?:Hex-STRING|STRING):\s*([\da-fA-F: ]+)/i);
      if (hx) mac = macFromHexStr(hx[1].trim()) || '';
    }
    if (/\.47\.1\.1\.1\.1\.11\.1\s*=/.test(line))    { const v = snmpVal(line.split('=').slice(1).join('=')); if (v && !v.includes('No Such')) serial = v; }
    if (/\.2356\.11\.1\.47\.7\.0\s*=/.test(line))    { const v = snmpVal(line.split('=').slice(1).join('=')); if (v && !v.includes('No Such')) serial = v; }
    if (/\.2356\.13\.1\.47\.7\.0\s*=/.test(line))    { const v = snmpVal(line.split('=').slice(1).join('=')); if (v && !v.includes('No Such')) serial = v; }
    if (/\.2356\.14\.1\.1\.1\.13\.0\s*=/.test(line)) { const v = snmpVal(line.split('=').slice(1).join('=')); if (v && !v.includes('No Such')) serial = v; }
  });

  const os = detectDeviceOs(sysDescr, sysObjectId);
  if (!os) return null;

  return { ip: host, sysName, sysDescr, sysLocation, os, mac, serial };
}

// ── HTTP Server ───────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // ── REST-API: Settings & Devices & LMC ────────────────────────────────────

  if (req.url === '/api/sdn') {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(readSdn())); return;
    }
    if (req.method === 'POST') {
      let b = ''; req.on('data', d => (b += d));
      req.on('end', () => {
        try { writeSdn(JSON.parse(b)); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); }
        catch (e) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); }
      }); return;
    }
  }

  if (req.url === '/api/version') {
    const proc = spawn('git', ['describe', '--tags', '--always'], { cwd: __dirname });
    let out = '';
    proc.stdout.on('data', d => (out += d));
    proc.on('close', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ version: out.trim() || 'unknown' }));
    });
    proc.on('error', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ version: 'unknown' }));
    });
    return;
  }

  if (req.url === '/api/criteria') {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(readCriteria())); return;
    }
    if (req.method === 'POST') {
      let b = ''; req.on('data', d => (b += d));
      req.on('end', () => {
        try { writeCriteria(JSON.parse(b)); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); }
        catch (e) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); }
      }); return;
    }
  }

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
      sendJson(req, res, 200, readDevices()); return;
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

  // Einzelnes Add-in lesen
  if (req.method === 'GET' && req.url.startsWith('/api/addin?')) {
    const qs   = new urlMod.URL('http://x' + req.url).searchParams;
    const os   = qs.get('os') || '';
    const file = qs.get('file') || '';
    if (!os || !file || file.includes('..') || os.includes('..')) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'Ungültige Parameter' })); return;
    }
    const filePath = path.join(__dirname, 'addins', os, file);
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      sendJson(req, res, 200, data);
    } catch { res.writeHead(404); res.end(JSON.stringify({ error: 'Nicht gefunden' })); }
    return;
  }

  // Einzelnes Add-in speichern (mit optionalem OS-Wechsel → Datei verschieben)
  if (req.method === 'DELETE' && req.url.startsWith('/api/addin?')) {
    try {
      const params = new URLSearchParams(req.url.slice(req.url.indexOf('?')));
      const os  = params.get('os');
      const file = params.get('file');
      if (!os || !file) return sendJson(req, res, 400, { error: 'os und file erforderlich' });
      const target = path.join(__dirname, 'addins', os, file);
      if (!target.startsWith(path.join(__dirname, 'addins'))) return sendJson(req, res, 400, { error: 'Ungültiger Pfad' });
      fs.unlinkSync(target);
      return sendJson(req, res, 200, { ok: true });
    } catch(e) { return sendJson(req, res, 500, { error: e.message }); }
  }

  if (req.method === 'POST' && req.url === '/api/addin') {
    let b = ''; req.on('data', d => (b += d));
    req.on('end', () => {
      try {
        const { originalOs, os, filename, ...data } = JSON.parse(b);
        if (!os || !filename || filename.includes('..') || os.includes('..') || (originalOs||'').includes('..'))
          throw new Error('Ungültige Parameter');
        if (!filename.endsWith('.json')) throw new Error('Nur .json Dateien erlaubt');
        const targetDir  = path.join(__dirname, 'addins', os);
        const targetFile = path.join(__dirname, 'addins', os, filename);
        fs.mkdirSync(targetDir, { recursive: true });
        // Bei OS-Wechsel: alte Datei löschen
        if (originalOs && originalOs !== os) {
          const sourceFile = path.join(__dirname, 'addins', originalOs, filename);
          try { fs.unlinkSync(sourceFile); } catch { /* ignorieren falls nicht vorhanden */ }
        }
        fs.writeFileSync(targetFile, JSON.stringify({ ...data, os }, null, 2), 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}');
      } catch(e) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); }
    }); return;
  }

  if (req.method === 'GET' && req.url === '/api/addins') {
    const addinsDir = path.join(__dirname, 'addins');
    const osFolders = ['LCOS', 'LCOS LX', 'LCOS SX 3', 'LCOS SX 4', 'LCOS SX 5', 'LCOS FX'];
    const result = [];
    for (const os of osFolders) {
      const dir = path.join(addinsDir, os);
      let files = [];
      try { files = fs.readdirSync(dir).filter(f => f.endsWith('.json')); } catch { continue; }
      for (const file of files) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
          result.push({ os, filename: file, ...data });
        } catch { /* ungültige JSON-Datei überspringen */ }
      }
    }
    sendJson(req, res, 200, result);
    return;
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
        const s = readSettings();
        community = s.snmpReadCommunity || 'public';
        version   = s.snmpVersion       || '2c';
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

      // Track client disconnect so workers can stop early
      // Use res.on('close') – req emits 'close' after body is consumed (before scan finishes)
      let aborted = false;
      res.on('close', () => { aborted = true; });
      if (res.socket) res.socket.setNoDelay(true);

      const send = (obj) => {
        if (aborted) return;
        try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch { aborted = true; }
      };

      send({ type: 'start', total: hosts.length });

      const CONCURRENCY = 20;
      let idx = 0, done = 0, found = 0;

      async function worker() {
        while (idx < hosts.length && !aborted) {
          const host = hosts[idx++];
          let device = null;
          try { device = await scanHost(host, community, version); } catch { /* skip host */ }
          done++;
          if (device) {
            found++;
            send({ type: 'found', device, scanned: done, total: hosts.length, found });
          } else if (done % 5 === 0 || done === hosts.length) {
            send({ type: 'progress', scanned: done, total: hosts.length, found });
          }
        }
      }

      try {
        await Promise.all(Array(Math.min(CONCURRENCY, hosts.length)).fill(null).map(() => worker()));
      } catch { /* ignore – individual errors are caught per host */ }

      if (!aborted) {
        send({ type: 'done', total: hosts.length, found });
        res.end();
      }
    });
    return;
  }

  // SNMP endpoint
  if (req.method === 'POST' && req.url === '/snmp') {
    let body = '';
    req.on('data', d => (body += d));
    req.on('end', async () => {
      try {
        const parsed = JSON.parse(body);
        const { host, type } = parsed;
        if (!host) throw new Error('host fehlt');
        const _s = readSettings();
        const community = _s.snmpReadCommunity || 'public';
        const version   = _s.snmpVersion       || '2c';

        let result;
        switch (type) {
          case 'system':     result = await snmpSystem(host, community, version);     break;
          case 'interfaces': result = await snmpInterfaces(host, community, version); break;
          case 'mac':        result = await snmpMac(host, community, version);        break;
          case 'lldp':       result = await snmpLldp(host, community, version);       break;
          case 'wlan':       result = await snmpWlan(host, community, version);       break;
          case 'vlan':       result = await snmpVlan(host, community, version, parsed.os||'', parsed.devType||''); break;
          case 'ports':      result = await snmpPortSettings(host, community, version); break;
          case 'stp':        result = await snmpStp(host, community, version);         break;
          case 'poe':        result = await snmpPoe(host, community, version);         break;
          case 'loop':       result = await snmpLoopProtection(host, community, version); break;
          case 'wds':        result = await snmpWds(host, community, version);        break;
          case 'l2tp':       result = await snmpL2tp(host, community, version);       break;
          case 'ping': {
            const out = await runSnmpGet(host, community, version, ['1.3.6.1.2.1.1.5.0'], 2000);
            if (!out.trim()) throw new Error('No SNMP response');
            result = { reachable: true };
            break;
          }
          case 'ifmacs': {
            // ifPhysAddress (1.3.6.1.2.1.2.2.1.6) — nur eigene Interface-MACs des Geräts.
            // Bridge-FDB / ARP (verbundene Clients) werden NICHT gelesen.
            const [ifPhysOut, ifNameOut] = await Promise.all([
              runSnmpWalk(host, community, version, '1.3.6.1.2.1.2.2.1.6'),
              runSnmpWalk(host, community, version, '1.3.6.1.2.1.31.1.1.1.1'),
            ]);
            // Interface-Namen einlesen um virtuelle Interfaces (Tunnel, Loopback) auszuschließen
            const ifNames = {};
            ifNameOut.split('\n').forEach(line => {
              const m = line.match(/31\.1\.1\.1\.1\.(\d+)\s*=\s*(?:STRING:\s*)?\"?([^"\n]+?)\"?\s*$/);
              if (m) ifNames[m[1]] = m[2].trim().toLowerCase();
            });
            const macs = [];
            ifPhysOut.split('\n').forEach(line => {
              // Nur Hex-STRING Einträge sind echte MAC-Adressen
              const m = line.match(/2\.2\.1\.6\.(\d+)\s*=\s*(?:Hex-STRING|STRING):\s*([\da-fA-F: ]+)/i);
              if (!m) return;
              const idx = m[1], name = ifNames[idx] || '';
              // Tunnel, Loopback und reine Bridge-Interfaces ausschließen
              if (/^(lo|tun|gre|l2tp|ppp|sit|ip6tnl)/.test(name)) return;
              const mac = macFromHexStr(m[2].trim());
              if (mac && mac !== '00:00:00:00:00:00' && !macs.includes(mac)) macs.push(mac);
            });
            result = { macs };
            break;
          }
          default:           throw new Error(`Unbekannter Typ: ${type}`);
        }

        sendJson(req, res, 200, result);
      } catch (err) {
        sendJson(req, res, 400, { error: err.message });
      }
    });
    return;
  }

  // SNMP SET endpoint
  if (req.method === 'POST' && req.url === '/snmpset') {
    let body = '';
    req.on('data', d => (body += d));
    req.on('end', async () => {
      try {
        const { host, oid, type, value } = JSON.parse(body);
        if (!host || !oid) throw new Error('host/oid fehlt');
        const _s = readSettings();
        const community = _s.snmpWriteCommunity || _s.snmpReadCommunity || 'public';
        const version   = _s.snmpVersion || '2c';
        const result = await runSnmpSet(host, community, version, oid, type || 'i', value);
        sendJson(req, res, 200, { ok: true, result });
      } catch (err) {
        sendJson(req, res, 400, { error: err.message });
      }
    });
    return;
  }

  // Static file serving
  if (req.method === 'GET') {
    const urlPath = req.url.split('?')[0];
    const asset = STATIC_FILES[urlPath] || (urlPath === '/' ? STATIC_FILES['/index.html'] : null);
    if (asset) {
      try {
        const content = fs.readFileSync(asset.file);
        res.writeHead(200, { 'Content-Type': asset.mime, 'Cache-Control': 'no-cache' });
        res.end(content);
      } catch { res.writeHead(404); res.end('Not found'); }
      return;
    }

    if (false) { // placeholder to keep structure
    }

    res.writeHead(404); res.end('Not found');
    return;
  }

  res.writeHead(405); res.end();
});

server.listen(PORT, () => {
  console.log(`OnSite läuft auf http://localhost:${PORT}`);
  console.log('Voraussetzung: snmpwalk / snmpbulkwalk muss installiert sein');
});
