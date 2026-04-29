/**
 * Eingebetteter RADIUS-Server (UDP) für MAC-Allowlist und optional PAP.
 * Accounting-Protokoll (JSONL), optional CoA/Disconnect (RFC 5176).
 */

const dgram = require('dgram');
const radius = require('radius');
const { readNac } = require('./data');
const { appendNacRadiusLog, attrsForLog, attrVal } = require('./nac-acct-log');

let socketAuth = null;
let socketAcct = null;
let socketCoa = null;
let lastError = null;
const statusLine = {
  auth: false,
  acct: false,
  coa: false,
  bind: null,
  authPort: null,
  acctPort: null,
  coaPort: null,
};

function normalizeMac(s) {
  if (s == null) return null;
  const str = String(s).trim();
  if (!str) return null;
  const hex = str.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
  if (hex.length !== 12) return null;
  return hex.match(/.{2}/g).join(':');
}

function macFromAccessRequest(attrs) {
  if (!attrs) return null;
  const cs = attrs['Calling-Station-Id'];
  const un = attrs['User-Name'];
  let m = normalizeMac(cs);
  if (m) return m;
  m = normalizeMac(un);
  if (m) return m;
  return null;
}

function stopEmbeddedRadiusServer() {
  lastError = null;
  statusLine.auth = false;
  statusLine.acct = false;
  statusLine.coa = false;
  statusLine.bind = null;
  statusLine.authPort = null;
  statusLine.acctPort = null;
  statusLine.coaPort = null;
  if (socketAuth) {
    try { socketAuth.close(); } catch (_) {}
    socketAuth = null;
  }
  if (socketAcct) {
    try { socketAcct.close(); } catch (_) {}
    socketAcct = null;
  }
  if (socketCoa) {
    try { socketCoa.close(); } catch (_) {}
    socketCoa = null;
  }
}

/**
 * RFC 3580: VLAN-Zuweisung im Access-Accept (Tunnel-* mit Tag 0).
 * @param {number} vlanId 1–4094
 */
function dynamicVlanAttributes(vlanId) {
  return [
    ['Tunnel-Type', 0x00, 'VLAN'],
    ['Tunnel-Medium-Type', 0x00, 'IEEE-802'],
    ['Tunnel-Private-Group-Id', 0x00, String(vlanId)],
  ];
}

function sendAuthResponse(socket, packet, secret, code, rinfo, tunnelAttrs) {
  const opts = { packet, code, secret };
  if (code === 'Access-Accept' && tunnelAttrs && tunnelAttrs.length) {
    opts.attributes = tunnelAttrs;
  }
  const response = radius.encode_response(opts);
  socket.send(response, 0, response.length, rinfo.port, rinfo.address, () => {});
}

function handleAccessRequest(msg, rinfo, secret) {
  let packet;
  try {
    packet = radius.decode({ packet: msg, secret });
  } catch (e) {
    lastError = e.message || String(e);
    return;
  }
  if (packet.code !== 'Access-Request') return;

  const nac = readNac();
  const mode = nac.nacAuthMode || 'mac_allowlist';
  let code = 'Access-Reject';
  /** @type {number|undefined} */
  let vlanForAccept;

  if (mode === 'mac_allowlist') {
    const mac = macFromAccessRequest(packet.attributes || {});
    const list = Array.isArray(nac.macAllowlist) ? nac.macAllowlist : [];
    const row = mac ? list.find((x) => String(x.mac || '').trim().toLowerCase() === mac) : null;
    if (mac && row) {
      code = 'Access-Accept';
      const v = row.vlan;
      if (v != null && nac.embeddedVlanAssignmentEnabled) {
        const n = parseInt(String(v), 10);
        if (!Number.isNaN(n) && n >= 1 && n <= 4094) vlanForAccept = n;
      }
    }
  } else if (mode === 'pap_users') {
    const users = Array.isArray(nac.radiusUsers) ? nac.radiusUsers : [];
    const u = packet.attributes && packet.attributes['User-Name'];
    const p = packet.attributes && packet.attributes['User-Password'];
    const row = u != null && p != null ? users.find((x) => x.user === u && x.pass === p) : null;
    if (row) {
      code = 'Access-Accept';
      const v = row.vlan;
      if (v != null && nac.embeddedVlanAssignmentEnabled) {
        const n = parseInt(String(v), 10);
        if (!Number.isNaN(n) && n >= 1 && n <= 4094) vlanForAccept = n;
      }
    }
  }

  const tunnelAttrs = vlanForAccept != null ? dynamicVlanAttributes(vlanForAccept) : null;
  sendAuthResponse(socketAuth, packet, secret, code, rinfo, tunnelAttrs);
}

