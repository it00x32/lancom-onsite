import S from '../lib/state.js';
import { q, h } from '../lib/helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// PORT-TEST
// ═══════════════════════════════════════════════════════════════════════════════

export function populatePortTestSelect() {
  const sel = q('porttest-dev-select'); if (!sel) return;
  const prev = sel.value;
  const switches = Object.values(S.deviceStore)
    .filter(d => d.type === 'switch' && d.online !== false)
    .sort((a,b) => (a.name||a.ip).localeCompare(b.name||b.ip));
  sel.innerHTML = `<option value="">-- Gerät wählen --</option>` +
    switches.map(d => `<option value="${h(d.ip)}"${d.ip===prev?' selected':''}>${h(d.name||d.ip)} (${h(d.ip)})</option>`).join('');
}

export async function runPortDiag() {
  const sel = q('porttest-dev-select');
  const ip  = sel?.value;
  const st  = q('porttest-status');
  const el  = q('porttest-content');
  if (!ip) { st.className='status-bar error'; st.textContent='Kein Gerät gewählt.'; return; }
  const dev = S.deviceStore[ip];
  st.className = 'status-bar loading';
  st.innerHTML = `<span class="spinner"></span> Lese Port-Daten von ${h(dev?.name||ip)}…`;
  el.innerHTML = '';
  try {
    const data = await window.snmpQ?.(ip, 'portdiag');
    renderPortDiag(data, ip);
    st.className = 'status-bar ok';
    st.textContent = `${data.entries.length} Ports gelesen.`;
  } catch(e) {
    st.className = 'status-bar error';
    st.textContent = `Fehler: ${e.message}`;
  }
}

function renderPortDiag(data, ip) {
  const el = q('porttest-content'); if (!el) return;
  const dev = S.deviceStore[ip];
  const entries = data.entries || [];
  if (!entries.length) { el.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text3)">Keine Port-Daten empfangen.</div>`; return; }

  const totalErrors = entries.reduce((s,p) => s + p.inErrors + p.outErrors + p.fcsErrors, 0);
  const downPorts   = entries.filter(p => p.operStatus === 2).length;
  const errPorts    = entries.filter(p => p.inErrors+p.outErrors+p.fcsErrors > 0).length;
  const upPorts     = entries.filter(p => p.operStatus === 1).length;

  // Summary tiles
  let html = `<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:16px">
    ${[
      ['UP', upPorts, '#22c55e'],
      ['DOWN', downPorts, downPorts?'#ef4444':'var(--text3)'],
      ['Mit Fehlern', errPorts, errPorts?'#f97316':'var(--text3)'],
      ['Fehler gesamt', totalErrors, totalErrors?'#ef4444':'var(--text3)'],
    ].map(([label,val,color]) => `<div style="flex:1;min-width:110px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px">
      <div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;margin-bottom:4px">${label}</div>
      <div style="font-size:26px;font-weight:800;color:${color}">${val}</div>
    </div>`).join('')}
  </div>`;

  // Port table
  html += `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">
    <thead><tr style="color:var(--text3);border-bottom:2px solid var(--border)">
      <th style="padding:6px 10px;text-align:left">Port</th>
      <th style="padding:6px 10px;text-align:left">Status</th>
      <th style="padding:6px 10px;text-align:right">Speed</th>
      <th style="padding:6px 10px;text-align:right">In-Errors</th>
      <th style="padding:6px 10px;text-align:right">Out-Errors</th>
      <th style="padding:6px 10px;text-align:right">FCS-Errors</th>
      <th style="padding:6px 10px;text-align:right">Align-Errors</th>
      <th style="padding:6px 10px;text-align:right">Discards</th>
      <th style="padding:6px 10px;text-align:left">Bewertung</th>
    </tr></thead>
    <tbody>
    ${entries.map((p,i) => {
      const up   = p.operStatus === 1;
      const errs = p.inErrors + p.outErrors + p.fcsErrors + p.alignErrors + p.symbolErrors;
      const disc = p.inDiscards + p.outDiscards;
      const badge = !up ? `<span class="badge badge-gray">DOWN</span>`
        : errs > 100  ? `<span class="badge badge-red">Kritisch</span>`
        : errs > 0    ? `<span class="badge badge-orange">Warnung</span>`
        : disc > 1000 ? `<span class="badge badge-yellow">Discards</span>`
        : `<span class="badge badge-green">OK</span>`;
      const rowBg = !up ? '' : errs > 100 ? 'background:#ef44440a' : errs > 0 ? 'background:#f974160a' : '';
      const speed = p.speedMbps >= 1000 ? (p.speedMbps/1000)+'G' : p.speedMbps ? p.speedMbps+'M' : up ? '?' : '—';
      const err = n => n > 0 ? `<span style="color:${n>100?'#ef4444':'#f97316'};font-weight:700">${n}</span>` : `<span style="color:var(--text3)">0</span>`;
      return `<tr style="border-top:1px solid var(--border);${rowBg}">
        <td style="padding:6px 10px;font-family:monospace;font-weight:600">${h(p.name)}</td>
        <td style="padding:6px 10px"><span class="badge ${up?'badge-green':'badge-gray'}">${up?'UP':'DOWN'}</span></td>
        <td style="padding:6px 10px;text-align:right;color:var(--text2)">${speed}</td>
        <td style="padding:6px 10px;text-align:right">${err(p.inErrors)}</td>
        <td style="padding:6px 10px;text-align:right">${err(p.outErrors)}</td>
        <td style="padding:6px 10px;text-align:right">${err(p.fcsErrors)}</td>
        <td style="padding:6px 10px;text-align:right">${err(p.alignErrors)}</td>
        <td style="padding:6px 10px;text-align:right">${disc>0?`<span style="color:var(--text2)">${disc}</span>`:`<span style="color:var(--text3)">0</span>`}</td>
        <td style="padding:6px 10px">${badge}</td>
      </tr>`;
    }).join('')}
    </tbody>
  </table></div>`;

  el.innerHTML = html;
}

if (typeof window !== 'undefined') {
  window.populatePortTestSelect = populatePortTestSelect;
  window.runPortDiag = runPortDiag;
}
