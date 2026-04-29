const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./config');
const { readSettings, readDevices } = require('./data');

const ALERT_LOG_FILE = path.join(DATA_DIR, 'alert-log.json');
const ALERT_LOG_MAX  = 500;
const MONITOR_BATCH  = 20;

let alertLog = [];
try { alertLog = JSON.parse(fs.readFileSync(ALERT_LOG_FILE, 'utf8')); } catch {}

// ── Persist ──────────────────────────────────────────────────────────────────

let _saveTimer = null;
function persistAlertLog() {
  if (_saveTimer) return;
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    try { fs.writeFileSync(ALERT_LOG_FILE, JSON.stringify(alertLog)); }
    catch (e) { console.error('[Alerts] Speichern fehlgeschlagen:', e.message); }
  }, 2000);
}
function flushAlertLogSync() {
  try { fs.writeFileSync(ALERT_LOG_FILE, JSON.stringify(alertLog)); } catch {}
}

// ── Cooldown ─────────────────────────────────────────────────────────────────

const _cooldowns = {};
function shouldFire(key, cooldownSec) {
  const now = Date.now();
  if (_cooldowns[key] && (now - _cooldowns[key]) < cooldownSec * 1000) return false;
  _cooldowns[key] = now;
  return true;
}

// ── Alert builder ────────────────────────────────────────────────────────────

function buildAlert(type, ctx) {
  switch (type) {
    case 'offline':
      return {
        title: `${ctx.name || ctx.ip} offline`,
        message: `Gerät ${ctx.name || ''} (${ctx.ip})${ctx.os ? ' · ' + ctx.os : ''} ist nicht mehr erreichbar.`,
        severity: 'critical',
        device: { ip: ctx.ip, name: ctx.name, os: ctx.os },
      };
    case 'online':
      return {
        title: `${ctx.name || ctx.ip} wieder online`,
        message: `Gerät ${ctx.name || ''} (${ctx.ip}) ist wieder erreichbar.`,
        severity: 'ok',
        device: { ip: ctx.ip, name: ctx.name, os: ctx.os },
      };
    case 'trap':
      return {
        title: `Trap: ${ctx.trapName || 'unbekannt'} von ${ctx.from}`,
        message: `SNMP Trap von ${ctx.from}: ${ctx.trapName || ctx.trapOid || 'unbekannt'}`,
        severity: ['coldStart', 'warmStart', 'linkDown', 'authenticationFailure'].includes(ctx.trapName) ? 'warning' : 'info',
        device: { ip: ctx.from },
      };
    case 'loop':
      return {
        title: `Loop: ${ctx.name || ctx.ip}`,
        message: `Loop-Gefahr auf ${ctx.name || ctx.ip}: ${ctx.detail || ''}`,
        severity: 'critical',
        device: { ip: ctx.ip, name: ctx.name },
      };
    case 'temperature':
      return {
        title: `Temperatur: ${ctx.name || ctx.ip} ${ctx.temp}°C`,
        message: `Temperatur auf ${ctx.name || ctx.ip}: ${ctx.temp}°C (Schwellwert: ${ctx.threshold}°C)`,
        severity: 'warning',
        device: { ip: ctx.ip, name: ctx.name },
      };
    case 'test':
      return {
        title: 'OnSite Testalarm',
        message: 'Dies ist ein Test-Alert. Wenn Sie diese Nachricht sehen, funktioniert der Kanal.',
        severity: 'info',
      };
    default:
      return { title: `Alert: ${type}`, message: JSON.stringify(ctx), severity: 'info' };
  }
}

// ── Webhook ──────────────────────────────────────────────────────────────────

function formatWebhookBody(alert, whType) {
  const ts = new Date().toLocaleString('de-DE');
  switch (whType) {
    case 'teams':
      return {
        '@type': 'MessageCard', '@context': 'http://schema.org/extensions',
        themeColor: alert.severity === 'critical' ? 'FF0000' : alert.severity === 'warning' ? 'FFA500' : '00CC00',
        summary: alert.title,
        sections: [{ activityTitle: `OnSite: ${alert.title}`, text: alert.message, facts: [{ name: 'Zeit', value: ts }] }],
      };
    case 'slack':
      return {
        text: `*OnSite: ${alert.title}*`,
        attachments: [{
          color: alert.severity === 'critical' ? '#ff0000' : alert.severity === 'warning' ? '#ffa500' : '#00cc00',
          text: alert.message, footer: `OnSite · ${ts}`,
        }],
      };
    default:
      return {
        source: 'OnSite', title: alert.title, message: alert.message,
        severity: alert.severity, timestamp: new Date().toISOString(),
        device: alert.device || null,
      };
  }
}

