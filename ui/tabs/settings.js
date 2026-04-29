import S from '../lib/state.js';
import { q, h, FILTER_OS_OPTS, FILTER_TYPE_OPTS } from '../lib/helpers.js';

export function toggleCfgDevicePasswordVisible() {
  const inp = q('cfg-device-password');
  const btn = q('cfg-device-password-toggle');
  if (!inp || !btn) return;
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  btn.textContent = show ? 'Verbergen' : 'Anzeigen';
}

export function showCfgTab(name) {
  ['snmp','import','rssi','license','devpw','monitoring','alerts','scheduler','ai','grundwerte','traffic'].forEach(t => {
    const tab = q('cfgtab-'+t); if (tab) tab.classList.toggle('active', t===name);
    const panel = q('cfgpanel-'+t); if (panel) { panel.classList.toggle('active', t===name); panel.style.display = t===name ? '' : 'none'; }
  });
  if (name === 'license') loadLicense();
}

// ── Lizenz ────────────────────────────────────────────────────────────────────

export function renderLicenseStatus(lic) {
  const badge   = q('license-badge');
  const cust    = q('license-customer');
  const details = q('license-details');
  const box     = q('license-status-box');

  const cfg = {
    active:        { label:'Aktiv',            bg:'var(--green)',  text:'#fff' },
    trial:         { label:'Trial',            bg:'var(--yellow)', text:'#1a1a00' },
    trial_expired: { label:'Trial abgelaufen', bg:'var(--red)',    text:'#fff' },
    expired:       { label:'Abgelaufen',       bg:'var(--red)',    text:'#fff' },
    invalid:       { label:'Ungültig',         bg:'var(--red)',    text:'#fff' },
    none:          { label:'Keine Lizenz',     bg:'var(--border)', text:'var(--text2)' },
  }[lic.status] || { label: lic.status, bg:'var(--border)', text:'var(--text1)' };

  // Header-Tag
  const htag = q('license-header-tag');
  if (htag) {
    htag.dataset.status  = lic.status;
    const headerLabel = {
      active:        `Lizenz · ${lic.daysLeft}d`,
      trial:         `Trial · ${lic.minutesLeft}min`,
      trial_expired: 'Trial abgelaufen',
      expired:       'Lizenz abgelaufen',
      invalid:       'Lizenz ungültig',
      none:          'Keine Lizenz',
    }[lic.status] || cfg.label;
    htag.textContent = headerLabel;
    htag.title = lic.status === 'active'
      ? `Lizenziert: ${lic.customer} · gültig bis ${lic.expiresAt}`
      : (lic.message || '');
  }

  if (!badge) return;
  badge.textContent        = cfg.label;
  badge.style.background   = cfg.bg;
  badge.style.color        = cfg.text;
  box.style.borderColor    = cfg.bg;

  if (lic.status === 'active') {
    cust.textContent = lic.customer;
    details.innerHTML = `
      <span>E-Mail: ${lic.email}</span>
      <span>Ausgestellt: ${lic.issuedAt}</span>
      <span>Gültig bis: <strong>${lic.expiresAt}</strong> (noch ${lic.daysLeft} Tag${lic.daysLeft!==1?'e':''})</span>`;
  } else if (lic.status === 'trial') {
    cust.textContent = 'Testversion';
    details.innerHTML = `<span>${lic.message}</span><span>Trial-Start: ${new Date(lic.trialStart).toLocaleString('de-DE')}</span>`;
  } else {
    cust.textContent = '';
    details.innerHTML = `<span>${lic.message || ''}</span>`;
  }

  // Lizenz-Wall anzeigen/verstecken
  const wall = q('license-wall');
  const locked = lic.status !== 'active' && lic.status !== 'trial';
  if (wall) {
    wall.style.display = locked ? 'flex' : 'none';
    if (locked) {
      const lwStatus = q('lw-status');
      if (lwStatus) {
        lwStatus.textContent = cfg.label;
        lwStatus.style.background = cfg.bg;
        lwStatus.style.color = cfg.text;
      }
    }
  }
}

