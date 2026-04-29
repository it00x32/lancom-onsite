const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns').promises;
const { spawn } = require('child_process');
const { PORT, APP_VERSION, BASE_DIR, ALL_OS, SCRIPTE_DIR, ROLLOUT_FILENAME, LICENSE_FILE, TRIAL_FILE, FREERADIUS_CLIENTS_FILE } = require('../config');
const { readSettings, writeSettings, readDevices, writeDevices, readCriteria, writeCriteria, readSdn, writeSdn, readVars, writeVars, DEFAULT_NAC, readNac, writeNac } = require('../data');
const { restartEmbeddedRadiusServer, stopEmbeddedRadiusServer, getEmbeddedRadiusStatus } = require('../radius-server');
const { listNacCerts, saveNacCert, deleteNacCert } = require('../nac-certs');
const { readNacAcctLog, clearNacAcctLog } = require('../nac-acct-log');
const { readFreeRadiusConfig, normalizeFreeRadiusPayload, writeFreeRadiusConfig } = require('../freeradius-config');
const { getDockerFreeRadiusStatus, startDockerFreeRadius, stopDockerFreeRadius } = require('../freeradius-docker');
const { validateLicense, getTrialInfo, PUBLIC_KEY } = require('../license');
const { lmcProxy } = require('../lmc');
const { snmpLib, runSnmpWalk, runSnmpGet, runSnmpSet, snmpVal, macFromHexStr } = require('../snmp-session');
const { snmpSystem, snmpInterfaces, snmpMac, snmpLldp, snmpWds, snmpL2tp, snmpWlan, snmpWlanLcos, snmpNeighborAps, snmpLxWlanNetworksSetup, snmpLxWlanSetSsid, snmpVlanTrace, snmpVlan, snmpPortSettings, snmpSensors, snmpStp, snmpPoe, snmpPortDiag, snmpLoopProtection, snmpLoopDetect } = require('../snmp-queries');
const { subnetToHosts, scanHost, extractModel } = require('../scanner');
const { detectOsViaHttp } = require('../detect');
const { trafficPrev } = require('../traffic');
const { getLldpInterfaces, recordSamples, trimAndAggregate, getHistoryData, getFullHistory, clearHistory: clearTrafficHistory, saveHistory: saveTrafficHistory } = require('../traffic-history');
const { trapLog, persistTraps } = require('../traps');
const { alertLog, testAlertChannel, restartMonitoring, flushAlertLogSync } = require('../alerts');
const { chatStream, buildNetworkContext } = require('../ai');
const { getAllUptimeData, getStats, getSparkline, calcAvailability } = require('../uptime');
const { getLastScanResult, runScheduledScan, restartScheduler } = require('../scheduler');
const { getSyslogEntries, clearSyslogEntries, deleteSyslogEntryMatch, deleteSyslogEntriesForMac } = require('../syslog');
const { backupDevice, listBackups, getBackupContent, deleteBackup, diffConfigs, resolveBackupFilePath } = require('../config-backup');
const { IP_RE, escapeExpect, sshPtyCommands, sshPipeCommands, sshFnForOs, sshExec, resolvePlaceholders, runRolloutScript } = require('../ssh');
const { takeSnapshot, getHistory: getWifiHistory, clearHistory: clearWifiHistory } = require('../wifi-history');
const { compareLldp, getChanges: getTopoChanges, clearChanges: clearTopoChanges, hasState: hasTopoState } = require('../topo-changes');
const { rebuildFromSyslogEntries, getEvents: getRoamingEvents, getClientHistory: getRoamingClientHistory, getStats: getRoamingStats, clearEvents: clearRoamingEvents } = require('../roaming');
const {
  startSniListener,
  stopSniListener,
  clearSniLogs,
  getSniState,
} = require('../sni-listener');

/**
 * Schreib-Community für SNMP-SET: zuerst explizit aus Request (writeCommunity),
 * dann globale snmpWriteCommunity, dann dieselbe wie Lesen (community / snmpRead) — viele Geräte nutzen eine gemeinsame Zeichenkette.
 */
function resolveSnmpWriteCommunity(parsed, _s) {
  const p = parsed || {};
  const w = p.writeCommunity != null ? String(p.writeCommunity).trim() : '';
  if (w) return w;
  const glob = _s.snmpWriteCommunity != null ? String(_s.snmpWriteCommunity).trim() : '';
  if (glob) return glob;
  const devRead = p.community != null ? String(p.community).trim() : '';
  if (devRead) return devRead;
  const r = _s.snmpReadCommunity != null ? String(_s.snmpReadCommunity).trim() : '';
  return r || 'public';
}

async function rolloutSnmpAndSave(ip, logs, arpMac) {
  const s = readSettings();
  const community = s.snmpReadCommunity || 'public';
  const version   = s.snmpVersion       || '2c';
  logs.push(`→ Warte 5s damit Gerät Konfiguration anwenden kann…`);
  await new Promise(r => setTimeout(r, 5000));
  logs.push(`→ SNMP-Scan auf ${ip}…`);
  try {
    const dev = await scanHost(ip, community, version);
    if (!dev) { logs.push('  Kein LANCOM-Gerät per SNMP gefunden'); return false; }
    const model = extractModel(dev.sysDescr) || dev.lcosLxName || '';
    logs.push(`  ✓ Gerät "${dev.sysName || model || dev.ip}" per SNMP gefunden`);
    return {
      ip:        dev.ip,
      sysName:   dev.sysName    || '',
      sysDescr:  dev.sysDescr   || '',
      sysLocation: dev.sysLocation || '',
      os:        dev.os,
      mac:       arpMac         || dev.mac || '',
      serial:    dev.serial     || '',
      lcosLxName: dev.lcosLxName || '',
    };
  } catch (e) { logs.push(`  SNMP-Fehler: ${e.message}`); return false; }
}

function requireLicense(req, res, next) {
  const lic = validateLicense();
  if (lic.status !== 'active' && lic.status !== 'trial') {
    return res.status(403).json({ error: 'Keine gültige Lizenz', status: lic.status });
  }
  next();
}

