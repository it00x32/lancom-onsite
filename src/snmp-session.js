const snmpLib = require('net-snmp');
const { readSettings } = require('./data');

function varbindToLine(vb) {
  const oid = '.' + vb.oid;
  switch (vb.type) {
    case snmpLib.ObjectType.Integer:
      return `${oid} = INTEGER: ${vb.value}`;
    case snmpLib.ObjectType.Counter32:
      return `${oid} = Counter32: ${vb.value}`;
    case snmpLib.ObjectType.Gauge32:
      return `${oid} = Gauge32: ${vb.value}`;
    case snmpLib.ObjectType.TimeTicks:
      return `${oid} = Timeticks: (${vb.value})`;
    case snmpLib.ObjectType.Counter64: {
      let val;
      if (Buffer.isBuffer(vb.value)) {
        val = 0n;
        for (let i = 0; i < vb.value.length; i++) val = (val << 8n) | BigInt(vb.value[i]);
      } else if (vb.value && typeof vb.value === 'object') {
        val = BigInt((vb.value.high >>> 0)) * 4294967296n + BigInt((vb.value.low >>> 0));
      } else {
        val = BigInt(Number(vb.value) || 0);
      }
      return `${oid} = Counter64: ${val}`;
    }
    case snmpLib.ObjectType.OctetString: {
      const buf = vb.value;
      if (!buf || !buf.length) return `${oid} = STRING: ""`;
      const isPrint = buf.every(b => (b >= 32 && b < 127) || b === 9 || b === 10 || b === 13);
      if (isPrint) return `${oid} = STRING: "${buf.toString('ascii')}"`;
      const hex = [...buf].map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
      return `${oid} = Hex-STRING: ${hex}`;
    }
    case snmpLib.ObjectType.OID:
      return `${oid} = OID: .${vb.value}`;
    case snmpLib.ObjectType.IpAddress:
      return `${oid} = IpAddress: ${vb.value}`;
    default:
      return `${oid} = STRING: "${vb.value}"`;
  }
}

function makeSnmpSession(host, community, version) {
  if (version === '3') {
    const s = readSettings();
    const levelMap = { noAuthNoPriv: snmpLib.SecurityLevel.noAuthNoPriv, authNoPriv: snmpLib.SecurityLevel.authNoPriv, authPriv: snmpLib.SecurityLevel.authPriv };
    const authMap  = { SHA: snmpLib.AuthProtocols.sha, 'SHA-256': snmpLib.AuthProtocols.sha256, 'SHA-512': snmpLib.AuthProtocols.sha512, MD5: snmpLib.AuthProtocols.md5 };
    const privMap  = { AES: snmpLib.PrivProtocols.aes, 'AES-192': snmpLib.PrivProtocols.aes192, 'AES-256': snmpLib.PrivProtocols.aes256, DES: snmpLib.PrivProtocols.des };
    return snmpLib.createV3Session(host, {
      name:         s.snmpV3SecurityName  || '',
      level:        levelMap[s.snmpV3SecurityLevel] ?? snmpLib.SecurityLevel.authPriv,
      authProtocol: authMap[s.snmpV3AuthProtocol]   ?? snmpLib.AuthProtocols.sha,
      authKey:      s.snmpV3AuthPassword  || '',
      privProtocol: privMap[s.snmpV3PrivProtocol]   ?? snmpLib.PrivProtocols.aes,
      privKey:      s.snmpV3PrivPassword  || '',
    }, { timeout: 5000, retries: 1 });
  }
  const ver = version === '1' ? snmpLib.Version1 : snmpLib.Version2c;
  return snmpLib.createSession(host, community, { version: ver, timeout: 5000, retries: 1 });
}

function runSnmpWalk(host, community, version, oid, timeout = 12000) {
  return new Promise((resolve) => {
    const session = makeSnmpSession(host, community, version);
    const lines = [];
    let done = false;
    const finish = () => { if (!done) { done = true; try { session.close(); } catch {} resolve(lines.join('\n')); } };
    const timer = setTimeout(finish, timeout);
    const method = version === '1' ? 'walk' : 'subtree';
    // SNMPv3: verschlüsselte GETBULK-Antworten können bei maxRepetitions=50 zu groß werden
    const maxRep = version === '3' ? 10 : 50;
    session[method](oid, maxRep,
      (vbs) => { for (const vb of vbs) if (!snmpLib.isVarbindError(vb)) lines.push(varbindToLine(vb)); },
      () => { clearTimeout(timer); finish(); }
    );
  });
}

function runSnmpGet(host, community, version, oids, timeout = 2000) {
  return new Promise((resolve) => {
    const session = makeSnmpSession(host, community, version);
    session.timeout = Math.min(timeout, 4000);
    const cleanOids = oids.map(o => o.startsWith('.') ? o.slice(1) : o);
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; try { session.close(); } catch {} resolve(''); }
    }, Math.min(timeout, 4000) + 2000);
    session.get(cleanOids, (error, vbs) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { session.close(); } catch {}
      if (error || !vbs) { resolve(''); return; }
      resolve(vbs.filter(vb => !snmpLib.isVarbindError(vb)).map(varbindToLine).join('\n'));
    });
  });
}

function runSnmpSet(host, community, version, oid, type, value, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const session = makeSnmpSession(host, community, version);
    session.timeout = timeout;
    const typeMap = { i: snmpLib.ObjectType.Integer, s: snmpLib.ObjectType.OctetString, o: snmpLib.ObjectType.OID, a: snmpLib.ObjectType.IpAddress, c: snmpLib.ObjectType.Counter32, u: snmpLib.ObjectType.Gauge32, t: snmpLib.ObjectType.TimeTicks };
    const snmpType  = typeMap[type] || snmpLib.ObjectType.Integer;
    const snmpValue = snmpType === snmpLib.ObjectType.OctetString
      ? Buffer.from(String(value))
      : (() => { const n = parseInt(value, 10); if (isNaN(n)) throw new Error('Ungültiger numerischer Wert für SNMP SET'); return n; })();
    const cleanOid  = oid.startsWith('.') ? oid.slice(1) : oid;
    session.set([{ oid: cleanOid, type: snmpType, value: snmpValue }], (error, vbs) => {
      try { session.close(); } catch {}
      if (error) { reject(error); return; }
      if (vbs && snmpLib.isVarbindError(vbs[0])) { reject(new Error(snmpLib.varbindError(vbs[0]))); return; }
      resolve('ok');
    });
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
  // Dash-separated: "00-A0-57-7E-04-47" (LCOS SX 4/5)
  const dparts = str.trim().split('-');
  if (dparts.length === 6 && dparts.every(p => /^[0-9a-fA-F]{1,2}$/.test(p))) {
    return dparts.map(p => p.padStart(2, '0').toLowerCase()).join(':');
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

/** LANCOM OID-Index: Länge + ASCII-Bytes (dotted) */
function encodeOidStr(str) {
  const buf = Buffer.from(String(str), 'latin1');
  return [buf.length, ...Array.from(buf)].join('.');
}

module.exports = {
  snmpLib,
  varbindToLine,
  makeSnmpSession,
  runSnmpWalk,
  runSnmpGet,
  runSnmpSet,
  macFromDecOid,
  macFromHexStr,
  snmpVal,
  decodeOidStr,
  encodeOidStr,
};