export async function loadLicense() {
  try {
    const r = await fetch('/api/license');
    renderLicenseStatus(await r.json());
  } catch {}
}

export function licenseDragOver(e, wall=false) {
  e.preventDefault();
  q(wall ? 'lw-drop' : 'license-drop').classList.add('drag-over');
}
export function licenseDragLeave(wall=false) {
  q(wall ? 'lw-drop' : 'license-drop').classList.remove('drag-over');
}
export function licenseDrop(e, wall=false) {
  e.preventDefault();
  q(wall ? 'lw-drop' : 'license-drop').classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) readLicenseFile(file, wall);
}
export function licenseFileSelected(e, wall=false) {
  const file = e.target.files[0];
  if (file) readLicenseFile(file, wall);
}
export function readLicenseFile(file, wall=false) {
  const reader = new FileReader();
  reader.onload = (ev) => {
    q(wall ? 'lw-input' : 'license-input').value = ev.target.result;
    q(wall ? 'lw-drop-text' : 'license-drop-text').textContent = `📄 ${file.name}`;
  };
  reader.readAsText(file);
}

export async function activateLicense(wall=false) {
  const input = q(wall ? 'lw-input' : 'license-input').value.trim();
  const msg   = q(wall ? 'lw-msg' : 'license-msg');
  if (!input) return;
  try {
    const lic = JSON.parse(input);
    const r   = await fetch('/api/license', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(lic) });
    const data = await r.json();
    renderLicenseStatus(data);
    msg.style.color   = data.status === 'active' ? 'var(--green)' : 'var(--red)';
    msg.textContent   = data.status === 'active' ? '✓ Lizenz erfolgreich aktiviert' : ('Fehler: ' + (data.message || 'Unbekannt'));
    msg.style.display = '';
    if (data.status === 'active') q(wall ? 'lw-input' : 'license-input').value = '';
  } catch {
    msg.style.color = 'var(--red)';
    msg.textContent = 'Fehler: Ungültiges JSON-Format';
    msg.style.display = '';
  }
  setTimeout(() => { msg.style.display = 'none'; }, 4000);
}

export async function removeLicense() {
  await fetch('/api/license', { method:'DELETE' });
  await loadLicense();
}

export function onSnmpVersionChange() {
  const v = q('cfg-snmp-version').value;
  const v3 = v === '3';
  const v12 = v === '2c';
  const elV2 = q('cfg-snmpv2-section');
  const elV3 = q('cfg-v3-section');
  if (elV3) elV3.style.display = v3 ? '' : 'none';
  if (elV2) elV2.style.display = v12 ? '' : 'none';
  if (v3) onV3LevelChange();
}
export function onV3LevelChange() {
  const lvl = q('cfg-v3-seclevel').value;
  q('cfg-v3-auth-block').style.display = (lvl === 'authNoPriv' || lvl === 'authPriv') ? '' : 'none';
  q('cfg-v3-priv-block').style.display = (lvl === 'authPriv') ? '' : 'none';
}