function registerRoutes(app) {
  const ALLOWED_WITHOUT_LICENSE = ['/license', '/version'];
  app.use('/api', (req, res, next) => {
    if (ALLOWED_WITHOUT_LICENSE.includes(req.path)) return next();
    requireLicense(req, res, next);
  });

  // ── REST-API ───────────────────────────────────────────────────────────────────

  app.get('/api/sdn',      (req, res) => res.json(readSdn()));
  app.post('/api/sdn',     (req, res) => { try { writeSdn(req.body); res.json({ ok: true }); } catch(e) { res.status(400).json({ error: e.message }); } });

  function normalizeNacPayload(body) {
    const b = body && typeof body === 'object' ? body : {};
    const existing = readNac();
    const out = {
      ...DEFAULT_NAC,
      ...existing,
      radiusHost: String(b.radiusHost != null ? b.radiusHost : existing.radiusHost || '').trim().slice(0, 255),
      policyUrl: String(b.policyUrl != null ? b.policyUrl : existing.policyUrl || '').trim().slice(0, 500),
      notes: String(b.notes != null ? b.notes : existing.notes || '').trim().slice(0, 4000),
      radiusAuthPort: Math.min(65535, Math.max(1, parseInt(b.radiusAuthPort, 10) || existing.radiusAuthPort || DEFAULT_NAC.radiusAuthPort)),
      radiusAcctPort: Math.min(65535, Math.max(1, parseInt(b.radiusAcctPort, 10) || existing.radiusAcctPort || DEFAULT_NAC.radiusAcctPort)),
      embeddedRadiusEnabled: b.embeddedRadiusEnabled !== undefined
        ? (b.embeddedRadiusEnabled === true || b.embeddedRadiusEnabled === 'true' || b.embeddedRadiusEnabled === 1 || b.embeddedRadiusEnabled === '1')
        : (existing.embeddedRadiusEnabled === true || existing.embeddedRadiusEnabled === 'true' || existing.embeddedRadiusEnabled === 1 || existing.embeddedRadiusEnabled === '1'),
      embeddedRadiusBind: String(b.embeddedRadiusBind != null ? b.embeddedRadiusBind : existing.embeddedRadiusBind || '0.0.0.0').trim().slice(0, 64) || '0.0.0.0',
      embeddedAuthPort: Math.min(65535, Math.max(1, parseInt(b.embeddedAuthPort, 10) || existing.embeddedAuthPort || DEFAULT_NAC.embeddedAuthPort)),
      embeddedAcctPort: Math.min(65535, Math.max(1, parseInt(b.embeddedAcctPort, 10) || existing.embeddedAcctPort || DEFAULT_NAC.embeddedAcctPort)),
      embeddedCoaPort: b.embeddedCoaPort !== undefined && b.embeddedCoaPort !== null
        ? Math.min(65535, Math.max(0, parseInt(b.embeddedCoaPort, 10) || 0))
        : Math.min(65535, Math.max(0, parseInt(existing.embeddedCoaPort, 10) || 0)),
      embeddedVlanAssignmentEnabled: b.embeddedVlanAssignmentEnabled !== undefined
        ? (b.embeddedVlanAssignmentEnabled === true || b.embeddedVlanAssignmentEnabled === 'true')
        : !!existing.embeddedVlanAssignmentEnabled,
      nacAuthMode: (() => {
        if (b.nacAuthMode === 'pap_users') return 'pap_users';
        if (b.nacAuthMode === 'mac_allowlist') return 'mac_allowlist';
        return existing.nacAuthMode || 'mac_allowlist';
      })(),
      trustedMacs: [],
      macAllowlist: [],
      radiusUsers: [],
    };
    if (b.embeddedRadiusSecret !== undefined) {
      out.embeddedRadiusSecret = String(b.embeddedRadiusSecret).trim().slice(0, 256);
    } else {
      out.embeddedRadiusSecret = String(existing.embeddedRadiusSecret || '').trim().slice(0, 256);
    }
    const rawMac = (b.macAllowlist !== undefined || b.trustedMacs !== undefined)
      ? (Array.isArray(b.macAllowlist) ? b.macAllowlist : (Array.isArray(b.trustedMacs) ? b.trustedMacs : []))
      : [...(existing.macAllowlist || existing.trustedMacs || [])];
    const macRe = /^([0-9a-f]{2}):([0-9a-f]{2}):([0-9a-f]{2}):([0-9a-f]{2}):([0-9a-f]{2}):([0-9a-f]{2})$/i;
    const parseVlan = (v) => {
      if (v === undefined || v === null || v === '') return undefined;
      const n = parseInt(String(v).trim(), 10);
      if (Number.isNaN(n) || n < 1 || n > 4094) return undefined;
      return n;
    };
    const seen = new Set();
    for (const row of rawMac.slice(0, 500)) {
      const mac = String(row.mac || '').trim().toLowerCase();
      if (!macRe.test(mac) || seen.has(mac)) continue;
      seen.add(mac);
      const entry = { mac, label: String(row.label || '').trim().slice(0, 120) };
      const vlan = parseVlan(row.vlan);
      if (vlan != null) entry.vlan = vlan;
      out.macAllowlist.push(entry);
      out.trustedMacs.push(entry);
    }
    const rawUsers = b.radiusUsers !== undefined
      ? (Array.isArray(b.radiusUsers) ? b.radiusUsers : [])
      : [...(existing.radiusUsers || [])];
    for (const row of rawUsers.slice(0, 50)) {
      const user = String(row.user || '').trim().slice(0, 128);
      const pass = String(row.pass || '').trim().slice(0, 256);
      if (!user) continue;
      const u = { user, pass };
      const uvlan = parseVlan(row.vlan);
      if (uvlan != null) u.vlan = uvlan;
      out.radiusUsers.push(u);
    }
    return out;
  }

  function nacJsonForClient() {
    const n = readNac();
    const { embeddedRadiusSecret, ...rest } = n;
    return {
      ...rest,
      embeddedRadiusSecretSet: !!String(embeddedRadiusSecret || '').trim(),
      embeddedRadiusStatus: getEmbeddedRadiusStatus(),
    };
  }

  app.get('/api/nac', (req, res) => {
    try { res.json(nacJsonForClient()); } catch (e) { res.status(400).json({ error: e.message }); }
  });
  app.post('/api/nac', (req, res) => {
    try {
      const normalized = normalizeNacPayload(req.body);
      writeNac(normalized);
      if (!normalized.embeddedRadiusEnabled) {
        stopEmbeddedRadiusServer();
      } else {
        restartEmbeddedRadiusServer();
      }
      res.json({ ok: true, ...nacJsonForClient() });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.get('/api/nac/certs', (req, res) => {
    try { res.json({ certs: listNacCerts() }); } catch (e) { res.status(400).json({ error: e.message }); }
  });
  app.post('/api/nac/cert', (req, res) => {
    try {
      const { name, pem } = req.body || {};
      saveNacCert(name, pem);
      res.json({ ok: true, certs: listNacCerts() });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  app.delete('/api/nac/cert/:name', (req, res) => {
    try {
      deleteNacCert(decodeURIComponent(req.params.name));
      res.json({ ok: true, certs: listNacCerts() });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.get('/api/nac/radius-log', (req, res) => {
    try {
      const limit = parseInt(req.query.limit, 10) || 200;
      res.json({ entries: readNacAcctLog(limit) });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  app.delete('/api/nac/radius-log', (req, res) => {
    try {
      clearNacAcctLog();
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.get('/api/freeradius/config', (req, res) => {
    try {
      const cfg = readFreeRadiusConfig();
      if (!fs.existsSync(FREERADIUS_CLIENTS_FILE)) {
        writeFreeRadiusConfig(cfg);
      }
      res.json(cfg);
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  app.post('/api/freeradius/config', (req, res) => {
    try {
      const cfg = normalizeFreeRadiusPayload(req.body);
      writeFreeRadiusConfig(cfg);
      res.json({ ok: true, ...readFreeRadiusConfig() });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.get('/api/freeradius/docker', async (req, res) => {
    try {
      const status = await getDockerFreeRadiusStatus();
      res.json(status);
    } catch (e) {
      res.status(500).json({ available: false, running: false, error: e.message });
    }
  });
  app.post('/api/freeradius/docker/start', async (req, res) => {
    try {
      await startDockerFreeRadius();
      const status = await getDockerFreeRadiusStatus();
      res.json({ ok: true, status });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });
  app.post('/api/freeradius/docker/stop', async (req, res) => {
    try {
      await stopDockerFreeRadius();
      const status = await getDockerFreeRadiusStatus();
      res.json({ ok: true, status });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/api/license',    (req, res) => res.json(validateLicense()));
  app.post('/api/license',   (req, res) => {
    try {
      const lic = req.body;
      if (!lic.signature || !lic.customer || !lic.expiresAt) throw new Error('Fehlende Felder');
      const { signature, ...payload } = lic;
      const data = JSON.stringify(payload, Object.keys(payload).sort());
      const verify = crypto.createVerify('SHA256');
      verify.update(data);
      if (!verify.verify(PUBLIC_KEY, signature, 'base64')) throw new Error('Ungültige Signatur');
      fs.writeFileSync(LICENSE_FILE, JSON.stringify(lic, null, 2));
      res.json(validateLicense());
    } catch(e) { res.status(400).json({ status: 'invalid', message: e.message }); }
  });
  app.delete('/api/license', (req, res) => {
    try { fs.unlinkSync(LICENSE_FILE); } catch {}
    const trial = getTrialInfo();
    fs.writeFileSync(TRIAL_FILE, JSON.stringify({ ...trial, removed: true }));
    res.json(validateLicense());
  });

  app.get('/api/version',  (req, res) => res.json({ version: APP_VERSION }));

  app.get('/api/criteria',  (req, res) => res.json(readCriteria()));
  app.post('/api/criteria', (req, res) => { try { writeCriteria(req.body); res.json({ ok: true }); } catch(e) { res.status(400).json({ error: e.message }); } });

  app.get('/api/settings',  (req, res) => res.json(readSettings()));
  app.post('/api/settings', (req, res) => {
    try {
      writeSettings(req.body);
      restartMonitoring();
      restartScheduler();
      res.json({ ok: true });
    } catch(e) { res.status(400).json({ error: e.message }); }
  });

  app.get('/api/alert-log',    (req, res) => res.json(alertLog));
  app.delete('/api/alert-log', (req, res) => { alertLog.length = 0; flushAlertLogSync(); res.json({ ok: true }); });
  app.post('/api/alert-test',  async (req, res) => {
    try {
      const { channel } = req.body;
      const result = await testAlertChannel(channel);
      res.json(result || { ok: false, error: 'Kein Kanal konfiguriert' });
    } catch(e) { res.status(400).json({ ok: false, error: e.message }); }
  });

  app.get('/api/uptime', (req, res) => {
    const ip = req.query.ip;
    const periodH = parseInt(req.query.hours || '24', 10);
    const periodMs = periodH * 60 * 60 * 1000;
    if (ip) {
      const stats = getStats(ip, periodMs);
      const sparkline = getSparkline(ip, periodMs);
      res.json({ ip, stats, sparkline });
    } else {
      const devs = readDevices();
      const result = {};
      for (const devIp of Object.keys(devs)) {
        const stats = getStats(devIp, periodMs);
        if (stats) result[devIp] = { stats, sparkline: getSparkline(devIp, periodMs) };
      }
      res.json(result);
    }
  });

  app.get('/api/syslog',    (req, res) => {
    const entries = getSyslogEntries();
    const ip = req.query.ip;
    const severity = req.query.severity;
    const limit = parseInt(req.query.limit || '500', 10);
    let filtered = entries;
    if (ip) filtered = filtered.filter(e => e.from === ip);
    if (severity) filtered = filtered.filter(e => e.severity === severity);
    res.json(filtered.slice(0, limit));
  });
  app.delete('/api/syslog', (req, res) => { clearSyslogEntries(); res.json({ ok: true }); });
  app.delete('/api/syslog/entry', (req, res) => {
    const body = req.body || {};
    if (!body.ts || body.from == null) {
      return res.status(400).json({ error: 'ts und from erforderlich' });
    }
    const ok = deleteSyslogEntryMatch({
      ts: body.ts,
      from: body.from,
      message: body.message == null ? '' : body.message,
    });
    res.json({ ok, removed: ok ? 1 : 0 });
  });
  app.post('/api/syslog/delete-for-mac', (req, res) => {
    const mac = (req.body && req.body.mac) || '';
    if (!mac) return res.status(400).json({ error: 'mac fehlt' });
    const removed = deleteSyslogEntriesForMac(mac);
    res.json({ ok: true, removed });
  });

  app.post('/api/backup', async (req, res) => {
    try {
      const { ip, os } = req.body;
      if (!ip) throw new Error('ip fehlt');
      const s = readSettings();
      const user = os === 'LCOS LX' ? 'root' : 'admin';
      const pass = s.devicePassword || '';
      if (!pass) throw new Error('Kein Gerätepasswort in Einstellungen');
      const result = await backupDevice(ip, os || '', user, pass);
      res.json(result);
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.post('/api/backup/all', async (req, res) => {
    const s = readSettings();
    const pass = s.devicePassword || '';
    if (!pass) return res.status(400).json({ error: 'Kein Gerätepasswort' });
    const devs = readDevices();
    const results = [];
    for (const [ip, dev] of Object.entries(devs)) {
      if (dev.online === false) { results.push({ ip, error: 'offline' }); continue; }
      const user = dev.os === 'LCOS LX' ? 'root' : 'admin';
      try {
        const r = await backupDevice(ip, dev.os || '', user, pass);
        results.push(r);
      } catch (e) { results.push({ ip, error: e.message }); }
    }
    res.json(results);
  });

  app.get('/api/backup/list', (req, res) => {
    const { ip } = req.query;
    if (!ip) return res.status(400).json({ error: 'ip fehlt' });
    res.json(listBackups(ip));
  });

  app.get('/api/backup/content', (req, res) => {
    const { ip, file } = req.query;
    if (!ip || !file) return res.status(400).json({ error: 'ip und file erforderlich' });
    try { res.type('text/plain').send(getBackupContent(ip, file)); }
    catch (e) { res.status(404).json({ error: e.message }); }
  });

  app.get('/api/backup/download', (req, res) => {
    const { ip, file } = req.query;
    if (!ip || !file) return res.status(400).json({ error: 'ip und file erforderlich' });
    try {
      const filepath = resolveBackupFilePath(ip, file);
      const name = path.basename(file);
      const buf = fs.readFileSync(filepath);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${name.replace(/"/g, '')}"`);
      res.send(buf);
    } catch (e) { res.status(404).json({ error: e.message }); }
  });

  app.delete('/api/backup', (req, res) => {
    const { ip, file } = req.query;
    if (!ip || !file) return res.status(400).json({ error: 'ip und file erforderlich' });
    try { deleteBackup(ip, file); res.json({ ok: true }); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.post('/api/backup/diff', async (req, res) => {
    const { ip, fileA, fileB } = req.body;
    if (!ip || !fileA || !fileB) return res.status(400).json({ error: 'ip, fileA, fileB erforderlich' });
    const txt = (f) => String(f || '').toLowerCase().endsWith('.txt');
    if (!txt(fileA) || !txt(fileB)) {
      return res.status(400).json({
        error: 'Diff nur zwischen .txt-Backups. Switch-Dateien (.lcfsx/.cfg/.xml) sind binär.',
      });
    }
    try {
      const a = getBackupContent(ip, fileA);
      const b = getBackupContent(ip, fileB);
      res.json(diffConfigs(a, b));
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.get('/api/scheduler', (req, res) => {
    const s = readSettings();
    res.json({ hours: s.scheduledScanHours || 0, subnet: s.scheduledScanSubnet || s.lastScanSubnet || '', autoSave: !!s.scheduledAutoSave, lastResult: getLastScanResult() });
  });
  app.post('/api/scheduler/run', async (req, res) => {
    try { await runScheduledScan(); res.json(getLastScanResult()); } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/ai/status', (req, res) => {
    const s = readSettings();
    const configured = !!(s.aiEndpoint || s.aiProvider === 'ollama');
    res.json({ configured, provider: s.aiProvider || 'openai', model: s.aiModel || '' });
  });
  app.post('/api/ai/chat', async (req, res) => {
    const { messages } = req.body || {};
    if (!messages?.length) return res.status(400).json({ error: 'messages fehlt' });
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    let aborted = false;
    res.on('close', () => { aborted = true; });
    if (res.socket) res.socket.setNoDelay(true);
    try {
      for await (const chunk of chatStream(messages)) {
        if (aborted) break;
        res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
      }
      if (!aborted) { res.write('data: [DONE]\n\n'); res.end(); }
    } catch (e) {
      const payload = JSON.stringify({ error: e.message });
      if (!aborted) { res.write(`data: ${payload}\n\n`); res.end(); }
    }
  });

  app.get('/api/devices',    (req, res) => res.json(readDevices()));
  app.post('/api/devices',   (req, res) => {
    try {
      const merged = { ...readDevices(), ...req.body };
      writeDevices(merged);
      res.json({ ok: true, count: Object.keys(merged).length });
    } catch(e) { res.status(400).json({ error: e.message }); }
  });
  app.delete('/api/devices', (req, res) => {
    try {
      const { ip } = req.body || {};
      const devs = readDevices();
      if (ip) delete devs[ip]; else Object.keys(devs).forEach(k => delete devs[k]);
      writeDevices(devs);
      res.json({ ok: true });
    } catch(e) { res.status(400).json({ error: e.message }); }
  });

  app.get('/api/vars',  (req, res) => res.json(readVars()));
  app.post('/api/vars', (req, res) => { try { writeVars(req.body); res.json({ ok: true }); } catch(e) { res.status(400).json({ error: e.message }); } });

  app.get('/api/traps',    (req, res) => res.json(trapLog));
  app.delete('/api/traps', (req, res) => { trapLog.length = 0; persistTraps(); res.json({ ok: true }); });

  app.get('/api/addin', (req, res) => {
    const { os, file } = req.query;
    if (!os || !file || file.includes('..') || os.includes('..')) return res.status(400).json({ error: 'Ungültige Parameter' });
    try {
      const data = JSON.parse(fs.readFileSync(path.join(BASE_DIR, 'addins', os, file), 'utf8'));
      res.json(data);
    } catch { res.status(404).json({ error: 'Nicht gefunden' }); }
  });
  app.delete('/api/addin', (req, res) => {
    const { os, file } = req.query;
    if (!os || !file || os.includes('..') || file.includes('..')) return res.status(400).json({ error: 'os und file erforderlich' });
    const target = path.resolve(BASE_DIR, 'addins', os, file);
    if (!target.startsWith(path.resolve(BASE_DIR, 'addins'))) return res.status(400).json({ error: 'Ungültiger Pfad' });
    try { fs.unlinkSync(target); res.json({ ok: true }); } catch(e) { res.status(500).json({ error: e.message }); }
  });
  app.post('/api/addin', (req, res) => {
    try {
      const { originalOs, os, filename, ...data } = req.body;
      if (!os || !filename || filename.includes('..') || os.includes('..') || (originalOs||'').includes('..'))
        throw new Error('Ungültige Parameter');
      if (!filename.endsWith('.json')) throw new Error('Nur .json Dateien erlaubt');
      const targetDir  = path.join(BASE_DIR, 'addins', os);
      const targetFile = path.join(BASE_DIR, 'addins', os, filename);
      fs.mkdirSync(targetDir, { recursive: true });
      if (originalOs && originalOs !== os) {
        try { fs.unlinkSync(path.join(BASE_DIR, 'addins', originalOs, filename)); } catch {}
      }
      fs.writeFileSync(targetFile, JSON.stringify({ ...data, os }, null, 2), 'utf8');
      res.json({ ok: true });
    } catch(e) { res.status(400).json({ error: e.message }); }
  });

  app.get('/api/addins', (req, res) => {
    const addinsDir = path.join(BASE_DIR, 'addins');
    const result = [];
    for (const os of ALL_OS) {
      const dir = path.join(addinsDir, os);
      let files = [];
      try { files = fs.readdirSync(dir).filter(f => f.endsWith('.json')); } catch { continue; }
      for (const file of files) {
        try { result.push({ os, filename: file, ...JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) }); } catch {}
      }
    }
    res.json(result);
  });

  app.post('/api/lmc', async (req, res) => {
    try {
      const { service, path: apiPath, method = 'GET', token, body: reqBody, host } = req.body;
      if (!token) throw new Error('token fehlt');
      const result = await lmcProxy(service, apiPath, method, token, reqBody || null, host || 'cloud.lancom.de');
      const outBody = result.body && result.body.trim() ? result.body : '{}';
      res.status(result.status).type('application/json').send(outBody);
    } catch(e) { res.status(400).json({ error: e.message }); }
  });

  // ifIndex-Cache: ip → { name→idx mapping, timestamp }
  const _ifIdxCache = {};
  const IF_IDX_TTL = 30 * 60 * 1000; // 30 min

  async function resolveIfIndices(ip, community, version) {
    const cached = _ifIdxCache[ip];
    if (cached && Date.now() - cached.ts < IF_IDX_TTL) return cached.map;
    const nameOut = await runSnmpWalk(ip, community, version, '1.3.6.1.2.1.31.1.1.1.1', 6000);
    const map = {};
    nameOut.split('\n').forEach(line => {
      const m = line.match(/\.31\.1\.1\.1\.1\.(\d+)\s*=\s*(.*)/);
      if (m) map[snmpVal(m[2]).trim()] = m[1];
    });
    _ifIdxCache[ip] = { ts: Date.now(), map };
    return map;
  }

  // Fuzzy ifIndex lookup: LLDP port name → SNMP ifIndex
  function findIfIndex(nameMap, portName) {
    if (nameMap[portName]) return nameMap[portName];
    const norm = s => (s || '').toLowerCase().replace(/[\s\-_]/g, '');
    const t = norm(portName);
    for (const [k, v] of Object.entries(nameMap)) { if (norm(k) === t) return v; }
    // Extract port number: "9A" → 9, "Port 7" → 7, "GigabitEthernet 1/7" → 7
    const extractNum = s => { const m = (s || '').match(/(\d+)\s*[a-z]?\s*$/i); return m ? parseInt(m[1], 10) : null; };
    const edgeNum = extractNum(portName);
    if (edgeNum !== null) {
      const physRe = /^(port|gigabit|switch|ethernet|eth|ge|fe|te|lan)/i;
      for (const [k, v] of Object.entries(nameMap)) {
        if (physRe.test(k) && extractNum(k) === edgeNum) return v;
      }
      // Fallback: short numeric names like "9" matching "Port  9"
      for (const [k, v] of Object.entries(nameMap)) {
        if (/^\d+$/.test(k.trim()) && parseInt(k.trim(), 10) === edgeNum) return v;
      }
    }
    return null;
  }

  // Concurrency limiter
  async function parallelLimit(tasks, limit) {
    const results = [];
    const executing = new Set();
    for (const task of tasks) {
      const p = task().then(r => { executing.delete(p); return r; });
      executing.add(p);
      results.push(p);
      if (executing.size >= limit) await Promise.race(executing);
    }
    return Promise.all(results);
  }

  app.get('/api/iftraffic', async (req, res) => {
    const _s        = readSettings();
    const community = _s.snmpReadCommunity || 'public';
    const version   = _s.snmpVersion       || '2c';
    const devs      = readDevices();
    const now       = Date.now();
    const filterIp  = req.query.ip || null;
    const lldpOnly  = req.query.lldp === '1';

    // Determine which devices to poll
    let targetDevs = Object.values(devs).filter(d => d.online === true && (!filterIp || d.ip === filterIp));
    const lldpIfaces = getLldpInterfaces(devs);

    if (lldpOnly) {
      // Only poll devices that have LLDP uplink interfaces
      targetDevs = targetDevs.filter(d => lldpIfaces[d.ip]);
    }

    const CONCURRENCY = 10;
    const out = {};

    if (lldpOnly) {
      // ── Optimized: targeted SNMP GETs for LLDP ports only ─────────────
      const tasks = targetDevs.map(d => async () => {
        try {
          const ports = lldpIfaces[d.ip];
          if (!ports?.size) return { ip: d.ip, ifData: {} };
          const nameMap = await resolveIfIndices(d.ip, community, version);

          const ifData = {};
          const oids = [];
          const portList = [];
          for (const portName of ports) {
            const idx = findIfIndex(nameMap, portName);
            if (!idx) continue;
            portList.push({ portName, idx });
            oids.push(
              `1.3.6.1.2.1.31.1.1.1.6.${idx}`,   // ifHCInOctets (Counter64)
              `1.3.6.1.2.1.31.1.1.1.10.${idx}`,   // ifHCOutOctets (Counter64)
              `1.3.6.1.2.1.31.1.1.1.15.${idx}`,   // ifHighSpeed (Mbps)
              `1.3.6.1.2.1.2.2.1.10.${idx}`,      // ifInOctets (Counter32 fallback)
              `1.3.6.1.2.1.2.2.1.16.${idx}`,      // ifOutOctets (Counter32 fallback)
              `1.3.6.1.2.1.2.2.1.5.${idx}`,       // ifSpeed (fallback)
            );
          }
          if (!oids.length) return { ip: d.ip, ifData: {} };

          const raw = await runSnmpGet(d.ip, community, version, oids, 4000);
          const vals = {};
          raw.split('\n').forEach(line => {
            let m = line.match(/\.31\.1\.1\.1\.(\d+)\.(\d+)\s*=\s*(.*)/);
            if (m) {
              const col = parseInt(m[1]), idx = m[2], val = parseInt(snmpVal(m[3])) || 0;
              if (!vals[idx]) vals[idx] = {};
              if (col === 6)  vals[idx].hcIn      = val;
              if (col === 10) vals[idx].hcOut     = val;
              if (col === 15) vals[idx].highSpeed = val;
              return;
            }
            m = line.match(/\.2\.2\.1\.(\d+)\.(\d+)\s*=\s*(.*)/);
            if (m) {
              const col = parseInt(m[1]), idx = m[2], val = parseInt(snmpVal(m[3])) || 0;
              if (!vals[idx]) vals[idx] = {};
              if (col === 10) vals[idx].in32    = val;
              if (col === 16) vals[idx].out32   = val;
              if (col === 5)  vals[idx].speed32 = val;
            }
          });

          for (const { portName, idx } of portList) {
            const v = vals[idx];
            if (!v) continue;
            const inOctets  = v.hcIn  || v.in32  || 0;
            const outOctets = v.hcOut || v.out32 || 0;
            const highSpeed = v.highSpeed || (v.speed32 ? v.speed32 / 1e6 : 0);
            const is64      = !!(v.hcIn || v.hcOut);
            ifData[portName] = { idx, inOctets, outOctets, highSpeed, is64 };
          }
          return { ip: d.ip, ifData };
        } catch { return { ip: d.ip, ifData: {} }; }
      });

      const rawResults = await parallelLimit(tasks, CONCURRENCY);
      rawResults.forEach(({ ip, ifData }) => {
        if (!Object.keys(ifData).length) return;
        const prev = trafficPrev[ip];
        const dt = prev ? Math.max((now - prev.ts) / 1000, 1) : null;
        out[ip] = {};
        for (const [name, data] of Object.entries(ifData)) {
          const speedBps = data.highSpeed ? data.highSpeed * 1e6 : 0;
          let inBps = 0, outBps = 0;
          if (dt && prev?.ifaces?.[data.idx]) {
            const p = prev.ifaces[data.idx];
            let dIn  = data.inOctets  - p.in;
            let dOut = data.outOctets - p.out;
            if (dIn < 0)  dIn  = data.is64 ? 0 : (dIn + 4294967296);
            if (dOut < 0) dOut = data.is64 ? 0 : (dOut + 4294967296);
            inBps  = Math.max(0, Math.round(dIn  * 8 / dt));
            outBps = Math.max(0, Math.round(dOut * 8 / dt));
            if (speedBps > 0 && (inBps > speedBps * 1.05 || outBps > speedBps * 1.05)) {
              inBps = 0; outBps = 0;
            }
          }
          const utilPct = speedBps > 0 ? Math.min(100, Math.max(inBps, outBps) / speedBps * 100) : 0;
          out[ip][name] = { inBps, outBps, speedBps, utilPct };
        }
        const prevIfaces = {};
        for (const [name, data] of Object.entries(ifData)) prevIfaces[data.idx] = { in: data.inOctets, out: data.outOctets };
        trafficPrev[ip] = { ts: now, ifaces: { ...(prev?.ifaces || {}), ...prevIfaces } };
      });
    } else {
      // ── Legacy: full interface walk (used by topology traffic) ─────────
      const tasks = targetDevs.map(d => async () => {
        try   { return { ip: d.ip, ifaces: await snmpInterfaces(d.ip, community, version) }; }
        catch { return { ip: d.ip, ifaces: [] }; }
      });
      const rawResults = await parallelLimit(tasks, CONCURRENCY);
      rawResults.forEach(({ ip, ifaces }) => {
        if (!ifaces.length) return;
        const prev = trafficPrev[ip];
        const dt   = prev ? Math.max((now - prev.ts) / 1000, 1) : null;
        out[ip] = {};
        ifaces.forEach(iface => {
          const name = (iface.name || iface.descr || '').trim();
          if (!name) return;
          const speedBps = iface.highSpeed ? iface.highSpeed * 1e6 : (iface.speed || 0);
          let inBps = 0, outBps = 0;
          if (dt && prev?.ifaces?.[iface.idx]) {
            const p = prev.ifaces[iface.idx];
            let dIn  = iface.inOctets  - p.in;
            let dOut = iface.outOctets - p.out;
            if (dIn < 0)  dIn  = iface.is64 ? 0 : (dIn + 4294967296);
            if (dOut < 0) dOut = iface.is64 ? 0 : (dOut + 4294967296);
            inBps  = Math.max(0, Math.round(dIn  * 8 / dt));
            outBps = Math.max(0, Math.round(dOut * 8 / dt));
            if (speedBps > 0 && (inBps > speedBps * 1.05 || outBps > speedBps * 1.05)) {
              inBps = 0; outBps = 0;
            }
          }
          const utilPct = speedBps > 0 ? Math.min(100, Math.max(inBps, outBps) / speedBps * 100) : 0;
          out[ip][name] = { inBps, outBps, speedBps, utilPct };
          if (iface.descr && iface.descr !== name && !out[ip][iface.descr]) out[ip][iface.descr] = out[ip][name];
        });
        trafficPrev[ip] = { ts: now, ifaces: Object.fromEntries(ifaces.map(i => [i.idx, { in: i.inOctets, out: i.outOctets }])) };
      });
    }

    // Record history for LLDP uplink interfaces only
    if (_s.trafficHistoryEnabled !== false) {
      try {
        recordSamples(out, lldpIfaces);
        trimAndAggregate(_s.trafficRetentionHours || 24);
      } catch { /* non-critical */ }
    }

    res.json(out);
  });

  // ── Traffic History ─────────────────────────────────────────────────────────

  app.get('/api/traffic-history', (req, res) => {
    const { ip, iface, hours } = req.query;
    if (ip && iface) {
      res.json(getHistoryData(ip, iface));
    } else if (ip) {
      res.json(getHistoryData(ip));
    } else {
      res.json(getFullHistory());
    }
  });

  app.get('/api/traffic-history/summary', (req, res) => {
    res.json(getHistoryData());
  });

  app.delete('/api/traffic-history', (req, res) => {
    clearTrafficHistory();
    res.json({ ok: true });
  });

  // ── SSE: Rollout-Scanner ──────────────────────────────────────────────────────

  app.post('/rollout-scan', requireLicense, async (req, res) => {
    const { subnet } = req.body || {};
    if (!subnet) return res.status(400).json({ error: 'subnet fehlt' });

    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });

        let aborted = false;
        res.on('close', () => { aborted = true; if (proc) proc.kill(); });
        if (res.socket) res.socket.setNoDelay(true);

        const send = (obj) => {
          if (aborted) return;
          try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch { aborted = true; }
        };

        const MAC_PREFIX = '00:a0:57';
        let proc = null;
        let foundCnt = 0;
        const detectionPromises = [];
        const { snmpReadCommunity: community = 'public', snmpVersion: version = '2c' } = readSettings();

        const detectAndSend = async (dev) => {
          let sent = false;
          const sendDev = () => { if (!sent && !aborted) { sent = true; send({ type: 'found', device: { ...dev } }); foundCnt++; } };

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
        try { totalHosts = subnetToHosts(subnet).length; } catch { /* ignorieren */ }
        send({ type: 'start', total: totalHosts });

        try {
          proc = spawn('arp-scan', ['--quiet', '--retry=3', subnet], { stdio: ['ignore', 'pipe', 'ignore'] });

          let scanned = 0;
          let buf = '';
          proc.stdout.on('data', chunk => {
            buf += chunk.toString();
            let nl;
            while ((nl = buf.indexOf('\n')) !== -1) {
              const line = buf.slice(0, nl).trim();
              buf = buf.slice(nl + 1);
              const m = line.match(/^(\d+\.\d+\.\d+\.\d+)\s+([\da-f:]+)\s*(.*)/i);
              if (m) {
                scanned++;
                const mac = m[2].toLowerCase();
                if (mac.startsWith(MAC_PREFIX)) {
                  const dev = { ip: m[1], mac: m[2], vendor: m[3].trim() || 'LANCOM Systems' };
                  detectionPromises.push(detectAndSend(dev));
                }
                send({ type: 'progress', scanned, total: totalHosts, found: foundCnt });
              }
            }
          });

          await new Promise((resolve) => proc.on('close', resolve));
          await Promise.all(detectionPromises);
        } catch (err) {
          send({ type: 'error', message: err.message });
        }

        if (!aborted) {
          send({ type: 'done', found: foundCnt });
          res.end();
        }
  });

  // ── SSE: Netzwerk-Scanner ─────────────────────────────────────────────────────

  app.post('/scan', requireLicense, async (req, res) => {
    let hosts, community, version;
    try {
      if (!req.body?.subnet) throw new Error('subnet fehlt');
      const s = readSettings();
      community = s.snmpReadCommunity || 'public';
      version   = s.snmpVersion       || '2c';
      hosts     = subnetToHosts(req.body.subnet);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    let aborted = false;
    res.on('close', () => { aborted = true; });
    if (res.socket) res.socket.setNoDelay(true);
    const send = (obj) => { if (aborted) return; try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch { aborted = true; } };

    send({ type: 'start', total: hosts.length });
    const CONCURRENCY = 50;
    let idx = 0, done = 0, found = 0;
    async function worker() {
      while (idx < hosts.length && !aborted) {
        const host = hosts[idx++];
        let device = null;
        try { device = await scanHost(host, community, version); } catch {}
        done++;
        if (device) { found++; send({ type: 'found', device, scanned: done, total: hosts.length, found }); }
        else if (done % 5 === 0 || done === hosts.length) { send({ type: 'progress', scanned: done, total: hosts.length, found }); }
      }
    }
    try { await Promise.all(Array(Math.min(CONCURRENCY, hosts.length)).fill(null).map(() => worker())); } catch {}
    if (!aborted) { send({ type: 'done', total: hosts.length, found }); res.end(); }
  });

  // ── SNMP ──────────────────────────────────────────────────────────────────────

  app.post('/snmp', requireLicense, async (req, res) => {
    try {
      const parsed = req.body;
      const { host, type } = parsed;
      if (!host) throw new Error('host fehlt');
      const _s = readSettings();
      const community = parsed.community || _s.snmpReadCommunity || 'public';
      const version   = parsed.version   || _s.snmpVersion       || '2c';

      let result;
      const snmpType = String(type || '').trim();
      switch (snmpType) {
        case 'system':     result = await snmpSystem(host, community, version);     break;
        case 'interfaces': result = await snmpInterfaces(host, community, version); break;
        case 'mac':        result = await snmpMac(host, community, version);        break;
        case 'lldp':       result = await snmpLldp(host, community, version);       break;
        case 'wlan': {
          const os = parsed.os || '';
          result = (os === 'LCOS' || os === 'LCOS FX')
            ? await snmpWlanLcos(host, community, version)
            : await snmpWlan(host, community, version);
          break;
        }
        case 'vlan':       result = await snmpVlan(host, community, version, parsed.os||'', parsed.devType||''); break;
            case 'ports':      result = await snmpPortSettings(host, community, version); break;
            case 'sensors':    result = await snmpSensors(host, community, version);      break;
            case 'stp':        result = await snmpStp(host, community, version);         break;
            case 'portdiag':   result = await snmpPortDiag(host, community, version);      break;
            case 'poe':        result = await snmpPoe(host, community, version);         break;
            case 'loop':       result = await snmpLoopProtection(host, community, version); break;
            case 'uptime': {
              const out = await runSnmpGet(host, community, version, ['1.3.6.1.2.1.1.3.0'], 3000);
              const m = (out||'').match(/Timeticks:\s*\((\d+)\)/i);
              if (!m) throw new Error('No sysUpTime');
              result = { ticks: parseInt(m[1]) };
              break;
            }
            case 'neighbor-aps': result = await snmpNeighborAps(host, community, version); break;
            case 'lx-wlan-networks': result = await snmpLxWlanNetworksSetup(host, community, version); break;
            case 'lx-wlan-set-ssid': {
              const { networkName, ssid } = parsed;
              if (!networkName || ssid == null || String(ssid).trim() === '') throw new Error('networkName und ssid erforderlich');
              const writeComm = resolveSnmpWriteCommunity(parsed, _s);
              result = await snmpLxWlanSetSsid(host, writeComm, version, networkName, String(ssid).trim());
              break;
            }
            case 'wds':        result = await snmpWds(host, community, version);        break;
            case 'l2tp':       result = await snmpL2tp(host, community, version);       break;
            case 'ping': {
              const out = await runSnmpGet(host, community, version, ['1.3.6.1.2.1.1.5.0'], 2000);
              if (!out.trim()) throw new Error('No SNMP response');
              result = { reachable: true };
              break;
            }
            case 'ifmacs': {
              const [ifPhysOut, ifNameOut] = await Promise.all([
                runSnmpWalk(host, community, version, '1.3.6.1.2.1.2.2.1.6'),
                runSnmpWalk(host, community, version, '1.3.6.1.2.1.31.1.1.1.1'),
              ]);
              const ifNames = {};
              ifNameOut.split('\n').forEach(line => {
                const m = line.match(/31\.1\.1\.1\.1\.(\d+)\s*=\s*(?:STRING:\s*)?\"?([^"\n]+?)\"?\s*$/);
                if (m) ifNames[m[1]] = m[2].trim().toLowerCase();
              });
              const macs = [];
              ifPhysOut.split('\n').forEach(line => {
                const m = line.match(/2\.2\.1\.6\.(\d+)\s*=\s*(?:Hex-STRING|STRING):\s*([\da-fA-F: ]+)/i);
                if (!m) return;
                const idx = m[1], name = ifNames[idx] || '';
                if (/^(lo|tun|gre|l2tp|ppp|sit|ip6tnl)/.test(name)) return;
                const mac = macFromHexStr(m[2].trim());
                if (mac && mac !== '00:00:00:00:00:00' && !macs.includes(mac)) macs.push(mac);
              });
              result = { macs };
              break;
            }
            case 'vlan-trace':   result = await snmpVlanTrace(host, community, version, parsed.vlanId || 1); break;
            case 'loop-detect': result = await snmpLoopDetect(host, community, version); break;
            default:           throw new Error(`Unbekannter Typ: ${snmpType}`);
          }

          res.json(result);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  app.post('/api/mib', async (req, res) => {
    try {
      const { host, oid, action } = req.body;
      if (!host || !oid) throw new Error('host und oid erforderlich');
      const _s = readSettings();
      const community = _s.snmpReadCommunity || 'public';
      const version   = _s.snmpVersion       || '2c';
      const cleanOid  = oid.startsWith('.') ? oid.slice(1) : oid;
      let lines = [];
      if (action === 'get') {
        const oids = cleanOid.split(',').map(o => o.trim());
        const raw = await runSnmpGet(host, community, version, oids, 5000);
        lines = raw.split('\n').filter(l => l.trim());
      } else {
        const raw = await runSnmpWalk(host, community, version, cleanOid, 30000);
        lines = raw.split('\n').filter(l => l.trim());
      }
      res.json({ lines });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.post('/api/lx-wlan-networks', async (req, res) => {
    try {
      const b = req.body || {};
      const host = b.host || b.ip;
      if (!host) throw new Error('host fehlt');
      const _s = readSettings();
      const community = b.community || _s.snmpReadCommunity || 'public';
      const version = b.version || _s.snmpVersion || '2c';
      const result = await snmpLxWlanNetworksSetup(host, community, version);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/lx-wlan-ssid', async (req, res) => {
    try {
      const b = req.body || {};
      const { host, networkName, ssid } = b;
      if (!host) throw new Error('host fehlt');
      const _s = readSettings();
      const community = resolveSnmpWriteCommunity(b, _s);
      const version = b.version || _s.snmpVersion || '2c';
      const out = await snmpLxWlanSetSsid(host, community, version, networkName, ssid);
      res.json({ ok: true, ...out });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/snmpset', requireLicense, async (req, res) => {
    try {
      const { host, oid, type, value } = req.body;
      if (!host || !oid) throw new Error('host/oid fehlt');
      const _s = readSettings();
      const community = _s.snmpWriteCommunity || _s.snmpReadCommunity || 'public';
      const version   = _s.snmpVersion || '2c';
      const result = await runSnmpSet(host, community, version, oid, type || 'i', value);
      res.json({ ok: true, result });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // ── TLS-SNI-Mitschnitt (Tools) ────────────────────────────────────────────────

  app.get('/api/tools/sni', (req, res) => {
    res.json(getSniState());
  });

  app.post('/api/tools/sni/start', async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const result = await startSniListener({
      port: body.port,
      bind: body.bind,
      filterDomains: body.filterDomains != null ? String(body.filterDomains) : '',
    });
    if (result.ok) res.json({ ok: true, ...getSniState() });
    else res.status(400).json({ ok: false, error: result.error || 'Start fehlgeschlagen' });
  });

  app.post('/api/tools/sni/stop', async (req, res) => {
    const result = await stopSniListener();
    if (result.ok) res.json({ ok: true, ...getSniState() });
    else res.status(400).json({ ok: false, error: result.error || 'Stopp fehlgeschlagen' });
  });

  app.post('/api/tools/sni/clear', (req, res) => {
    clearSniLogs();
    res.json({ ok: true, ...getSniState() });
  });

  // ── Scripting API ─────────────────────────────────────────────────────────────

  app.get('/api/scripte', (req, res) => {
      const result = {};
      for (const os of ALL_OS) {
        const dir = path.join(SCRIPTE_DIR, os);
        if (!fs.existsSync(dir)) { result[os] = []; continue; }
        result[os] = fs.readdirSync(dir)
          .filter(f => f.endsWith('.json'))
          .map(f => {
            try { return { ...JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), _file: f, _protected: f === ROLLOUT_FILENAME }; }
            catch { return null; }
          }).filter(Boolean)
          .sort((a, b) => (a._file === ROLLOUT_FILENAME ? -1 : b._file === ROLLOUT_FILENAME ? 1 : 0));
      }
      res.json(result);
  });

  app.post('/api/scripte', (req, res) => {
    try {
      const script = req.body;
      if (!script.name || !script.os?.length || !script.commands?.length)
        return res.status(400).json({ error: 'name, os und commands erforderlich' });
      const os       = script.os[0];
      if (!ALL_OS.includes(os)) return res.status(400).json({ error: 'Ungültiges Betriebssystem' });
      const filename = script._file || (script.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.json');
      if (filename.includes('..') || filename.includes('/') || filename.includes('\\'))
        return res.status(400).json({ error: 'Ungültiger Dateiname' });
      const dir      = path.join(SCRIPTE_DIR, os);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const target   = path.resolve(dir, filename);
      if (!target.startsWith(path.resolve(SCRIPTE_DIR))) return res.status(400).json({ error: 'Ungültiger Pfad' });
      const { _file, ...data } = script;
      fs.writeFileSync(target, JSON.stringify(data, null, 2));
      res.json({ ok: true, file: filename });
    } catch (e) {
      const msg = e.code === 'EACCES' || e.code === 'EPERM'
        ? 'Keine Schreibrechte im Ordner scripte/ — Besitzer auf den Server-Benutzer setzen (z. B. sudo chown -R www-data:www-data scripte/)'
        : e.message;
      res.status(400).json({ error: msg });
    }
  });

  app.delete('/api/scripte', (req, res) => {
    const { os, file } = req.query;
    if (!os || !file || os.includes('..') || file.includes('..')) return res.status(400).json({ error: 'os und file erforderlich' });
    if (!ALL_OS.includes(os)) return res.status(400).json({ error: 'Ungültiges Betriebssystem' });
    if (file === ROLLOUT_FILENAME) return res.status(403).json({ error: 'ROLLOUT-Script kann nicht gelöscht werden' });
    const target = path.resolve(SCRIPTE_DIR, os, file);
    if (!target.startsWith(path.resolve(SCRIPTE_DIR))) return res.status(400).json({ error: 'Ungültiger Pfad' });
    if (fs.existsSync(target)) fs.unlinkSync(target);
    res.json({ ok: true });
  });

  app.post('/api/rollout/set-password', async (req, res) => {
    try {
      const { ip, os, mac } = req.body;
      if (!ip || !IP_RE.test(ip)) return res.status(400).json({ error: 'ip fehlt oder ungültig' });
          const s = readSettings();
          const newPass = s.devicePassword || '';
          if (!newPass) return res.status(400).json({ error: 'Kein Gerätepasswort in den Einstellungen gespeichert' });

          const logs = [];

          // ── LCOS SX 3 ────────────────────────────────────────────────────────
          if (os === 'LCOS SX 3') {
            const sx3Expect = (loginPass, alreadySet) => new Promise((resolve) => {
              const esc = escapeExpect(newPass);
              const script = `
set timeout 15
spawn sshpass -p "${loginPass}" ssh -tt -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 admin@${ip}
expect {
  "# " {}
  "Permission denied" { exit 1 }
  timeout             { exit 2 }
}
${alreadySet ? '' : `send "account\\r"
expect "(account)# "
send "add 15 admin ${esc}\\r"
expect "(account)# "
send "exit\\r"
expect "# "
send "save start\\r"
expect "# "
`}send "exit\\r"
expect eof
exit 0
`;
              const proc = spawn('expect', ['-c', script], { stdio: ['ignore', 'pipe', 'pipe'] });
              let out = '', err = '';
              proc.stdout.on('data', d => out += d.toString());
              proc.stderr.on('data', d => err += d.toString());
              const timer = setTimeout(() => { proc.kill(); resolve({ exitCode: -1, out: out + '\n[Timeout]', err }); }, 25000);
              proc.on('close', code => { clearTimeout(timer); resolve({ exitCode: code, out, err }); });
              proc.on('error', e => { clearTimeout(timer); resolve({ exitCode: -1, out, err: e.message }); });
            });

            logs.push(`→ LCOS SX 3: Verbinde als admin@${ip} (Standard-Passwort "admin")…`);
            const r = await sx3Expect('admin', false);
            logs.push(`  exit=${r.exitCode}`);
            if (r.out.trim()) logs.push('  stdout: ' + r.out.trim());
            if (r.err.trim()) logs.push('  stderr: ' + r.err.trim());
            if (r.exitCode === 0) {
              logs.push(`→ Warte 10s auf Neustart nach save start…`);
              await new Promise(r => setTimeout(r, 10000));
              const scriptResults = await runRolloutScript(ip, os, 'admin', newPass);
              const snmpDevice    = await rolloutSnmpAndSave(ip, logs, mac);
              return res.json({ ok: true, user: 'admin', log: logs.join('\n'), scriptResults, snmpDevice });
            }

            logs.push(`→ Fallback: Versuche mit gespeichertem Passwort…`);
            const r2 = await sx3Expect(newPass, true);
            logs.push(`  exit=${r2.exitCode}`);
            if (r2.out.trim()) logs.push('  stdout: ' + r2.out.trim());
            if (r2.err.trim()) logs.push('  stderr: ' + r2.err.trim());
            if (r2.exitCode === 0) {
              const scriptResults = await runRolloutScript(ip, os, 'admin', newPass);
              const snmpDevice    = await rolloutSnmpAndSave(ip, logs, mac);
              return res.json({ ok: true, user: 'admin', alreadySet: true, log: logs.join('\n'), scriptResults, snmpDevice });
            }

            return res.json({ ok: false, error: 'SSH-Login fehlgeschlagen', log: logs.join('\n') });
          }

          // ── LCOS SX 4 ────────────────────────────────────────────────────────
          if (os === 'LCOS SX 4') {
            const sx4Commands = [
              'configure',
              `username admin privilege 15 password unencrypted ${newPass}`,
              'exit',
              'copy running-config startup-config',
            ];
            logs.push(`→ LCOS SX 4: Verbinde als admin@${ip} (leeres Passwort)…`);
            const r = await sshPipeCommands(ip, 'admin', '', sx4Commands, 20000, true);
            logs.push(`  exit=${r.exitCode}`);
            if (r.stdout.trim()) logs.push('  stdout: ' + r.stdout.trim());
            if (r.stderr.trim()) logs.push('  stderr: ' + r.stderr.trim());
            if (r.exitCode === 0) {
              const scriptResults = await runRolloutScript(ip, os, 'admin', newPass);
              const snmpDevice    = await rolloutSnmpAndSave(ip, logs, mac);
              return res.json({ ok: true, user: 'admin', log: logs.join('\n'), scriptResults, snmpDevice });
            }
            logs.push(`→ Fallback: Versuche mit gespeichertem Passwort…`);
            const r2 = await sshPipeCommands(ip, 'admin', newPass, sx4Commands, 20000, true);
            logs.push(`  exit=${r2.exitCode}`);
            if (r2.stdout.trim()) logs.push('  stdout: ' + r2.stdout.trim());
            if (r2.stderr.trim()) logs.push('  stderr: ' + r2.stderr.trim());
            if (r2.exitCode === 0) {
              const scriptResults = await runRolloutScript(ip, os, 'admin', newPass);
              const snmpDevice    = await rolloutSnmpAndSave(ip, logs, mac);
              return res.json({ ok: true, user: 'admin', alreadySet: true, log: logs.join('\n'), scriptResults, snmpDevice });
            }
            return res.json({ ok: false, error: 'SSH-Login fehlgeschlagen', log: logs.join('\n') });
          }

          // ── LCOS SX 5 ────────────────────────────────────────────────────────
          if (os === 'LCOS SX 5') {
            if (newPass.length < 8) {
              return res.json({ ok: false, error: 'LCOS SX 5 erfordert ein Passwort mit mindestens 8 Zeichen.' });
            }
            const esc = escapeExpect(newPass);
            const sx5Expect = (loginPass, alreadySet) => new Promise((resolve) => {
              const script = `
set timeout 25
set send_slow {1 0.05}
spawn sshpass -p "${loginPass}" ssh -tt -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 admin@${ip}
expect {
  "Permission denied" { exit 1 }
  timeout             { exit 2 }
  -re {[#>$] ?$}     {}
}
${alreadySet ? '' : `# LCOS SX 5: Shell-Prompt erscheint zuerst, danach Password-Dialog
expect {
  "Enter old password:" {
    after 300
    send "\\r"
    expect {
      "Enter new password:" {
        after 300
        send -s "${esc}\\r"
        expect {
          "Confirm new password:" {
            after 300
            send -s "${esc}\\r"
            expect {
              "Incorrect password"    { exit 3 }
              "Could not set"        { exit 3 }
              -re {[#>$] ?$}         {}
            }
          }
          "Incorrect password"  { exit 3 }
          "Could not set"      { exit 3 }
        }
      }
      "Incorrect password"  { exit 3 }
      "Could not set"      { exit 3 }
      timeout              { exit 2 }
    }
  }
  timeout { exit 2 }
}
send "configure\\r"
expect -re {\\(config\\)[#>$] ?$}
send "username admin privilege 15 password unencrypted ${esc}\\r"
expect -re {\\(config\\)[#>$] ?$}
send "exit\\r"
expect -re {[#>$] ?$}
send "copy running-config startup-config\\r"
expect -re {[#>$] ?$}
`}send "exit\\r"
expect eof
exit 0
`;
              const proc = spawn('expect', ['-c', script], { stdio: ['ignore', 'pipe', 'pipe'] });
              let out = '', err = '';
              proc.stdout.on('data', d => out += d.toString());
              proc.stderr.on('data', d => err += d.toString());
              const timer = setTimeout(() => { proc.kill(); resolve({ exitCode: -1, out: out + '\n[Timeout]', err }); }, 35000);
              proc.on('close', code => { clearTimeout(timer); resolve({ exitCode: code, out, err }); });
              proc.on('error', e => { clearTimeout(timer); resolve({ exitCode: -1, out, err: e.message }); });
            });

            logs.push(`→ LCOS SX 5: Verbinde als admin@${ip} (leeres Passwort, Erstlogin-Dialog)…`);
            const r = await sx5Expect('', false);
            logs.push(`  exit=${r.exitCode}`);
            if (r.out.trim()) logs.push('  stdout: ' + r.out.trim());
            if (r.err.trim()) logs.push('  stderr: ' + r.err.trim());
            if (r.exitCode === 3) {
              return res.json({ ok: false, error: 'Passwort wurde vom Gerät abgelehnt (zu kurz oder ungültig). Mindestlänge: 8 Zeichen.', log: logs.join('\n') });
            }
            if (r.exitCode === 0) {
              const scriptResults = await runRolloutScript(ip, os, 'admin', newPass);
              const snmpDevice    = await rolloutSnmpAndSave(ip, logs, mac);
              return res.json({ ok: true, user: 'admin', log: logs.join('\n'), scriptResults, snmpDevice });
            }

            logs.push(`→ Fallback: Versuche mit gespeichertem Passwort (bereits gesetzt)…`);
            const r2 = await sx5Expect(newPass, true);
            logs.push(`  exit=${r2.exitCode}`);
            if (r2.out.trim()) logs.push('  stdout: ' + r2.out.trim());
            if (r2.err.trim()) logs.push('  stderr: ' + r2.err.trim());
            if (r2.exitCode === 0) {
              const scriptResults = await runRolloutScript(ip, os, 'admin', newPass);
              const snmpDevice    = await rolloutSnmpAndSave(ip, logs, mac);
              return res.json({ ok: true, user: 'admin', alreadySet: true, log: logs.join('\n'), scriptResults, snmpDevice });
            }

            return res.json({ ok: false, error: 'SSH-Login fehlgeschlagen', log: logs.join('\n') });
          }

          function expectSetPassword(user) {
            return new Promise((resolve) => {
              const esc = escapeExpect(newPass);
              const script = `
set timeout 20
spawn sshpass -p "" ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 ${user}@${ip}
expect {
  "New password:" {
    send "${esc}\\r"
    expect "Retype new password:"
    send "${esc}\\r"
    expect eof
    exit 0
  }
  "$ " {
    send "printf '%s\\n%s\\n' \\"${esc}\\" \\"${esc}\\" | passwd\\r"
    expect { "password updated" {} "successfully" {} eof {} }
    exit 0
  }
  "# " {
    send "printf '%s\\n%s\\n' \\"${esc}\\" \\"${esc}\\" | passwd\\r"
    expect { "password updated" {} "successfully" {} eof {} }
    exit 0
  }
  "Permission denied" { exit 1 }
  "password:"         { exit 1 }
  timeout             { exit 2 }
}
`;
              const proc = spawn('expect', ['-c', script], { stdio: ['ignore', 'pipe', 'pipe'] });
              let out = '', err = '';
              proc.stdout.on('data', d => out += d.toString());
              proc.stderr.on('data', d => err += d.toString());
              const timer = setTimeout(() => { proc.kill(); resolve({ exitCode: -1, out: out + '\n[Timeout]', err }); }, 25000);
              proc.on('close', code => { clearTimeout(timer); resolve({ exitCode: code, out, err }); });
              proc.on('error', e => { clearTimeout(timer); resolve({ exitCode: -1, out, err: e.message }); });
            });
          }

          // ── LCOS LX: nur root, sonst gleicher Ablauf wie LCOS ────────────────
          const users = os === 'LCOS LX' ? ['root'] : ['root', 'admin'];
          for (const user of users) {
            logs.push(`→ Versuche ${user}@${ip} mit leerem Passwort…`);
            const r = await expectSetPassword(user);
            logs.push(`  exit=${r.exitCode}`);
            if (r.out.trim()) logs.push('  stdout: ' + r.out.trim());
            if (r.err.trim()) logs.push('  stderr: ' + r.err.trim());

            if (r.exitCode === 0) {
              await new Promise(r => setTimeout(r, 1500));
              logs.push(`→ Führe "flash yes" aus (${user}@${ip})…`);
              const rf = await sshExec(ip, user, newPass, 'flash yes');
              logs.push(`  exit=${rf.exitCode}`);
              if (rf.stdout.trim()) logs.push('  stdout: ' + rf.stdout.trim());
              if (rf.stderr.trim()) logs.push('  stderr: ' + rf.stderr.trim());
              const scriptResults = await runRolloutScript(ip, os, user, newPass);
              const snmpDevice    = await rolloutSnmpAndSave(ip, logs, mac);
              return res.json({ ok: true, user, log: logs.join('\n'), scriptResults, snmpDevice });
            }

            logs.push(`→ Versuche ${user}@${ip} mit gespeichertem Passwort (flash yes)…`);
            const r2 = await sshExec(ip, user, newPass, 'flash yes');
            logs.push(`  exit=${r2.exitCode}`);
            if (r2.stdout.trim()) logs.push('  stdout: ' + r2.stdout.trim());
            if (r2.stderr.trim()) logs.push('  stderr: ' + r2.stderr.trim());
            if (r2.exitCode === 0) {
              const scriptResults = await runRolloutScript(ip, os, user, newPass);
              const snmpDevice    = await rolloutSnmpAndSave(ip, logs, mac);
              return res.json({ ok: true, user, alreadySet: true, log: logs.join('\n'), scriptResults, snmpDevice });
            }
          }

          res.json({ ok: false, error: 'SSH-Login fehlgeschlagen (root und admin)', log: logs.join('\n') });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/scripte/run', async (req, res) => {
    try {
      const { ip, user, pass, commands, os } = req.body;
      if (!ip || !user || !pass || !commands?.length)
        return res.status(400).json({ error: 'ip, user, pass, commands erforderlich' });
      const resolved = commands.map(c => resolvePlaceholders(c, readSettings()));
      const r = await sshFnForOs(os)(ip, user, pass, resolved);
      res.json({ results: [{ commands, ...r, combined: true }] });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // ── WiFi History ──────────────────────────────────────────────────────────
  app.post('/api/wifi-history/snapshot', (req, res) => {
    const devs = readDevices();
    const snap = takeSnapshot(devs);
    const apCount = Object.keys(snap.aps).length;
    const totalClients = Object.values(snap.aps).reduce((s, a) => s + a.clients, 0);
    res.json({ ok: true, ts: snap.ts, aps: apCount, clients: totalClients });
  });

  app.get('/api/wifi-history', (req, res) => {
    const hours = parseInt(req.query.hours) || 24;
    res.json(getWifiHistory(hours));
  });

  app.delete('/api/wifi-history', (req, res) => {
    clearWifiHistory();
    res.json({ ok: true });
  });

  // ── Topology Change Detection ─────────────────────────────────────────────
  app.post('/api/topo-changes/check', (req, res) => {
    const devs = readDevices();
    const isFirst = !hasTopoState();
    const newChanges = compareLldp(devs);
    res.json({ ok: true, isFirst, changes: newChanges.length, details: newChanges });
  });

  app.get('/api/topo-changes', (req, res) => {
    const hours = parseInt(req.query.hours) || 24;
    res.json(getTopoChanges(hours));
  });

  app.delete('/api/topo-changes', (req, res) => {
    clearTopoChanges();
    res.json({ ok: true });
  });

  // ── Roaming Tracker ───────────────────────────────────────────────────────
  app.post('/api/roaming/track', (req, res) => {
    rebuildFromSyslogEntries(getSyslogEntries());
    res.json({ ok: true, source: 'syslog', events24h: getRoamingEvents(24).length });
  });

  app.get('/api/roaming/events', (req, res) => {
    const hours = parseInt(req.query.hours) || 24;
    res.json(getRoamingEvents(hours));
  });

  app.get('/api/roaming/stats', (req, res) => {
    const hours = parseInt(req.query.hours) || 24;
    res.json(getRoamingStats(hours));
  });

  app.get('/api/roaming/client/:mac', (req, res) => {
    const hours = parseInt(req.query.hours) || 24;
    res.json(getRoamingClientHistory(req.params.mac, hours));
  });

  app.delete('/api/roaming', (req, res) => {
    clearRoamingEvents();
    res.json({ ok: true });
  });
}

module.exports = { registerRoutes };
