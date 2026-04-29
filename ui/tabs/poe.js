import S from '../lib/state.js';
import { q, h } from '../lib/helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// POE HAUPTMENÜ
// ═══════════════════════════════════════════════════════════════════════════════

const POE_STATUS = {1:'Disabled',2:'Searching',3:'Delivering',4:'Fault',5:'Test',6:'Other Fault',7:'Requesting Power',8:'Overcurrent'};
const POE_BADGE  = {1:'badge-gray',2:'badge-yellow',3:'badge-green',4:'badge-red',5:'badge-yellow',6:'badge-red',7:'badge-yellow',8:'badge-red'};
const POE_CLASS  = {0:'0 (≤15.4W)',1:'1 (≤4W)',2:'2 (≤7W)',3:'3 (≤15.4W)',4:'4 (≤30W)',5:'5 (≤45W)',6:'6 (≤60W)',7:'7 (≤75W)',8:'8 (≤90W)'};

let poeStore = {}; // ip → snmpPoe result

export async function syncPoeAll() {
  const btn = q('btn-poe-sync');
  const st  = q('poe-sync-status');
  const switches = Object.values(S.deviceStore).filter(d => d.type === 'switch' && d.online !== false);
  if (!switches.length) {
    st.className = 'status-bar error';
    st.textContent = 'Keine Online-Switches vorhanden.';
    return;
  }
  btn.disabled = true;
  st.className = 'status-bar loading';
  st.innerHTML = `<span class="spinner"></span> Frage ${switches.length} Switch${switches.length > 1 ? 'es' : ''} ab…`;
  let done = 0;
  await Promise.all(switches.map(async dev => {
    try {
      const data = await window.snmpQ?.(dev.ip, 'poe');
      if (data?.portEntries?.length || data?.main?.power) {
        poeStore[dev.ip] = { ...data, devName: dev.name || dev.ip };
        // auch deviceStore aktualisieren für Dashboard
        if (S.deviceStore[dev.ip]) S.deviceStore[dev.ip].poeMain = data.main;
      }
    } catch {}
    done++;
    st.innerHTML = `<span class="spinner"></span> ${done} / ${switches.length} – ${h(dev.name || dev.ip)}`;
  }));
  btn.disabled = false;
  const found = Object.keys(poeStore).length;
  st.className = found ? 'status-bar ok' : 'status-bar';
  st.textContent = found ? `Fertig – ${found} Switch${found !== 1 ? 'es' : ''} mit PoE-Daten.` : 'Fertig – keine PoE-Daten gefunden.';
  renderPoeTab();
  if (window.renderDashboard) void window.renderDashboard().catch(() => {});
}

export function renderPoeTab() {
  const el = q('poe-tab-content'); if (!el) return;
  if (!Object.keys(poeStore).length) {
    el.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text3)">Noch keine Daten – "Alle Switches abfragen" klicken.</div>`;
    return;
  }
  el.innerHTML = Object.entries(poeStore).map(([ip, data]) => {
    const dev = S.deviceStore[ip];
    const m   = data.main || {};
    const pct = (m.power && m.consumption) ? Math.round(m.consumption / m.power * 100) : null;
    const barColor = pct === null ? 'var(--accent)' : pct > 85 ? '#ef4444' : pct > 65 ? '#f97316' : '#22c55e';
    const ports = data.portEntries || [];
    const activeCount = ports.filter(e => parseInt(e.detectionStatus) === 5).length;

    return `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:16px;margin-bottom:16px">
      <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:10px">
        <span style="font-size:14px;font-weight:700;cursor:pointer" onclick="openDeviceDetail('${ip}')">${h(data.devName)}</span>
        <span style="font-size:12px;color:var(--text3)">${activeCount} Port${activeCount !== 1 ? 's' : ''} aktiv</span>
      </div>
      ${m.power ? `<div style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:5px">
          <span style="font-size:11px;color:var(--text3)">Verbrauch</span>
          <span style="font-size:13px;font-weight:700;color:${barColor}">${m.consumption || 0} W / ${m.power} W${pct !== null ? ' (' + pct + '%)' : ''}</span>
        </div>
        <div style="height:8px;background:var(--bg3);border-radius:4px;overflow:hidden">
          <div style="height:100%;width:${Math.min(pct || 0, 100)}%;background:${barColor};border-radius:4px;transition:width .4s"></div>
        </div>
      </div>` : ''}
      ${ports.length ? `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="border-bottom:1px solid var(--border)">
          <th style="text-align:left;padding:4px 8px;color:var(--text3);font-weight:600">Port</th>
          <th style="text-align:left;padding:4px 8px;color:var(--text3);font-weight:600">Admin</th>
          <th style="text-align:left;padding:4px 8px;color:var(--text3);font-weight:600">Status</th>
          <th style="text-align:left;padding:4px 8px;color:var(--text3);font-weight:600">Klasse</th>
        </tr></thead>
        <tbody>${ports.map(e => {
          const stN   = parseInt(e.detectionStatus);
          const admin = e.adminEnable === '1' || e.adminEnable === 'true';
          return `<tr style="border-bottom:1px solid var(--border)">
            <td style="padding:4px 8px;font-family:var(--mono)">${h(e.group)}.${h(e.port)}</td>
            <td style="padding:4px 8px">${admin ? '<span class="badge badge-green">An</span>' : '<span class="badge badge-gray">Aus</span>'}</td>
            <td style="padding:4px 8px"><span class="badge ${POE_BADGE[stN] || 'badge-gray'}">${POE_STATUS[stN] || e.detectionStatus || '—'}</span></td>
            <td style="padding:4px 8px">${POE_CLASS[parseInt(e.powerClass)] || e.powerClass || '—'}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>` : `<div style="color:var(--text3);font-size:12px">Keine PoE-Ports.</div>`}
    </div>`;
  }).join('');
}
