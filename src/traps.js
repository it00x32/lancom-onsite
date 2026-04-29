const fs = require('fs');
const dgram = require('dgram');
const { TRAPS_FILE } = require('./config');

const TRAP_PORT = 1620;
const TRAP_MAX  = 500;
let trapLog = [];
try { trapLog = JSON.parse(fs.readFileSync(TRAPS_FILE, 'utf8')); } catch {}

let _trapSaveTimer = null;
function persistTraps() {
  if (_trapSaveTimer) return;
  _trapSaveTimer = setTimeout(() => {
    _trapSaveTimer = null;
    try { fs.writeFileSync(TRAPS_FILE, JSON.stringify(trapLog)); } catch (e) { console.error('[Traps] Speichern fehlgeschlagen:', e.message); }
  }, 2000);
}

function flushTrapsSync() { try { fs.writeFileSync(TRAPS_FILE, JSON.stringify(trapLog)); } catch {} }

const TRAP_OID_NAMES = {
  '1.3.6.1.6.3.1.1.5.1': 'coldStart',
  '1.3.6.1.6.3.1.1.5.2': 'warmStart',
  '1.3.6.1.6.3.1.1.5.3': 'linkDown',
  '1.3.6.1.6.3.1.1.5.4': 'linkUp',
  '1.3.6.1.6.3.1.1.5.5': 'authenticationFailure',
  '1.3.6.1.6.3.1.1.5.6': 'egpNeighborLoss',
};
const VARBIND_OID_NAMES = {
  '1.3.6.1.2.1.1.1.0':     'sysDescr',
  '1.3.6.1.2.1.1.3.0':     'sysUpTime',
  '1.3.6.1.2.1.1.5.0':     'sysName',
  '1.3.6.1.2.1.2.2.1.1':   'ifIndex',
  '1.3.6.1.2.1.2.2.1.2':   'ifDescr',
  '1.3.6.1.2.1.2.2.1.7':   'ifAdminStatus',
  '1.3.6.1.2.1.2.2.1.8':   'ifOperStatus',
  '1.3.6.1.6.3.1.1.4.1.0': 'snmpTrapOID',
  '1.3.6.1.6.3.1.1.4.3.0': 'snmpTrapEnterprise',
  '1.3.6.1.6.3.18.1.3.0':  'snmpTrapAddress',
  '1.3.6.1.6.3.18.1.4.0':  'snmpTrapCommunity',
};
const V1_GENERIC_NAMES = ['coldStart','warmStart','linkDown','linkUp','authenticationFailure','egpNeighborLoss','enterpriseSpecific'];

