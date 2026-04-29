/**
 * TLS ClientHello SNI-Mitschnitt (kein TLS-Terminierung).
 * Loggt SNI + Client-IP; Verbindung wird danach geschlossen.
 */

const net = require('net');
const { PORT: HTTP_PORT } = require('./config');

const MAX_LOG = 500;

/** @type {import('net').Server|null} */
let server = null;
/** @type {Array<{ts:number, remote?: string, sni?: string|null, reason?: string, bytes?: number, msg?: string}>} */
let logs = [];
let meta = {
  running: false,
  port: null,
  bind: null,
  filterDomains: /** @type {string[]} */ ([]),
};

function pushLog(entry) {
  logs.push(entry);
  if (logs.length > MAX_LOG) logs.splice(0, logs.length - MAX_LOG);
}

/**
 * @param {Buffer} buf
 */
function parseClientHelloSNI(buf) {
  if (buf.length < 5) return { done: false };
  if (buf[0] !== 0x16) {
    return { done: true, sni: null, reason: 'non-tls' };
  }
  const recLen = 5 + buf.readUInt16BE(3);
  if (buf.length < recLen) return { done: false };
  let ptr = 5;
  if (buf[ptr] !== 0x01) {
    return { done: true, sni: null, reason: 'not-client-hello' };
  }
  const hsLen = (buf[ptr + 1] << 16) | (buf[ptr + 2] << 8) | buf[ptr + 3];
  ptr += 4;
  const hsEnd = ptr + hsLen;
  if (hsEnd > recLen) {
    return { done: true, sni: null, reason: 'invalid-handshake' };
  }
  if (buf.length < hsEnd) return { done: false };
  ptr += 2 + 32;
  if (ptr >= hsEnd) return { done: true, sni: null, reason: 'truncated' };
  const sidLen = buf[ptr++];
  ptr += sidLen;
  if (ptr + 2 > hsEnd) return { done: true, sni: null, reason: 'truncated' };
  const csLen = buf.readUInt16BE(ptr);
  ptr += 2 + csLen;
  if (ptr + 1 > hsEnd) return { done: true, sni: null, reason: 'truncated' };
  const compLen = buf[ptr++];
  ptr += compLen;
  if (ptr + 2 > hsEnd) {
    return { done: true, sni: null, reason: 'no-extensions' };
  }
  const extLen = buf.readUInt16BE(ptr);
  ptr += 2;
  const extEnd = ptr + extLen;
  if (extEnd > hsEnd) return { done: true, sni: null, reason: 'invalid-extensions' };

  while (ptr + 4 <= extEnd) {
    const type = buf.readUInt16BE(ptr);
    const len = buf.readUInt16BE(ptr + 2);
    ptr += 4;
    const extDataEnd = ptr + len;
    if (extDataEnd > extEnd) return { done: true, sni: null, reason: 'bad-extension' };

    if (type === 0) {
      let p = ptr;
      if (p + 2 > extDataEnd) return { done: true, sni: null, reason: 'bad-sni' };
      const listLen = buf.readUInt16BE(p);
      p += 2;
      const listEnd = p + listLen;
      if (listEnd > extDataEnd) return { done: true, sni: null, reason: 'bad-sni' };
      while (p + 3 <= listEnd) {
        const nameType = buf[p++];
        const nameLen = buf.readUInt16BE(p);
        p += 2;
        if (p + nameLen > listEnd) return { done: true, sni: null, reason: 'bad-sni' };
        if (nameType === 0) {
          return { done: true, sni: buf.slice(p, p + nameLen).toString('utf8') };
        }
        p += nameLen;
      }
    }
    ptr = extDataEnd;
  }
  return { done: true, sni: null, reason: 'no-sni' };
}

function matchesFilter(filters, sni) {
  if (!filters || !filters.length) return true;
  const lower = (sni || '').toLowerCase();
  return filters.some((f) => lower.includes(f.toLowerCase()));
}

