import S from '../lib/state.js';
import { q, h, setBadge } from '../lib/helpers.js';

let trapsPollTimer = null;
const TRAPS_AUTOREFRESH_LS = 'onsite-traps-autorefresh';
const TRAPS_AUTOREFRESH_MS = 5000;

function isTrapsPanelActive() {
  return q('panel-traps')?.classList.contains('active');
}

function stopTrapsAutoRefreshTimer() {
  if (trapsPollTimer) {
    clearInterval(trapsPollTimer);
    trapsPollTimer = null;
  }
}

export function setTrapsAutoRefresh(enabled) {
  localStorage.setItem(TRAPS_AUTOREFRESH_LS, enabled ? '1' : '0');
  const cb = q('traps-autorefresh');
  if (cb) cb.checked = enabled;
  stopTrapsAutoRefreshTimer();
  if (enabled && isTrapsPanelActive()) {
    trapsPollTimer = setInterval(() => { loadTraps(); }, TRAPS_AUTOREFRESH_MS);
  }
}

export function applyTrapsAutoRefresh() {
  stopTrapsAutoRefreshTimer();
  if (localStorage.getItem(TRAPS_AUTOREFRESH_LS) === '1' && isTrapsPanelActive()) {
    trapsPollTimer = setInterval(() => { loadTraps(); }, TRAPS_AUTOREFRESH_MS);
  }
}

export function stopTrapsAutoRefresh() {
  stopTrapsAutoRefreshTimer();
}

export function initTrapsAutoRefreshUi() {
  const cb = q('traps-autorefresh');
  if (!cb) return;
  cb.checked = localStorage.getItem(TRAPS_AUTOREFRESH_LS) === '1';
}

export function trapToggle(rowId) {
  const el = q(rowId);
  if (el) el.style.display = el.style.display === 'none' ? '' : 'none';
}

export async function loadTraps() {
  try { renderTraps(await (await fetch('/api/traps')).json()); } catch {}
}

export function renderTraps(traps) {
  window._trapLog = traps;
  setBadge('traps', traps.length);
  const cnt = q('cnt-traps'); if (cnt) cnt.textContent = traps.length ? traps.length + ' Einträge' : '';
  const tbody = q('tbody-traps');
  if (!tbody) return;
  if (!traps.length) { tbody.innerHTML = '<tr><td colspan="8" class="empty">Keine Traps empfangen</td></tr>'; return; }

  function fmtTicks(ticks) {
    if (ticks == null) return '—';
    let s = Math.floor(Number(ticks) / 100);
    const d = Math.floor(s / 86400); s %= 86400;
    const hh = Math.floor(s / 3600); s %= 3600;
    const mm = Math.floor(s / 60);   s %= 60;
    return (d ? d + 'd ' : '') + String(hh).padStart(2,'0') + ':' + String(mm).padStart(2,'0') + ':' + String(s).padStart(2,'0');
  }

  const trapColor = name => {
    if (!name) return 'badge-gray';
    if (/linkDown|offline|fail|error/i.test(name)) return 'badge-red';
    if (/linkUp|online|start/i.test(name))          return 'badge-green';
    if (/warm|auth/i.test(name))                    return 'badge-orange';
    return 'badge-blue';
  };

  tbody.innerHTML = traps.map((t, idx) => {
    const devName = Object.values(S.deviceStore).find(d => d.ip === t.from)?.name || '';
    const trapLabel = t.trapName || t.pduType || '—';
    const vbCount = t.varbinds?.length || 0;
    const hasDetail = vbCount > 0 || t.enterprise || t.agentAddr || t.parseError;
    const rowId = 'trap-detail-' + idx;

    // Single expandable detail row
    const detailRow = !hasDetail ? '' : (() => {
      let inner = '';
      if (t.enterprise || t.agentAddr) {
        inner += `<div style="padding:6px 16px;font-size:12px;border-bottom:1px solid var(--border)">`;
        if (t.enterprise) inner += `<span style="color:var(--text3)">Enterprise:</span> <span class="mono">${h(t.enterprise)}</span>&nbsp;&nbsp;`;
        if (t.agentAddr)  inner += `<span style="color:var(--text3)">Agent:</span> <span class="mono">${h(t.agentAddr)}</span>`;
        inner += `</div>`;
      }
      if (t.parseError) inner += `<div style="padding:6px 16px;color:#ef4444;font-size:12px">Parse-Fehler: ${h(t.parseError)}</div>`;
      if (vbCount) {
        inner += `<table style="width:100%;border-collapse:collapse">` +
          (t.varbinds||[]).map(vb => {
            const label = vb.name
              ? `<b style="color:var(--accent)">${h(vb.name)}</b> <span style="color:var(--text3);font-size:10px">${h(vb.oid)}</span>`
              : `<span class="mono" style="font-size:11px">${h(vb.oid)}</span>`;
            const valStr = vb.type === 'TimeTicks' ? `${vb.val} (${fmtTicks(Number(vb.val))})` : String(vb.val ?? '—');
            return `<tr style="border-top:1px solid var(--border)">
              <td style="padding:4px 12px;color:var(--text3);font-size:10px;white-space:nowrap;width:80px">${h(vb.type)}</td>
              <td style="padding:4px 8px;width:40%">${label}</td>
              <td style="padding:4px 12px;font-family:monospace;font-size:11px;word-break:break-all">${h(valStr)}</td>
            </tr>`;
          }).join('') + `</table>`;
      }
      return `<tr id="${rowId}" style="display:none"><td colspan="8" style="padding:0;background:var(--bg3)">${inner}</td></tr>`;
    })();

    const mainRow = `<tr style="cursor:${hasDetail?'pointer':'default'}" ${hasDetail?`onclick="trapToggle('${rowId}')"`:''}>
      <td class="mono" style="font-size:11px;white-space:nowrap">${h(t.ts.replace('T',' ').slice(0,19))}</td>
      <td class="mono" style="font-size:12px">${h(t.from)}${devName?`<div style="font-size:10px;color:var(--text3)">${h(devName)}</div>`:''}</td>
      <td><span class="badge badge-gray">${h(t.version||'?')}</span></td>
      <td class="mono" style="color:var(--text2);font-size:12px">${h(t.community||'—')}</td>
      <td><span class="badge badge-gray" style="font-size:10px">${h(t.pduType||'—')}</span></td>
      <td><span class="badge ${trapColor(trapLabel)}">${h(trapLabel)}</span></td>
      <td class="mono" style="font-size:11px;color:var(--text3)">${fmtTicks(t.uptime)}</td>
      <td style="font-size:11px;color:var(--text3)">${vbCount ? `${vbCount} Varbind${vbCount>1?'s':''} ▾` : h(t.raw)}</td>
    </tr>`;
    return mainRow + detailRow;
  }).join('');
}

export async function clearTraps() {
  await fetch('/api/traps', { method: 'DELETE' });
  renderTraps([]);
}

if (typeof window !== 'undefined') {
  window.trapToggle = trapToggle;
}