export async function loadSettings() {
  try {
    const r = await fetch('/api/settings'); S.appSettings = await r.json();
  } catch { S.appSettings = { snmpReadCommunity:'public', snmpWriteCommunity:'private', snmpVersion:'2c', rssiGreen:80, rssiYellow:50, rssiOrange:0 }; }
  q('cfg-snmp-read').value    = S.appSettings.snmpReadCommunity  || 'public';
  q('cfg-snmp-write').value   = S.appSettings.snmpWriteCommunity || 'private';
  {
    let sv = S.appSettings.snmpVersion || '2c';
    if (sv === '1') sv = '2c'; // frühere SNMPv1-Option entfernt
    q('cfg-snmp-version').value = sv;
  }
  q('cfg-rssi-green').value   = S.appSettings.rssiGreen  ?? 80;
  q('cfg-rssi-yellow').value  = S.appSettings.rssiYellow ?? 50;
  q('cfg-rssi-orange').value  = S.appSettings.rssiOrange ?? 0;
  // SNMPv3
  q('cfg-v3-secname').value   = S.appSettings.snmpV3SecurityName  || '';
  q('cfg-v3-seclevel').value  = S.appSettings.snmpV3SecurityLevel || 'authPriv';
  q('cfg-v3-authproto').value = S.appSettings.snmpV3AuthProtocol  || 'SHA';
  q('cfg-v3-authpass').value  = S.appSettings.snmpV3AuthPassword  || '';
  q('cfg-v3-privproto').value = S.appSettings.snmpV3PrivProtocol  || 'AES';
  q('cfg-v3-privpass').value  = S.appSettings.snmpV3PrivPassword  || '';
  // Import-Filter
  const _fOS   = S.appSettings.filterOS   || [];
  const _fType = S.appSettings.filterType || [];
  FILTER_OS_OPTS.forEach((v,i)   => { const el=q(`cfg-os-${i}`);   if(el) el.checked=_fOS.includes(v); });
  FILTER_TYPE_OPTS.forEach((v,i) => { const el=q(`cfg-type-${i}`); if(el) el.checked=_fType.includes(v); });
  onSnmpVersionChange();
  if (q('lmc-host')) q('lmc-host').value = S.appSettings.lmcHost || 'cloud.lancom.de';
  if (S.appSettings.lastScanSubnet) q('scan-subnet').value = S.appSettings.lastScanSubnet;
  if (S.appSettings.lastRolloutSubnet) q('rollout-subnet').value = S.appSettings.lastRolloutSubnet;
  {
    const dp = q('cfg-device-password');
    if (dp) {
      dp.type = 'password';
      const tgl = q('cfg-device-password-toggle');
      if (tgl) tgl.textContent = 'Anzeigen';
    }
  }
  if (S.appSettings.devicePassword) {
    q('cfg-device-password').value = S.appSettings.devicePassword;
    const rp = q('script-run-pass'); if (rp) rp.value = S.appSettings.devicePassword;
  }
  const autoSync = q('cfg-auto-sync'); if (autoSync) autoSync.value = S.appSettings.autoSyncMinutes || 0;
  const priceEl = q('cfg-power-price'); if (priceEl) priceEl.value = S.appSettings.powerPricePerKwh ?? 0.30;
  const notifyEl = q('cfg-notify-offline'); if (notifyEl) notifyEl.checked = !!S.appSettings.notifyOffline;
  setAutoSync(parseInt(S.appSettings.autoSyncMinutes) || 0);
  const permEl = q('notify-perm-status');
  if (permEl) {
    if (!('Notification' in window) || (location.protocol !== 'https:' && location.hostname !== 'localhost')) {
      permEl.textContent = '⚠ Nur über HTTPS verfügbar';
      permEl.style.color = 'var(--text3)';
      const btn = permEl.previousElementSibling;
      if (btn) btn.style.display = 'none';
    } else {
      permEl.textContent = Notification.permission === 'granted' ? '✓ Erlaubt' : '';
    }
  }
  // Alert settings
  const a = S.appSettings;
  const ae = a.alertEmail || {}, aw = a.alertWebhook || {}, at = a.alertTelegram || {}, ar = a.alertRules || {};
  const aEl = id => q(id);
  if (aEl('cfg-alerts-enabled'))     aEl('cfg-alerts-enabled').checked = !!a.alertsEnabled;
  if (aEl('cfg-alert-interval'))     aEl('cfg-alert-interval').value   = a.alertMonitorIntervalMin || 5;
  if (aEl('cfg-alert-cooldown'))     aEl('cfg-alert-cooldown').value   = a.alertCooldownSec || 300;
  if (aEl('cfg-alert-email-on'))     aEl('cfg-alert-email-on').checked = !!ae.enabled;
  if (aEl('cfg-alert-email-host'))   aEl('cfg-alert-email-host').value = ae.host || '';
  if (aEl('cfg-alert-email-port'))   aEl('cfg-alert-email-port').value = ae.port || 587;
  if (aEl('cfg-alert-email-secure')) aEl('cfg-alert-email-secure').checked = !!ae.secure;
  if (aEl('cfg-alert-email-user'))   aEl('cfg-alert-email-user').value = ae.user || '';
  if (aEl('cfg-alert-email-pass'))   aEl('cfg-alert-email-pass').value = ae.pass || '';
  if (aEl('cfg-alert-email-from'))   aEl('cfg-alert-email-from').value = ae.from || '';
  if (aEl('cfg-alert-email-to'))     aEl('cfg-alert-email-to').value   = ae.to   || '';
  if (aEl('cfg-alert-wh-on'))       aEl('cfg-alert-wh-on').checked    = !!aw.enabled;
  if (aEl('cfg-alert-wh-url'))      aEl('cfg-alert-wh-url').value     = aw.url  || '';
  if (aEl('cfg-alert-wh-type'))     aEl('cfg-alert-wh-type').value    = aw.type || 'generic';
  if (aEl('cfg-alert-tg-on'))       aEl('cfg-alert-tg-on').checked    = !!at.enabled;
  if (aEl('cfg-alert-tg-token'))    aEl('cfg-alert-tg-token').value   = at.botToken || '';
  if (aEl('cfg-alert-tg-chatid'))   aEl('cfg-alert-tg-chatid').value  = at.chatId   || '';
  if (aEl('cfg-alert-tg-silent'))   aEl('cfg-alert-tg-silent').checked = !!at.silent;
  if (aEl('cfg-alert-r-offline'))    aEl('cfg-alert-r-offline').checked = ar.offline !== false;
  if (aEl('cfg-alert-r-online'))     aEl('cfg-alert-r-online').checked  = ar.online  !== false;
  if (aEl('cfg-alert-r-trap'))       aEl('cfg-alert-r-trap').checked    = !!ar.trap;
  if (aEl('cfg-alert-r-trapfilter')) aEl('cfg-alert-r-trapfilter').value = ar.trapFilter || '';
  if (aEl('cfg-alert-r-loop'))       aEl('cfg-alert-r-loop').checked    = ar.loop !== false;
  if (aEl('cfg-alert-r-temp'))       aEl('cfg-alert-r-temp').checked    = !!ar.tempThreshold;
  if (aEl('cfg-alert-r-tempval'))    aEl('cfg-alert-r-tempval').value   = ar.tempThreshold || 65;
  // AI settings
  if (aEl('cfg-ai-provider')) aEl('cfg-ai-provider').value = a.aiProvider || 'openai';
  if (aEl('cfg-ai-endpoint')) aEl('cfg-ai-endpoint').value = a.aiEndpoint || '';
  if (aEl('cfg-ai-key'))     aEl('cfg-ai-key').value     = a.aiApiKey   || '';
  if (aEl('cfg-ai-model'))   aEl('cfg-ai-model').value   = a.aiModel    || '';
  onAiProviderChange();
  // Scheduler
  if (aEl('cfg-sched-hours'))    aEl('cfg-sched-hours').value   = a.scheduledScanHours || 0;
  if (aEl('cfg-sched-subnet'))   aEl('cfg-sched-subnet').value  = a.scheduledScanSubnet || a.lastScanSubnet || '';
  if (aEl('cfg-sched-autosave')) aEl('cfg-sched-autosave').checked = !!a.scheduledAutoSave;
  // Traffic settings
  if (aEl('cfg-traffic-interval'))        aEl('cfg-traffic-interval').value        = a.trafficPollInterval || 60;
  if (aEl('cfg-traffic-history-enabled')) aEl('cfg-traffic-history-enabled').checked = a.trafficHistoryEnabled !== false;
  if (aEl('cfg-traffic-retention'))       aEl('cfg-traffic-retention').value       = a.trafficRetentionHours || 24;
  if (aEl('cfg-traffic-autostart'))       aEl('cfg-traffic-autostart').checked     = !!a.trafficAutoStart;
  if (aEl('cfg-traffic-warn'))            aEl('cfg-traffic-warn').value            = a.trafficWarnThreshold || 80;
}

