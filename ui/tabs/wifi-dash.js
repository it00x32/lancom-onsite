import S from '../lib/state.js';
import { q, h, matchesLocFilter, setBadge } from '../lib/helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// WIFI DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════

export async function wifiRefresh(btn) {
  if (btn) btn.disabled = true;
  try { await syncWlanClients(); } finally { if (btn) btn.disabled = false; }
  renderWifiDashboard();
}

async function syncWlanClients() {
  const btn    = q('btn-wlan-clients-sync');
  // Status-Anzeige: Geräte-Tab oder WiFi-Analyse-Tab
  const st     = q('wifi-sync-status') || q('dev-sync-status');
  // Vor jedem Abgleich: alte WLAN-/Radio-/Nachbar-Daten für APs im aktuellen Standort verwerfen (sonst bleiben Clients von gestern sichtbar, wenn der AP offline ist)
  Object.values(S.deviceStore).forEach(d => {
    if (!matchesLocFilter(d)) return;
    if (d.type === 'lx-ap' || d.type === 'lcos-ap') d.wlanClients = [];
    if (d.type === 'lx-ap') {
      d.neighborAps = [];
      d.radioChannels = [];
    }
  });
  const apDevs = Object.values(S.deviceStore).filter(d => (d.type === 'lx-ap' || d.type === 'lcos-ap') && d.online !== false && matchesLocFilter(d));
  if (!apDevs.length) {
    try {
      await fetch('/api/devices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(S.deviceStore) });
      window.rebuildCachedData?.();
      window.renderClients?.();
      window.renderDevices?.();
    } catch (_) {}
    if (st) {
      st.className = 'status-bar error';
      st.textContent = S.devLocFilter !== 'all'
        ? `Keine erreichbaren Access Points im Standort „${S.devLocFilter}" — gespeicherte WLAN-Listen wurden verworfen.`
        : 'Keine erreichbaren Access Points (Status prüfen) — gespeicherte WLAN-Listen wurden verworfen.';
    }
    return;
  }
  if (btn) btn.disabled = true;
  if (st) { st.className = 'status-bar loading'; st.innerHTML = '<span class="spinner"></span> WLAN Clients werden abgefragt…'; }
  let done = 0;
  const total = apDevs.length;
  try {
    for (let i = 0; i < apDevs.length; i += 4) {
      await Promise.all(apDevs.slice(i, i + 4).map(async dev => {
        try {
          const result = await window.snmpQ?.(dev.ip, 'wlan', { os: dev.os || '', devType: dev.type });
          if (S.deviceStore[dev.ip]) {
            S.deviceStore[dev.ip].wlanClients = result.entries.map(e => ({
              ...e, sourceIp: dev.ip, sourceName: dev.name || dev.ip, type: 'wlan',
            }));
            if (result.radioChannels) S.deviceStore[dev.ip].radioChannels = result.radioChannels;
          }
        } catch { if (S.deviceStore[dev.ip]) S.deviceStore[dev.ip].wlanClients = []; }
        done++;
        if (st) st.innerHTML = `<span class="spinner"></span> WLAN Clients – ${done} / ${total} – ${h(dev.name||dev.ip)}`;
      }));
    }
    // Nachbar-APs nur für LX APs abfragen
    const lxDevs = apDevs.filter(d => d.type === 'lx-ap');
    let ndone = 0;
    for (let i = 0; i < lxDevs.length; i += 4) {
      await Promise.all(lxDevs.slice(i, i + 4).map(async dev => {
        try {
          const result = await window.snmpQ?.(dev.ip, 'neighbor-aps', {});
          if (S.deviceStore[dev.ip]) S.deviceStore[dev.ip].neighborAps = result.entries;
        } catch { if (S.deviceStore[dev.ip]) S.deviceStore[dev.ip].neighborAps = []; }
        ndone++;
        if (st) st.innerHTML = `<span class="spinner"></span> Nachbar-APs – ${ndone} / ${lxDevs.length} – ${h(dev.name||dev.ip)}`;
      }));
    }
    await fetch('/api/devices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(S.deviceStore) });
    window.rebuildCachedData?.();
    window._wpCoChanFromAnalysis = false;
    window.renderClients?.();
    window.renderDevices?.();
    fetch('/api/wifi-history/snapshot', { method: 'POST' }).catch(() => {});
    const wlanCnt = S.clientsData.filter(c => c.type === 'wlan').length;
    if (st) { st.className = 'status-bar ok'; st.textContent = `Abgeschlossen – ${wlanCnt} WLAN-Client${wlanCnt !== 1 ? 's' : ''} von ${total} Access Point${total !== 1 ? 's' : ''}.`; }
  } catch (e) {
    if (st) { st.className = 'status-bar error'; st.textContent = `Fehler: ${e.message}`; }
  } finally {
    if (btn) btn.disabled = false;
  }
}

export function renderWifiDashboard() {
  const el = q('wifi-dash-content'); if (!el) return;

  // ── Daten aufbereiten ───────────────────────────────────────────────────────
  const aps = Object.values(S.deviceStore).filter(d => d.type === 'lx-ap' || d.type === 'lcos-ap');
  const allClients = aps.flatMap(ap => (ap.wlanClients||[]).map(c => ({ ...c, apIp: ap.ip, apName: ap.name||ap.ip })));

  const lxAps = aps.filter(a => a.type === 'lx-ap');
  const hasRadioData    = lxAps.some(a => (a.radioChannels||[]).length > 0);
  const hasNeighborData = lxAps.some(a => (a.neighborAps||[]).length > 0);
  if (!allClients.length && !hasRadioData && !hasNeighborData && !lxAps.length) {
    el.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text3)">Keine WLAN-Daten vorhanden – zuerst <b>Aktualisieren</b> drücken.</div>`;
    return;
  }

  const sig = c => parseInt(c.signal) || null;

  // ── Hilfsfunktionen ─────────────────────────────────────────────────────────
  const section = (title, body) =>
    `<div style="margin-bottom:20px">
      <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.07em;margin-bottom:10px">${title}</div>
      ${body}
    </div>`;

  const card = (inner, onclick='', extra='') =>
    `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px;${onclick?'cursor:pointer;':''}${extra}" ${onclick?`onclick="${onclick}"`:''}>${inner}</div>`;

  const kachel = (label, value, sub, color) =>
    `<div style="flex:1;min-width:110px;max-width:180px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px">
      <div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.07em;margin-bottom:4px">${label}</div>
      <div style="font-size:26px;font-weight:800;color:${color};line-height:1">${value}</div>
      ${sub?`<div style="font-size:10px;color:var(--text3);margin-top:3px">${sub}</div>`:''}
    </div>`;

  const miniBar = (pct, color) =>
    `<div style="height:6px;background:var(--bg3);border-radius:3px;overflow:hidden;margin-top:3px">
      <div style="height:100%;width:${Math.min(pct,100)}%;background:${color};border-radius:3px"></div>
    </div>`;

  // ── Statistiken ─────────────────────────────────────────────────────────────
  const total  = allClients.length;
  const band24 = allClients.filter(c => c.band === '2.4 GHz').length;
  const band5  = allClients.filter(c => c.band === '5 GHz').length;
  const band6  = allClients.filter(c => c.band === '6 GHz').length;
  const noIp   = allClients.filter(c => !c.ip).length;
  const sigVals = allClients.map(sig).filter(s => s !== null);
  const avgSig = sigVals.length ? Math.round(sigVals.reduce((a,b)=>a+b,0)/sigVals.length) : null;

  let html = section('Übersicht',
    `<div style="display:flex;flex-wrap:wrap;gap:10px">
      ${kachel('Clients gesamt', total, `${aps.length} APs aktiv`, 'var(--accent)')}
      ${kachel('2.4 GHz', band24, `${total?Math.round(band24/total*100):0}% der Clients`, '#f97316')}
      ${kachel('5 GHz', band5, `${total?Math.round(band5/total*100):0}% der Clients`, '#22c55e')}
      ${band6 ? kachel('6 GHz', band6, `${Math.round(band6/total*100)}% der Clients`, 'var(--cyan)') : ''}
      ${kachel('Ø Signal', avgSig !== null ? avgSig+' dBm' : '—', avgSig>=-60?'Ausgezeichnet':avgSig>=-70?'Gut':avgSig>=-80?'Mäßig':'Schwach', avgSig>=-60?'#22c55e':avgSig>=-70?'#84cc16':avgSig>=-80?'#f97316':'#ef4444')}
      ${noIp ? kachel('Ohne IP', noIp, 'DHCP-Problem?', '#ef4444') : ''}
    </div>`
  );

  // ── Band-Verteilung Balken ──────────────────────────────────────────────────
  if (total) {
    const p24 = Math.round(band24/total*100), p5 = Math.round(band5/total*100), p6 = Math.round(band6/total*100);
    html += section('Band-Verteilung',
      card(`<div style="display:flex;height:24px;border-radius:4px;overflow:hidden;gap:1px">
        ${band24?`<div style="flex:${band24};background:#f97316;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff">${p24}%</div>`:''}
        ${band5 ?`<div style="flex:${band5};background:#22c55e;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff">${p5}%</div>`:''}
        ${band6 ?`<div style="flex:${band6};background:var(--cyan);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff">${p6}%</div>`:''}
      </div>
      <div style="display:flex;gap:16px;margin-top:6px;font-size:11px;color:var(--text3)">
        <span><span style="color:#f97316">■</span> 2.4 GHz (${band24})</span>
        <span><span style="color:#22c55e">■</span> 5 GHz (${band5})</span>
        ${band6?`<span><span style="color:var(--cyan)">■</span> 6 GHz (${band6})</span>`:''}
      </div>`)
    );
  }

  // ── Clients pro AP (nur APs mit Status „Online“, wie Geräte-Tab) ────────────
  const apStats = aps
    .filter(ap => ap.online === true)
    .map(ap => {
      const clients = ap.wlanClients || [];
      const ssids   = [...new Set(clients.map(c => c.ssid).filter(Boolean))];
      const sigs    = clients.map(sig).filter(s => s !== null);
      const avgS    = sigs.length ? Math.round(sigs.reduce((a,b)=>a+b,0)/sigs.length) : null;
      return { ap, clients, ssids, avgS };
    }).sort((a,b) => b.clients.length - a.clients.length);

  const maxClients = apStats[0]?.clients.length || 1;
  html += section('Clients pro AP',
    apStats.length
      ? `<div style="display:flex;flex-direction:column;gap:6px">` +
      apStats.map(({ ap, clients, ssids, avgS }) => {
        const cnt   = clients.length;
        const pct   = Math.round(cnt / maxClients * 100);
        const color = cnt > 20 ? '#ef4444' : cnt > 12 ? '#f97316' : '#22c55e';
        const sigColor = avgS == null ? 'var(--text3)' : avgS >= -60 ? '#22c55e' : avgS >= -70 ? '#84cc16' : avgS >= -80 ? '#f97316' : '#ef4444';
        const ssidWarn = ssids.length > 4 ? `<span class="badge badge-orange" title="Mehr als 4 SSIDs reduzieren die WLAN-Performance">${ssids.length} SSIDs ⚠</span>` : `<span style="font-size:10px;color:var(--text3)">${ssids.length} SSID${ssids.length!==1?'s':''}</span>`;
        return card(
          `<div style="display:flex;align-items:center;gap:10px">
          <span style="font-weight:600;font-size:13px;min-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h(ap.name||ap.ip)}</span>
          <div style="flex:1">
            <div style="display:flex;align-items:center;gap:6px">
              <div style="flex:1;height:8px;background:var(--bg3);border-radius:4px;overflow:hidden">
                <div style="height:100%;width:${pct}%;background:${color};border-radius:4px"></div>
              </div>
              <span style="font-size:13px;font-weight:700;color:${color};min-width:28px;text-align:right">${cnt}</span>
            </div>
          </div>
          <span style="font-size:11px;color:${sigColor};min-width:55px;text-align:right">${avgS !== null ? avgS+' dBm' : '—'}</span>
          ${ssidWarn}
        </div>`,
          `openDeviceDetail('${h(ap.ip)}')`
        );
      }).join('') + `</div>`
      : `<div style="font-size:12px;color:var(--text3);line-height:1.45">Kein Access Point mit Status <b>Online</b> — im Tab <b>Geräte</b> Ping/Scan ausführen oder Filter prüfen. Offline/Unbekannt werden hier nicht aufgeführt.</div>`
  );

  // ── AP Radio-Kanäle (LCOS LX) ───────────────────────────────────────────────
  if (hasRadioData) {
    const bandColor = b => b === '2.4 GHz' ? '#f97316' : b === '5 GHz' ? '#22c55e' : '#818cf8';
    html += section('AP Radio-Kanäle (LCOS LX)',
      card(`<table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr>
          <th style="text-align:left;padding:4px 8px;color:var(--text3);font-weight:600">Access Point</th>
          <th style="padding:4px 8px;color:var(--text3);font-weight:600">Radios</th>
          <th style="padding:4px 8px;color:var(--text3);font-weight:600;text-align:right">Clients</th>
        </tr></thead>
        <tbody>
        ${lxAps.filter(ap => (ap.radioChannels||[]).length > 0).map(ap => {
          const radios = (ap.radioChannels||[]).sort((a,b)=>a.channel-b.channel);
          const cntStr = (ap.wlanClients||[]).length;
          return `<tr style="border-top:1px solid var(--border)">
            <td style="padding:5px 8px;font-weight:600;cursor:pointer" onclick="openDeviceDetail('${h(ap.ip)}')">${h(ap.name||ap.ip)}</td>
            <td style="padding:5px 8px">
              ${radios.map(r => `<span style="display:inline-block;margin:1px 3px 1px 0;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;background:${bandColor(r.band)}22;color:${bandColor(r.band)}">CH ${r.channel} <span style="opacity:.7;font-weight:400">${r.band}</span></span>`).join('')}
            </td>
            <td style="padding:5px 8px;text-align:right;color:var(--cyan)">${cntStr}</td>
          </tr>`;
        }).join('')}
        </tbody>
      </table>`)
    );
  }

  // ── Nachbar-APs (LCOS LX) ───────────────────────────────────────────────────
  if (hasNeighborData) {
    // Alle Nachbar-APs aus allen LX APs aggregieren, dedupliziert nach BSSID
    const allNeighbors = {}; // bssid → {bssid, ssid, channel, band, seenBy:[apName]}
    lxAps.forEach(ap => {
      (ap.neighborAps||[]).forEach(n => {
        if (!allNeighbors[n.bssid]) allNeighbors[n.bssid] = { ...n, seenBy: [] };
        // Kanal/SSID aktualisieren falls noch nicht gesetzt
        if (!allNeighbors[n.bssid].channel && n.channel) allNeighbors[n.bssid].channel = n.channel;
        if (!allNeighbors[n.bssid].ssid && n.ssid) allNeighbors[n.bssid].ssid = n.ssid;
        if (!allNeighbors[n.bssid].band && n.band) allNeighbors[n.bssid].band = n.band;
        // Welche eigenen APs sehen diesen Nachbarn?
        if (!allNeighbors[n.bssid].seenBy.includes(ap.name||ap.ip))
          allNeighbors[n.bssid].seenBy.push(ap.name||ap.ip);
        // IP des Nachbar-APs (falls bekannt = eigenes Netz)
        if (!allNeighbors[n.bssid].nbrIp && n.ip) allNeighbors[n.bssid].nbrIp = n.ip;
      });
    });
    // Eigene APs (nach IP erkennbar) markieren
    const ownIps = new Set(Object.values(S.deviceStore).map(d => d.ip));
    const neighborList = Object.values(allNeighbors).sort((a,b) => {
      const aOwn = ownIps.has(a.nbrIp) ? 0 : 1;
      const bOwn = ownIps.has(b.nbrIp) ? 0 : 1;
      return aOwn - bOwn || (a.channel||999) - (b.channel||999);
    });
    const bandColor = b => b === '2.4 GHz' ? '#f97316' : b === '5 GHz' ? '#22c55e' : '#818cf8';
    html += section('Nachbar-APs in Reichweite (LCOS LX Scan)',
      card(`<div style="margin-bottom:8px;font-size:11px;color:var(--text3)">${neighborList.length} BSSIDs erkannt · <span style="color:#22c55e">grün = eigene APs</span></div>
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr>
          <th style="text-align:left;padding:4px 8px;color:var(--text3);font-weight:600">BSSID</th>
          <th style="text-align:left;padding:4px 8px;color:var(--text3);font-weight:600">SSID</th>
          <th style="padding:4px 8px;color:var(--text3);font-weight:600">Kanal</th>
          <th style="padding:4px 8px;color:var(--text3);font-weight:600">Sichtbar von</th>
        </tr></thead>
        <tbody>
        ${neighborList.map(n => {
          const isOwn = ownIps.has(n.nbrIp);
          const ownDev = isOwn ? Object.values(S.deviceStore).find(d => d.ip === n.nbrIp) : null;
          const devLabel = ownDev ? `<span style="color:#22c55e;font-weight:600">${h(ownDev.name||n.nbrIp)}</span>` : `<span style="color:var(--text3)">${h(n.nbrIp||'—')}</span>`;
          const ch = n.channel || '—';
          const bc = bandColor(n.band||'');
          return `<tr style="border-top:1px solid var(--border)">
            <td style="padding:5px 8px;font-family:monospace;font-size:11px">${h(n.bssid)}</td>
            <td style="padding:5px 8px;font-weight:600">${h(n.ssid||'—')}</td>
            <td style="padding:5px 8px;text-align:center">
              ${n.channel ? `<span style="padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;background:${bc}22;color:${bc}">CH ${ch}</span>` : '—'}
            </td>
            <td style="padding:5px 8px;font-size:11px">${devLabel} · ${n.seenBy.map(h).join(', ')}</td>
          </tr>`;
        }).join('')}
        </tbody>
      </table></div>`)
    );
  }

  // ── Signalstärke-Heatmap ────────────────────────────────────────────────────
  const sigBuckets = [
    { label: 'Exzellent', range: '> −60 dBm', color: '#22c55e', fn: s => s > -60 },
    { label: 'Gut',       range: '−60…−70',   color: '#84cc16', fn: s => s <= -60 && s > -70 },
    { label: 'Mäßig',    range: '−70…−80',   color: '#f97316', fn: s => s <= -70 && s > -80 },
    { label: 'Schwach',  range: '< −80 dBm', color: '#ef4444', fn: s => s <= -80 },
  ];
  html += section('Signalstärke-Heatmap',
    `<div style="overflow-x:auto">${card(`
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr>
          <th style="text-align:left;padding:4px 8px;color:var(--text3);font-weight:600">AP</th>
          ${sigBuckets.map(b => `<th style="padding:4px 8px;color:${b.color};font-weight:600;text-align:center">${b.label}<div style="font-size:10px;font-weight:400;color:var(--text3)">${b.range}</div></th>`).join('')}
          <th style="padding:4px 8px;color:var(--text3);font-weight:600;text-align:center">Ø dBm</th>
        </tr></thead>
        <tbody>
        ${apStats.filter(a => a.clients.length > 0).map(({ ap, clients, avgS }, i) => {
          const sigs = clients.map(sig).filter(s => s !== null);
          return `<tr style="border-top:1px solid var(--border)">
            <td style="padding:5px 8px;font-weight:600;cursor:pointer" onclick="openDeviceDetail('${h(ap.ip)}')">${h(ap.name||ap.ip)}</td>
            ${sigBuckets.map(b => {
              const cnt = sigs.filter(b.fn).length;
              const pct = sigs.length ? Math.round(cnt/sigs.length*100) : 0;
              return `<td style="padding:5px 8px;text-align:center">
                ${cnt > 0 ? `<span style="font-weight:700;color:${b.color}">${cnt}</span><div style="font-size:10px;color:var(--text3)">${pct}%</div>` : `<span style="color:var(--border)">—</span>`}
              </td>`;
            }).join('')}
            <td style="padding:5px 8px;text-align:center;font-family:monospace;color:${avgS>=-60?'#22c55e':avgS>=-70?'#84cc16':avgS>=-80?'#f97316':'#ef4444'}">${avgS ?? '—'}</td>
          </tr>`;
        }).join('')}
        </tbody>
      </table>
    `)}</div>`
  );

  // ── Kanalverteilung (2.4 / 5 / 6 GHz) ──────────────────────────────────────

  // 5 GHz 80-MHz-Blöcke: APs im selben Block interferieren bei 80-MHz-Kanalbreite
  const blocks5 = [[36,40,44,48],[52,56,60,64],[100,104,108,112],[116,120,124,128],[132,136,140,144],[149,153,157,161],[165,169,173,177]];
  // 6 GHz 80-MHz-Blöcke (Wi-Fi 6E, jede Gruppe von 4 Kanälen à 20 MHz)
  const blocks6 = [[1,5,9,13],[17,21,25,29],[33,37,41,45],[49,53,57,61],[65,69,73,77],[81,85,89,93],[97,101,105,109],[113,117,121,125],[129,133,137,141],[145,149,153,157],[161,165,169,173],[177,181,185,189],[193,197,201,205],[209,213,217,221],[225,229,233,237]];

  function chanSection(bandLabel, bandFilter, nonOverlapChans, blocks, clients = allClients) {
    const bClients = clients.filter(c => c.band === bandFilter && c.channel);
    if (!bClients.length) return '';

    // channel → { clients (nur echte), aps: {ip → {name, ip, count}} }
    const chanData = {};
    bClients.forEach(c => {
      const ch = String(c.channel);
      if (!chanData[ch]) chanData[ch] = { clients: 0, aps: {} };
      if (!c._virtual) chanData[ch].clients++;
      if (!chanData[ch].aps[c.apIp]) chanData[ch].aps[c.apIp] = { name: c.apName, ip: c.apIp, count: 0 };
      if (!c._virtual) chanData[ch].aps[c.apIp].count++;
    });

    // Problem 1: Nicht-Standard-Kanal (2.4 GHz) — nur Kanäle im gültigen Band-Bereich prüfen
    const chanInBand = ch => {
      const n = parseInt(ch);
      if (bandFilter === '2.4 GHz') return n >= 1 && n <= 14;
      return true;
    };
    const badStdChans = nonOverlapChans
      ? Object.keys(chanData).filter(ch => chanInBand(ch) && !nonOverlapChans.has(ch))
      : [];

    // Problem 2: Co-Channel – gleicher Primärkanal auf 2+ APs
    const coChanProblems = Object.entries(chanData)
      .filter(([, d]) => Object.keys(d.aps).length > 1)
      .map(([ch, d]) => ({ ch, aps: Object.values(d.aps) }));

    // Problem 3: 80-MHz-Blocküberschneidung (5/6 GHz) – verschiedene Primärkanäle im selben Block
    const blockProblems = [];
    if (blocks) {
      blocks.forEach(block => {
        const apsInBlock = {};
        block.forEach(ch => {
          const d = chanData[String(ch)];
          if (!d) return;
          Object.values(d.aps).forEach(ap => {
            if (!apsInBlock[ap.ip]) apsInBlock[ap.ip] = { ...ap, channels: [] };
            apsInBlock[ap.ip].channels.push(ch);
          });
        });
        const apList = Object.values(apsInBlock);
        // Only a problem if APs are on DIFFERENT primary channels in the same block
        const usedChans = [...new Set(apList.flatMap(a => a.channels))];
        if (apList.length > 1 && usedChans.length > 1) {
          blockProblems.push({ block, aps: apList });
        }
      });
    }

    const hasProblems = badStdChans.length || coChanProblems.length || blockProblems.length;
    const maxClients = Math.max(1, ...Object.values(chanData).map(d => d.clients));
    const problemChans = new Set([
      ...badStdChans,
      ...coChanProblems.map(p => p.ch),
      ...blockProblems.flatMap(p => p.aps.flatMap(a => a.channels.map(String))),
    ]);

    let inner = `<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;margin-bottom:${hasProblems?'12px':'0'}">
      ${Object.entries(chanData).sort((a,b)=>Number(a[0])-Number(b[0])).map(([ch, d]) => {
        const isProblem = problemChans.has(ch);
        const color = isProblem ? '#ef4444' : '#22c55e';
        const pct   = Math.round(d.clients / maxClients * 100);
        const apNames = Object.values(d.aps).map(a => h(a.name)).join(', ');
        return `<div style="text-align:center;min-width:38px" title="APs: ${apNames}">
          <div style="font-size:10px;font-weight:700;color:${color};margin-bottom:2px">${d.clients}</div>
          <div style="height:${Math.max(pct*0.6,4)}px;background:${color};border-radius:2px 2px 0 0;opacity:0.85"></div>
          <div style="font-size:11px;font-weight:600;color:${isProblem?'#ef4444':'var(--text)'};margin-top:2px">CH${ch}</div>
          <div style="font-size:9px;color:var(--text3)">${Object.keys(d.aps).length} AP${Object.keys(d.aps).length>1?'s':''}</div>
          ${isProblem ? `<div style="font-size:10px;color:#ef4444">⚠</div>` : ''}
        </div>`;
      }).join('')}
    </div>`;

    // Probleme auflisten
    if (badStdChans.length) {
      inner += `<div style="margin-top:8px;padding:8px 10px;background:#ef44441a;border:1px solid #ef444440;border-radius:6px;font-size:12px">
        <b style="color:#ef4444">⚠ Nicht-Standard-Kanäle:</b> CH${badStdChans.join(', CH')} — empfohlen: nur Kanal 1, 6, 11<br>
        <span style="color:var(--text3)">Betroffene APs: ${[...new Set(badStdChans.flatMap(ch => Object.values(chanData[ch].aps).map(a => a.name)))].join(', ')}</span>
      </div>`;
    }
    if (coChanProblems.length) {
      inner += coChanProblems.map(p =>
        `<div style="margin-top:6px;padding:8px 10px;background:#ef44441a;border:1px solid #ef444440;border-radius:6px;font-size:12px">
          <b style="color:#ef4444">⚠ Co-Channel-Interferenz CH${p.ch}:</b> ${p.aps.length} APs auf demselben Primärkanal<br>
          <span style="color:var(--text3)">${p.aps.map(a => `<span style="cursor:pointer;color:var(--accent)" onclick="openDeviceDetail('${h(a.ip)}')">${h(a.name)}</span>`).join(' · ')}</span>
        </div>`
      ).join('');
    }
    if (blockProblems.length) {
      inner += blockProblems.map(p =>
        `<div style="margin-top:6px;padding:8px 10px;background:#f974161a;border:1px solid #f9741640;border-radius:6px;font-size:12px">
          <b style="color:#f97316">⚠ 80-MHz-Überschneidung Block CH${p.block[0]}–CH${p.block[p.block.length-1]}:</b> APs auf verschiedenen Primärkanälen im selben 80-MHz-Block<br>
          <span style="color:var(--text3)">${p.aps.map(a => `<span style="cursor:pointer;color:var(--accent)" onclick="openDeviceDetail('${h(a.ip)}')">${h(a.name)}</span> (CH${a.channels.join('/')})`).join(' · ')}</span>
        </div>`
      ).join('');
    }

    return section(`Kanalverteilung ${bandLabel}${hasProblems?' <span style="color:#ef4444;font-size:11px;font-weight:400">● Probleme erkannt</span>':''}`, card(inner));
  }

  // Kanal-Analyse: Kanal immer aus radioChannels (.57.1.3) — nicht aus Client-Tabelle (.4.1.1),
  // da beide OIDs unterschiedliche Werte liefern können (Primary vs. Center Channel).
  const lxApIps = new Set(lxAps.map(a => a.ip));
  const lxClients = allClients.filter(c => lxApIps.has(c.apIp));
  const lxAnalysis = [];
  lxAps.forEach(ap => {
    (ap.radioChannels||[]).forEach(r => {
      const radioChannel = String(r.channel);
      const clientsOnBand = lxClients.filter(c => c.apIp === ap.ip && c.band === r.band);
      if (clientsOnBand.length > 0) {
        // Echte Clients behalten, aber Kanal durch den zuverlässigen Radio-Kanal ersetzen
        clientsOnBand.forEach(c => lxAnalysis.push({ ...c, channel: radioChannel }));
      } else {
        lxAnalysis.push({ apIp: ap.ip, apName: ap.name||ap.ip, band: r.band, channel: radioChannel, _virtual: true });
      }
    });
  });
  // Kein Roh-Client-Kanal in lxAnalysis: unzuverlässig vs. Radio (.57); Co-Channel/WiFi-Plan nur aus Radio-Daten

  // ── Co-Channel-Paare für WiFi-Plan berechnen (gleiche Daten wie chanSection) ──
  window._wpCoChanPairs = {};
  window._wpCoChanFromAnalysis = true; // WiFi-Analyse hat aktuelle Daten gesetzt
  [
    { band: '2.4 GHz', blocks: null },
    { band: '5 GHz',   blocks: blocks5 },
    { band: '6 GHz',   blocks: blocks6 },
  ].forEach(({ band, blocks }) => {
    const bClients = lxAnalysis.filter(c => c.band === band && c.channel);
    const chanData = {};
    bClients.forEach(c => {
      if (!chanData[c.channel]) chanData[c.channel] = {};
      chanData[c.channel][c.apIp] = true;
    });
    // Co-Channel: gleicher Kanal, 2+ APs
    Object.entries(chanData).forEach(([ch, apsObj]) => {
      const aps = Object.keys(apsObj);
      if (aps.length < 2) return;
      for (let i = 0; i < aps.length; i++) for (let j = i+1; j < aps.length; j++) {
        const k = [aps[i], aps[j]].sort().join('||');
        if (!window._wpCoChanPairs[k]) window._wpCoChanPairs[k] = [];
        window._wpCoChanPairs[k].push({ band, label: `CH${ch}`, color: '#ef4444' });
      }
    });
    // Teilweise Overlap: gleicher 80-MHz-Block, verschiedene Kanäle
    if (blocks) blocks.forEach(block => {
      const blockAps = {};
      bClients.filter(c => block.includes(parseInt(c.channel))).forEach(c => { blockAps[c.apIp] = c.channel; });
      const aps = Object.keys(blockAps);
      if (aps.length < 2) return;
      for (let i = 0; i < aps.length; i++) for (let j = i+1; j < aps.length; j++) {
        if (blockAps[aps[i]] === blockAps[aps[j]]) continue; // schon co-channel
        const k = [aps[i], aps[j]].sort().join('||');
        if (!window._wpCoChanPairs[k]) window._wpCoChanPairs[k] = [];
        if (!window._wpCoChanPairs[k].some(p => p.band === band)) {
          window._wpCoChanPairs[k].push({ band, label: `CH${blockAps[aps[i]]}↔${blockAps[aps[j]]}`, color: '#f97316' });
        }
      }
    });
  });

  html += chanSection('2.4 GHz (LCOS LX)', '2.4 GHz', new Set(['1','6','11']), null, lxAnalysis);
  html += chanSection('5 GHz (LCOS LX)',   '5 GHz',   null, blocks5, lxAnalysis);
  html += chanSection('6 GHz (LCOS LX)',   '6 GHz',   null, blocks6, lxAnalysis);

  // ── Sticky Clients ──────────────────────────────────────────────────────────
  const stickyClients = allClients.filter(c => sig(c) !== null && sig(c) <= -70).sort((a,b) => sig(a)-sig(b));
  if (stickyClients.length) {
    html += section(`Schwache / Sticky Clients <span style="font-weight:400;font-size:10px;color:var(--text3)">(Signal ≤ −70 dBm, kein Roaming)</span>`,
      card(`<table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="color:var(--text3)">
          <th style="text-align:left;padding:4px 8px">MAC</th>
          <th style="text-align:left;padding:4px 8px">IP / Hostname</th>
          <th style="text-align:left;padding:4px 8px">AP</th>
          <th style="text-align:left;padding:4px 8px">SSID</th>
          <th style="text-align:left;padding:4px 8px">Band</th>
          <th style="text-align:right;padding:4px 8px">Signal</th>
        </tr></thead>
        <tbody>
        ${stickyClients.map((c,i) => {
          const s = sig(c);
          const color = s <= -80 ? '#ef4444' : '#f97316';
          return `<tr style="border-top:1px solid var(--border)">
            <td style="padding:5px 8px;font-family:monospace;font-size:11px;cursor:pointer;color:var(--accent)" onclick="openTopoWithMac('${h(c.mac)}')">${h(c.mac)}</td>
            <td style="padding:5px 8px;color:var(--text2)">${c.ip ? h(c.ip) : '—'}${c.hostname?`<div style="font-size:10px;color:var(--text3)">${h(c.hostname)}</div>`:''}</td>
            <td style="padding:5px 8px;cursor:pointer;color:var(--accent)" onclick="openDeviceDetail('${h(c.apIp)}')">${h(c.apName)}</td>
            <td style="padding:5px 8px">${c.ssid ? `<span class="badge badge-blue">${h(c.ssid)}</span>` : '—'}</td>
            <td style="padding:5px 8px;color:var(--text2)">${h(c.band||'—')}</td>
            <td style="padding:5px 8px;text-align:right;font-weight:700;color:${color}">${s} dBm</td>
          </tr>`;
        }).join('')}
        </tbody>
      </table>`)
    );
  }

  // ── Roaming-Anomalien ───────────────────────────────────────────────────────
  const macToAps = {};
  allClients.forEach(c => {
    if (!macToAps[c.mac]) macToAps[c.mac] = [];
    macToAps[c.mac].push(c);
  });
  const roamingAnomalies = Object.entries(macToAps).filter(([,list]) => list.length > 1);
  if (roamingAnomalies.length) {
    html += section(`Roaming-Anomalien <span style="font-weight:400;font-size:10px;color:var(--text3)">(gleiche MAC auf mehreren APs)</span>`,
      card(`<table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="color:var(--text3)">
          <th style="text-align:left;padding:4px 8px">MAC</th>
          <th style="text-align:left;padding:4px 8px">APs</th>
        </tr></thead>
        <tbody>
        ${roamingAnomalies.map(([mac, list]) =>
          `<tr style="border-top:1px solid var(--border)">
            <td style="padding:5px 8px;font-family:monospace;font-size:11px;cursor:pointer;color:var(--accent)" onclick="openTopoWithMac('${h(mac)}')">${h(mac)}</td>
            <td style="padding:5px 8px">${list.map(c => `<span style="margin-right:8px">${h(c.apName)} <span style="color:var(--text3)">(${sig(c)??'?'} dBm)</span></span>`).join('')}</td>
          </tr>`
        ).join('')}
        </tbody>
      </table>`)
    );
  }

  // ── WiFi History (Zeitreihen) ───────────────────────────────────────────────
  html += `<div style="margin-top:4px" id="wifi-history-section">
    <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px;display:flex;align-items:center;gap:10px;cursor:pointer;user-select:none" onclick="toggleDashSection('wifihist')">
      <span>WiFi History (24h)</span>
      <button class="btn btn-sm" style="font-size:10px" onclick="event.stopPropagation();wifiHistSnapshot()">Snapshot speichern</button>
      <button class="btn btn-sm btn-ghost" style="font-size:10px" onclick="event.stopPropagation();loadWifiHistory()">Aktualisieren</button>
      <span id="dash-wifihist-chevron" style="margin-left:auto;font-size:11px;transition:transform .2s;display:inline-block">▾</span>
    </div>
    <div id="dash-wifihist-list" style="overflow:hidden;transition:max-height .25s ease,opacity .2s ease;max-height:2000px;opacity:1">
      <div id="wifi-history-content" style="color:var(--text3);font-size:12px;padding:12px 0">Lade History…</div>
    </div>
  </div>`;

  el.innerHTML = html;
  loadWifiHistory();
}

function svgLineChart(data, width, height, color, label) {
  if (!data.length) return '';
  const max = Math.max(1, ...data.map(d => d.v));
  const min = Math.min(0, ...data.map(d => d.v));
  const range = max - min || 1;
  const step = width / Math.max(1, data.length - 1);
  const points = data.map((d, i) => {
    const x = i * step;
    const y = height - ((d.v - min) / range) * (height - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const polyline = points.join(' ');
  const areaPoints = `0,${height} ${polyline} ${((data.length-1)*step).toFixed(1)},${height}`;
  const lastVal = data[data.length - 1]?.v ?? 0;
  const firstTs = data[0]?.t || '';
  const lastTs  = data[data.length - 1]?.t || '';
  return `<div style="margin-bottom:12px">
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px">
      <span style="font-size:12px;font-weight:600">${label}</span>
      <span style="font-size:12px;font-weight:700;color:${color}">${lastVal}</span>
    </div>
    <svg width="${width}" height="${height}" style="display:block;background:var(--bg3);border-radius:4px;overflow:hidden">
      <polygon points="${areaPoints}" fill="${color}" opacity="0.1"/>
      <polyline points="${polyline}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/>
    </svg>
    <div style="display:flex;justify-content:space-between;font-size:9px;color:var(--text3);margin-top:2px">
      <span>${firstTs.slice(11,16)}</span><span>${lastTs.slice(11,16)}</span>
    </div>
  </div>`;
}

export async function wifiHistSnapshot() {
  try {
    const r = await (await fetch('/api/wifi-history/snapshot', { method: 'POST' })).json();
    if (r.ok) loadWifiHistory();
  } catch {}
}

export async function loadWifiHistory() {
  const el = document.getElementById('wifi-history-content');
  if (!el) return;
  try {
    const data = await (await fetch('/api/wifi-history?hours=24')).json();
    if (!data.length) {
      el.innerHTML = '<div style="padding:12px 0;color:var(--text3);font-size:12px">Noch keine History-Daten. Klicke <b>Snapshot speichern</b> nach jedem WLAN-Sync, oder aktiviere Auto-Snapshots in den Einstellungen.</div>';
      return;
    }
    const firstTs = data[0]?.ts || '';
    const lastTs  = data[data.length - 1]?.ts || '';
    const allIps = new Set();
    data.forEach(s => Object.keys(s.aps).forEach(ip => allIps.add(ip)));
    const chartWidth = 320;
    const chartHeight = 48;

    // Total clients over time
    const totalData = data.map(s => ({
      t: s.ts,
      v: Object.values(s.aps).reduce((sum, a) => sum + a.clients, 0),
    }));

    // Band distribution over time
    const band24Data = data.map(s => ({ t: s.ts, v: Object.values(s.aps).reduce((sum, a) => sum + (a.bands?.['2.4'] || 0), 0) }));
    const band5Data  = data.map(s => ({ t: s.ts, v: Object.values(s.aps).reduce((sum, a) => sum + (a.bands?.['5'] || 0), 0) }));
    const band6Data  = data.map(s => ({ t: s.ts, v: Object.values(s.aps).reduce((sum, a) => sum + (a.bands?.['6'] || 0), 0) }));

    // Per-AP client count
    const apCharts = [...allIps].map(ip => {
      const apData = data.map(s => ({ t: s.ts, v: s.aps[ip]?.clients || 0 }));
      const name = data[data.length - 1]?.aps[ip]?.name || ip;
      return { ip, name, data: apData };
    }).sort((a, b) => {
      const aLast = a.data[a.data.length - 1]?.v || 0;
      const bLast = b.data[b.data.length - 1]?.v || 0;
      return bLast - aLast;
    });

    // Avg signal per AP
    const sigCharts = [...allIps].map(ip => {
      const sigData = data.map(s => ({ t: s.ts, v: s.aps[ip]?.avgSignal ?? 0 })).filter(d => d.v !== 0);
      const name = data[data.length - 1]?.aps[ip]?.name || ip;
      return { ip, name, data: sigData };
    }).filter(c => c.data.length > 1);

    let out = `<div style="display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start">`;

    // Gesamt-Clients
    out += `<div style="flex:1;min-width:340px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px">
      ${svgLineChart(totalData, chartWidth, chartHeight, 'var(--cyan)', 'Clients gesamt')}
      ${svgLineChart(band24Data, chartWidth, 36, '#f97316', '2.4 GHz')}
      ${svgLineChart(band5Data, chartWidth, 36, '#22c55e', '5 GHz')}
      ${band6Data.some(d => d.v > 0) ? svgLineChart(band6Data, chartWidth, 36, '#818cf8', '6 GHz') : ''}
    </div>`;

    // Pro AP
    out += `<div style="flex:2;min-width:340px;display:flex;flex-wrap:wrap;gap:10px">`;
    apCharts.slice(0, 12).forEach(c => {
      out += `<div style="flex:1;min-width:200px;max-width:360px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px;cursor:pointer" onclick="openDeviceDetail('${h(c.ip)}')">
        ${svgLineChart(c.data, 200, 40, 'var(--accent)', h(c.name))}
      </div>`;
    });
    out += `</div></div>`;

    // Signal History
    if (sigCharts.length) {
      out += `<div style="margin-top:12px"><div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px">Ø Signal pro AP</div>
        <div style="display:flex;flex-wrap:wrap;gap:10px">`;
      sigCharts.slice(0, 12).forEach(c => {
        const lastSig = c.data[c.data.length - 1]?.v || 0;
        const sigColor = lastSig >= -60 ? '#22c55e' : lastSig >= -70 ? '#84cc16' : lastSig >= -80 ? '#f97316' : '#ef4444';
        out += `<div style="flex:1;min-width:200px;max-width:360px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px">
          ${svgLineChart(c.data, 200, 40, sigColor, h(c.name) + ' (dBm)')}
        </div>`;
      });
      out += `</div></div>`;
    }

    out += `<div style="margin-top:8px;font-size:10px;color:var(--text3)">${data.length} Snapshots · ${firstTs.slice(0,16).replace('T',' ')} bis ${lastTs.slice(0,16).replace('T',' ')}</div>`;

    el.innerHTML = out;
  } catch (e) {
    el.innerHTML = `<div style="color:var(--red);font-size:12px">Fehler beim Laden: ${e.message}</div>`;
  }
}

export { syncWlanClients };

if (typeof window !== 'undefined') {
  window.wifiRefresh = wifiRefresh;
  window.renderWifiDashboard = renderWifiDashboard;
  window.syncWlanClients = syncWlanClients;
  window.wifiHistSnapshot = wifiHistSnapshot;
  window.loadWifiHistory = loadWifiHistory;
}
