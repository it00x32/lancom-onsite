const http = require('http');
const https = require('https');

// ── HTTP-Fingerprint zur OS-Erkennung ────────────────────────────────────────

function detectOsViaHttp(ip) {
  const fetchPage = (protocol, pagePath) => new Promise((resolve) => {
    const mod = protocol === 'https' ? https : http;
    let done = false;
    const finish = (val) => { if (!done) { done = true; resolve(val); } };
    const timer = setTimeout(() => { try { request.destroy(); } catch {} finish({ body: '', location: null, server: '', cookies: '' }); }, 2000);
    const request = mod.get(
      { host: ip, port: protocol === 'https' ? 443 : 80, path: pagePath, rejectUnauthorized: false },
      (r) => {
        const location = (r.statusCode >= 300 && r.statusCode < 400) ? (r.headers.location || null) : null;
        const server   = (r.headers.server || '').toLowerCase();
        const cookies  = [].concat(r.headers['set-cookie'] || []).join(' ');
        let body = '';
        r.on('data', d => { body += d; if (body.length > 4096) { clearTimeout(timer); finish({ body, location, server, cookies }); try { request.destroy(); } catch {} } });
        r.on('end',  () => { clearTimeout(timer); finish({ body, location, server, cookies }); });
        r.on('error',() => { clearTimeout(timer); finish({ body, location, server, cookies }); });
      }
    );
    request.on('error', () => { clearTimeout(timer); finish({ body: '', location: null, server: '', cookies: '' }); });
  });
  const extractSxVersion = (s) => {
    const m = s.match(/LCOS[- ]SX\s+(\d+)/i);
    if (!m) return null;
    const v = parseInt(m[1]);
    if (v === 3) return 'LCOS SX 3';
    if (v === 4) return 'LCOS SX 4';
    if (v >= 5)  return 'LCOS SX 5';
    return null;
  };
  return (async () => {
    for (const proto of ['https', 'http']) {
      const { body, location, server, cookies } = await fetchPage(proto, '/');
      if (server.includes('lighttpd')) {
        if (cookies.includes('__Secure-')) return 'LCOS SX 5';
        const sxV = extractSxVersion(body);
        if (sxV) return sxV;
        if (location && location.startsWith('/')) {
          const { body: body2 } = await fetchPage(proto, location);
          const sxV2 = extractSxVersion(body2);
          if (sxV2) return sxV2;
        }
        return null;
      }
      if (server.includes('lancom')) return 'LCOS';
      if (server.includes('ecos'))   return 'LCOS SX 3';
      if (server.includes('hiawatha')) {
        const isSx4 = (b) => b.includes('AdminLTE_base.css') || b.includes('initpage.js');
        const sxV = extractSxVersion(body);
        if (sxV) return sxV;
        if (isSx4(body)) return 'LCOS SX 4';
        if (location && location.startsWith('/')) {
          const { body: b2 } = await fetchPage(proto, location);
          const sxV2 = extractSxVersion(b2);
          if (sxV2) return sxV2;
          if (isSx4(b2)) return 'LCOS SX 4';
        }
        return null;
      }
      if (body.includes('data-critters-container')) return 'LCOS LX';
      const sxV = extractSxVersion(body);
      if (sxV) return sxV;
      if (body.includes('LCOS FX')) return 'LCOS FX';
      if (location && location.startsWith('/')) {
        const { body: body2 } = await fetchPage(proto, location);
        if (body2.includes('WEBconfig') || body2.includes('LANCOM')) return 'LCOS';
      }
      if (body.includes('WEBconfig') || body.includes('LANCOM')) return 'LCOS';
    }
    return null;
  })();
}

module.exports = { detectOsViaHttp };