export async function saveSettings() {
  S.appSettings = {
    ...S.appSettings,
    snmpReadCommunity:  q('cfg-snmp-read').value.trim(),
    snmpWriteCommunity: q('cfg-snmp-write').value.trim(),
    snmpVersion:        q('cfg-snmp-version').value,
    rssiGreen:  parseInt(q('cfg-rssi-green').value)  || 80,
    rssiYellow: parseInt(q('cfg-rssi-yellow').value) || 50,
    rssiOrange: parseInt(q('cfg-rssi-orange').value) || 0,
    snmpV3SecurityName:  q('cfg-v3-secname').value.trim(),
    snmpV3SecurityLevel: q('cfg-v3-seclevel').value,
    snmpV3AuthProtocol:  q('cfg-v3-authproto').value,
    snmpV3AuthPassword:  q('cfg-v3-authpass').value,
    snmpV3PrivProtocol:  q('cfg-v3-privproto').value,
    snmpV3PrivPassword:  q('cfg-v3-privpass').value,
    filterOS:       FILTER_OS_OPTS.filter((_,i)   => q(`cfg-os-${i}`)?.checked),
    filterType:     FILTER_TYPE_OPTS.filter((_,i) => q(`cfg-type-${i}`)?.checked),
    devicePassword:   q('cfg-device-password').value,
    autoSyncMinutes:  parseInt(q('cfg-auto-sync')?.value) || 0,
    notifyOffline:    q('cfg-notify-offline')?.checked || false,
    powerPricePerKwh: parseFloat(q('cfg-power-price')?.value) || 0.30,
    alertsEnabled:          q('cfg-alerts-enabled')?.checked || false,
    alertMonitorIntervalMin: parseInt(q('cfg-alert-interval')?.value) || 5,
    alertCooldownSec:       parseInt(q('cfg-alert-cooldown')?.value) || 300,
    alertEmail: {
      enabled: q('cfg-alert-email-on')?.checked || false,
      host: q('cfg-alert-email-host')?.value?.trim() || '',
      port: parseInt(q('cfg-alert-email-port')?.value) || 587,
      secure: q('cfg-alert-email-secure')?.checked || false,
      user: q('cfg-alert-email-user')?.value?.trim() || '',
      pass: q('cfg-alert-email-pass')?.value || '',
      from: q('cfg-alert-email-from')?.value?.trim() || '',
      to:   q('cfg-alert-email-to')?.value?.trim()   || '',
    },
    alertWebhook: {
      enabled: q('cfg-alert-wh-on')?.checked || false,
      url:  q('cfg-alert-wh-url')?.value?.trim() || '',
      type: q('cfg-alert-wh-type')?.value || 'generic',
    },
    alertTelegram: {
      enabled:  q('cfg-alert-tg-on')?.checked || false,
      botToken: q('cfg-alert-tg-token')?.value?.trim() || '',
      chatId:   q('cfg-alert-tg-chatid')?.value?.trim() || '',
      silent:   q('cfg-alert-tg-silent')?.checked || false,
    },
    alertRules: {
      offline:       q('cfg-alert-r-offline')?.checked || false,
      online:        q('cfg-alert-r-online')?.checked  || false,
      trap:          q('cfg-alert-r-trap')?.checked    || false,
      trapFilter:    q('cfg-alert-r-trapfilter')?.value?.trim() || '',
      loop:          q('cfg-alert-r-loop')?.checked    || false,
      tempThreshold: q('cfg-alert-r-temp')?.checked ? (parseInt(q('cfg-alert-r-tempval')?.value) || 65) : 0,
    },
    scheduledScanHours:  parseInt(q('cfg-sched-hours')?.value) || 0,
    scheduledScanSubnet: q('cfg-sched-subnet')?.value?.trim() || '',
    scheduledAutoSave:   q('cfg-sched-autosave')?.checked || false,
    aiProvider: q('cfg-ai-provider')?.value || 'openai',
    aiEndpoint: q('cfg-ai-endpoint')?.value?.trim() || '',
    aiApiKey:   q('cfg-ai-key')?.value || '',
    aiModel:    q('cfg-ai-model')?.value?.trim() || '',
    trafficPollInterval:    parseInt(q('cfg-traffic-interval')?.value) || 60,
    trafficHistoryEnabled:  q('cfg-traffic-history-enabled')?.checked !== false,
    trafficRetentionHours:  parseInt(q('cfg-traffic-retention')?.value) || 24,
    trafficAutoStart:       q('cfg-traffic-autostart')?.checked || false,
    trafficWarnThreshold:   parseInt(q('cfg-traffic-warn')?.value) || 80,
  };
  setAutoSync(S.appSettings.autoSyncMinutes || 0);
  await fetch('/api/settings',{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(S.appSettings) });
  const lbl = q('settings-save-lbl');
  lbl.style.display=''; setTimeout(()=>{ lbl.style.display='none'; }, 2500);
  window.renderMesh?.();
  window.renderL2tp?.();
}