function parseTrap(buf, rinfo) {
  const entry = {
    ts: new Date().toISOString(), from: rinfo.address, raw: buf.length + ' B',
    version: '?', community: '', pduType: '', trapName: '', trapOid: '',
    enterprise: '', agentAddr: '', genericTrap: null, specificTrap: null,
    uptime: null, varbinds: [],
  };
  try {
    if (buf[0] !== 0x30) return entry;

    function readLen(pos) {
      if (pos >= buf.length) return { len: 0, skip: 1 };
      if (buf[pos] & 0x80) {
        const n = buf[pos] & 0x7f;
        if (pos + n >= buf.length) return { len: 0, skip: 1 };
        let len = 0;
        for (let i = 1; i <= n; i++) len = len * 256 + buf[pos + i];
        return { len, skip: 1 + n };
      }
      return { len: buf[pos], skip: 1 };
    }
    function decodeOid(pos, len) {
      if (len < 1 || pos + len > buf.length) return '';
      const parts = [Math.floor(buf[pos] / 40), buf[pos] % 40];
      let i = pos + 1;
      while (i < pos + len && i < buf.length) {
        let val = 0;
        do { val = val * 128 + (buf[i] & 0x7f); } while (i < buf.length && buf[i++] & 0x80);
        parts.push(val);
      }
      return parts.join('.');
    }
    function decodeUint(pos, len) {
      if (pos + len > buf.length) return 0;
      let val = 0;
      for (let i = 0; i < len && i < 8; i++) val = val * 256 + buf[pos + i];
      return val;
    }
    function decodeInt(pos, len) {
      if (len < 1 || pos + len > buf.length) return 0;
      let val = buf[pos] & 0x80 ? -1 : 0;
      for (let i = 0; i < len; i++) val = val * 256 + buf[pos + i];
      return val > 2147483647 ? val - 4294967296 : val;
    }
    function decodeVal(tag, pos, len) {
      switch (tag) {
        case 0x02: return { type: 'Integer',     val: String(decodeInt(pos, len)) };
        case 0x04: {
          const raw = buf.slice(pos, pos + len);
          const str = raw.toString('latin1');
          const ok  = [...str].every(c => c.charCodeAt(0) >= 0x20 || '\n\r\t'.includes(c));
          return { type: 'OctetString', val: ok ? str.replace(/\0+$/, '').trim() : raw.toString('hex') };
        }
        case 0x05: return { type: 'Null',        val: '' };
        case 0x06: return { type: 'OID',         val: decodeOid(pos, len) };
        case 0x40: return { type: 'IpAddress',   val: len >= 4 ? `${buf[pos]}.${buf[pos+1]}.${buf[pos+2]}.${buf[pos+3]}` : '' };
        case 0x41: return { type: 'Counter32',   val: String(decodeUint(pos, len)) };
        case 0x42: return { type: 'Gauge32',     val: String(decodeUint(pos, len)) };
        case 0x43: return { type: 'TimeTicks',   val: String(decodeUint(pos, len)) };
        case 0x44: return { type: 'Opaque',      val: buf.slice(pos, pos+len).toString('hex') };
        case 0x46: return { type: 'Counter64',   val: String(decodeUint(pos, len)) };
        default:   return { type: `0x${tag.toString(16)}`, val: buf.slice(pos, pos+len).toString('hex') };
      }
    }
    function parseVarbinds(pos, end) {
      const vbs = [];
      while (pos < end) {
        if (buf[pos] !== 0x30) break;
        const vbL  = readLen(pos + 1);
        const vbEnd = pos + 1 + vbL.skip + vbL.len;
        let p = pos + 1 + vbL.skip;
        if (buf[p] !== 0x06) { pos = vbEnd; continue; }
        const oidL = readLen(p + 1);
        const oid  = decodeOid(p + 1 + oidL.skip, oidL.len);
        p += 1 + oidL.skip + oidL.len;
        const valTag = buf[p];
        const valL   = readLen(p + 1);
        const { type, val } = decodeVal(valTag, p + 1 + valL.skip, valL.len);
        const name = VARBIND_OID_NAMES[oid] || '';
        vbs.push({ oid, name, type, val });
        pos = vbEnd;
      }
      return vbs;
    }

    // Outer SEQUENCE
    let pos = 1;
    const outerL = readLen(1); pos = 1 + outerL.skip;
    // Version
    if (buf[pos] !== 0x02 || buf[pos+1] !== 0x01) return entry;
    const ver = buf[pos + 2];
    entry.version = ver === 0 ? 'v1' : ver === 1 ? 'v2c' : 'v3';
    pos += 3;
    // Community
    if (ver < 3 && buf[pos] === 0x04) {
      const cl = readLen(pos + 1);
      entry.community = buf.slice(pos + 1 + cl.skip, pos + 1 + cl.skip + cl.len).toString('ascii').replace(/[^\x20-\x7e]/g, '?');
      pos += 1 + cl.skip + cl.len;
    }

    const pduTag   = buf[pos];
    const pduL     = readLen(pos + 1);
    const pduStart = pos + 1 + pduL.skip;
    const pduEnd   = pduStart + pduL.len;

    if (pduTag === 0xa4) {
      // SNMPv1 Trap-PDU
      entry.pduType = 'v1-Trap';
      let p = pduStart;
      if (buf[p] === 0x06) { const l = readLen(p+1); entry.enterprise = decodeOid(p+1+l.skip, l.len); p += 1+l.skip+l.len; }
      if (buf[p] === 0x40) { const l = readLen(p+1); entry.agentAddr  = buf[p+1+l.skip]+'.'+buf[p+2+l.skip]+'.'+buf[p+3+l.skip]+'.'+buf[p+4+l.skip]; p += 1+l.skip+l.len; }
      if (buf[p] === 0x02) { const l = readLen(p+1); entry.genericTrap  = decodeInt(p+1+l.skip, l.len); p += 1+l.skip+l.len; }
      if (buf[p] === 0x02) { const l = readLen(p+1); entry.specificTrap = decodeInt(p+1+l.skip, l.len); p += 1+l.skip+l.len; }
      if (buf[p] === 0x43) { const l = readLen(p+1); entry.uptime       = decodeUint(p+1+l.skip, l.len); p += 1+l.skip+l.len; }
      entry.trapName = V1_GENERIC_NAMES[entry.genericTrap] || `generic(${entry.genericTrap})`;
      if (entry.genericTrap === 6) entry.trapName = `enterpriseSpecific(${entry.specificTrap})`;
      if (buf[p] === 0x30) { const l = readLen(p+1); entry.varbinds = parseVarbinds(p+1+l.skip, p+1+l.skip+l.len); }

    } else if (pduTag === 0xa7 || pduTag === 0xa6) {
      // SNMPv2c Trap (0xa7) or Inform (0xa6)
      entry.pduType = pduTag === 0xa7 ? 'v2c-Trap' : 'v2c-Inform';
      let p = pduStart;
      for (let i = 0; i < 3; i++) { if (buf[p] === 0x02) { const l = readLen(p+1); p += 1+l.skip+l.len; } }
      if (buf[p] === 0x30) {
        const l = readLen(p+1);
        entry.varbinds = parseVarbinds(p+1+l.skip, p+1+l.skip+l.len);
        const upVb  = entry.varbinds.find(v => v.oid === '1.3.6.1.2.1.1.3.0');
        if (upVb)  entry.uptime = Number(upVb.val);
        const oidVb = entry.varbinds.find(v => v.oid === '1.3.6.1.6.3.1.1.4.1.0');
        if (oidVb) { entry.trapOid = oidVb.val; entry.trapName = TRAP_OID_NAMES[oidVb.val] || oidVb.val; }
      }
    }
  } catch (e) { entry.parseError = e.message; }
  return entry;
}

let _onTrapCb = null;
function setTrapCallback(fn) { _onTrapCb = fn; }

function createTrapServer() {
  const trapServer = dgram.createSocket('udp4');
  trapServer.on('message', (msg, rinfo) => {
    const entry = parseTrap(msg, rinfo);
    trapLog.unshift(entry);
    if (trapLog.length > TRAP_MAX) trapLog.length = TRAP_MAX;
    persistTraps();
    if (_onTrapCb) try { _onTrapCb(entry); } catch {}
  });
  trapServer.on('error', err => console.error('[Trap]', err.message));
  trapServer.bind(TRAP_PORT, () => console.log(`SNMP Trap Receiver auf UDP/${TRAP_PORT}`));
  return trapServer;
}

module.exports = {
  TRAP_PORT,
  TRAP_MAX,
  trapLog,
  persistTraps,
  flushTrapsSync,
  TRAP_OID_NAMES,
  VARBIND_OID_NAMES,
  V1_GENERIC_NAMES,
  parseTrap,
  createTrapServer,
  setTrapCallback,
};
