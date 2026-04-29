import { q, h } from '../lib/helpers.js';

let syslogData = [];
let syslogAutoTimer = null;
const SYSLOG_AUTOREFRESH_LS = 'onsite-syslog-autorefresh';
const SYSLOG_AUTOREFRESH_MS = 5000;

function isSyslogPanelActive() {
  return q('panel-syslog')?.classList.contains('active');
}

function stopSyslogAutoRefreshTimer() {
  if (syslogAutoTimer) {
    clearInterval(syslogAutoTimer);
    syslogAutoTimer = null;
  }
}

/** Checkbox + localStorage; startet/stoppt Polling nur wenn Syslog-Tab aktiv */
export function setSyslogAutoRefresh(enabled) {
  localStorage.setItem(SYSLOG_AUTOREFRESH_LS, enabled ? '1' : '0');
  const cb = q('syslog-autorefresh');
  if (cb) cb.checked = enabled;
  stopSyslogAutoRefreshTimer();
  if (enabled && isSyslogPanelActive()) {
    syslogAutoTimer = setInterval(() => { loadSyslog(); }, SYSLOG_AUTOREFRESH_MS);
  }
}

/** Beim Wechsel auf den Syslog-Tab: Polling starten wenn Option an */
export function applySyslogAutoRefresh() {
  stopSyslogAutoRefreshTimer();
  if (localStorage.getItem(SYSLOG_AUTOREFRESH_LS) === '1' && isSyslogPanelActive()) {
    syslogAutoTimer = setInterval(() => { loadSyslog(); }, SYSLOG_AUTOREFRESH_MS);
  }
}

/** Timer beim Verlassen des Tabs stoppen */
export function stopSyslogAutoRefresh() {
  stopSyslogAutoRefreshTimer();
}

/** Checkbox-Zustand aus localStorage beim Start */
export function initSyslogAutoRefreshUi() {
  const cb = q('syslog-autorefresh');
  if (!cb) return;
  cb.checked = localStorage.getItem(SYSLOG_AUTOREFRESH_LS) === '1';
}

const SEV_COLORS = {
  emerg: '#ef4444', alert: '#ef4444', crit: '#ef4444',
  err: '#f97316', warning: '#eab308', notice: '#3b82f6',
  info: 'var(--text2)', debug: 'var(--text3)',
};

function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function loadSyslog() {
  const sev = q('syslog-severity-filter')?.value || '';
  const ip = q('syslog-ip-filter')?.value?.trim() || '';
  let url = '/api/syslog?limit=500';
  if (sev) url += `&severity=${sev}`;
  if (ip) url += `&ip=${encodeURIComponent(ip)}`;
  const tb = q('tbody-syslog');
  try {
    const r = await fetch(url);
    let body;
    try {
      body = await r.json();
    } catch {
      if (tb) tb.innerHTML = `<tr><td colspan="6" class="empty" style="color:var(--red)">Antwort ist kein JSON (HTTP ${r.status})</td></tr>`;
      syslogData = [];
      return;
    }
    if (!r.ok) {
      const msg = (body && (body.error || body.message)) || `HTTP ${r.status}`;
      if (tb) tb.innerHTML = `<tr><td colspan="6" class="empty" style="color:var(--red)">${h(String(msg))}</td></tr>`;
      syslogData = [];
      return;
    }
    syslogData = Array.isArray(body) ? body : [];
    renderSyslog(syslogData);
    if ((q('syslog-search')?.value || '').trim()) filterSyslogLocal();
  } catch (e) {
    if (tb) tb.innerHTML = `<tr><td colspan="6" class="empty" style="color:var(--red)">${h(e.message || 'Fehler beim Laden')}</td></tr>`;
    syslogData = [];
  }
}

export function filterSyslogLocal() {
  const search = (q('syslog-search')?.value || '').toLowerCase();
  if (!search) { renderSyslog(syslogData); return; }
  const filtered = syslogData.filter(e =>
    (e.message || '').toLowerCase().includes(search) ||
    (e.from || '').includes(search) ||
    (e.program || '').toLowerCase().includes(search) ||
    (e.hostname || '').toLowerCase().includes(search)
  );
  renderSyslog(filtered);
}

function renderSyslog(data) {
  const tb = q('tbody-syslog');
  const cnt = q('cnt-syslog');
  if (!tb) return;
  const rows = Array.isArray(data) ? data : [];
  if (cnt) cnt.textContent = rows.length ? `(${rows.length})` : '';
  if (!rows.length) {
    tb.innerHTML = '<tr><td colspan="6" class="empty">Keine Syslog-Nachrichten</td></tr>';
    return;
  }
  tb.innerHTML = rows.slice(0, 300).map(e => {
    const ts = e.ts ? new Date(e.ts).toLocaleString('de-DE') : '—';
    const sevColor = SEV_COLORS[e.severity] || 'var(--text2)';
    const msg = escHtml(e.message || e.raw || '');
    const msgShort = msg.length > 200 ? msg.slice(0, 200) + '…' : msg;
    return `<tr>
      <td style="white-space:nowrap;font-size:11px;color:var(--text3)">${ts}</td>
      <td style="font-family:monospace;font-size:11px">${escHtml(e.from)}</td>
      <td><span style="color:${sevColor};font-weight:600;font-size:11px">${escHtml(e.severity || '?')}</span></td>
      <td style="font-size:11px;color:var(--text3)">${escHtml(e.facility || '')}</td>
      <td style="font-size:11px">${escHtml(e.program || '')}</td>
      <td style="font-size:11px;max-width:500px;word-break:break-word" title="${msg}">${msgShort}</td>
    </tr>`;
  }).join('');
}

export async function clearSyslog() {
  await fetch('/api/syslog', { method: 'DELETE' });
  syslogData = [];
  renderSyslog([]);
}
