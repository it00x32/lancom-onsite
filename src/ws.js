const { spawn } = require('child_process');
const dns = require('dns').promises;
const { readSettings } = require('./data');
const { subnetToHosts, scanHost } = require('./scanner');
const { detectOsViaHttp } = require('./detect');

function makeWsSender(ws, WebSocket) {
  const state = { aborted: false };
  ws.on('close', () => { state.aborted = true; });
  const send = (obj) => {
    if (state.aborted || ws.readyState !== WebSocket.OPEN) return;
    try { ws.send(JSON.stringify(obj)); } catch { state.aborted = true; }
  };
  return { send, state };
}

async function handleScanWs(ws, { subnet }, WebSocket) {
  if (!subnet) { ws.send(JSON.stringify({ type: 'error', message: 'subnet fehlt' })); ws.close(); return; }
  let hosts, community, version;
  try {
    const s = readSettings();
    community = s.snmpReadCommunity || 'public';
    version   = s.snmpVersion       || '2c';
    hosts     = subnetToHosts(subnet);
  } catch (err) { ws.send(JSON.stringify({ type: 'error', message: err.message })); ws.close(); return; }

  const { send, state } = makeWsSender(ws, WebSocket);

  send({ type: 'start', total: hosts.length });
  const CONCURRENCY = 50;
  let idx = 0, done = 0, found = 0;
  async function worker() {
    while (idx < hosts.length && !state.aborted) {
      const host = hosts[idx++];
      let device = null;
      try { device = await scanHost(host, community, version); } catch {}
      done++;
      if (device) { found++; send({ type: 'found', device, scanned: done, total: hosts.length, found }); }
      else if (done % 5 === 0 || done === hosts.length) { send({ type: 'progress', scanned: done, total: hosts.length, found }); }
    }
  }
  try { await Promise.all(Array(Math.min(CONCURRENCY, hosts.length)).fill(null).map(() => worker())); } catch {}
  if (!state.aborted) { send({ type: 'done', total: hosts.length, found }); ws.close(); }
}

async function handleRolloutScanWs(ws, { subnet }, WebSocket) {
  if (!subnet) { ws.send(JSON.stringify({ type: 'error', message: 'subnet fehlt' })); ws.close(); return; }

  const { send, state } = makeWsSender(ws, WebSocket);

  const MAC_PREFIX = '00:a0:57';
  let foundCnt = 0;
  const detectionPromises = [];
  const { snmpReadCommunity: community = 'public', snmpVersion: version = '2c' } = readSettings();

  const detectAndSend = async (dev) => {
    let sent = false;
    const sendDev = () => { if (!sent && !state.aborted) { sent = true; send({ type: 'found', device: { ...dev } }); foundCnt++; } };
    const timer = setTimeout(() => sendDev(), 8000);
    try {
      const [hostnameResult, httpOs] = await Promise.all([
        dns.reverse(dev.ip).then(n => n[0]).catch(() => null),
        detectOsViaHttp(dev.ip),
      ]);
      clearTimeout(timer);
      if (hostnameResult) dev.hostname = hostnameResult;
      dev.os = httpOs || null;
    } catch { clearTimeout(timer); }
    sendDev();
  };

  let totalHosts = 0;
  try { totalHosts = subnetToHosts(subnet).length; } catch {}
  send({ type: 'start', total: totalHosts });

  try {
    let scanned = 0, buf = '';
    const proc = spawn('arp-scan', ['--quiet', '--retry=3', subnet], { stdio: ['ignore', 'pipe', 'ignore'] });
    ws.on('close', () => { try { proc.kill(); } catch {} });
    proc.stdout.on('data', chunk => {
      buf += chunk.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        const m = line.match(/^(\d+\.\d+\.\d+\.\d+)\s+([\da-f:]+)\s*(.*)/i);
        if (m) {
          scanned++;
          const mac = m[2].toLowerCase();
          if (mac.startsWith(MAC_PREFIX)) {
            detectionPromises.push(detectAndSend({ ip: m[1], mac: m[2], vendor: m[3].trim() || 'LANCOM Systems' }));
          }
          send({ type: 'progress', scanned, total: totalHosts, found: foundCnt });
        }
      }
    });
    await new Promise(resolve => proc.on('close', resolve));
    await Promise.all(detectionPromises);
  } catch (err) { send({ type: 'error', message: err.message }); }

  if (!state.aborted) { send({ type: 'done', found: foundCnt }); ws.close(); }
}

module.exports = { makeWsSender, handleScanWs, handleRolloutScanWs };
