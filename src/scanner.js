const { spawn } = require('child_process');
const { readSettings, readCriteria } = require('./data');
const { runSnmpGet, snmpVal, macFromHexStr } = require('./snmp-session');

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
  if (mask < 20 || mask > 30) throw new Error('Subnetzmaske muss zwischen /20 und /30 liegen (max. 4094 Hosts)');
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

function detectDeviceOs(sysDescr, sysObjectId) {
  const desc = (sysDescr || '').toUpperCase();
  const { osCriteria } = readCriteria();
  for (const rule of osCriteria) {
    if (rule.match.some(kw => desc.includes(kw.toUpperCase()))) return rule.os;
  }
  if ((sysObjectId || '').includes('.2356.')) return 'LANCOM';
  return null;
}

function pingHost(host, timeoutMs = 800) {
  return new Promise(resolve => {
    const proc = spawn('ping', ['-c', '1', '-W', String(Math.ceil(timeoutMs / 1000)), host],
      { stdio: 'ignore' });
    const timer = setTimeout(() => { proc.kill(); resolve(false); }, timeoutMs + 200);
    proc.on('close', code => { clearTimeout(timer); resolve(code === 0); });
    proc.on('error', () => { clearTimeout(timer); resolve(false); });
  });
}

async function scanHost(host, community, version) {
  if (!await pingHost(host)) return null;
  const out = await runSnmpGet(host, community, version, [
    '1.3.6.1.2.1.1.1.0',        // sysDescr
    '1.3.6.1.2.1.1.2.0',        // sysObjectID
    '1.3.6.1.2.1.1.5.0',        // sysName
    '1.3.6.1.2.1.1.6.0',        // sysLocation
    '1.3.6.1.2.1.2.2.1.6.1',    // ifPhysAddress.1–4 (Management-MAC; LCOS LX hat Index 1–2 leer)
    '1.3.6.1.2.1.2.2.1.6.2',
    '1.3.6.1.2.1.2.2.1.6.3',
    '1.3.6.1.2.1.2.2.1.6.4',
    '1.3.6.1.2.1.47.1.1.1.1.11.1',    // entPhysicalSerialNum.1 (FX, LCOS SX 3/4)
    '1.3.6.1.2.1.47.1.1.1.1.11.2',    // entPhysicalSerialNum.2 (LCOS SX 5: Chassis-Index 2)
    '1.3.6.1.2.1.47.1.1.1.1.11.3',    // entPhysicalSerialNum.3 (Fallback)
    '1.3.6.1.4.1.2356.11.1.47.7.0',   // LANCOM LCOS Seriennummer (Status/Hardware-Info)
    '1.3.6.1.4.1.2356.13.1.47.7.0',   // LANCOM LCOS LX Seriennummer
    '1.3.6.1.4.1.2356.13.2.1.0',      // LANCOM LCOS LX Gerätename
    '1.3.6.1.4.1.2356.14.1.1.1.13.0', // LANCOM LCOS SX Seriennummer (ältere FW)
  ]);
  if (!out.trim()) return null;

  let sysDescr = '', sysObjectId = '', sysName = '', sysLocation = '', mac = '', serial = '', lcosLxName = '';
  out.split('\n').forEach(line => {
    if (/\.2\.1\.1\.1\.0\s*=/.test(line))  sysDescr    = snmpVal(line.split('=').slice(1).join('='));
    if (/\.2\.1\.1\.2\.0\s*=/.test(line))  sysObjectId = (line.match(/OID:\s*(.+)/) || [])[1]?.trim() || '';
    if (/\.2\.1\.1\.5\.0\s*=/.test(line))  sysName     = snmpVal(line.split('=').slice(1).join('='));
    if (/\.2\.1\.1\.6\.0\s*=/.test(line))  sysLocation = snmpVal(line.split('=').slice(1).join('='));
    if (!mac && /\.2\.2\.1\.6\.[1-4]\s*=/.test(line)) {
      const hx = line.match(/(?:Hex-STRING|STRING):\s*([\da-fA-F: ]+)/i);
      const candidate = hx ? (macFromHexStr(hx[1].trim()) || '') : '';
      if (candidate && candidate !== '00:00:00:00:00:00') mac = candidate;
    }
    if (/\.47\.1\.1\.1\.1\.11\.[1-9]\s*=/.test(line)) { const v = snmpVal(line.split('=').slice(1).join('=')); if (v && v !== '""' && !v.includes('No Such') && !serial) serial = v; }
    if (/\.2356\.11\.1\.47\.7\.0\s*=/.test(line))    { const v = snmpVal(line.split('=').slice(1).join('=')); if (v && !v.includes('No Such')) serial = v; }
    if (/\.2356\.13\.1\.47\.7\.0\s*=/.test(line))    { const v = snmpVal(line.split('=').slice(1).join('=')); if (v && !v.includes('No Such')) serial = v; }
    if (/\.2356\.13\.2\.1\.0\s*=/.test(line))        { const v = snmpVal(line.split('=').slice(1).join('=')); if (v && !v.includes('No Such')) lcosLxName = v; }
    if (/\.2356\.14\.1\.1\.1\.13\.0\s*=/.test(line)) { const v = snmpVal(line.split('=').slice(1).join('=')); if (v && !v.includes('No Such')) serial = v; }
  });

  const os = detectDeviceOs(sysDescr, sysObjectId);
  if (!os) return null;

  return { ip: host, sysName, sysDescr, sysLocation, os, mac, serial, lcosLxName };
}

function extractModel(sysDescr) {
  if (!sysDescr) return '';
  const s = sysDescr.split(/[\r\n]/)[0].trim();
  let m;
  m = s.match(/^LANCOM\s+(\S+)/);                                if (m) return m[1];
  m = s.match(/^Linux\s+(\S+)/); if (m && !/^\d/.test(m[1]))   return m[1];
  if (/^Linux\b/.test(s)) return '';
  return s.split(/\s+/)[0].substring(0, 30);
}

module.exports = {
  subnetToHosts,
  pingHost,
  detectDeviceOs,
  scanHost,
  extractModel,
};
