import S from '../lib/state.js';
import { q, h } from '../lib/helpers.js';

let mibResults = [];
let mibHistory = [];

const WELL_KNOWN = [
  { oid: '1.3.6.1.2.1.1',       label: 'system'          },
  { oid: '1.3.6.1.2.1.2.2',     label: 'ifTable'         },
  { oid: '1.3.6.1.2.1.4.22',    label: 'ipNetToMedia (ARP)' },
  { oid: '1.3.6.1.2.1.17.4.3',  label: 'dot1dTpFdb (MAC)' },
  { oid: '1.3.6.1.2.1.17.7.1',  label: 'dot1qVlan'       },
  { oid: '1.3.6.1.2.1.47.1.1',  label: 'entPhysical'     },
  { oid: '1.3.6.1.2.1.31.1.1',  label: 'ifXTable'        },
  { oid: '1.3.6.1.4.1.2356',    label: 'LANCOM (private)' },
];

function mibHost() {
  const sel = q('mib-dev-select');
  return sel?.value || '';
}

function mibStatus(msg, err) {
  const el = q('mib-status');
  if (!el) return;
  el.textContent = msg;
  el.style.color = err ? 'var(--red)' : 'var(--text3)';
  if (msg) setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 8000);
}

function parseVarbindLine(raw) {
  const m = raw.match(/^([\d.]+)\s*=\s*(\w[\w-]*):\s*(.*)/s);
  if (m) return { oid: m[1].replace(/^\./, ''), type: m[2], value: m[3].trim().replace(/^"(.*)"$/, '$1') };
  const m2 = raw.match(/^([\d.]+)\s*=\s*(.*)/s);
  if (m2) return { oid: m2[1].replace(/^\./, ''), type: '?', value: m2[2].trim() };
  return null;
}

function populateMibDevSelect() {
  const sel = q('mib-dev-select');
  if (!sel) return;
  const devs = Object.values(S.deviceStore || {}).sort((a, b) => (a.name || a.sysName || a.ip || '').localeCompare(b.name || b.sysName || b.ip || ''));
  sel.innerHTML = '<option value="">— Gerät / IP —</option>' +
    devs.map(d => `<option value="${d.ip}">${d.name || d.sysName || d.ip} (${d.ip})</option>`).join('');
}

export async function mibWalk(oidOverride) {
  const host = q('mib-host-input')?.value?.trim() || mibHost();
  const oid = oidOverride || q('mib-oid')?.value?.trim() || '1.3.6.1.2.1.1';
  if (!host) return mibStatus('Kein Gerät gewählt', true);
  if (!oid) return mibStatus('Keine OID angegeben', true);

  if (!oidOverride) q('mib-oid').value = oid;
  mibStatus('Walk läuft…');
  q('mib-run-btn')?.setAttribute('disabled', '');

  try {
    const r = await fetch('/api/mib', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host, oid, action: 'walk' }),
    });
    const data = await r.json();
    if (data.error) throw new Error(data.error);
    mibResults = (data.lines || []).map(parseVarbindLine).filter(Boolean);
    mibHistory.push({ oid, host, count: mibResults.length });
    if (mibHistory.length > 30) mibHistory.shift();
    renderMibResults();
    mibStatus(`${mibResults.length} Ergebnisse`);
  } catch (e) {
    mibStatus(e.message, true);
  } finally {
    q('mib-run-btn')?.removeAttribute('disabled');
  }
}

export async function mibGet() {
  const host = q('mib-host-input')?.value?.trim() || mibHost();
  const oid = q('mib-oid')?.value?.trim();
  if (!host) return mibStatus('Kein Gerät gewählt', true);
  if (!oid) return mibStatus('Keine OID angegeben', true);

  mibStatus('GET läuft…');
  try {
    const r = await fetch('/api/mib', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host, oid, action: 'get' }),
    });
    const data = await r.json();
    if (data.error) throw new Error(data.error);
    mibResults = (data.lines || []).map(parseVarbindLine).filter(Boolean);
    renderMibResults();
    mibStatus(`${mibResults.length} Ergebnis(se)`);
  } catch (e) {
    mibStatus(e.message, true);
  }
}