async function sendWebhook(alert, cfg) {
  if (!cfg?.enabled || !cfg.url) return null;
  try {
    const resp = await fetch(cfg.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formatWebhookBody(alert, cfg.type || 'generic')),
      signal: AbortSignal.timeout(10000),
    });
    return { ok: resp.ok, status: resp.status };
  } catch (e) {
    console.error('[Alerts] Webhook fehlgeschlagen:', e.message);
    return { ok: false, error: e.message };
  }
}

// ── E-Mail ───────────────────────────────────────────────────────────────────

async function sendEmail(alert, cfg) {
  if (!cfg?.enabled || !cfg.host || !cfg.to) return null;
  try {
    const nodemailer = require('nodemailer');
    const transport = nodemailer.createTransport({
      host: cfg.host, port: cfg.port || 587, secure: !!cfg.secure,
      ...(cfg.user ? { auth: { user: cfg.user, pass: cfg.pass || '' } } : {}),
      tls: { rejectUnauthorized: false },
    });
    const ts = new Date().toLocaleString('de-DE');
    const sevColor = { critical: '#e74c3c', warning: '#f39c12', ok: '#27ae60', info: '#3498db' }[alert.severity] || '#888';
    await transport.sendMail({
      from: cfg.from || `OnSite <${cfg.user || 'onsite@localhost'}>`,
      to: cfg.to,
      subject: `[OnSite] ${alert.title}`,
      text: `${alert.title}\n\n${alert.message}\n\nZeit: ${ts}`,
      html: [
        '<div style="font-family:sans-serif;max-width:500px">',
        `<div style="background:${sevColor};color:#fff;padding:12px 16px;border-radius:6px 6px 0 0;font-weight:bold">${alert.title}</div>`,
        '<div style="padding:16px;border:1px solid #ddd;border-top:none;border-radius:0 0 6px 6px">',
        `<p>${alert.message}</p>`,
        `<p style="color:#888;font-size:12px;margin-top:16px">${ts} · OnSite</p>`,
        '</div></div>',
      ].join(''),
    });
    return { ok: true };
  } catch (e) {
    console.error('[Alerts] E-Mail fehlgeschlagen:', e.message);
    return { ok: false, error: e.message };
  }
}

// ── Telegram ─────────────────────────────────────────────────────────────────

function formatTelegramText(alert) {
  const icon = { critical: '🔴', warning: '🟡', ok: '🟢', info: 'ℹ️' }[alert.severity] || '📢';
  const lines = [
    `${icon} <b>${escapeHtml(alert.title)}</b>`,
    '',
    escapeHtml(alert.message),
  ];
  if (alert.device?.ip) lines.push(`\n🖥 <code>${alert.device.ip}</code>`);
  lines.push(`\n🕐 ${new Date().toLocaleString('de-DE')}`);
  return lines.join('\n');
}

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function sendTelegram(alert, cfg) {
  if (!cfg?.enabled || !cfg.botToken || !cfg.chatId) return null;
  try {
    const url = `https://api.telegram.org/bot${cfg.botToken.trim()}/sendMessage`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: cfg.chatId.trim(),
        text: formatTelegramText(alert),
        parse_mode: 'HTML',
        disable_notification: !!cfg.silent,
      }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await resp.json();
    if (!data.ok) return { ok: false, error: data.description || 'Telegram API error' };
    return { ok: true };
  } catch (e) {
    console.error('[Alerts] Telegram fehlgeschlagen:', e.message);
    return { ok: false, error: e.message };
  }
}

// ── Fire alert ───────────────────────────────────────────────────────────────

