const https = require('https');
const urlMod = require('url');

const LMC_SERVICE_PATHS = {
  auth:              '/cloud-service-auth',
  devices:           '/cloud-service-devices',
  configapplication: '/cloud-service-config',
  configvariable:    '/cloud-service-config',
};

const LMC_ALLOWED_HOSTS = ['cloud.lancom.de', 'cloud.lancom.eu', 'cloud-test.lancom.de'];

function lmcProxy(service, apiPath, method, token, body, host) {
  return new Promise((resolve, reject) => {
    const servicePath = LMC_SERVICE_PATHS[service];
    if (!servicePath) { resolve({ status: 400, body: JSON.stringify({ error: 'Unknown service' }) }); return; }
    const sanitizedHost = (host || 'cloud.lancom.de').replace(/[^a-zA-Z0-9.\-]/g, '');
    if (!LMC_ALLOWED_HOSTS.some(h => sanitizedHost === h || sanitizedHost.endsWith('.' + h))) {
      resolve({ status: 400, body: JSON.stringify({ error: 'Nicht erlaubter LMC-Host' }) }); return;
    }
    const base = `https://${sanitizedHost}${servicePath}`;
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
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('LMC-Anfrage Timeout (15s)')); });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

module.exports = { lmcProxy, LMC_ALLOWED_HOSTS };