export async function mibSet() {
  const host = q('mib-host-input')?.value?.trim() || mibHost();
  const oid = q('mib-oid')?.value?.trim();
  const type = q('mib-set-type')?.value || 'i';
  const value = q('mib-set-value')?.value || '';
  if (!host || !oid) return mibStatus('Host und OID erforderlich', true);

  if (!confirm(`SNMP SET auf ${host}:\nOID: ${oid}\nTyp: ${type}\nWert: ${value}\n\nFortfahren?`)) return;

  mibStatus('SET läuft…');
  try {
    const r = await fetch('/snmpset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host, oid, type, value }),
    });
    const data = await r.json();
    if (data.error) throw new Error(data.error);
    mibStatus('SET erfolgreich ✓');
    await mibGet();
  } catch (e) {
    mibStatus('SET Fehler: ' + e.message, true);
  }
}

export function mibWalkFrom(oid) {
  q('mib-oid').value = oid;
  mibWalk(oid);
}

export function mibPreset(oid) {
  q('mib-oid').value = oid;
  mibWalk(oid);
}

export function mibCopyOid(oid) {
  navigator.clipboard?.writeText(oid);
  mibStatus('OID kopiert: ' + oid);
}

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatValue(type, value) {
  if (type === 'Hex-STRING') {
    const hex = value.replace(/\s+/g, ' ');
    const bytes = hex.split(' ').filter(Boolean);
    if (bytes.length === 6) return `<span class="mib-mac">${bytes.map(b => b.padStart(2, '0')).join(':')}</span>`;
    if (bytes.length <= 32) return `<code>${escHtml(hex)}</code>`;
    return `<code title="${escHtml(hex)}">${escHtml(hex.slice(0, 60))}…</code>`;
  }
  if (type === 'Timeticks') {
    const m = value.match(/\((\d+)\)/);
    if (m) {
      const t = parseInt(m[1]) / 100;
      const d = Math.floor(t / 86400), h = Math.floor((t % 86400) / 3600), min = Math.floor((t % 3600) / 60), s = Math.floor(t % 60);
      return `${d}d ${h}h ${min}m ${s}s <span style="color:var(--text3)">(${m[1]})</span>`;
    }
  }
  if (type === 'IpAddress') return `<span style="color:var(--cyan)">${escHtml(value)}</span>`;
  if (type === 'Counter32' || type === 'Counter64' || type === 'Gauge32') {
    return `<span style="color:var(--accent)">${escHtml(value)}</span>`;
  }
  const str = escHtml(value);
  return str.length > 120 ? `<span title="${str}">${str.slice(0, 120)}…</span>` : str;
}

export function renderMibResults() {
  const wrap = q('mib-results');
  if (!wrap) return;
  if (!mibResults.length) {
    wrap.innerHTML = '<div style="padding:30px;text-align:center;color:var(--text3)">Keine Ergebnisse</div>';
    return;
  }
  const cnt = q('mib-result-count');
  if (cnt) cnt.textContent = `${mibResults.length} Einträge`;
  const rows = mibResults.map((r, i) => `<tr>
    <td class="mib-oid-cell" title="${escHtml(r.oid)}">
      <span class="mib-oid-text">${escHtml(r.oid)}</span>
      <span class="mib-oid-actions">
        <button class="btn-micro" onclick="mibWalkFrom('${r.oid}')" title="Walk ab hier">↓</button>
        <button class="btn-micro" onclick="mibCopyOid('${r.oid}')" title="OID kopieren">⧉</button>
      </span>
    </td>
    <td><span class="mib-type-badge">${escHtml(r.type)}</span></td>
    <td class="mib-val-cell">${formatValue(r.type, r.value)}</td>
  </tr>`).join('');
  wrap.innerHTML = `<table class="mib-table">
    <thead><tr><th style="width:38%">OID</th><th style="width:12%">Typ</th><th>Wert</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

export function mibDevChanged() {
  const sel = q('mib-dev-select');
  const inp = q('mib-host-input');
  if (sel?.value && inp) inp.value = sel.value;
}

export function initMibBrowser() {
  populateMibDevSelect();
}
