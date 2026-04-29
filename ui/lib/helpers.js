import S from './state.js';

export function q(id) { return document.getElementById(id); }
export function h(s)  { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

export function fmtBytes(n) {
  n = Number(n)||0;
  if (n < 1024)    return n + ' B';
  if (n < 1048576) return (n/1024).toFixed(1) + ' KB';
  if (n < 1073741824) return (n/1048576).toFixed(1) + ' MB';
  return (n/1073741824).toFixed(2) + ' GB';
}
export function fmtSpeed(mbps, bps) {
  if (mbps > 0) return mbps >= 1000 ? (mbps/1000)+'Gbit/s' : mbps+'Mbit/s';
  const b = Number(bps)||0; if (!b) return '—';
  return b >= 1e9 ? (b/1e9)+'Gbit/s' : b >= 1e6 ? (b/1e6)+'Mbit/s' : (b/1e3)+'kbit/s';
}

export function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('de-DE',{dateStyle:'short',timeStyle:'short'});
}
export function statusBadge(val) {
  const up = val==='1'||String(val).startsWith('up');
  return up ? `<span class="dot dot-green"></span><span class="badge badge-green">UP</span>`
             : `<span class="dot dot-red"></span><span class="badge badge-red">DOWN</span>`;
}
export function setBadge(id, n) { const el=q('badge-'+id); if(el) el.textContent = n>0?n:''; }

export const TYPE_LABELS = {
  'lx-ap':'Access Point','lcos-ap':'Access Point',
  'switch':'Switch','router':'Router','firewall':'Firewall','unknown':'Unbekannt'
};
export const TYPE_BADGE = {
  'lx-ap':'badge-green','lcos-ap':'badge-blue','switch':'badge-yellow',
  'router':'badge-gray','firewall':'badge-orange','unknown':'badge-gray'
};
export const OS_BADGE = {
  'LCOS LX':   'badge-green',
  'LCOS FX':   'badge-orange',
  'LCOS SX 3': 'badge-yellow',
  'LCOS SX 4': 'badge-yellow',
  'LCOS SX 5': 'badge-yellow',
  'LCOS':      'badge-blue',
  'LANCOM':    'badge-gray',
};

export const FILTER_OS_OPTS   = ['LCOS','LCOS LX','LCOS SX 3','LCOS SX 4','LCOS SX 5','LCOS FX'];
export const FILTER_TYPE_OPTS = ['Router','Access Point','Switch','Firewall'];

export function parseModelStr(s) {
  if (s == null || s === '') return '';
  let m;
  m = s.match(/^LANCOM\s+(\S+)/);                              if (m) return m[1];
  m = s.match(/^Linux\s+(\S+)/); if (m && !/^\d/.test(m[1])) return m[1];
  if (/^Linux\b/.test(s)) return '';
  return s.split(/\s+/)[0].substring(0, 30);
}

export function extractModel(sysDescr) {
  if (!sysDescr) return '';
  return parseModelStr(sysDescr.split(/[\r\n]/)[0].trim());
}

// Gespeicherte (ggf. alte) Modell-Strings für die Anzeige kürzen
export function shortModel(model) {
  return parseModelStr(model || '') || '—';
}

// ── Sortier-Hilfsfunktionen ────────────────────────────────────────────────────
export function mkTh(label, col, sort, clickFn) {
  const active = sort.col === col;
  const cls = active ? (sort.dir === 1 ? 'sortable sort-asc' : 'sortable sort-desc') : 'sortable';
  return `<th class="${cls}" onclick="${clickFn}('${col}')">${label}</th>`;
}
export function noSortTh(label) { return `<th>${label}</th>`; }

export function applySort(arr, sort, keyFn) {
  if (!sort.col) return arr;
  return [...arr].sort((a, b) => {
    const va = keyFn(a, sort.col), vb = keyFn(b, sort.col);
    if (va === vb) return 0;
    return (va < vb ? -1 : 1) * sort.dir;
  });
}

export function clickSort(sort, col, renderFn) {
  if (sort.col === col) sort.dir *= -1;
  else { sort.col = col; sort.dir = 1; }
  renderFn();
}

export function logActivity(text, type = 'info') {
  S.activityLog.unshift({ ts: new Date().toISOString(), text, type });
  if (S.activityLog.length > S.ACTIVITY_LOG_MAX) S.activityLog.length = S.ACTIVITY_LOG_MAX;
}

export function getLocations() {
  const locs = new Set();
  Object.values(S.deviceStore).forEach(d => { if (d.location) locs.add(d.location); });
  return [...locs].sort();
}

export function refreshLocationSelects() {
  const locs = getLocations();
  const filterOpts = `<option value="all">Alle Standorte</option>` + locs.map(l => `<option value="${h(l)}">${h(l)}</option>`).join('');
  const scanOpts   = `<option value="">Kein Standort</option>` + locs.map(l => `<option value="${h(l)}">${h(l)}</option>`).join('');
  [['dev-loc-filter', filterOpts], ['mesh-loc-filter', filterOpts],
   ['l2tp-loc-filter', filterOpts], ['topo-loc-filter', filterOpts],
   ['scan-loc-select', scanOpts]].forEach(([id, opts]) => {
    const el = q(id); if (!el) return;
    const cur = el.value; el.innerHTML = opts;
    if (cur) el.value = cur;
  });
}

export function matchesLocFilter(d) { return S.devLocFilter === 'all' || (d.location||'') === S.devLocFilter; }

/**
 * fetch-Response als JSON parsen. Leerer Body: bei HTTP-OK → {}, sonst verständlicher Fehler.
 * Verhindert „Unexpected end of JSON input“, wenn der Server keinen Body liefert.
 */
export async function parseFetchJson(r) {
  const text = await r.text();
  const t = String(text || '').trim();
  if (!t) {
    if (!r.ok) {
      throw new Error(`Leere Antwort vom Server (HTTP ${r.status}). Läuft OnSite und ist die URL korrekt?`);
    }
    return {};
  }
  try {
    return JSON.parse(t);
  } catch {
    const preview = t.length > 160 ? `${t.slice(0, 160)}…` : t;
    throw new Error(`Antwort ist kein gültiges JSON (HTTP ${r.status}): ${preview.replace(/\s+/g, ' ')}`);
  }
}

/** Wie parseFetchJson, bei leerem oder kaputtem Body still {} (Hintergrund-Caches). */
export async function parseFetchJsonLenient(r) {
  try {
    const text = await r.text();
    const t = String(text || '').trim();
    if (!t) return {};
    return JSON.parse(t);
  } catch {
    return {};
  }
}
