import S from '../lib/state.js';
import { q, h, fmtDate } from '../lib/helpers.js';

export function adminBadge(val) {
  // IF-MIB: adminStatus/operStatus 1=up 2=down 3=testing
  if (val==='1'||val==='up')   return '<span class="badge badge-green">Up</span>';
  if (val==='2'||val==='down') return '<span class="badge badge-red">Down</span>';
  return `<span class="badge badge-gray">${h(val||'—')}</span>`;
}

function fmtUptime(ticks) {
  if (ticks == null) return '—';
  if (typeof ticks === 'string') {
    const m = ticks.match(/\((\d+)\)/);
    ticks = m ? parseInt(m[1]) : parseInt(ticks);
  }
  if (isNaN(ticks)) return '—';
  let s = Math.floor(ticks / 100);
  const d = Math.floor(s / 86400); s %= 86400;
  const h = Math.floor(s / 3600);  s %= 3600;
  const m = Math.floor(s / 60);    s %= 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

function dashWarnings() {
  const warns = [];
  Object.values(S.deviceStore).forEach(d => {
    if (d.online === false) warns.push({ type:'error', text:`${d.name||d.ip} nicht erreichbar`, ip: d.ip });
    if (d.poeMain?.power && d.poeMain.consumption / d.poeMain.power > 0.8)
      warns.push({ type:'warn', text:`PoE ${d.name||d.ip}: ${Math.round(d.poeMain.consumption/d.poeMain.power*100)}% ausgelastet`, ip: d.ip });
    (d.wlanClients||[]).forEach(c => {
      if (c.signal && parseInt(c.signal) < -75)
        warns.push({ type:'warn', text:`Schwaches WLAN: ${c.mac} @ ${d.name||d.ip} (${c.signal} dBm)` });
    });
  });
  const loopCount = S.ldLastResults.reduce((s,r) => s + (r.data.lpDetectedPorts?.length||0), 0);
  if (loopCount > 0) warns.push({ type:'error', text:`${loopCount} Loop${loopCount!==1?'s':''} erkannt`, tab:'loopdetect' });
  const now = Date.now();
  const stpChanges = Object.values(S.stpStore).filter(s => s.ts && (now - new Date(s.ts).getTime()) < 86400000)
    .reduce((s,d) => s + (parseInt(d.global?.topChanges)||0), 0);
  if (stpChanges > 0) warns.push({ type:'warn', text:`${stpChanges} STP Topologie-Wechsel in den letzten 24h`, tab:'stp' });
  return warns;
}

function dashWlanSsidChart() {
  const ssidMap = {};
  Object.values(S.deviceStore).forEach(d =>
    (d.wlanClients||[]).forEach(c => { const s = c.ssid||'(unbekannt)'; ssidMap[s] = (ssidMap[s]||0)+1; })
  );
  const entries = Object.entries(ssidMap).sort((a,b) => b[1]-a[1]);
  if (!entries.length) return '<div style="color:var(--text3);font-size:12px;padding:12px 0">Keine WLAN-Daten – zuerst Sync ausführen</div>';
  const max = entries[0][1];
  return entries.map(([ssid, cnt]) => {
    const pct = Math.round(cnt/max*100);
    return `<div style="margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
        <span style="font-weight:600;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${h(ssid)}">${h(ssid)}</span>
        <span style="color:var(--text3)">${cnt}</span>
      </div>
      <div style="height:6px;background:var(--bg3);border-radius:3px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:var(--cyan);border-radius:3px"></div>
      </div>
    </div>`;
  }).join('');
}

async function fetchDashboardUptimes() {
  const devs = Object.values(S.deviceStore).filter(d => d.online === true);
  const snmpQ = window.snmpQ;
  if (!snmpQ) return;
  await Promise.all(devs.map(async dev => {
    try {
      const r = await snmpQ(dev.ip, 'uptime');
      if (r.ticks !== undefined) {
        S.dashUptimeCache[dev.ip] = r.ticks;
        const id = 'dash-uptime-' + dev.ip.replace(/\./g,'-');
        const el = q(id); if (el) el.textContent = fmtUptime(r.ticks);
      }
    } catch {}
  }));
}

async function fetchDashboardTraffic() {
  try {
    const data = await (await fetch('/api/iftraffic')).json();
    // Find top-5 busiest interfaces (by max(inBps,outBps))
    const list = [];
    Object.entries(data).forEach(([ip, ifaces]) => {
      const dev = S.deviceStore[ip];
      Object.entries(ifaces).forEach(([ifname, s]) => {
        const bps = Math.max(s.inBps||0, s.outBps||0);
        if (bps > 0) list.push({ ip, name: dev?.name||ip, ifname, inBps: s.inBps||0, outBps: s.outBps||0, bps });
      });
    });
    list.sort((a,b) => b.bps-a.bps);
    const el = q('dash-traffic-list'); if (!el) return;
    if (!list.length) { el.innerHTML = '<div style="color:var(--text3);font-size:12px">Kein aktiver Traffic erkannt – ggf. zweiten Aufruf abwarten</div>'; return; }
    const maxBps = list[0].bps;
    el.innerHTML = list.slice(0,5).map(e => {
      const pct = Math.round(e.bps/maxBps*100);
      return `<div style="margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:2px">
          <span style="font-weight:600">${h(e.name)} <span style="color:var(--text3);font-weight:400">${h(e.ifname)}</span></span>
          <span style="color:var(--text3);font-size:11px">↓${fmtBps(e.inBps)} ↑${fmtBps(e.outBps)}</span>
        </div>
        <div style="height:5px;background:var(--bg3);border-radius:3px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:var(--accent);border-radius:3px"></div>
        </div>
      </div>`;
    }).join('');
  } catch {}
}

function fmtBps(bps) {
  bps = Number(bps)||0;
  if (bps < 1000)    return bps+'b/s';
  if (bps < 1e6)     return (bps/1000).toFixed(0)+'kb/s';
  if (bps < 1e9)     return (bps/1e6).toFixed(1)+'Mb/s';
  return (bps/1e9).toFixed(2)+'Gb/s';
}

export function renderActivityLog() {
  const activityLog = S.activityLog;
  if (!activityLog.length) return '<div style="padding:16px;text-align:center;color:var(--text3);font-size:12px">Kein Verlauf</div>';
  return activityLog.slice(0,12).map((a,i) => {
    const col = a.type==='ok'?'#22c55e':a.type==='warn'?'#f97316':a.type==='error'?'#ef4444':'var(--text3)';
    return `<div style="padding:6px 12px;border-top:${i?'1px solid var(--border)':'none'};font-size:11px">
      <span style="color:${col};margin-right:6px">●</span>${h(a.text)}
      <div style="color:var(--text3);font-size:10px;margin-top:1px">${h((a.ts||'').replace('T',' ').slice(0,16))}</div>
    </div>`;
  }).join('');
}

export function toggleDashSection(id) {
  const list    = document.getElementById('dash-' + id + '-list');
  const chevron = document.getElementById('dash-' + id + '-chevron');
  if (!list) return;
  const collapsed = list.style.maxHeight === '0px' || list.style.opacity === '0';
  list.style.maxHeight = collapsed ? '2000px' : '0';
  list.style.opacity   = collapsed ? '1' : '0';
  if (chevron) chevron.style.transform = collapsed ? '' : 'rotate(-90deg)';
}

export function toggleDashWarns() { toggleDashSection('warns'); }

export async function renderDashboard() {
  const el = q('dash-content'); if (!el) return;
  const devs    = Object.values(S.deviceStore);
  const online  = devs.filter(d => d.online === true).length;
  const offline = devs.filter(d => d.online === false).length;
  const unknown = devs.length - online - offline;
  const wlanCnt = devs.reduce((s,d) => s + (d.wlanClients?.length||0), 0);
  const trapCnt = (window._trapLog?.length) || 0;

  const kachel = (label, value, sub, color, onclick) =>
    `<div style="flex:1;min-width:130px;max-width:200px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px;cursor:${onclick?'pointer':'default'}" ${onclick?`onclick="${onclick}"`:''}>
      <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px">${label}</div>
      <div style="font-size:28px;font-weight:800;color:${color};line-height:1">${value}</div>
      ${sub?`<div style="font-size:11px;color:var(--text3);margin-top:4px">${sub}</div>`:''}
    </div>`;

  const statusSub = [online&&`<span style="color:#22c55e">${online} online</span>`, offline&&`<span style="color:#ef4444">${offline} offline</span>`, unknown&&`<span style="color:var(--text3)">${unknown} ?</span>`].filter(Boolean).join(' · ');

  const pricePerKwh = S.appSettings.powerPricePerKwh ?? 0.30;
  const totalW = devs.reduce((s, d) => s + (d.poeMain?.consumption || 0), 0);
  const costPerMonth = totalW > 0 ? (totalW / 1000 * 24 * 30 * pricePerKwh) : 0;
  const powerSub = totalW > 0 ? `${costPerMonth.toFixed(2)} €/Monat` : 'kein PoE-Sync';
  const loopCount = S.ldLastResults.reduce((s,r) => s + (r.data.lpDetectedPorts?.length||0), 0);
  const now = Date.now();
  const stpChanges = Object.values(S.stpStore).filter(s => s.ts && (now - new Date(s.ts).getTime()) < 86400000).reduce((s,d) => s + (parseInt(d.global?.topChanges)||0), 0);

  // ── Stat-Kacheln ───────────────────────────────────────────────────────────
  let html = `<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:10px">
    ${kachel('Geräte gesamt', devs.length, statusSub, 'var(--accent)', "showTab('devices')")}
    ${kachel('Online', online, 'SNMP erreichbar', '#22c55e', "setDevFilter('online');showTab('devices')")}
    ${kachel('Offline', offline, offline ? 'nicht erreichbar' : 'alle erreichbar', offline ? '#ef4444' : 'var(--text3)', "setDevFilter('offline');showTab('devices')")}
    ${kachel('WLAN Clients', wlanCnt, wlanCnt?'aktive Verbindungen':'kein WLAN-Sync', 'var(--cyan)', "showTab('clients')")}
    ${kachel('SNMP Traps', trapCnt, trapCnt?'empfangen':'kein Trap', trapCnt?'#f97316':'var(--text3)', "showTab('traps')")}
    ${kachel('PoE Verbrauch', totalW ? totalW + ' W' : '—', powerSub, totalW ? '#f97316' : 'var(--text3)', "showTab('poe')")}
    ${kachel('Loops erkannt', loopCount, loopCount ? 'letzte Prüfung' : 'keine Loops', loopCount ? '#ef4444' : 'var(--text3)', "showTab('loopdetect')")}
    ${kachel('STP Wechsel', stpChanges, stpChanges ? 'letzte 24h' : 'keine Änderungen', stpChanges ? '#f97316' : 'var(--text3)', "showTab('stp')")}
  </div>`;

  // ── Letzter Sync (kompakt) ────────────────────────────────────────────────
  html += `<div style="display:flex;gap:16px;margin-bottom:16px;font-size:11px;color:var(--text3)">
    <span>Status: <b style="color:var(--text)">${S.dashLastStatusCheck ? fmtDate(S.dashLastStatusCheck) : '—'}</b></span>
    <span>Sync: <b style="color:var(--text)">${S.dashLastDataSync ? fmtDate(S.dashLastDataSync) : '—'}</b></span>
  </div>`;

  // ── Warnungen ─────────────────────────────────────────────────────────────
  const warns = dashWarnings();
  if (warns.length) {
    const errCnt  = warns.filter(w => w.type === 'error').length;
    const warnCnt = warns.filter(w => w.type === 'warn').length;
    const summary = [errCnt && `<span style="color:#ef4444">${errCnt} Fehler</span>`, warnCnt && `<span style="color:#f97316">${warnCnt} Warnung${warnCnt!==1?'en':''}</span>`].filter(Boolean).join(' · ');
    const collapsed = true;
    html += `<div style="margin-bottom:16px" id="dash-warns-wrap">
      <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px;display:flex;align-items:center;gap:10px;cursor:pointer;user-select:none" onclick="toggleDashWarns()">
        <span>Warnungen</span>
        <span style="font-weight:400;text-transform:none;letter-spacing:0;font-size:11px">${summary}</span>
        <span id="dash-warns-chevron" style="margin-left:auto;font-size:11px;transition:transform .2s;display:inline-block;${collapsed?'transform:rotate(-90deg)':''}">▾</span>
      </div>
      <div id="dash-warns-list" style="display:flex;flex-direction:column;gap:4px;overflow:hidden;transition:max-height .25s ease,opacity .2s ease;${collapsed?'max-height:0;opacity:0':'max-height:2000px;opacity:1'}">
        ${warns.map(w => `<div style="display:flex;align-items:center;gap:8px;padding:7px 12px;background:var(--bg2);border:1px solid ${w.type==='error'?'#ef44441a':'#f974161a'};border-radius:var(--radius);font-size:12px">
          <span style="color:${w.type==='error'?'#ef4444':'#f97316'};font-size:14px">${w.type==='error'?'✕':'⚠'}</span>
          <span style="flex:1">${h(w.text)}</span>
          ${w.ip ? `<button class="btn btn-sm" style="font-size:11px" onclick="openDeviceDetail('${h(w.ip)}')">Details</button>` : ''}
          ${w.tab ? `<button class="btn btn-sm" style="font-size:11px" onclick="showTab('${h(w.tab)}')">Anzeigen</button>` : ''}
        </div>`).join('')}
      </div>
    </div>`;
  }

  // ── Verfügbarkeit (Uptime-Tracking) ────────────────────────────────────────
  if (S.uptimeStats && Object.keys(S.uptimeStats).length) {
    const uptimeEntries = Object.entries(S.uptimeStats)
      .map(([ip, u]) => ({ ip, name: S.deviceStore[ip]?.name || ip, ...u }))
      .sort((a, b) => (a.stats?.pct ?? 100) - (b.stats?.pct ?? 100));
    const worstOnes = uptimeEntries.filter(e => e.stats && e.stats.pct < 100);
    const worstPct = uptimeEntries.length ? Math.min(...uptimeEntries.map(e => e.stats?.pct ?? 100)) : 100;
    const uptimeSummary = worstPct < 100 ? `<span style="color:#f97316">${uptimeEntries.filter(e=>e.stats&&e.stats.pct<100).length} mit Ausfällen</span>` : `<span style="color:#22c55e">alle stabil</span>`;
    html += `<div style="margin-bottom:16px">
      <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px;display:flex;align-items:center;gap:10px;cursor:pointer;user-select:none" onclick="toggleDashSection('uptime')">
        <span>Verfügbarkeit (24h)</span>
        <span style="font-weight:400;text-transform:none;letter-spacing:0;font-size:11px">${uptimeSummary} · ${uptimeEntries.length} Geräte</span>
        <button class="btn btn-sm" style="font-size:10px" onclick="event.stopPropagation();fetchUptimeStats()">Aktualisieren</button>
        <span id="dash-uptime-chevron" style="margin-left:auto;font-size:11px;transition:transform .2s;display:inline-block;transform:rotate(-90deg)">▾</span>
      </div>
      <div id="dash-uptime-list" style="display:flex;flex-wrap:wrap;gap:8px;overflow:hidden;transition:max-height .25s ease,opacity .2s ease;max-height:0;opacity:0">
      ${uptimeEntries.slice(0, 12).map(e => {
        const pct = e.stats?.pct ?? 0;
        const color = pct >= 99.9 ? '#22c55e' : pct >= 99 ? '#f97316' : '#ef4444';
        const sparkSvg = e.sparkline?.length ? renderSparklineSvg(e.sparkline) : '';
        return `<div style="flex:1;min-width:180px;max-width:280px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px;cursor:pointer" onclick="openDeviceDetail('${h(e.ip)}')">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px">
            <span style="font-size:12px;font-weight:600;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h(e.name)}</span>
            <span style="font-size:14px;font-weight:800;color:${color}">${pct}%</span>
          </div>
          ${sparkSvg}
          <div style="font-size:10px;color:var(--text3);margin-top:3px">${e.stats.probes} Probes · ${e.stats.down} Ausfälle</div>
        </div>`;
      }).join('')}
      </div>
    </div>`;
  }

  // ── PoE Übersicht ──────────────────────────────────────────────────────────
  const poeSwitches = devs.filter(d => d.type==='switch' && d.poeMain?.power);
  if (poeSwitches.length) {
    const totalW = poeSwitches.reduce((s,d) => s + (d.poeMain?.consumption||0), 0);
    const totalMax = poeSwitches.reduce((s,d) => s + (d.poeMain?.power||0), 0);
    const poePctTotal = totalMax ? Math.round(totalW/totalMax*100) : 0;
    const poeSummaryColor = poePctTotal>85?'#ef4444':poePctTotal>65?'#f97316':'#22c55e';
    html += `<div style="margin-bottom:16px">
      <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px;display:flex;align-items:center;gap:10px;cursor:pointer;user-select:none" onclick="toggleDashSection('poe')">
        <span>PoE Verbrauch</span>
        <span style="font-weight:400;text-transform:none;letter-spacing:0;font-size:11px;color:${poeSummaryColor}">${totalW}W / ${totalMax}W (${poePctTotal}%)</span>
        <span style="font-weight:400;text-transform:none;letter-spacing:0;font-size:11px;color:var(--text3)">${poeSwitches.length} Switch${poeSwitches.length!==1?'es':''}</span>
        <span id="dash-poe-chevron" style="margin-left:auto;font-size:11px;transition:transform .2s;display:inline-block;transform:rotate(-90deg)">▾</span>
      </div>
      <div id="dash-poe-list" style="display:flex;flex-wrap:wrap;gap:10px;overflow:hidden;transition:max-height .25s ease,opacity .2s ease;max-height:0;opacity:0">
      ${poeSwitches.map(d => {
        const {power,consumption} = d.poeMain;
        const pct = Math.round(consumption/power*100);
        const color = pct>85?'#ef4444':pct>65?'#f97316':'#22c55e';
        const devCostMonth = (consumption / 1000 * 24 * 30 * pricePerKwh);
        const devCostYear  = devCostMonth * 12;
        return `<div style="flex:1;min-width:180px;max-width:320px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px;cursor:pointer" onclick="openDeviceDetail('${h(d.ip)}');showStab('poe')">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:7px">
            <span style="font-size:13px;font-weight:700">${h(d.name||d.ip)}</span>
            <span style="font-size:13px;font-weight:700;color:${color}">${consumption}W <span style="font-size:11px;font-weight:400;color:var(--text3)">/ ${power}W</span></span>
          </div>
          <div style="height:8px;background:var(--bg3);border-radius:4px;overflow:hidden">
            <div style="height:100%;width:${Math.min(pct,100)}%;background:${color};border-radius:4px"></div>
          </div>
          <div style="display:flex;justify-content:space-between;margin-top:5px">
            <span style="font-size:10px;color:var(--text3)">${devCostMonth.toFixed(2)} €/Mon · ${devCostYear.toFixed(0)} €/Jahr</span>
            <span style="font-size:10px;color:var(--text3)">${pct}%</span>
          </div>
        </div>`;
      }).join('')}
      </div>
    </div>`;
  }

  // ── Topology Changes ────────────────────────────────────────────────────────
  html += `<div style="margin-bottom:16px" id="dash-topochanges-wrap">
    <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px;display:flex;align-items:center;gap:10px;cursor:pointer;user-select:none" onclick="toggleDashSection('topochanges')">
      <span>Topologie-Änderungen</span>
      <span id="dash-topochanges-summary" style="font-weight:400;text-transform:none;letter-spacing:0;font-size:11px;color:var(--text3)">Lade…</span>
      <button class="btn btn-sm" style="font-size:10px" onclick="event.stopPropagation();checkTopoChanges()">Prüfen</button>
      <button class="btn btn-sm btn-ghost" style="font-size:10px" onclick="event.stopPropagation();loadTopoChanges()">Aktualisieren</button>
      <span id="dash-topochanges-chevron" style="margin-left:auto;font-size:11px;transition:transform .2s;display:inline-block;transform:rotate(-90deg)">▾</span>
    </div>
    <div id="dash-topochanges-list" style="overflow:hidden;transition:max-height .25s ease,opacity .2s ease;max-height:0;opacity:0">
      <div id="topo-changes-content"></div>
    </div>
  </div>`;

  // ── Hauptbereich: 2 Spalten (Geräteliste nur unter „Geräte“) ───────────────
  html += `<div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start">`;

  // ── Spalte 1: WLAN-SSIDs + Traffic ─────────────────────────────────────
  html += `<div style="flex:1;min-width:260px;display:flex;flex-direction:column;gap:16px">
    <div>
      <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px">WLAN Clients je SSID</div>
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:12px">
        ${dashWlanSsidChart()}
      </div>
    </div>
    <div>
      <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px">
        Traffic Top-5
        <button class="btn btn-sm" style="margin-left:8px;font-size:10px" onclick="fetchDashboardTraffic()">Aktualisieren</button>
      </div>
      <div id="dash-traffic-list" style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:12px">
        <div style="color:var(--text3);font-size:12px">Klicke "Aktualisieren" zum Laden</div>
      </div>
    </div>
  </div>`;

  // ── Spalte 2: Aktivitätslog + Traps ─────────────────────────────────────
  html += `<div style="flex:1;min-width:260px;display:flex;flex-direction:column;gap:16px">
    <div>
      <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px">Aktivitätslog</div>
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden">
      ${renderActivityLog()}
      </div>
    </div>
    <div>
      <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px">
        Letzte Traps <span style="font-weight:400;font-size:10px;cursor:pointer;color:var(--accent)" onclick="showTab('traps')">→ alle</span>
      </div>
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden">
      ${(window._trapLog||[]).length ? (window._trapLog||[]).slice(0,6).map((t,i) => `
        <div style="padding:6px 12px;border-top:${i?'1px solid var(--border)':'none'}">
          <div style="display:flex;justify-content:space-between;font-size:11px">
            <span style="font-weight:600;color:var(--accent)">${h(t.from)}</span>
            <span style="color:var(--text3)">${h((t.ts||'').slice(11,19))}</span>
          </div>
          <div style="font-size:10px;color:var(--text3);margin-top:1px">${h(t.community||t.version||'—')} · ${h(t.raw||'')}</div>
        </div>`).join('')
      : '<div style="padding:16px;text-align:center;color:var(--text3);font-size:12px">Keine Traps</div>'}
      </div>
    </div>
  </div>`;

  html += `</div>`;
  el.innerHTML = html;
  loadTopoChanges();
}

function renderSparklineSvg(data) {
  if (!data?.length) return '';
  const w = 160, ht = 20;
  const bw = w / data.length;
  const bars = data.map((v, i) => {
    if (v === null) return `<rect x="${i * bw}" y="0" width="${bw - 0.5}" height="${ht}" fill="var(--bg3)" rx="1"/>`;
    const color = v >= 100 ? '#22c55e' : v >= 80 ? '#f97316' : '#ef4444';
    return `<rect x="${i * bw}" y="0" width="${bw - 0.5}" height="${ht}" fill="${color}" rx="1"/>`;
  }).join('');
  return `<svg width="${w}" height="${ht}" style="display:block;border-radius:3px;overflow:hidden">${bars}</svg>`;
}

export async function fetchUptimeStats() {
  try {
    const data = await (await fetch('/api/uptime?hours=24')).json();
    S.uptimeStats = data;
    window.renderDashboard?.();
  } catch {}
}

export async function checkTopoChanges() {
  try {
    const r = await (await fetch('/api/topo-changes/check', { method: 'POST' })).json();
    if (r.isFirst) {
      const el = document.getElementById('dash-topochanges-summary');
      if (el) el.innerHTML = '<span style="color:var(--text3)">Baseline gespeichert — nächste Prüfung erkennt Änderungen</span>';
    }
    loadTopoChanges();
    if (r.changes > 0) {
      window.pushActivity?.('warn', `${r.changes} Topologie-Änderung${r.changes!==1?'en':''} erkannt`);
    }
  } catch {}
}

export async function loadTopoChanges() {
  const el = document.getElementById('topo-changes-content');
  const summary = document.getElementById('dash-topochanges-summary');
  if (!el) return;
  try {
    const data = await (await fetch('/api/topo-changes?hours=24')).json();
    if (!data.length) {
      if (summary) summary.innerHTML = '<span style="color:#22c55e">keine Änderungen (24h)</span>';
      el.innerHTML = '<div style="padding:12px 0;color:var(--text3);font-size:12px">Keine Topologie-Änderungen in den letzten 24h. Klicke <b>Prüfen</b> nach einem LLDP-Sync.</div>';
      return;
    }
    const added   = data.filter(c => c.type === 'added').length;
    const removed = data.filter(c => c.type === 'removed').length;
    const parts = [];
    if (added)   parts.push(`<span style="color:#22c55e">${added} neu</span>`);
    if (removed) parts.push(`<span style="color:#ef4444">${removed} entfernt</span>`);
    if (summary) summary.innerHTML = parts.join(' · ') + ` <span style="color:var(--text3)">(24h)</span>`;

    el.innerHTML = `<div style="display:flex;flex-direction:column;gap:4px">
      ${data.slice(0, 50).map(c => {
        const icon = c.type === 'added' ? '<span style="color:#22c55e;font-weight:700">＋</span>' : '<span style="color:#ef4444;font-weight:700">－</span>';
        const verb = c.type === 'added' ? 'Neuer Nachbar' : 'Nachbar entfernt';
        return `<div style="display:flex;align-items:center;gap:8px;padding:6px 12px;background:var(--bg2);border:1px solid ${c.type==='added'?'rgba(34,197,94,.15)':'rgba(239,68,68,.15)'};border-radius:var(--radius);font-size:12px">
          ${icon}
          <span style="font-weight:600;min-width:120px;cursor:pointer;color:var(--accent)" onclick="openDeviceDetail('${h(c.ip)}')">${h(c.deviceName)}</span>
          <span style="color:var(--text2)">${verb}:</span>
          <span style="font-weight:600">${h(c.remoteName || '?')}</span>
          <span style="color:var(--text3)">Port ${h(c.localPort)} ↔ ${h(c.remotePort)}</span>
          <span style="margin-left:auto;font-size:10px;color:var(--text3)">${c.ts.slice(11,19)}</span>
        </div>`;
      }).join('')}
    </div>`;
  } catch (e) {
    el.innerHTML = `<div style="color:var(--red);font-size:12px">Fehler: ${e.message}</div>`;
  }
}

export { fetchDashboardUptimes, fetchDashboardTraffic };

if (typeof window !== 'undefined') {
  window.toggleDashWarns = toggleDashWarns;
  window.toggleDashSection = toggleDashSection;
  window.checkTopoChanges = checkTopoChanges;
  window.loadTopoChanges = loadTopoChanges;
  window.fetchDashboardUptimes = fetchDashboardUptimes;
  window.fetchDashboardTraffic = fetchDashboardTraffic;
}