async function fireAlert(type, context) {
  const s = readSettings();
  if (!s.alertsEnabled) return;
  const rules = s.alertRules || {};

  if (type === 'offline'     && !rules.offline) return;
  if (type === 'online'      && !rules.online)  return;
  if (type === 'trap'        && !rules.trap)    return;
  if (type === 'loop'        && !rules.loop)    return;
  if (type === 'temperature' && (!rules.tempThreshold || context.temp < rules.tempThreshold)) return;

  const key = `${type}:${context.ip || context.from || 'global'}`;
  if (!shouldFire(key, s.alertCooldownSec || 300)) return;

  const alert = buildAlert(type, context);
  const entry = { ts: new Date().toISOString(), type, ...alert, channels: [] };

  const results = await Promise.allSettled([
    sendEmail(alert, s.alertEmail),
    sendWebhook(alert, s.alertWebhook),
    sendTelegram(alert, s.alertTelegram),
  ]);
  if (results[0].value?.ok) entry.channels.push('email');
  if (results[1].value?.ok) entry.channels.push('webhook');
  if (results[2].value?.ok) entry.channels.push('telegram');

  alertLog.unshift(entry);
  if (alertLog.length > ALERT_LOG_MAX) alertLog.length = ALERT_LOG_MAX;
  persistAlertLog();
  console.log(`[Alert] ${type}: ${alert.title} → [${entry.channels.join(', ') || 'kein Kanal aktiv'}]`);
}

// ── Trap hook ────────────────────────────────────────────────────────────────

function onTrapReceived(entry) {
  const s = readSettings();
  if (!s.alertsEnabled || !s.alertRules?.trap) return;
  if (s.alertRules.trapFilter) {
    const f = s.alertRules.trapFilter.toLowerCase();
    const name = (entry.trapName || '').toLowerCase();
    if (!name.includes(f) && !(entry.trapOid || '').includes(f)) return;
  }
  fireAlert('trap', entry);
}

// ── Server-side status monitor ───────────────────────────────────────────────

let _monitorTimer = null;
const _prevOnline = {};

function startMonitoring() {
  stopMonitoring();
  const s = readSettings();
  if (!s.alertsEnabled) return;
  const mins = s.alertMonitorIntervalMin || 5;
  const devs = readDevices();
  for (const [ip, d] of Object.entries(devs)) {
    if (!(ip in _prevOnline)) _prevOnline[ip] = d.online !== false;
  }
  _monitorTimer = setInterval(monitorCheck, mins * 60000);
  console.log(`[Alerts] Monitoring gestartet (${mins} Min, ${Object.keys(devs).length} Geräte)`);
}

function stopMonitoring() {
  if (_monitorTimer) { clearInterval(_monitorTimer); _monitorTimer = null; }
}

function restartMonitoring() { stopMonitoring(); startMonitoring(); }

async function monitorCheck() {
  const { runSnmpGet } = require('./snmp-session');
  const s = readSettings();
  if (!s.alertsEnabled) return;

  const devs = readDevices();
  const community = s.snmpReadCommunity || 'public';
  const version   = s.snmpVersion       || '2c';
  const ips = Object.keys(devs);

  for (let i = 0; i < ips.length; i += MONITOR_BATCH) {
    const batch = ips.slice(i, i + MONITOR_BATCH);
    await Promise.all(batch.map(async ip => {
      const d = devs[ip];
      let online = false;
      try {
        const out = await runSnmpGet(ip, community, version, ['1.3.6.1.2.1.1.5.0'], 3000);
        online = !!out.trim();
      } catch {}

      const wasOnline = _prevOnline[ip] !== false;
      if (wasOnline && !online)
        await fireAlert('offline', { ip, name: d.sysName || d.name || ip, os: d.os });
      else if (!wasOnline && online)
        await fireAlert('online',  { ip, name: d.sysName || d.name || ip, os: d.os });

      _prevOnline[ip] = online;
    }));
  }
}

// ── Test ─────────────────────────────────────────────────────────────────────

async function testAlertChannel(channel) {
  const s = readSettings();
  const alert = buildAlert('test', {});
  if (channel === 'email')    return await sendEmail(alert, s.alertEmail);
  if (channel === 'webhook')  return await sendWebhook(alert, s.alertWebhook);
  if (channel === 'telegram') return await sendTelegram(alert, s.alertTelegram);
  return { ok: false, error: 'Unbekannter Kanal' };
}

module.exports = {
  alertLog,
  fireAlert,
  onTrapReceived,
  testAlertChannel,
  startMonitoring,
  stopMonitoring,
  restartMonitoring,
  flushAlertLogSync,
};