function handleAccountingRequest(msg, rinfo, secret) {
  let packet;
  try {
    packet = radius.decode({ packet: msg, secret });
  } catch (e) {
    lastError = e.message || String(e);
    return;
  }
  if (packet.code !== 'Accounting-Request') return;

  const a = packet.attributes || {};
  appendNacRadiusLog({
    kind: 'accounting',
    remote: `${rinfo.address}:${rinfo.port}`,
    userName: attrVal(a['User-Name']),
    callingStationId: attrVal(a['Calling-Station-Id']),
    nasIp: attrVal(a['NAS-IP-Address']),
    nasPortId: attrVal(a['NAS-Port-Id']),
    acctStatusType: attrVal(a['Acct-Status-Type']),
    acctSessionId: attrVal(a['Acct-Session-Id']),
    framedIp: attrVal(a['Framed-IP-Address']),
    acctInputOctets: attrVal(a['Acct-Input-Octets']),
    acctOutputOctets: attrVal(a['Acct-Output-Octets']),
    acctTerminateCause: attrVal(a['Acct-Terminate-Cause']),
    attrs: attrsForLog(a),
  });

  const response = radius.encode_response({
    packet,
    code: 'Accounting-Response',
    secret,
  });
  socketAcct.send(response, 0, response.length, rinfo.port, rinfo.address, () => {});
}

function handleCoaPacket(msg, rinfo, secret) {
  let packet;
  try {
    packet = radius.decode({ packet: msg, secret });
  } catch (e) {
    lastError = e.message || String(e);
    return;
  }
  const code = packet.code;
  const a = packet.attributes || {};
  appendNacRadiusLog({
    kind: 'coa',
    packetCode: code,
    remote: `${rinfo.address}:${rinfo.port}`,
    userName: attrVal(a['User-Name']),
    callingStationId: attrVal(a['Calling-Station-Id']),
    nasIp: attrVal(a['NAS-IP-Address']),
    sessionId: attrVal(a['Acct-Session-Id']),
    attrs: attrsForLog(a),
  });

  let respCode = null;
  if (code === 'CoA-Request') respCode = 'CoA-ACK';
  else if (code === 'Disconnect-Request') respCode = 'Disconnect-ACK';
  if (!respCode) return;

  try {
    const response = radius.encode_response({
      packet,
      code: respCode,
      secret,
    });
    socketCoa.send(response, 0, response.length, rinfo.port, rinfo.address, () => {});
  } catch (e) {
    lastError = e.message || String(e);
    console.error('[NAC/RADIUS] CoA Antwort:', e);
  }
}