// ── Auto-Sync ──────────────────────────────────────────────────────────────────
let _autoSyncTimer = null;
let _checkAllDeviceStatus = async () => {};
export function registerAutoSyncHandlers(check) {
  _checkAllDeviceStatus = check || _checkAllDeviceStatus;
}

export function setAutoSync(minutes) {
  if (_autoSyncTimer) { clearInterval(_autoSyncTimer); _autoSyncTimer = null; }
  if (minutes > 0) _autoSyncTimer = setInterval(autoSyncRun, minutes * 60000);
}
async function autoSyncRun() {
  const prevStates = Object.fromEntries(Object.entries(S.deviceStore).map(([ip,d]) => [ip, d.online]));
  await _checkAllDeviceStatus();
  for (const [ip, d] of Object.entries(S.deviceStore)) {
    if (prevStates[ip] !== false && d.online === false) notifyOffline(d);
  }
}

// ── Desktop-Benachrichtigungen ─────────────────────────────────────────────────
function notifyOffline(dev) {
  if (!S.appSettings.notifyOffline) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  new Notification(`OnSite: ${dev.name||dev.ip} offline`, { body: `IP: ${dev.ip}${dev.os?' · '+dev.os:''}`, tag: `offline-${dev.ip}` });
}

// ── Alert-Tests & Log ────────────────────────────────────────────────────────

