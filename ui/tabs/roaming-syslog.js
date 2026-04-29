import S from '../lib/state.js';
import { q, h, applySort, clickSort, parseFetchJsonLenient } from '../lib/helpers.js';
import { lookupMacVendor } from '../lib/oui.js';

const MAC_RE = /(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}/g;
/** Nur erste 3 Oktette — nicht die ersten 3 einer vollständigen MAC (Lookahead) */
const OUI_ONLY_SOURCE = '(?<![0-9A-Fa-f])(?:[0-9A-Fa-f]{2}[:-]){2}[0-9A-Fa-f]{2}(?![:-][0-9A-Fa-f]{2})';
const OUI_ONLY_RE = new RegExp(OUI_ONLY_SOURCE, 'gi');
const OUI_ONLY_TEST = new RegExp(OUI_ONLY_SOURCE, 'i');

/** Letzte Tracker-Daten für Sortierung ohne erneuten Syslog-Fetch */
let roamTrackerCache = { tracks: null, meta: null };

let nacAllowlistFetchPromise = null;

function normalizeMacForNacLookup(s) {
  if (s == null) return null;
  const hex = String(s).replace(/[^0-9a-fA-F]/g, '').toLowerCase();
  if (hex.length !== 12) return null;
  return hex.match(/.{2}/g).join(':');
}

/** Lädt /api/nac einmal in S.nacMacAllowlistCache (gleicher Cache wie Client Explorer). */
function ensureNacAllowlistForRoaming() {
  if (Array.isArray(S.nacMacAllowlistCache)) return;
  if (nacAllowlistFetchPromise) return;
  nacAllowlistFetchPromise = fetch('/api/nac')
    .then((r) => parseFetchJsonLenient(r))
    .then((data) => {
      if (data && Array.isArray(data.macAllowlist)) {
        S.nacMacAllowlistCache = data.macAllowlist.map((row) => ({ ...row }));
      } else if (S.nacMacAllowlistCache === null) {
        S.nacMacAllowlistCache = [];
      }
    })
    .catch(() => {
      if (S.nacMacAllowlistCache === null) S.nacMacAllowlistCache = [];
    })
    .finally(() => {
      nacAllowlistFetchPromise = null;
      renderRoamTrackerCached();
    });
}

/** Bezeichnung / VLAN aus NAC-MAC-Liste (Abgleich über normalisierte 12-Hex-MAC). */
function nacMetaForTrack(t) {
  if (!Array.isArray(S.nacMacAllowlistCache)) return { label: '', vlan: undefined };
  const norm = normalizeMacForNacLookup(t.mac);
  if (!norm) return { label: '', vlan: undefined };
  const row = S.nacMacAllowlistCache.find((e) => String(e.mac || '').trim().toLowerCase() === norm);
  if (!row) return { label: '', vlan: undefined };
  const label = String(row.label || '').trim();
  let vlan;
  if (row.vlan != null && row.vlan !== '') {
    const n = parseInt(String(row.vlan), 10);
    if (!Number.isNaN(n) && n >= 1 && n <= 4094) vlan = n;
  }
  return { label, vlan };
}

/** Syslog-Zeilen, die typischerweise Roaming / WLAN-Wechsel beschreiben (Heuristik) */
export function isRoamingSyslogEntry(e) {
  const t = `${e.message || ''}\n${e.raw || ''}\n${e.program || ''}\n${e.hostname || ''}`.toLowerCase();
  if (/\broam|roaming|reassoc|re-assoc|802\.11r|bss transition|fast transition|dot11r|\b11r\b|pmk\b|okc\b|mobility domain/.test(t)) return true;
  if (/(wlan|wifi|802\.11|hostapd|wpa_supplicant|ath|nl80211)/.test(t) &&
      /(reassoc|disassoc|deauth|new bssid|different ap|wechsel|hand-?off|sticky|ft\s|ieee\s*802)/.test(t)) return true;
  if (/(sta|station|client).{0,120}(ap|bss|bssid)/.test(t) && /(chang|switch|move|von|nach|new|another)/.test(t)) return true;
  return false;
}

function normMac(m) {
  return m.replace(/-/g, ':').toUpperCase();
}

/** Voll-MAC deckt dieselbe OUI ab → kein zusätzlicher OUI-nur-Eintrag */
function fullMacCoversOui(fullNorm, ouiNorm) {
  return fullNorm.startsWith(ouiNorm) && fullNorm.length > ouiNorm.length;
}

/** Drei Oktetts kommen irgendwo in der vollständigen MAC vor (z. B. letzte 3 Oktette — kein „OUI“) */
function ouiIsContiguousInFullMac(ouiNorm, fullNorm) {
  const o = ouiNorm.split(':');
  const f = fullNorm.split(':');
  if (o.length !== 3 || f.length < 3) return false;
  const O = o.map((x) => x.toUpperCase());
  for (let i = 0; i <= f.length - 3; i++) {
    if (
      f[i].toUpperCase() === O[0]
      && f[i + 1].toUpperCase() === O[1]
      && f[i + 2].toUpperCase() === O[2]
    ) return true;
  }
  return false;
}

function textHasMacOrOui(text) {
  MAC_RE.lastIndex = 0;
  return MAC_RE.test(text) || OUI_ONLY_TEST.test(text);
}

function apLabel(ip) {
  const devs = S.deviceStore || {};
  const d = Object.values(devs).find(x => x.ip === ip);
  return d ? (d.name || ip) : ip;
}

function apHtml(ip) {
  const name = apLabel(ip);
  if (name !== ip) {
    return `${escHtml(name)} <span style="color:var(--text3);font-size:10px">${escHtml(ip)}</span>`;
  }
  return escHtml(ip);
}

