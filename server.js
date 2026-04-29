#!/usr/bin/env node
/**
 * OnSite – lokaler SNMP-Server
 * Start: node server.js [port]
 */

const fs   = require('fs');
const path = require('path');

const { PORT, TRAPS_FILE, BASE_DIR } = require('./src/config');

/** Statische UI-Dateien: gleiches Root wie BASE_DIR (src/..), damit es nie von einem falschen cwd abweicht. */
function resolveStaticRoot(entryFile) {
  const withIndex = (dir) => {
    const rp = fs.realpathSync(dir);
    return fs.existsSync(path.join(rp, 'index.html')) ? rp : null;
  };
  let root = withIndex(BASE_DIR);
  if (root) return root;
  const serverDir = path.dirname(fs.realpathSync(entryFile));
  root = withIndex(serverDir);
  if (root) return root;
  const parent = path.dirname(serverDir);
  // Geschwisterordner mit UI (ältere Installationen: z. B. …/onsite neben …/onsite-dev)
  for (const name of ['onsite', 'onsite-dev']) {
    const cand = path.join(parent, name);
    if (fs.existsSync(path.join(cand, 'index.html'))) {
      try {
        return fs.realpathSync(cand);
      } catch (_) {
        /* weiter */
      }
    }
  }
  try {
    return fs.realpathSync(BASE_DIR);
  } catch (_) {
    return BASE_DIR;
  }
}

const ROOT_DIR = resolveStaticRoot(__filename);
if (!fs.existsSync(path.join(ROOT_DIR, 'index.html'))) {
  console.error('[OnSite] Start abgebrochen: index.html fehlt.');
  console.error('  ROOT_DIR (berechnet)=', ROOT_DIR);
  console.error('  BASE_DIR (config)   =', fs.realpathSync(BASE_DIR));
  console.error('  server.js           =', path.resolve(__filename));
  console.error('  systemd: WorkingDirectory und ExecStart müssen auf denselben Ordner wie diese server.js zeigen.');
  process.exit(1);
}
console.log('[OnSite] Statisches Root:', ROOT_DIR, '| index.html: ok');

const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');

const { trapLog, flushTrapsSync, createTrapServer, setTrapCallback } = require('./src/traps');
const { registerRoutes }           = require('./src/routes/api');
const { handleScanWs, handleRolloutScanWs } = require('./src/ws');
const { onTrapReceived, startMonitoring, flushAlertLogSync } = require('./src/alerts');
const { startUptimeProbes } = require('./src/uptime');
const { startScheduler } = require('./src/scheduler');
const { createSyslogServer, getSyslogEntries, flushSyslogSync } = require('./src/syslog');
const { rebuildFromSyslogEntries } = require('./src/roaming');
const { startEmbeddedRadiusServer, stopEmbeddedRadiusServer } = require('./src/radius-server');
const { stopSniListenerSync } = require('./src/sni-listener');

// ── Express App ───────────────────────────────────────────────────────────────

const app = express();

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});
app.options(/.*/, (req, res) => res.sendStatus(204));
app.use(express.json({ limit: '10mb' }));

// ── Statische Dateien (vor API, damit GET / sicher die UI trifft; UTF-8-String — stabiler als großer Buffer + ETag in Express 5)
function sendStatic(rel, type, res) {
  const abs = path.join(ROOT_DIR, rel);
  res.set('Cache-Control', 'no-cache');
  res.type(type);
  let body;
  try {
    body = fs.readFileSync(abs, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      console.error(`[OnSite] Datei fehlt: ${abs}. Projektroot=${ROOT_DIR}. Prüfen: WorkingDirectory/ExecStart des Dienstes auf dieses Verzeichnis zeigen (gleicher Pfad wie server.js).`);
    } else {
      console.error(`[OnSite] Lesen fehlgeschlagen: ${abs}`, e && e.message);
    }
    if (!res.headersSent) res.status(500).type('txt').send(e && e.code === 'ENOENT' ? 'Statische Datei fehlt (siehe Server-Log).' : (e && e.message) || String(e));
    return;
  }
  res.send(body);
}

app.get('/',           (req, res) => sendStatic('index.html', 'html', res));
app.get('/app.js',     (req, res) => sendStatic('app.js', 'application/javascript', res));
app.get('/styles.css', (req, res) => sendStatic('styles.css', 'text/css', res));

registerRoutes(app);
console.log('[OnSite] API registriert (u.a. POST /snmp mit lx-wlan-networks, POST /api/lx-wlan-networks)');

// ── Trap Receiver ─────────────────────────────────────────────────────────────

createTrapServer();
setTrapCallback(onTrapReceived);
startMonitoring();
startUptimeProbes(1);
startScheduler();
createSyslogServer();
setImmediate(() => {
  try {
    rebuildFromSyslogEntries(getSyslogEntries());
  } catch (e) {
    console.error('[Roaming] Rebuild aus Syslog:', e.message);
  }
});

startEmbeddedRadiusServer();

// ── WebSocket ─────────────────────────────────────────────────────────────────

process.on('unhandledRejection', (reason) => { console.error('[unhandledRejection]', reason); });
process.on('uncaughtException',  (err)    => { console.error('[uncaughtException]', err); });
process.on('SIGINT',  () => { stopSniListenerSync(); stopEmbeddedRadiusServer(); flushTrapsSync(); flushAlertLogSync(); flushSyslogSync(); process.exit(0); });
process.on('SIGTERM', () => { stopSniListenerSync(); stopEmbeddedRadiusServer(); flushTrapsSync(); flushAlertLogSync(); flushSyslogSync(); process.exit(0); });

const httpServer = app.listen(PORT, '0.0.0.0', () => {
  console.log(`OnSite läuft auf http://0.0.0.0:${PORT} (lokal: http://localhost:${PORT})`);
});
httpServer.on('error', (err) => {
  console.error('[OnSite] HTTP-Server-Fehler:', err.message);
  if (err.code === 'EADDRINUSE') {
    console.error(`[OnSite] Port ${PORT} ist bereits belegt (zweite OnSite-Instanz oder anderer Dienst). Beenden Sie den anderen Prozess oder starten Sie mit z.B. PORT=3005 node server.js`);
    process.exit(1);
  }
});

const wss = new WebSocketServer({ noServer: true });
httpServer.on('upgrade', (req, socket, head) => {
  if (req.url === '/ws') {
    wss.handleUpgrade(req, socket, head, ws => {
      ws.on('message', async raw => {
        if (raw.length > 65536) { ws.close(); return; }
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }
        if (msg.type === 'scan')              await handleScanWs(ws, msg, WebSocket);
        else if (msg.type === 'rollout-scan') await handleRolloutScanWs(ws, msg, WebSocket);
      });
    });
  } else {
    socket.destroy();
  }
});