function startEmbeddedRadiusServer() {
  stopEmbeddedRadiusServer();
  const nac = readNac();
  if (!nac.embeddedRadiusEnabled) {
    console.log('[NAC/RADIUS] Eingebetteter Server: aus');
    return;
  }
  const secret = String(nac.embeddedRadiusSecret || '').trim();
  if (!secret) {
    console.error('[NAC/RADIUS] Eingebetteter Server ist aktiv, aber Shared Secret fehlt — UDP wird nicht gestartet');
    lastError = 'Shared Secret fehlt';
    return;
  }

  const bind = String(nac.embeddedRadiusBind || '0.0.0.0').trim() || '0.0.0.0';
  const authPort = Math.min(65535, Math.max(1, parseInt(nac.embeddedAuthPort, 10) || 1812));
  const acctPort = Math.min(65535, Math.max(1, parseInt(nac.embeddedAcctPort, 10) || 1813));
  const coaPort = Math.min(65535, Math.max(0, parseInt(nac.embeddedCoaPort, 10) || 0));

  socketAuth = dgram.createSocket('udp4');
  socketAuth.on('error', (err) => {
    lastError = err.message;
    console.error('[NAC/RADIUS] Auth-Socket:', err.message);
  });
  socketAuth.on('message', (msg, rinfo) => {
    try {
      handleAccessRequest(msg, rinfo, secret);
    } catch (e) {
      lastError = e.message || String(e);
      console.error('[NAC/RADIUS]', e);
    }
  });
  socketAuth.bind(authPort, bind, () => {
    statusLine.auth = true;
    statusLine.authPort = authPort;
    statusLine.bind = bind;
    console.log(`[NAC/RADIUS] Auth: UDP ${bind}:${authPort} (${nac.nacAuthMode || 'mac_allowlist'})`);
  });

  if (acctPort !== authPort) {
    socketAcct = dgram.createSocket('udp4');
    socketAcct.on('error', (err) => {
      lastError = err.message;
      console.error('[NAC/RADIUS] Acct-Socket:', err.message);
    });
    socketAcct.on('message', (msg, rinfo) => {
      try {
        handleAccountingRequest(msg, rinfo, secret);
      } catch (e) {
        lastError = e.message || String(e);
        console.error('[NAC/RADIUS] Acct:', e);
      }
    });
    socketAcct.bind(acctPort, bind, () => {
      statusLine.acct = true;
      statusLine.acctPort = acctPort;
      console.log(`[NAC/RADIUS] Accounting: UDP ${bind}:${acctPort}`);
    });
  } else {
    console.warn('[NAC/RADIUS] Accounting-Port gleich Auth-Port — kein separater Accounting-UDP');
  }

  if (coaPort > 0 && coaPort !== authPort && coaPort !== acctPort) {
    socketCoa = dgram.createSocket('udp4');
    socketCoa.on('error', (err) => {
      lastError = err.message;
      console.error('[NAC/RADIUS] CoA-Socket:', err.message);
    });
    socketCoa.on('message', (msg, rinfo) => {
      try {
        handleCoaPacket(msg, rinfo, secret);
      } catch (e) {
        lastError = e.message || String(e);
        console.error('[NAC/RADIUS] CoA:', e);
      }
    });
    socketCoa.bind(coaPort, bind, () => {
      statusLine.coa = true;
      statusLine.coaPort = coaPort;
      console.log(`[NAC/RADIUS] CoA/Disconnect: UDP ${bind}:${coaPort}`);
    });
  } else if (coaPort > 0) {
    console.warn('[NAC/RADIUS] CoA-Port muss sich von Auth- und Acct-Port unterscheiden — CoA deaktiviert');
  }
}

function restartEmbeddedRadiusServer() {
  startEmbeddedRadiusServer();
}

function getEmbeddedRadiusStatus() {
  const n = readNac();
  return {
    enabled: !!n.embeddedRadiusEnabled,
    listeningAuth: statusLine.auth,
    listeningAcct: statusLine.acct,
    listeningCoa: statusLine.coa,
    bind: statusLine.bind,
    authPort: statusLine.authPort,
    acctPort: statusLine.acctPort,
    coaPort: statusLine.coaPort,
    lastError,
    mode: n.nacAuthMode || 'mac_allowlist',
    vlanAssignmentEnabled: !!n.embeddedVlanAssignmentEnabled,
  };
}

module.exports = {
  startEmbeddedRadiusServer,
  stopEmbeddedRadiusServer,
  restartEmbeddedRadiusServer,
  getEmbeddedRadiusStatus,
};
