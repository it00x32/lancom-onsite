import { q, h } from '../lib/helpers.js';

let sniPollT = null;

function sniSchedulePoll() {
  if (sniPollT != null) return;
  const tick = async () => {
    if (!q('panel-sni')?.classList.contains('active')) {
      sniPollT = null;
      return;
    }
    await sniRefresh();
    sniPollT = setTimeout(tick, 2000);
  };
  sniPollT = setTimeout(tick, 2000);
}

export function sniTabActivated() {
  sniRefresh();
  sniSchedulePoll();
}

async function sniRefresh() {
  try {
    const r = await fetch('/api/tools/sni');
    const d = await r.json();
    sniApplyState(d);
  } catch (e) {
    const st = q('sni-status');
    if (st) st.textContent = 'Fehler: ' + (e.message || String(e));
  }
}

function sniApplyState(d) {
  const run = d.running;
  const st = q('sni-status');
  const btnS = q('sni-btn-start');
  const btnP = q('sni-btn-stop');
  const portEl = q('sni-port');
  if (btnS) btnS.disabled = !!run;
  if (btnP) btnP.disabled = !run;
  if (portEl) portEl.disabled = !!run;
  const filt = q('sni-filter');
  if (filt) filt.disabled = !!run;
  if (st) {
    st.textContent = run
      ? `Aktiv auf ${d.bind || '0.0.0.0'}:${d.port}` +
        (d.filterDomains && d.filterDomains.length ? ` · Filter: ${d.filterDomains.join(', ')}` : '')
      : 'Gestoppt';
  }
  const tb = q('tbody-sni');
  if (!tb) return;
  const rows = [...(d.logs || [])].reverse();
  if (!rows.length) {
    tb.innerHTML =
      '<tr><td colspan="4" class="empty">Keine Einträge</td></tr>';
    return;
  }
  tb.innerHTML = rows
    .map((e) => {
      const t = new Date(e.ts).toLocaleString('de-DE');
      if (e.msg) {
        return `<tr><td>${h(t)}</td><td colspan="2" style="color:var(--text3)">${h(e.msg)}</td><td>—</td></tr>`;
      }
      const sniCell = e.sni
        ? h(e.sni)
        : `<span style="color:var(--text3)">(${h(e.reason || '—')})</span>`;
      return `<tr><td>${h(t)}</td><td style="font-family:monospace;font-size:11px">${h(e.remote || '')}</td><td>${sniCell}</td><td>${e.bytes ?? '—'}</td></tr>`;
    })
    .join('');
}

export async function sniStart() {
  const port = parseInt(q('sni-port')?.value || '8443', 10);
  const filterDomains = q('sni-filter')?.value?.trim() || '';
  const r = await fetch('/api/tools/sni/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ port, filterDomains }),
  });
  const d = await r.json();
  if (!r.ok) {
    alert(d.error || 'Start fehlgeschlagen');
    await sniRefresh();
    return;
  }
  sniApplyState(d);
}

export async function sniStop() {
  const r = await fetch('/api/tools/sni/stop', { method: 'POST' });
  const d = await r.json();
  if (!r.ok) alert(d.error || 'Stopp fehlgeschlagen');
  sniApplyState(d);
}

export async function sniClearLogs() {
  const r = await fetch('/api/tools/sni/clear', { method: 'POST' });
  const d = await r.json();
  sniApplyState(d);
}

window.sniTabActivated = sniTabActivated;
window.sniStart = sniStart;
window.sniStop = sniStop;
window.sniClearLogs = sniClearLogs;