async function _testChannel(channel, msgId) {
  const msg = q(msgId); if (!msg) return;
  msg.textContent = 'Sende…'; msg.style.color = 'var(--text2)'; msg.style.display = '';
  try {
    const r = await fetch('/api/alert-test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel }) });
    const d = await r.json();
    msg.textContent = d.ok ? '✓ Gesendet' : `✗ ${d.error || 'Fehler'}`;
    msg.style.color = d.ok ? 'var(--green)' : 'var(--red)';
  } catch (e) {
    msg.textContent = `✗ ${e.message}`; msg.style.color = 'var(--red)';
  }
  setTimeout(() => { msg.style.display = 'none'; }, 5000);
}
export function testAlertEmail()    { _testChannel('email',    'alert-email-msg'); }
export function testAlertWebhook()  { _testChannel('webhook',  'alert-wh-msg'); }
export function testAlertTelegram() { _testChannel('telegram', 'alert-tg-msg'); }

export async function loadAlertLog() {
  const box = q('alert-log-box'); if (!box) return;
  try {
    const r = await fetch('/api/alert-log');
    const log = await r.json();
    const cnt = q('alert-log-count'); if (cnt) cnt.textContent = `${log.length} Einträge`;
    if (!log.length) { box.innerHTML = '<div style="color:var(--text3);padding:8px 0">Keine Alerts vorhanden</div>'; return; }
    const sevStyle = { critical: 'color:#e74c3c', warning: 'color:#f39c12', ok: 'color:#27ae60', info: 'color:#3498db' };
    box.innerHTML = log.slice(0, 100).map(e => {
      const ts = new Date(e.ts).toLocaleString('de-DE');
      const ch = e.channels?.length ? e.channels.join(', ') : '–';
      const sev = sevStyle[e.severity] || '';
      return `<div style="padding:4px 0;border-bottom:1px solid var(--border);display:flex;gap:10px;align-items:baseline"><span style="color:var(--text3);min-width:130px">${ts}</span><span style="font-weight:600;min-width:60px;${sev}">${e.type}</span><span style="flex:1">${e.title || ''}</span><span style="color:var(--text3)">${ch}</span></div>`;
    }).join('');
  } catch { box.innerHTML = '<div style="color:var(--red)">Fehler beim Laden</div>'; }
}

export async function clearAlertLog() {
  await fetch('/api/alert-log', { method: 'DELETE' });
  const box = q('alert-log-box'); if (box) box.innerHTML = '<div style="color:var(--text3);padding:8px 0">Keine Alerts vorhanden</div>';
  const cnt = q('alert-log-count'); if (cnt) cnt.textContent = '0 Einträge';
}

// ── KI-Anbieter-Voreinstellungen ─────────────────────────────────────────────

const AI_PRESETS = {
  gemini:    { endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.0-flash' },
  groq:      { endpoint: 'https://api.groq.com/openai/v1',                         model: 'llama-3.3-70b-versatile' },
  ollama:    { endpoint: 'http://localhost:11434/v1',                               model: 'llama3.2' },
  openai:    { endpoint: 'https://api.openai.com/v1',                               model: 'gpt-4o-mini' },
  anthropic: { endpoint: '',                                                        model: 'claude-sonnet-4-20250514' },
};
export function onAiProviderChange() {
  const prov = q('cfg-ai-provider')?.value || 'gemini';
  const preset = AI_PRESETS[prov] || AI_PRESETS.gemini;
  const ep = q('cfg-ai-endpoint'), md = q('cfg-ai-model'), ky = q('cfg-ai-key');
  if (ep) ep.placeholder = preset.endpoint || '';
  if (md) md.placeholder = preset.model;
  if (ky) ky.placeholder = prov === 'ollama' ? '(nicht nötig)' : 'API-Key eingeben';
}

export async function runSchedulerNow() {
  const st = q('sched-status');
  if (st) { st.textContent = 'Scan läuft…'; st.style.color = 'var(--accent)'; }
  try {
    const r = await fetch('/api/scheduler/run', { method: 'POST' });
    const data = await r.json();
    if (data.error) throw new Error(data.error);
    const wrap = q('sched-last-result'), info = q('sched-last-info');
    if (wrap) wrap.style.display = '';
    if (info) {
      const ts = data.ts ? new Date(data.ts).toLocaleString('de-DE') : '—';
      info.innerHTML = `${ts} · ${data.scanned} geprüft · <b style="color:${data.newDevices?.length ? 'var(--green)' : 'var(--text3)'}">${data.newDevices?.length || 0} neue Geräte</b>` +
        (data.newDevices?.length ? '<br>' + data.newDevices.map(d => `${d.ip} – ${d.sysName || d.model || '?'}`).join('<br>') : '');
    }
    if (st) { st.textContent = `Fertig: ${data.newDevices?.length || 0} neu`; st.style.color = 'var(--green)'; }
  } catch (e) {
    if (st) { st.textContent = e.message; st.style.color = 'var(--red)'; }
  }
}

export async function requestNotifyPermission() {
  if (!('Notification' in window)) { alert('Ihr Browser unterstützt keine Desktop-Benachrichtigungen.'); return; }
  const result = await Notification.requestPermission();
  const el = q('notify-perm-status');
  if (el) el.textContent = result === 'granted' ? '✓ Erlaubt' : '✗ Verweigert';
}