let roamingSyslogTimer = null;
const ROAMING_SYSLOG_LS = 'onsite-roaming-syslog-autorefresh';
const ROAMING_SYSLOG_MS = 5000;

function isRoamingPanelActive() {
  return q('panel-roaming')?.classList.contains('active');
}

function stopRoamingSyslogTimer() {
  if (roamingSyslogTimer) {
    clearInterval(roamingSyslogTimer);
    roamingSyslogTimer = null;
  }
}

export function setRoamingSyslogAutoRefresh(enabled) {
  localStorage.setItem(ROAMING_SYSLOG_LS, enabled ? '1' : '0');
  const cb = q('roaming-autorefresh');
  if (cb) cb.checked = enabled;
  stopRoamingSyslogTimer();
  if (enabled && isRoamingPanelActive()) {
    roamingSyslogTimer = setInterval(() => { loadRoamingSyslog(); }, ROAMING_SYSLOG_MS);
  }
}

export function applyRoamingSyslogAutoRefresh() {
  stopRoamingSyslogTimer();
  if (localStorage.getItem(ROAMING_SYSLOG_LS) === '1' && isRoamingPanelActive()) {
    roamingSyslogTimer = setInterval(() => { loadRoamingSyslog(); }, ROAMING_SYSLOG_MS);
  }
}

export function stopRoamingSyslogAutoRefresh() {
  stopRoamingSyslogTimer();
}

export function initRoamingSyslogAutoRefreshUi() {
  const cb = q('roaming-autorefresh');
  if (!cb) return;
  cb.checked = localStorage.getItem(ROAMING_SYSLOG_LS) === '1';
}

function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const SEV_COLORS = {
  emerg: '#ef4444', alert: '#ef4444', crit: '#ef4444',
  err: '#f97316', warning: '#eab308', notice: '#3b82f6',
  info: 'var(--text2)', debug: 'var(--text3)',
};