function getFilterList(filterDomainsStr) {
  if (!filterDomainsStr || typeof filterDomainsStr !== 'string') return [];
  return filterDomainsStr.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * @param {{ port?: number|string, bind?: string, filterDomains?: string }} opts
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
function startSniListener(opts = {}) {
  if (server) return Promise.resolve({ ok: false, error: 'Listener läuft bereits' });

  const port = parseInt(String(opts.port), 10);
  const bind = (opts.bind && String(opts.bind).trim()) || '0.0.0.0';
  const filterDomains = getFilterList(opts.filterDomains || '');

  if (!port || port < 1 || port > 65535) {
    return Promise.resolve({ ok: false, error: 'Ungültiger Port' });
  }
  if (port === HTTP_PORT) {
    return Promise.resolve({ ok: false, error: `Port ${port} ist der OnSite-HTTP-Port` });
  }
  if (port < 1024 && process.env.SNI_ALLOW_PRIV_PORTS !== '1') {
    return Promise.resolve({
      ok: false,
      error: 'Ports unter 1024 sind gesperrt. Setzen Sie SNI_ALLOW_PRIV_PORTS=1 und starten Sie mit Root/CAP_NET_BIND_SERVICE.',
    });
  }

  const srv = net.createServer((socket) => {
    const remote = `${socket.remoteAddress}:${socket.remotePort}`;
    let buf = Buffer.alloc(0);

    const onData = (chunk) => {
      buf = Buffer.concat([buf, chunk], buf.length + chunk.length);
      if (buf.length > 65536) {
        socket.destroy();
        return;
      }
      const r = parseClientHelloSNI(buf);
      if (!r.done) return;
      socket.removeListener('data', onData);
      if (matchesFilter(filterDomains, r.sni)) {
        pushLog({
          ts: Date.now(),
          remote,
          sni: r.sni,
          reason: r.sni ? undefined : r.reason,
          bytes: buf.length,
        });
      }
      socket.destroy();
    };

    socket.on('data', onData);
    socket.on('error', () => {});
    socket.setTimeout(15000, () => socket.destroy());
  });

  return new Promise((resolve) => {
    const onErr = (e) => {
      srv.removeListener('error', onErr);
      srv.close();
      resolve({ ok: false, error: e.message });
    };
    srv.once('error', onErr);
    srv.listen(port, bind, () => {
      srv.removeListener('error', onErr);
      server = srv;
      meta = { running: true, port, bind, filterDomains: [...filterDomains] };
      pushLog({
        ts: Date.now(),
        msg: `Listener ${bind}:${port} gestartet${filterDomains.length ? ` (Filter: ${filterDomains.join(', ')})` : ''}`,
      });
      console.log(`[SNI] Listener ${bind}:${port}`);
      resolve({ ok: true });
    });
  });
}

/**
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
function stopSniListener() {
  if (!server) {
    meta.running = false;
    return Promise.resolve({ ok: true });
  }
  const srv = server;
  server = null;
  meta.running = false;
  meta.port = null;
  meta.bind = null;
  meta.filterDomains = [];
  return new Promise((resolve) => {
    srv.close((err) => {
      pushLog({ ts: Date.now(), msg: 'Listener gestoppt' });
      console.log('[SNI] Listener gestoppt');
      if (err) resolve({ ok: false, error: err.message });
      else resolve({ ok: true });
    });
  });
}

function stopSniListenerSync() {
  if (!server) return;
  try {
    server.close();
  } catch (_) { /* ignore */ }
  server = null;
  meta.running = false;
  meta.port = null;
  meta.bind = null;
  meta.filterDomains = [];
}

function clearSniLogs() {
  logs = [];
}

function getSniState() {
  return {
    running: meta.running,
    port: meta.port,
    bind: meta.bind,
    filterDomains: meta.filterDomains,
    logs: logs.slice(),
  };
}

module.exports = {
  startSniListener,
  stopSniListener,
  stopSniListenerSync,
  clearSniLogs,
  getSniState,
};