/** Eine Zeile pro MAC + Syslog-Absender (AP/Controller), dedupliziert */
function extractClientEvents(filtered) {
  const seen = new Set();
  const out = [];
  for (const e of filtered) {
    const text = `${e.message || ''} ${e.raw || ''}`;
    MAC_RE.lastIndex = 0;
    OUI_ONLY_RE.lastIndex = 0;
    const fullMacs = [...new Set((text.match(MAC_RE) || []).map(normMac))];
    const ouiRaw = text.match(OUI_ONLY_RE) || [];
    const ouiNormList = [...new Set(ouiRaw.map(normMac))].filter((oui) =>
      !fullMacs.some((f) => fullMacCoversOui(f, oui) || ouiIsContiguousInFullMac(oui, f)),
    );
    const macs = [...fullMacs, ...ouiNormList.map((o) => `${o}:00:00:00`)];
    if (!macs.length) continue;
    for (let i = 0; i < macs.length; i++) {
      const mac = macs[i];
      const partialOui = i >= fullMacs.length;
      const displayMac = partialOui ? ouiNormList[i - fullMacs.length] : null;
      const key = `${e.ts}|${mac}|${e.from}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        ts: e.ts,
        mac,
        partialOui,
        displayMac,
        reporterIp: e.from,
        syslogHostname: e.hostname || '',
        severity: e.severity || '',
        program: e.program || '',
        message: (e.message || e.raw || '').slice(0, 600),
      });
    }
  }
  out.sort((a, b) => new Date(a.ts) - new Date(b.ts));
  return out;
}

const SEV_PROBLEM_BAD = new Set(['emerg', 'alert', 'crit']);
const SEV_PROBLEM_KW = /failed|timeout|reject|denied|invalid|error|abort/i;

function isBenignWlanSeverityMsg(msg) {
  return /\bidle\s+timeout\b/i.test(String(msg || ''));
}

/** Gleiche Regel wie Hinweis „Fehler oder hohe Severity in den Meldungen“ (pro Syslog-Zeile). */
function isSeverityProblemEvent(ev) {
  if (!ev) return false;
  const s = String(ev.severity || '').toLowerCase();
  if (SEV_PROBLEM_BAD.has(s)) return true;
  const msg = ev.message || '';
  return SEV_PROBLEM_KW.test(msg) && !isBenignWlanSeverityMsg(msg) && !/success|ok\b/i.test(msg);
}

function detectProblems(evs, roams) {
  const out = [];
  // Kein deauth/disassoc: normale 802.11-/Roaming-Meldungen; „idle timeout“ siehe isBenignWlanSeverityMsg.
  if (evs.some((e) => isSeverityProblemEvent(e))) {
    out.push({ level: 'bad', text: 'Fehler oder hohe Severity in den Meldungen' });
  }

  if (roams.length >= 3) {
    const pairCounts = {};
    for (const r of roams) {
      const k = [r.fromAp, r.toAp].sort().join('|');
      pairCounts[k] = (pairCounts[k] || 0) + 1;
    }
    const maxP = Math.max(0, ...Object.values(pairCounts));
    if (maxP >= 4) {
      out.push({ level: 'warn', text: `Häufiges Pendeln zwischen denselben APs (${maxP}×)` });
    }
  }

  if (roams.length >= 2) {
    const tEnd = new Date(roams[roams.length - 1].ts).getTime();
    const tStart = tEnd - 10 * 60 * 1000;
    const recent = roams.filter(r => new Date(r.ts).getTime() >= tStart);
    if (recent.length >= 5) {
      out.push({ level: 'warn', text: 'Sehr viele Roams in 10 Minuten' });
    }
  }

  if (roams.length >= 8) {
    const span = new Date(roams[roams.length - 1].ts) - new Date(roams[0].ts);
    if (span < 3600 * 1000) {
      out.push({ level: 'warn', text: 'Viele Roams innerhalb 1 Stunde' });
    }
  }

  return out;
}

function buildTracks(events) {
  const byMac = {};
  for (const ev of events) {
    if (!byMac[ev.mac]) byMac[ev.mac] = [];
    byMac[ev.mac].push(ev);
  }
  const tracks = [];
  for (const [mac, evs] of Object.entries(byMac)) {
    evs.sort((a, b) => new Date(a.ts) - new Date(b.ts));
    const roams = [];
    for (let i = 1; i < evs.length; i++) {
      if (evs[i].reporterIp !== evs[i - 1].reporterIp) {
        const stepIndex = roams.length + 1;
        roams.push({
          ts: evs[i].ts,
          fromAp: evs[i - 1].reporterIp,
          toAp: evs[i].reporterIp,
          eventIndexAfter: i,
          stepIndex,
        });
      }
    }
    tracks.push({
      mac,
      partialOui: evs.some((x) => x.partialOui),
      displayOui: (evs.find((x) => x.displayMac)?.displayMac) || null,
      events: evs,
      roams,
      problems: detectProblems(evs, roams),
    });
  }
  tracks.sort((a, b) => {
    const badDiff = b.problems.filter(p => p.level === 'bad').length - a.problems.filter(p => p.level === 'bad').length;
    if (badDiff !== 0) return badDiff;
    const wdiff = b.problems.filter(p => p.level === 'warn').length - a.problems.filter(p => p.level === 'warn').length;
    if (wdiff !== 0) return wdiff;
    return b.roams.length - a.roams.length;
  });
  return tracks;
}

function fmtShort(ts) {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch { return ts; }
}

function fmtLong(ts) {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString('de-DE', {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch { return ts; }
}

/** Einzelne Syslog-Zeile für Detailansicht */
function formatRoamEventDetail(ev) {
  if (!ev) return '<div class="roam-ev-missing">—</div>';
  const prob = isSeverityProblemEvent(ev) ? ' roam-ev-block--prob' : '';
  const msg = escHtml(ev.message || '');
  return `<div class="roam-ev-block${prob}">
    <div class="roam-ev-grid">
      <span class="roam-ev-k">Zeit</span><span>${escHtml(fmtLong(ev.ts))}</span>
      <span class="roam-ev-k">Absender (IP)</span><span class="roam-ev-mono">${escHtml(ev.reporterIp || '')}</span>
      <span class="roam-ev-k">Syslog-Hostname</span><span>${escHtml(ev.syslogHostname || '—')}</span>
      <span class="roam-ev-k">Severity</span><span>${escHtml(ev.severity || '—')}</span>
      <span class="roam-ev-k">Programm</span><span>${escHtml(ev.program || '—')}</span>
    </div>
    <div class="roam-ev-msg-label">Nachricht</div>
    <pre class="roam-detail-msg">${msg}</pre>
  </div>`;
}

let roamDetailEscapeHandler = null;

function buildRoamDetailHtml(t) {
  const wlan = enrichFromWlan(t.mac);
  const syslogHosts = syslogHostnamesForTrack(t.events);
  const v = lookupMacVendor(t.mac);
  const showMac = t.partialOui && t.displayOui ? t.displayOui : t.mac;

  let meta = `<div class="roam-detail-meta">
    <div><span class="roam-dm-k">MAC</span><span class="roam-dm-v roam-dm-mono">${escHtml(showMac)}</span></div>`;
  if (t.partialOui) {
    meta += '<div class="roam-dm-note">Nur OUI-Präfix in den Syslog-Zeilen erkannt (keine vollständige MAC).</div>';
  }
  if (v.vendor || v.oui) {
    meta += `<div><span class="roam-dm-k">Hersteller</span><span class="roam-dm-v">${v.local ? escHtml(`Lokal / Privacy · ${v.oui || ''}`) : escHtml([v.vendor, v.oui ? `(${v.oui})` : ''].filter(Boolean).join(' '))}</span></div>`;
  }
  const nacM = nacMetaForTrack(t);
  if (nacM.label) {
    meta += `<div><span class="roam-dm-k">NAC</span><span class="roam-dm-v">${escHtml(nacM.label)}${nacM.vlan != null ? ` <span class="badge badge-gray">VLAN ${escHtml(String(nacM.vlan))}</span>` : ''}</span></div>`;
  }
  meta += '</div>';

  if (wlan) {
    meta += `<div class="roam-detail-wlan">
      <div class="roam-dm-section-title">WLAN-Scan (Geräteliste)</div>
      <div class="roam-ev-grid">
        <span class="roam-ev-k">Hostname</span><span>${escHtml(wlan.hostname || '—')}</span>
        <span class="roam-ev-k">IP</span><span class="roam-ev-mono">${escHtml(wlan.ip || '—')}</span>
        <span class="roam-ev-k">SSID</span><span>${escHtml(wlan.ssid || '—')}</span>
        <span class="roam-ev-k">Band / Kanal</span><span>${escHtml([wlan.band, wlan.channel != null && wlan.channel !== '' ? `Kanal ${wlan.channel}` : ''].filter(Boolean).join(' · ') || '—')}</span>
        <span class="roam-ev-k">Signal</span><span>${wlan.signal != null && wlan.signal !== '' ? `${escHtml(String(wlan.signal))} dBm` : '—'}</span>
        <span class="roam-ev-k">AP (Scan)</span><span>${escHtml(wlan.apName || '')} <span class="roam-ev-mono">${escHtml(wlan.apIp || '')}</span></span>
      </div>
    </div>`;
  }

  if (syslogHosts.length) {
    meta += `<div class="roam-detail-hosts">Syslog-Hostnamen in den Meldungen: <span class="roam-ev-mono">${escHtml([...new Set(syslogHosts)].join(', '))}</span></div>`;
  }

  if ((t.problems || []).length) {
    meta += `<div class="roam-detail-problems">${(t.problems || []).map(p =>
      `<span class="roaming-badge ${p.level === 'bad' ? 'roaming-badge-bad' : 'roaming-badge-warn'}">${escHtml(p.text)}</span>`,
    ).join(' ')}</div>`;
  }

  const evSorted = [...(t.events || [])].sort((a, b) => new Date(b.ts) - new Date(a.ts));
  const nAll = evSorted.length;
  const nProb = evSorted.filter(isSeverityProblemEvent).length;

  let body = '';

  if (t.roams.length) {
    const total = t.roams.length;
    const ordered = [...t.roams].sort((a, b) => new Date(b.ts) - new Date(a.ts));
    body += '<div class="roam-detail-steps-region">';
    body += `<p class="roam-detail-intro">Roam-Schritte: <strong>neueste zuerst</strong>. Pro Schritt: Syslog-Zeile unmittelbar vor dem AP-Wechsel und auslösende Zeile danach.</p>`;
    for (const r of ordered) {
      const i = r.eventIndexAfter;
      const fromEv = i != null && t.events[i - 1] ? t.events[i - 1] : null;
      const toEv = i != null ? t.events[i] : null;
      body += `<section class="roam-detail-step">
        <div class="roam-detail-step-h">
          <span class="roam-detail-step-nr">Schritt ${r.stepIndex} / ${total}</span>
          <span class="roam-detail-step-ts">${escHtml(fmtLong(r.ts))}</span>
        </div>
        <div class="roam-detail-apline">von ${apHtml(r.fromAp)} <span class="roaming-tl-arrow">→</span> ${apHtml(r.toAp)}</div>
        <div class="roam-detail-pair">
          <div class="roam-detail-pair-col">
            <div class="roam-detail-pair-title">Vorherige Meldung (gleicher Client, noch alter AP)</div>
            ${formatRoamEventDetail(fromEv)}
          </div>
          <div class="roam-detail-pair-col">
            <div class="roam-detail-pair-title">Nachfolgende Meldung (Wechsel erkannt)</div>
            ${formatRoamEventDetail(toEv)}
          </div>
        </div>
      </section>`;
    }
    body += '</div>';
  } else if ((t.events || []).length) {
    body += '<p class="roam-detail-intro roam-detail-hide-if-sev-empty">Kein erkannter AP-Wechsel (Absender-IP blieb gleich). Unten alle zugehörigen Syslog-Zeilen.</p>';
  }

  body += `<h4 class="roam-dm-section-title roam-detail-hide-if-sev-empty" style="margin-top:20px">Alle zugehörigen Syslog-Ereignisse (${nAll}) — neueste zuerst</h4>`;
  if (!evSorted.length) {
    body += '<p class="roam-detail-empty roam-detail-hide-if-sev-empty">Keine Ereignisse.</p>';
  } else {
    body += '<div class="roam-detail-all-events roam-detail-hide-if-sev-empty">';
    for (const ev of evSorted) {
      body += formatRoamEventDetail(ev);
    }
    body += '</div>';
  }

  const filterBar = `<div class="roam-detail-filter-bar">
    <label class="roam-detail-filter-label" for="roam-detail-ev-filter">Einträge filtern</label>
    <select id="roam-detail-ev-filter" class="roam-detail-filter-select input-field" onchange="roamDetailEventFilterChange(this)">
      <option value="all">Alle anzeigen</option>
      <option value="sev">Nur „Fehler oder hohe Severity“</option>
    </select>
    <span class="roam-detail-filter-hint" aria-live="polite"></span>
  </div>`;
  const emptySev = '<p class="roam-detail-sev-filter-empty">Keine Einträge, die diesem Filter entsprechen (emerg/alert/crit oder Fehler-Stichwörter in der Nachricht).</p>';

  return `${meta}<div class="roam-detail-filter-root" data-ev-filter="all" data-n-all="${nAll}" data-n-prob="${nProb}">${filterBar}${emptySev}<div class="roam-detail-filterable-body roam-detail-hide-if-sev-empty">${body}</div></div>`;
}

/** Inline onchange im Roaming-Detail-Overlay — an window gebunden (main.js). */
export function roamDetailEventFilterChange(selectEl) {
  const root = q('roaming-detail-body')?.querySelector('.roam-detail-filter-root');
  if (!root || !selectEl) return;
  root.dataset.evFilter = selectEl.value === 'sev' ? 'sev' : 'all';
  const hint = root.querySelector('.roam-detail-filter-hint');
  const nAll = parseInt(root.dataset.nAll, 10) || 0;
  const nProb = parseInt(root.dataset.nProb, 10) || 0;
  if (hint) {
    if (root.dataset.evFilter === 'sev') {
      hint.textContent = nProb
        ? `${nProb} von ${nAll} Einträgen entsprechen dem Filter.`
        : '';
    } else {
      hint.textContent = nProb
        ? `${nProb} von ${nAll} Einträgen würden mit diesem Filter angezeigt.`
        : '';
    }
  }
}

/** Vollständiger Verlauf in Overlay (alle Syslog-Felder, Schritte neueste zuerst) */
export function openRoamDetailView(mac) {
  const { tracks } = roamTrackerCache;
  const t = tracks?.find((x) => x.mac === mac);
  if (!t) {
    window.alert?.('Keine Tracker-Daten für diese MAC. Bitte den Roaming-Tab aktualisieren.');
    return;
  }
  const overlay = q('roaming-detail-overlay');
  const titleEl = q('roaming-detail-title');
  const bodyEl = q('roaming-detail-body');
  if (!overlay || !titleEl || !bodyEl) return;
  titleEl.textContent = `Roaming-Verlauf · ${t.partialOui && t.displayOui ? t.displayOui : t.mac}`;
  bodyEl.innerHTML = buildRoamDetailHtml(t);
  const sel = q('roam-detail-ev-filter');
  if (sel) roamDetailEventFilterChange(sel);
  overlay.style.display = 'flex';
  if (roamDetailEscapeHandler) document.removeEventListener('keydown', roamDetailEscapeHandler);
  roamDetailEscapeHandler = (e) => {
    if (e.key === 'Escape') closeRoamDetailView();
  };
  document.addEventListener('keydown', roamDetailEscapeHandler);
}

export function closeRoamDetailView() {
  const overlay = q('roaming-detail-overlay');
  if (overlay) overlay.style.display = 'none';
  if (roamDetailEscapeHandler) {
    document.removeEventListener('keydown', roamDetailEscapeHandler);
    roamDetailEscapeHandler = null;
  }
}

/** Daten aus WLAN-Client-Scan (Geräteliste / Client Explorer), falls MAC bekannt */
function enrichFromWlan(mac) {
  const M = mac.toUpperCase();
  for (const c of S.clientsData || []) {
    if (c.type !== 'wlan') continue;
    if ((c.mac || '').toUpperCase() === M) {
      return {
        hostname: c.hostname || '',
        ip: c.ip || '',
        ssid: c.ssid || '',
        band: c.band || '',
        signal: c.signal,
        channel: c.channel,
        apName: c.sourceName || '',
        apIp: c.sourceIp || '',
      };
    }
  }
  for (const d of Object.values(S.deviceStore || {})) {
    for (const c of (d.wlanClients || [])) {
      if ((c.mac || '').toUpperCase() === M) {
        return {
          hostname: c.hostname || '',
          ip: c.ip || '',
          ssid: c.ssid || '',
          band: c.band || '',
          signal: c.signal,
          channel: c.channel,
          apName: d.name || d.ip,
          apIp: d.ip,
        };
      }
    }
  }
  return null;
}

function syslogHostnamesForTrack(events) {
  const h = new Set();
  for (const ev of events) {
    if (ev.syslogHostname) h.add(ev.syslogHostname);
  }
  return [...h];
}

function roamSortTh(label, col, thStyle = '') {
  const sort = S.roamSort;
  const active = sort.col === col;
  const cls = active ? (sort.dir === 1 ? 'sortable sort-asc' : 'sortable sort-desc') : 'sortable';
  const st = thStyle ? ` style="${thStyle}"` : '';
  return `<th class="${cls}" onclick="roamSortClick('${col}')"${st}>${label}</th>`;
}

/** Sortierschlüssel pro Spalte (applySort) */
function roamSortKey(t, col) {
  const wlan = enrichFromWlan(t.mac);
  const v = lookupMacVendor(t.mac);
  const macKey = (t.displayOui || t.mac).toLowerCase();
  switch (col) {
    case 'mac':
      return macKey;
    case 'vendor': {
      if (v.local) return `0privacy\u0000${(v.oui || '').toLowerCase()}\u0000${macKey}`;
      if (v.vendor) return `1${v.vendor.toLowerCase()}\u0000${macKey}`;
      if (v.oui) return `2unknown\u0000${v.oui.toLowerCase()}\u0000${macKey}`;
      return `3\u0000${macKey}`;
    }
    case 'client':
      if (!wlan) return '\uFFFF';
      return `${(wlan.hostname || '').toLowerCase()}\u0000${wlan.ip || ''}\u0000${(wlan.ssid || '').toLowerCase()}`;
    case 'nacLabel': {
      const nm = nacMetaForTrack(t);
      if (!nm.label) return '\uFFFF';
      return nm.label.toLowerCase() + '\u0000' + macKey;
    }
    case 'roams':
      return t.roams.length;
    case 'last':
      return t.events.length ? new Date(t.events[t.events.length - 1].ts).getTime() : 0;
    case 'hints': {
      const p = t.problems || [];
      if (!p.length) return '';
      return p.map(x => `${x.level}:${x.text}`).join('|').toLowerCase();
    }
    case 'verlauf':
      return t.roams.length * 1e6 + t.events.length;
    default:
      return '';
  }
}

export function roamSortClick(col) {
  clickSort(S.roamSort, col, renderRoamTrackerCached);
}

function renderRoamTrackerCached() {
  const { tracks, meta } = roamTrackerCache;
  if (!tracks || !meta) return;
  renderRoamingTracker(tracks, meta);
}

function formatClientInfoCell(wlan, syslogHosts) {
  const lines = [];
  if (wlan) {
    const hn = wlan.hostname || '—';
    lines.push(`<div style="font-weight:600">${escHtml(hn)}</div>`);
    const bits = [];
    if (wlan.ip) bits.push(`IP ${escHtml(wlan.ip)}`);
    if (wlan.ssid) bits.push(`SSID ${escHtml(wlan.ssid)}`);
    if (wlan.band) bits.push(escHtml(wlan.band));
    if (bits.length) lines.push(`<div style="font-size:11px;color:var(--text3)">${bits.join(' · ')}</div>`);
    if (wlan.signal != null && wlan.signal !== '') {
      lines.push(`<div style="font-size:11px;color:var(--text3)">Signal ${escHtml(String(wlan.signal))} dBm${wlan.channel != null && wlan.channel !== '' ? ` · Kanal ${escHtml(String(wlan.channel))}` : ''}</div>`);
    }
    lines.push(`<div style="font-size:10px;color:var(--text3)">WLAN-Scan: ${escHtml(wlan.apName || '')} <span style="font-family:var(--mono)">${escHtml(wlan.apIp || '')}</span></div>`);
  } else {
    lines.push('<div style="font-size:11px;color:var(--text3)">WLAN-Scan: <em>keine Daten</em> <span style="font-size:10px">— zuerst <b>WiFi Analyse → Aktualisieren</b></span></div>');
  }
  const sh = syslogHosts.filter(Boolean);
  if (sh.length) {
    lines.push(`<div style="font-size:10px;color:var(--text3)">Syslog-Host: ${escHtml([...new Set(sh)].join(', '))}</div>`);
  }
  return `<div class="roam-cell-info">${lines.join('')}</div>`;
}

function rowSearchBlob(t, wlan, syslogHosts) {
  const parts = [t.mac];
  if (t.displayOui) parts.push(t.displayOui);
  const nm = nacMetaForTrack(t);
  if (nm.label) parts.push(nm.label);
  const v = lookupMacVendor(t.mac);
  parts.push(v.oui || '', v.vendor || '', v.local ? 'privacy lokal' : '');
  for (const p of (t.problems || [])) parts.push(p.text);
  for (const r of t.roams) {
    parts.push(r.fromAp, r.toAp, apLabel(r.fromAp), apLabel(r.toAp));
  }
  if (wlan) {
    parts.push(wlan.hostname, wlan.ip, wlan.ssid, wlan.band, wlan.apName, wlan.apIp);
  }
  parts.push(...syslogHosts);
  return parts.join(' ').toLowerCase();
}

function formatRoamMacCell(mac, track) {
  const showMac = track?.partialOui && track?.displayOui ? track.displayOui : mac;
  const partialNote = track?.partialOui
    ? '<div class="roam-oui-hint" style="margin-top:4px">Nur OUI-Präfix in Syslog (keine vollständige MAC)</div>'
    : '';
  return `<div class="roam-mac-cell">${escHtml(showMac)}</div>${partialNote}`;
}

function formatRoamVendorCell(mac) {
  const { oui, vendor, local } = lookupMacVendor(mac);
  if (!oui) return '<span style="font-size:11px;color:var(--text3)">—</span>';
  if (local) {
    return `<div class="roam-oui-hint roam-oui-local">Lokale / Privacy-MAC · ${escHtml(oui)}</div>`;
  }
  if (vendor) {
    return `<div class="roam-oui-hint">${escHtml(vendor)} <span class="roam-oui-code">(${escHtml(oui)})</span></div>`;
  }
  return `<div class="roam-oui-hint">OUI ${escHtml(oui)} — nicht in der lokalen Herstellerliste</div>`;
}

const MAX_TL = 32;

/** Tabellenansicht + Suchfeld (Zeilen haben data-search) */
export function filterRoamTable() {
  const inp = q('roaming-client-search');
  const needle = (inp?.value || '').trim().toLowerCase();
  q('tbody-roaming-tracker')?.querySelectorAll('tr.roam-track-row').forEach(tr => {
    const hay = (tr.getAttribute('data-search') || '').toLowerCase();
    tr.style.display = !needle || hay.includes(needle) ? '' : 'none';
  });
}

function renderRoamingTracker(tracks, meta) {
  roamTrackerCache = { tracks, meta };
  const root = q('roaming-tracker-root');
  if (!root) return;

  ensureNacAllowlistForRoaming();

  const totalRoams = tracks.reduce((s, t) => s + t.roams.length, 0);
  const badHints = tracks.reduce((s, t) => s + t.problems.filter(p => p.level === 'bad').length, 0);
  const warnHints = tracks.reduce((s, t) => s + t.problems.filter(p => p.level === 'warn').length, 0);

  if (!tracks.length) {
    root.innerHTML = meta.noMacLines > 0
      ? `<div class="roaming-sum">In den passenden Syslog-Zeilen wurde <strong>keine MAC-Adresse</strong> erkannt (${meta.noMacLines} Zeilen). Bitte Rohdaten prüfen oder Geräte-Logging erweitern.</div>`
      : '<div class="roaming-sum">Keine Roaming-Syslog-Zeilen vorhanden.</div>';
    return;
  }

  const sumParts = [
    `<strong>${tracks.length}</strong> Clients (MAC)`,
    `<strong>${totalRoams}</strong> vermutete Roam-Schritte`,
  ];
  if (badHints) sumParts.push(`<span class="roaming-sum-bad">${badHints} kritische Hinweise</span>`);
  if (warnHints) sumParts.push(`<span class="roaming-sum-warn">${warnHints} Warnungen</span>`);
  if (meta.noMacLines) {
    sumParts.push(`<span style="color:var(--text3)">${meta.noMacLines} Syslog-Zeilen ohne MAC (nur unten in der Tabelle)</span>`);
  }

  let html = `<div class="roaming-sum">${sumParts.join(' · ')}<br><span style="font-size:11px;color:var(--text3);margin-top:6px;display:inline-block">Roam-Schritt = gleiche Client-MAC, nächste Meldung von <em>anderem</em> Syslog-Absender (meist anderer AP). Zusätzliche Infos aus WLAN-Scan (WiFi Analyse) und Syslog-Hostnamen.</span></div>`;

  const sortedTracks = S.roamSort.col ? applySort(tracks, S.roamSort, roamSortKey) : [...tracks];

  html += `<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap">
    <input class="search-input" id="roaming-client-search" placeholder="Suche: MAC, Hostname, SSID, AP-Name, IP …" oninput="filterRoamTable()" style="width:min(100%,420px)">
    <span style="font-size:11px;color:var(--text3)">${tracks.length} Zeilen</span>
  </div>`;

  html += `<div class="roaming-table-wrap"><table class="roaming-track-table">
    <thead><tr>
      ${roamSortTh('MAC', 'mac')}
      ${roamSortTh('Hersteller', 'vendor')}
      ${roamSortTh('Client-Info', 'client')}
      ${roamSortTh('Bezeichnung (NAC)', 'nacLabel', 'min-width:100px;max-width:200px')}
      ${roamSortTh('Roam-Schritte', 'roams', 'text-align:right;white-space:nowrap')}
      ${roamSortTh('Zuletzt (Syslog)', 'last', 'white-space:nowrap')}
      ${roamSortTh('Hinweise', 'hints')}
      ${roamSortTh('Verlauf', 'verlauf', 'min-width:140px')}
      <th style="width:96px">Details</th>
      <th style="width:52px"></th>
    </tr></thead><tbody id="tbody-roaming-tracker">`;

  for (const t of sortedTracks) {
    const wlan = enrichFromWlan(t.mac);
    const syslogHosts = syslogHostnamesForTrack(t.events);
    const searchAttr = h(rowSearchBlob(t, wlan, syslogHosts));
    const lastTs = t.events.length ? t.events[t.events.length - 1].ts : '';

    let tlInner = '';
    const roamsPreview = t.roams.slice(-MAX_TL);
    const hiddenOlder = t.roams.length - roamsPreview.length;
    for (const r of [...roamsPreview].reverse()) {
      tlInner += `<div class="roaming-tl-row">
        <div class="roaming-tl-time">${escHtml(fmtShort(r.ts))}</div>
        <div class="roaming-tl-ap">von ${apHtml(r.fromAp)} <span class="roaming-tl-arrow">→</span> ${apHtml(r.toAp)}</div>
      </div>`;
    }
    if (hiddenOlder > 0) {
      tlInner += `<div class="roaming-card-note">… ${hiddenOlder} ältere Schritte (in „Details“ vollständig)</div>`;
    }

    const verlaufCell = t.roams.length
      ? `<details class="roam-details"><summary style="cursor:pointer;font-size:11px;color:var(--accent)">${t.roams.length} Schritt${t.roams.length !== 1 ? 'e' : ''} <span style="color:var(--text3);font-weight:400">(neueste zuerst)</span></summary><div class="roaming-timeline" style="margin-top:8px">${tlInner}</div></details>`
      : `<span style="font-size:11px;color:var(--text3)">${t.events.length} Syslog, kein AP-Wechsel · ${apHtml(t.events[t.events.length - 1].reporterIp)}</span>`;

    const detailBtn = t.events.length
      ? `<button type="button" class="btn btn-sm" onclick='openRoamDetailView(${JSON.stringify(t.mac)})' title="Vollständiger Verlauf mit allen Syslog-Feldern">Details</button>`
      : '<span style="font-size:10px;color:var(--text3)">—</span>';

    const probOnly = (t.problems || []).length
      ? (t.problems || []).map(p =>
        `<span class="roaming-badge ${p.level === 'bad' ? 'roaming-badge-bad' : 'roaming-badge-warn'}" style="display:inline-block;margin:2px 4px 2px 0">${escHtml(p.text)}</span>`,
      ).join('')
      : (!t.roams.length && t.events.length
        ? '<span class="roaming-badge roaming-badge-info">Kein AP-Wechsel</span>'
        : '<span style="font-size:11px;color:var(--text3)">—</span>');

    const nm = nacMetaForTrack(t);
    const nacLabelCell = nm.label
      ? `<span style="color:var(--text2);font-size:12px" title="Bezeichnung aus NAC">${escHtml(nm.label)}</span>${nm.vlan != null ? ` <span class="badge badge-gray" title="Dynamisches VLAN (NAC)">VLAN ${escHtml(String(nm.vlan))}</span>` : ''}`
      : '—';

    const macDelBtn = !t.partialOui
      ? `<button type="button" class="btn btn-sm btn-ghost" title="Alle Syslog-Zeilen mit dieser MAC löschen" onclick='deleteRoamingTrackerMac(${JSON.stringify(t.mac)})'>×</button>`
      : '<span style="font-size:10px;color:var(--text3)" title="Nur OUI in Syslog — Zeilen einzeln unten löschen">—</span>';

    html += `<tr class="roam-track-row" data-search="${searchAttr}">
      <td>${formatRoamMacCell(t.mac, t)}</td>
      <td class="roam-vendor-td">${formatRoamVendorCell(t.mac)}</td>
      <td>${formatClientInfoCell(wlan, syslogHosts)}</td>
      <td style="max-width:200px;word-break:break-word">${nacLabelCell}</td>
      <td style="text-align:right;font-variant-numeric:tabular-nums">${t.roams.length}</td>
      <td style="font-size:11px;color:var(--text3);white-space:nowrap">${escHtml(fmtShort(lastTs))}</td>
      <td style="max-width:280px">${probOnly}</td>
      <td>${verlaufCell}</td>
      <td style="text-align:center;vertical-align:middle">${detailBtn}</td>
      <td style="text-align:center;vertical-align:middle">${macDelBtn}</td>
    </tr>`;
  }

  html += '</tbody></table></div>';
  root.innerHTML = html;
  filterRoamTable();
}

export async function loadRoamingSyslog() {
  const ip = q('roaming-syslog-ip-filter')?.value?.trim() || '';
  let url = '/api/syslog?limit=3000';
  if (ip) url += `&ip=${encodeURIComponent(ip)}`;
  const tb = q('tbody-roaming-syslog');
  const hint = q('roaming-syslog-hint');
  const tracker = q('roaming-tracker-root');
  try {
    const r = await fetch(url);
    let body;
    try {
      body = await r.json();
    } catch {
      if (tb) tb.innerHTML = `<tr><td colspan="7" class="empty" style="color:var(--red)">Antwort ist kein JSON (HTTP ${r.status})</td></tr>`;
      if (hint) hint.textContent = '';
      if (tracker) tracker.innerHTML = '';
      return;
    }
    if (!r.ok) {
      const msg = (body && (body.error || body.message)) || `HTTP ${r.status}`;
      if (tb) tb.innerHTML = `<tr><td colspan="7" class="empty" style="color:var(--red)">${h(String(msg))}</td></tr>`;
      if (hint) hint.textContent = '';
      if (tracker) tracker.innerHTML = '';
      return;
    }
    const list = Array.isArray(body) ? body : [];
    const filtered = list.filter(isRoamingSyslogEntry);
    const noMacLines = filtered.filter((e) => {
      const t = `${e.message || ''} ${e.raw || ''}`;
      MAC_RE.lastIndex = 0;
      return !textHasMacOrOui(t);
    }).length;

    if (hint) {
      hint.textContent = list.length
        ? `${filtered.length} von ${list.length} Syslog-Zeilen nach Roaming-Stichworten · Tracker nutzt Zeilen mit MAC + wechselndem Absender.`
        : 'Keine Syslog-Daten — Geräte müssen an UDP/1514 senden.';
    }

    const clientEvents = extractClientEvents(filtered);
    const tracks = buildTracks(clientEvents);
    renderRoamingTracker(tracks, { noMacLines, filteredCount: filtered.length });

    renderRoamingSyslogTable(filtered.slice(0, 400));
  } catch (e) {
    if (tb) tb.innerHTML = `<tr><td colspan="7" class="empty" style="color:var(--red)">${h(e.message || 'Fehler beim Laden')}</td></tr>`;
    if (hint) hint.textContent = '';
    if (tracker) tracker.innerHTML = '';
  }
}

function renderRoamingSyslogTable(rows) {
  const tb = q('tbody-roaming-syslog');
  const cnt = q('cnt-roaming-syslog');
  if (!tb) return;
  if (cnt) cnt.textContent = rows.length ? `(${rows.length})` : '';
  if (!rows.length) {
    tb.innerHTML = '<tr><td colspan="7" class="empty">Keine passenden Roaming-Einträge im Syslog — Stichworte: roam, reassoc, 802.11r, WLAN-Client-Wechsel …</td></tr>';
    return;
  }
  tb.innerHTML = rows.map((e) => {
    const ts = e.ts ? new Date(e.ts).toLocaleString('de-DE') : '—';
    const sevColor = SEV_COLORS[e.severity] || 'var(--text2)';
    const msg = escHtml(e.message || e.raw || '');
    const msgShort = msg.length > 220 ? msg.slice(0, 220) + '…' : msg;
    const payload = encodeURIComponent(JSON.stringify({
      ts: e.ts,
      from: e.from,
      message: e.message == null ? '' : e.message,
    }));
    return `<tr>
      <td style="white-space:nowrap;font-size:11px;color:var(--text3)">${ts}</td>
      <td style="font-family:monospace;font-size:11px">${escHtml(e.from)}</td>
      <td><span style="color:${sevColor};font-weight:600;font-size:11px">${escHtml(e.severity || '?')}</span></td>
      <td style="font-size:11px;color:var(--text3)">${escHtml(e.facility || '')}</td>
      <td style="font-size:11px">${escHtml(e.program || '')}</td>
      <td style="font-size:11px;max-width:520px;word-break:break-word" title="${msg}">${msgShort}</td>
      <td style="text-align:center;vertical-align:middle"><button type="button" class="btn btn-sm btn-ghost" title="Diese Zeile aus dem Syslog löschen" onclick="roamingDeleteSyslogRow(this)" data-payload="${payload}">×</button></td>
    </tr>`;
  }).join('');
}

/** Löscht eine einzelne Roh-Zeile (gleicher Eintrag wie in data/syslog.json). */
export async function roamingDeleteSyslogRow(btn) {
  let payload;
  try {
    payload = JSON.parse(decodeURIComponent(btn.dataset.payload || ''));
  } catch {
    return;
  }
  try {
    const r = await fetch('/api/syslog/entry', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok || body.ok === false) {
      window.alert?.((body && body.error) || `Löschen fehlgeschlagen (HTTP ${r.status})`);
      return;
    }
    await loadRoamingSyslog();
  } catch (e) {
    window.alert?.(e.message || 'Netzwerkfehler');
  }
}

/** Leert die komplette Syslog-Liste (alle Tabs). */
export async function clearRoamingSyslogAll() {
  if (!window.confirm('Alle gespeicherten Syslog-Einträge löschen? Betrifft Roaming, Syslog-Tab und UDP/1514-Puffer.')) return;
  try {
    const r = await fetch('/api/syslog', { method: 'DELETE' });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      window.alert?.((body && body.error) || `HTTP ${r.status}`);
      return;
    }
    await loadRoamingSyslog();
  } catch (e) {
    window.alert?.(e.message || 'Netzwerkfehler');
  }
}

/** Entfernt alle Syslog-Zeilen, die diese vollständige MAC enthalten (Tracker-Zeile). */
export async function deleteRoamingTrackerMac(mac) {
  if (!mac || !window.confirm(`Alle Syslog-Zeilen mit dieser MAC löschen?\n${mac}`)) return;
  try {
    const r = await fetch('/api/syslog/delete-for-mac', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mac }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      window.alert?.((body && body.error) || `HTTP ${r.status}`);
      return;
    }
    await loadRoamingSyslog();
  } catch (e) {
    window.alert?.(e.message || 'Netzwerkfehler');
  }
}
