import S from '../lib/state.js';
import { q, h } from '../lib/helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// STP TOPOLOGY
// ═══════════════════════════════════════════════════════════════════════════════

const STP_STATE  = {1:'Disabled',2:'Blocking',3:'Listening',4:'Learning',5:'Forwarding',6:'Broken'};
const STP_COLOR  = {1:'var(--text3)',2:'#ef4444',3:'#f97316',4:'#f97316',5:'#22c55e',6:'#ef4444'};
const STP_BADGE  = {1:'badge-gray',2:'badge-red',3:'badge-orange',4:'badge-orange',5:'badge-green',6:'badge-red'};

export async function syncStpAll() {
  const btn = q('btn-stp-sync');
  const st  = q('stp-sync-status');
  const switches = Object.values(S.deviceStore).filter(d => d.type === 'switch' && d.online !== false);
  if (!switches.length) {
    st.className = 'status-bar error';
    st.textContent = 'Keine Online-Switches vorhanden.';
    return;
  }
  btn.disabled = true;
  st.className = 'status-bar loading';
  st.innerHTML = `<span class="spinner"></span> Frage ${switches.length} Switch${switches.length>1?'es':''} ab…`;
  let done = 0;
  await Promise.all(switches.map(async dev => {
    try {
      const data = await window.snmpQ?.(dev.ip, 'stp');
      S.stpStore[dev.ip] = { ...data, ts: new Date().toISOString(), devName: dev.name||dev.ip };
    } catch {}
    done++;
    st.innerHTML = `<span class="spinner"></span> ${done} / ${switches.length} – ${h(dev.name||dev.ip)}`;
  }));
  btn.disabled = false;
  const found = Object.keys(S.stpStore).length;
  st.className = 'status-bar ok';
  st.textContent = `Fertig – ${found} Switch${found!==1?'es':''} mit STP-Daten.`;
  renderStpTab();
}

// ── STP Map drag/pan/zoom helpers ─────────────────────────────────────────
function applyStpTransform() {
  const g = document.getElementById('stp-map-g');
  if (g) g.setAttribute('transform', `translate(${S.stpTx.toFixed(1)},${S.stpTy.toFixed(1)}) scale(${S.stpScale.toFixed(4)})`);
}
function stpSvgPt(e) {
  const wrap = document.getElementById('stp-map-wrap');
  if (!wrap) return { x: 0, y: 0 };
  const r = wrap.getBoundingClientRect();
  return { x: (e.clientX - r.left - S.stpTx) / S.stpScale, y: (e.clientY - r.top - S.stpTy) / S.stpScale };
}
function stpNodeDragStart(e, ip) {
  e.stopPropagation();
  const pt = stpSvgPt(e), p = S.stpNodePos[ip];
  if (!p) return;
  S.stpDragNode = { ip, ox: pt.x - p.x, oy: pt.y - p.y };
  S.stpWasDrag = false;
}
function stpBgDragStart(e) {
  if (S.stpDragNode) return;
  S.stpPan = { sx: e.clientX, sy: e.clientY, tx: S.stpTx, ty: S.stpTy };
}
function stpMouseMove(e) {
  if (S.stpDragNode) {
    const pt = stpSvgPt(e), p = S.stpNodePos[S.stpDragNode.ip];
    if (!p) return;
    p.x = pt.x - S.stpDragNode.ox;
    p.y = pt.y - S.stpDragNode.oy;
    S.stpWasDrag = true;
    renderStpSvg();
  } else if (S.stpPan) {
    S.stpTx = S.stpPan.tx + (e.clientX - S.stpPan.sx);
    S.stpTy = S.stpPan.ty + (e.clientY - S.stpPan.sy);
    applyStpTransform();
  }
}
function stpMouseUp() {
  if (S.stpDragNode && S.stpWasDrag) {
    try { localStorage.setItem('onsite_stp_pos', JSON.stringify(S.stpNodePos)); } catch(e) {}
  }
  S.stpDragNode = null; S.stpPan = null; S.stpWasDrag = false;
}
// Globaler Fallback: Positions speichern wenn Maus irgendwo losgelassen wird
window.addEventListener('mouseup', () => { if (S.stpDragNode && S.stpWasDrag) stpMouseUp(); });
function stpWheel(e) {
  e.preventDefault();
  const wrap = document.getElementById('stp-map-wrap');
  if (!wrap) return;
  const factor = e.deltaY < 0 ? 1.12 : 0.9;
  const rect = wrap.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  S.stpTx = mx - (mx - S.stpTx) * factor;
  S.stpTy = my - (my - S.stpTy) * factor;
  S.stpScale *= factor;
  applyStpTransform();
}
function stpResetLayout() {
  localStorage.removeItem('onsite_stp_pos');
  Object.keys(S.stpNodePos).forEach(k => delete S.stpNodePos[k]);
  renderStpTab();
}
function stpMapFit() {
  const wrap = document.getElementById('stp-map-wrap');
  if (!wrap) return;
  const ps = Object.values(S.stpNodePos);
  if (!ps.length) return;
  const xs = ps.map(p => p.x), ys = ps.map(p => p.y);
  const minX = Math.min(...xs) - S.STP_NW / 2 - 20;
  const maxX = Math.max(...xs) + S.STP_NW / 2 + 20;
  const minY = Math.min(...ys) - S.STP_NH / 2 - 20;
  const maxY = Math.max(...ys) + S.STP_NH / 2 + 20;
  const bw = maxX - minX || 1, bh = maxY - minY || 1;
  const cw = wrap.clientWidth, ch = wrap.clientHeight;
  S.stpScale = Math.min(cw / bw, ch / bh, 1) * 0.9;
  S.stpTx = (cw - bw * S.stpScale) / 2 - minX * S.stpScale;
  S.stpTy = (ch - bh * S.stpScale) / 2 - minY * S.stpScale;
  applyStpTransform();
}

// ── Render STP SVG content (edges + nodes) from current S.stpNodePos ─────────
export function renderStpSvg() {
  const mapG = document.getElementById('stp-map-g');
  if (!mapG) return;
  const NW = S.STP_NW, NH = S.STP_NH;

  function borderPt(cx, cy, tx, ty) {
    const hw = NW/2, hh = NH/2;
    const dx = tx-cx, dy = ty-cy;
    if (!dx && !dy) return { x: cx, y: cy+hh };
    const sX = dx ? hw/Math.abs(dx) : Infinity;
    const sY = dy ? hh/Math.abs(dy) : Infinity;
    const s = Math.min(sX, sY);
    return { x: cx+dx*s, y: cy+dy*s };
  }

  // Count total edges per pair (for offset)
  const pairTotalCount = {};
  S.stpEdgeData.forEach(edge => { pairTotalCount[edge.pairKey] = (pairTotalCount[edge.pairKey]||0) + 1; });

  // Draw edges (forwarding first, blocking on top)
  let edgeSvg = '';
  const pairIdxCount = {};
  [...S.stpEdgeData].sort((a, b) => (b.effState??9) - (a.effState??9)).forEach(edge => {
    const p1 = S.stpNodePos[edge.ip], p2 = S.stpNodePos[edge.remIp];
    if (!p1 || !p2) return;
    pairIdxCount[edge.pairKey] = pairIdxCount[edge.pairKey] || 0;
    const pairIdx = pairIdxCount[edge.pairKey]++;
    const totalInPair = pairTotalCount[edge.pairKey] || 1;

    const color   = edge.effState !== null ? (STP_COLOR[edge.effState]||'#888') : '#888';
    const label   = edge.effState !== null ? (STP_STATE[edge.effState]||'?') : null;
    const blocking = edge.effState !== null && edge.effState <= 2;
    const dash    = blocking ? '8,5' : edge.effState === 4 ? '3,3' : '';

    const f = borderPt(p1.x, p1.y, p2.x, p2.y);
    const t = borderPt(p2.x, p2.y, p1.x, p1.y);
    const OFFSET = 28;
    const dx = t.x-f.x, dy = t.y-f.y;
    const len = Math.sqrt(dx*dx+dy*dy)||1;
    const px = -dy/len, py = dx/len;
    const off = totalInPair > 1 ? (pairIdx - (totalInPair-1)/2) * OFFSET : 0;
    const cpx = (f.x+t.x)/2 + px*off*2;
    const cpy = (f.y+t.y)/2 + py*off*2;
    const path = `M${f.x.toFixed(1)},${f.y.toFixed(1)} Q${cpx.toFixed(1)},${cpy.toFixed(1)} ${t.x.toFixed(1)},${t.y.toFixed(1)}`;

    edgeSvg += `<path d="${path}" stroke="${color}" stroke-width="2.5" fill="none" opacity="0.9"${dash?` stroke-dasharray="${dash}"`:''}/>`;

    if (label) {
      const mx = (f.x+t.x)/2*0.5 + cpx*0.5, my = (f.y+t.y)/2*0.5 + cpy*0.5;
      const tw = label.length * 6 + 12;
      edgeSvg += `<rect x="${(mx-tw/2).toFixed(1)}" y="${(my-9).toFixed(1)}" width="${tw}" height="17" rx="5" fill="var(--bg2)" stroke="${color}" stroke-width="1.5" opacity="0.97"/>
        <text x="${mx.toFixed(1)}" y="${(my+4).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="700" fill="${color}" font-family="system-ui,sans-serif">${label}</text>`;
    }

    const lldp = edge.lldp;
    if (lldp) {
      const TS = `font-size="10" font-weight="600" font-family="system-ui,sans-serif" paint-order="stroke" stroke="var(--bg)" stroke-width="3"`;
      const LOFF = 13;
      if (lldp.localPortName) {
        const anchor = f.x > p1.x ? 'start' : f.x < p1.x ? 'end' : 'middle';
        const lx = f.x + (f.x > p1.x ? LOFF : f.x < p1.x ? -LOFF : 0);
        const ly = f.y + (f.y > p1.y ? LOFF : f.y < p1.y ? -LOFF/2 : 0);
        edgeSvg += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${anchor}" fill="${color}" ${TS}>${h(lldp.localPortName)}</text>`;
      }
      if (lldp.remPortLabel || lldp.remPortId) {
        const anchor = t.x > p2.x ? 'start' : t.x < p2.x ? 'end' : 'middle';
        const lx = t.x + (t.x > p2.x ? LOFF : t.x < p2.x ? -LOFF : 0);
        const ly = t.y + (t.y > p2.y ? LOFF : t.y < p2.y ? -LOFF/2 : 0);
        edgeSvg += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${anchor}" fill="${color}" ${TS}>${h(lldp.remPortLabel || lldp.remPortId)}</text>`;
      }
    }
  });

  // Fallback: simple lines to root if no edge data
  if (S.stpEdgeData.length === 0) {
    const rootEntry = S.stpEntries.find(e => e.global?.isRootBridge) || S.stpEntries.find(e => String(e.global?.rootCost) === '0') || S.stpEntries[0];
    if (rootEntry) {
      S.stpEntries.forEach(({ ip, global: g }) => {
        if (ip === rootEntry.ip) return;
        const p1 = S.stpNodePos[ip], p2 = S.stpNodePos[rootEntry.ip];
        if (!p1 || !p2) return;
        const s1 = (S.stpStore[ip]?.portEntries||[]).find(pe => String(pe.port) === String(g?.rootPort));
        const effState = s1 ? parseInt(s1.state) : 5;
        const f = borderPt(p1.x, p1.y, p2.x, p2.y);
        const t = borderPt(p2.x, p2.y, p1.x, p1.y);
        const color = STP_COLOR[effState] || '#888';
        edgeSvg += `<path d="M${f.x.toFixed(1)},${f.y.toFixed(1)} L${t.x.toFixed(1)},${t.y.toFixed(1)}" stroke="${color}" stroke-width="2.5" fill="none" opacity="0.9"/>`;
      });
    }
  }

  // Draw nodes
  let nodeSvg = '';
  S.stpEntries.forEach(({ ip, global: g }) => {
    const p = S.stpNodePos[ip]; if (!p) return;
    const dev     = S.deviceStore[ip];
    const isRoot  = g?.isRootBridge || String(g?.rootCost) === '0';
    const hasBlocking = (S.stpStore[ip]?.portEntries||[]).some(pe => parseInt(pe.state) === 2);
    const stroke  = isRoot ? '#f97316' : hasBlocking ? '#ef4444' : '#22c55e';
    const strokeW = isRoot ? 3 : 2;
    const rx = p.x - NW/2, ry = p.y - NH/2;
    const nameRaw = dev?.name || ip;
    const name  = h(nameRaw.length > 22 ? nameRaw.slice(0,21)+'…' : nameRaw);
    const model = dev?.model && dev.model !== nameRaw ? h(dev.model.length > 22 ? dev.model.slice(0,21)+'…' : dev.model) : '';
    const sub   = isRoot ? '★ Root Bridge' : `Root-Port: ${g?.rootPort??'—'}`;
    const sub2  = `${h(g?.modeLabel||'STP')}  ·  Pri ${g?.priority??'—'}`;
    const subColor = isRoot ? '#f97316' : 'var(--text3)';

    if (isRoot) {
      nodeSvg += `<rect x="${rx}" y="${ry}" width="${NW}" height="16" rx="8" fill="#f97316" opacity="0.85"/>
        <rect x="${rx}" y="${ry+8}" width="${NW}" height="8" fill="#f97316" opacity="0.85"/>`;
    }
    nodeSvg += `<g onmousedown="stpNodeDragStart(event,'${ip}')" onclick="!stpWasDrag&&openDeviceDetail('${ip}')" style="cursor:move" title="${h(nameRaw)} (${ip})">
      <rect x="${rx}" y="${ry}" width="${NW}" height="${NH}" rx="8" fill="var(--card-bg,var(--bg2))" stroke="${stroke}" stroke-width="${strokeW}"/>
      <text x="${p.x}" y="${ry+(isRoot?25:18)}" text-anchor="middle" font-size="13" font-weight="700" fill="var(--text)" font-family="system-ui,sans-serif">${name}</text>
      ${model ? `<text x="${p.x}" y="${ry+(isRoot?37:30)}" text-anchor="middle" font-size="9" fill="var(--text3)" font-family="system-ui,sans-serif">${model}</text>` : ''}
      <text x="${p.x}" y="${ry+(isRoot?49:44)}" text-anchor="middle" font-size="10" fill="${subColor}" font-family="system-ui,sans-serif">${sub}</text>
      <text x="${p.x}" y="${ry+(isRoot?62:57)}" text-anchor="middle" font-size="11" font-weight="600" fill="var(--text2)" font-family="system-ui,sans-serif">${h(ip)}</text>
      <text x="${p.x}" y="${ry+(isRoot?76:72)}" text-anchor="middle" font-size="9" fill="var(--text3)" font-family="system-ui,sans-serif">${sub2}</text>
    </g>`;
  });

  mapG.innerHTML = edgeSvg + nodeSvg;
  applyStpTransform();
}

// ── Sensors ───────────────────────────────────────────────────────────────────

let sensorsStore = {}; // ip → snmpSensors result
let sensorsEmptyHint = null; // Anzeige-Hinweis wenn keine Abfrage möglich

export async function syncSensorsAll() {
  const btn = q('btn-sensors-sync');
  const st  = q('sensors-sync-status');
  if (btn) btn.disabled = true;
  if (st)  { st.className = 'status-bar'; st.innerHTML = '<span class="spinner"></span> Abfrage läuft…'; }

  sensorsEmptyHint = null;
  sensorsStore = {};
  const switches = Object.values(S.deviceStore).filter(d =>
    (d.type === 'switch' || !d.type) && d.online === true
  );
  if (!switches.length) {
    sensorsEmptyHint = 'Kein <b>online</b> erreichbarer Switch – zuerst Geräte-Status prüfen (Dashboard / Geräte).';
    if (btn) btn.disabled = false;
    if (st) {
      st.className = 'status-bar';
      st.textContent = 'Kein online erreichbarer Switch – zuerst Status-Check / SNMP.';
    }
    renderSensorsTab();
    return;
  }

  let done = 0;
  await Promise.all(switches.map(async dev => {
    try {
      const data = await window.snmpQ?.(dev.ip, 'sensors');
      if (data) {
        sensorsStore[dev.ip] = { ...data, devName: dev.name || dev.ip };
      }
    } catch {}
    done++;
    if (st) st.innerHTML = `<span class="spinner"></span> ${done} / ${switches.length} – ${h(dev.name || dev.ip)}`;
  }));

  if (btn) btn.disabled = false;
  const found = Object.keys(sensorsStore).length;
  if (st) {
    st.className = found ? 'status-bar ok' : 'status-bar';
    st.textContent = found ? `Fertig – ${found} Gerät${found !== 1 ? 'e' : ''}.` : 'Fertig – keine Daten.';
  }
  renderSensorsTab();
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

export function renderSensorsTab() {
  const el = q('sensors-content'); if (!el) return;
  if (!Object.keys(sensorsStore).length) {
    const msg = sensorsEmptyHint
      ? `<div style="padding:40px;text-align:center;color:var(--text3);max-width:420px;margin:0 auto;line-height:1.5">${sensorsEmptyHint}</div>`
      : `<div style="padding:40px;text-align:center;color:var(--text3)">Noch keine Daten – "Alle Switches abfragen" klicken (nur <b>online</b> Switches).</div>`;
    el.innerHTML = msg;
    return;
  }

  el.innerHTML = Object.entries(sensorsStore).map(([ip, data]) => {
    const dev = S.deviceStore[ip] || {};
    const poe = (data.poe || [])[0] || null;
    const sens = data.sensors || {};

    // Uptime
    const uptimeHtml = `
      <div class="sensor-item">
        <div class="sensor-label">Uptime</div>
        <div class="sensor-value">${fmtUptime(data.uptimeTicks)}</div>
      </div>`;

    // Temperature
    let tempHtml = '';
    if (sens.temperature != null) {
      const t = sens.temperature;
      const col = t >= 70 ? '#ef4444' : t >= 55 ? '#f97316' : '#22c55e';
      const pct = Math.min(100, Math.round(t / 100 * 100));
      tempHtml = `
        <div class="sensor-item">
          <div class="sensor-label">Temperatur</div>
          <div class="sensor-value" style="color:${col}">${t} °C</div>
          <div class="sensor-bar-wrap">
            <div class="sensor-bar" style="width:${pct}%;background:${col}"></div>
          </div>
        </div>`;
    }

    // Fan
    let fanHtml = '';
    if (sens.fanRpm != null) {
      fanHtml = `
        <div class="sensor-item">
          <div class="sensor-label">Lüfter</div>
          <div class="sensor-value">${sens.fanRpm.toLocaleString()} RPM</div>
        </div>`;
    } else if (sens.fanCount != null && sens.fanCount === 0) {
      fanHtml = `
        <div class="sensor-item">
          <div class="sensor-label">Lüfter</div>
          <div class="sensor-value" style="color:var(--text3)">lautlos</div>
        </div>`;
    }

    // PoE
    let poeHtml = '';
    if (poe && poe.power) {
      const pct = poe.consumption != null ? Math.round(poe.consumption / poe.power * 100) : 0;
      const col = pct > 85 ? '#ef4444' : pct > 65 ? '#f97316' : '#22c55e';
      const statusLabel = poe.status === 1 ? '' : '<span style="color:#ef4444"> (aus)</span>';
      poeHtml = `
        <div class="sensor-item">
          <div class="sensor-label">PoE${statusLabel}</div>
          <div class="sensor-value">${poe.consumption ?? 0} W <span style="color:var(--text3);font-size:11px">/ ${poe.power} W</span></div>
          <div class="sensor-bar-wrap">
            <div class="sensor-bar" style="width:${pct}%;background:${col}"></div>
          </div>
          <div style="font-size:10px;color:var(--text3);margin-top:2px">${pct}% ausgelastet</div>
        </div>`;
    }

    const hasData = tempHtml || fanHtml || poeHtml;

    return `<div class="sensor-card">
      <div class="sensor-card-header">
        <span style="font-weight:700;cursor:pointer" onclick="openDeviceDetail('${ip}')">${h(data.devName)}</span>
        <span style="font-size:11px;color:var(--text3)">${ip}</span>
      </div>
      <div class="sensor-grid">
        ${uptimeHtml}
        ${tempHtml}
        ${fanHtml}
        ${poeHtml}
        ${!hasData ? '<div style="color:var(--text3);font-size:12px;grid-column:1/-1">Nur Uptime verfügbar</div>' : ''}
      </div>
    </div>`;
  }).join('');
}

// ── STP role inference from LLDP topology ────────────────────────────────────
// Corrects port states for LCOS SX 4/5 which only provide ifOperStatus proxy.
// Algorithm: BFS from root bridge using LLDP neighbor graph, then assign roles:
//   root port     = port connecting to BFS parent
//   designated    = port connecting to BFS child (further from root)
//   alternate     = port connecting to peer at same/lower BFS level (creates loop)
export function inferStpRolesFromLldp(entries) {
  const normP = s => (s||'').trim().toLowerCase();
  const normM = m => (m||'').replace(/[:\-\. ]/g,'').toLowerCase();
  // Extract numeric port suffix for cross-format matching
  // "GigabitEthernet 1/2" → 2,  "1/0/30" → 30,  "02" → 2
  const portNum = s => { const m=(s||'').match(/(\d+)$/); return m?parseInt(m[1]):null; };
  const portMatch = (a, b) => normP(a)===normP(b) ||
    (portNum(a)!==null && portNum(a)===portNum(b));

  const switchIps = new Set(entries.map(e => e.ip));

  // Resolve LLDP neighbor to an IP (only if it's a known switch)
  const resolveNeighbor = lldp => {
    const rMac = normM(lldp.remMac);
    return Object.values(S.deviceStore).find(d => {
      if (lldp.remSysName && normP(d.name||'') === normP(lldp.remSysName)) return true;
      if (rMac && normM(d.mac) === rMac) return true;
      if (rMac && (d.macs||[]).some(m => normM(m) === rMac)) return true;
      if (lldp.remChassisIp && d.ip === lldp.remChassisIp) return true;
      return false;
    })?.ip;
  };

  // Build adjacency: ip → [{neighborIp, localPortName}]
  const adj = {};
  for (const {ip} of entries) {
    adj[ip] = [];
    for (const lldp of (S.deviceStore[ip]?.lldpData || [])) {
      const nIp = resolveNeighbor(lldp);
      if (nIp && switchIps.has(nIp) && !adj[ip].some(l => l.neighborIp===nIp && l.localPortName===lldp.localPortName))
        adj[ip].push({ neighborIp: nIp, localPortName: lldp.localPortName });
    }
  }

  // Find root bridge
  const rootEntry = entries.find(e => e.global?.isRootBridge)
    || entries.find(e => String(e.global?.rootCost)==='0')
    || entries[0];
  if (!rootEntry) return;

  // Bridge MAC for tiebreaking (lower MAC = designated, higher = alternate)
  const getMac = ip => normM(S.deviceStore[ip]?.mac || entries.find(x=>x.ip===ip)?.global?.bridgeMac || '');

  // BFS from root — assign levels only (parent ports refined below)
  const bfsLevel = { [rootEntry.ip]: 0 };
  const bfsParentPort = {}; // ip → localPortName on that switch connecting to its parent
  const q2 = [rootEntry.ip];
  while (q2.length) {
    const curr = q2.shift();
    for (const {neighborIp} of adj[curr]) {
      if (bfsLevel[neighborIp] !== undefined) continue;
      bfsLevel[neighborIp] = bfsLevel[curr] + 1;
      q2.push(neighborIp);
    }
  }

  // Assign parent port: for each node pick the upstream neighbor with lowest bridge MAC
  // (lower bridge ID = better path in RSTP — correctly handles multi-homed leaf switches)
  for (const {ip} of entries) {
    if (ip === rootEntry.ip) continue;
    const myLevel = bfsLevel[ip];
    if (myLevel === undefined) continue;
    const upstream = (adj[ip]||[]).filter(l => (bfsLevel[l.neighborIp]??99) < myLevel);
    if (!upstream.length) continue;
    const best = upstream.reduce((b, c) =>
      (getMac(c.neighborIp) < getMac(b.neighborIp)) ? c : b);
    bfsParentPort[ip] = best.localPortName;
  }

  // Assign port roles to non-root switches
  for (const entry of entries) {
    const {ip, portEntries} = entry;
    if (!portEntries?.length) continue;
    if (entry.global?.isRootBridge) continue; // root bridge: keep standard MIB states

    const myLevel = bfsLevel[ip] ?? 1;
    const parentPortName = bfsParentPort[ip] || null;
    const myMac = getMac(ip);

    for (const port of portEntries) {
      if (parseInt(port.state) === 1) continue; // port is down/disabled — skip

      // Find what switch this port connects to
      const link = (adj[ip]||[]).find(l => portMatch(l.localPortName, port.portName));
      if (!link) continue; // not a switch-to-switch port — leave state as-is

      const nIp = link.neighborIp;
      const nLevel = bfsLevel[nIp] ?? 99;
      const isParent = parentPortName !== null && portMatch(parentPortName, port.portName);

      if (isParent) {
        port.state = 5; port.role = 'root';
      } else if (nLevel > myLevel) {
        port.state = 5; port.role = 'designated';
      } else if (nLevel < myLevel) {
        // Connects to an upstream switch that's not my parent → alternate
        port.state = 2; port.role = 'alternate';
      } else {
        // Same BFS level → MAC tiebreak (higher MAC = alternate)
        const nMac = getMac(nIp);
        if (myMac && nMac && myMac > nMac) {
          port.state = 2; port.role = 'alternate';
        } else {
          port.state = 5; port.role = 'designated';
        }
      }
    }
  }
}

export function renderStpTab() {
  const el = q('stp-content'); if (!el) return;
  if (!Object.keys(S.stpStore).length) {
    el.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text3)">Noch keine Daten – "Alle Switches abfragen" klicken.</div>`;
    return;
  }

  const normPort = s => (s||'').trim().toLowerCase();
  const normMac  = m => (m||'').replace(/[:\-\. ]/g,'').toLowerCase();

  S.stpEntries = Object.entries(S.stpStore).map(([ip, d]) => ({ ip, ...d }));
  inferStpRolesFromLldp(S.stpEntries);
  const rootEntry = S.stpEntries.find(e => e.global?.isRootBridge) || S.stpEntries.find(e => String(e.global?.rootCost) === '0') || S.stpEntries[0];

  // ── BFS layout → init S.stpNodePos for new IPs ──────────────────────────────
  const HPAD = 60, LEVEL_H = 150;
  const levels = { [rootEntry.ip]: 0 };
  const bfsQ = [rootEntry.ip];
  while (bfsQ.length) {
    const ip = bfsQ.shift();
    (S.deviceStore[ip]?.lldpData||[]).forEach(e => {
      const remIp = Object.values(S.deviceStore).find(d =>
        (d.mac||'').toLowerCase() === (e.remChassisId||'').toLowerCase() || d.ip === e.remChassisId
      )?.ip;
      if (remIp && S.stpStore[remIp] && levels[remIp] === undefined) {
        levels[remIp] = levels[ip] + 1;
        bfsQ.push(remIp);
      }
    });
  }
  S.stpEntries.forEach(e => { if (levels[e.ip] === undefined) levels[e.ip] = 1; });

  const byLevel = {};
  S.stpEntries.forEach(e => {
    const lv = levels[e.ip] ?? 1;
    (byLevel[lv] = byLevel[lv]||[]).push(e.ip);
  });
  const maxPerLevel = Math.max(...Object.values(byLevel).map(a => a.length));
  const svgW = Math.max(700, maxPerLevel * (S.STP_NW + HPAD) + HPAD * 2);

  // Remove stale IPs, init new ones
  const currentIps = new Set(S.stpEntries.map(e => e.ip));
  Object.keys(S.stpNodePos).forEach(ip => { if (!currentIps.has(ip)) delete S.stpNodePos[ip]; });
  Object.entries(byLevel).forEach(([lv, ips]) => {
    const cy = parseInt(lv) * LEVEL_H + 60;
    const totalW = ips.length * S.STP_NW + (ips.length - 1) * HPAD;
    const startX = (svgW - totalW) / 2 + S.STP_NW / 2;
    ips.forEach((ip, i) => { if (!S.stpNodePos[ip]) S.stpNodePos[ip] = { x: startX + i * (S.STP_NW + HPAD), y: cy }; });
  });

  // ── Compute logical edge data ──────────────────────────────────────────────
  S.stpEdgeData = [];
  const drawnPortKeys = new Set();
  const pairCount = {};

  S.stpEntries.forEach(({ ip }) => {
    (S.deviceStore[ip]?.lldpData||[]).forEach(lldp => {
      const rMac  = normMac(lldp.remMac);
      const rpMac = normMac(lldp.remPortMac);
      const remIp = Object.values(S.deviceStore).find(d => {
        if (lldp.remSysName && (d.name||'').toLowerCase() === lldp.remSysName.toLowerCase()) return true;
        if (rMac  && normMac(d.mac) === rMac)  return true;
        if (rpMac && normMac(d.mac) === rpMac) return true;
        if (rMac  && (d.macs||[]).some(m => normMac(m) === rMac))  return true;
        if (rpMac && (d.macs||[]).some(m => normMac(m) === rpMac)) return true;
        if (lldp.remChassisIp && d.ip === lldp.remChassisIp) return true;
        return false;
      })?.ip;
      if (!remIp || !S.stpStore[remIp]) return;
      const portKey = `${ip}||${lldp.localPortName||'?'}`;
      if (drawnPortKeys.has(portKey)) return;
      drawnPortKeys.add(portKey);

      const pairKey = [ip, remIp].sort().join('||');
      pairCount[pairKey] = (pairCount[pairKey]||0) + 1;
      const pairIdx = pairCount[pairKey] - 1;

      const stpPN = s => { const m=(s||'').match(/(\d+)$/); return m?parseInt(m[1]):null; };
      const stpPM = (a,b) => normPort(a)===normPort(b) || (stpPN(a)!==null && stpPN(a)===stpPN(b));
      const s1 = (() => {
        const entry = S.stpStore[ip]?.portEntries?.find(p => stpPM(p.portName, lldp.localPortName));
        return entry ? parseInt(entry.state) : null;
      })();
      const isMacPortId = /^([0-9a-fA-F]{2}[:\- ]){5}[0-9a-fA-F]{2}$/.test((lldp.remPortId||'').trim());
      let remPortLabel = lldp.remPortId, remPortName = lldp.remPortId;
      if (isMacPortId) {
        remPortLabel = lldp.remPortDesc || lldp.remPortId;
        const srcMacs = new Set([(S.deviceStore[ip]?.mac||''), ...(S.deviceStore[ip]?.macs||[])].map(normMac).filter(Boolean));
        const revEntry = (S.deviceStore[remIp]?.lldpData||[]).find(re => {
          const rm  = normMac(re.remMac);
          const rpm = normMac(re.remPortMac);
          return (rm && srcMacs.has(rm)) || (rpm && srcMacs.has(rpm)) || re.remChassisIp === ip
              || window.resolveTopoNeighbor?.(re, remIp) === ip;
        });
        if (revEntry?.localPortName) { remPortLabel = revEntry.localPortName; remPortName = revEntry.localPortName; }
      }
      const s2 = (() => {
        const entry = S.stpStore[remIp]?.portEntries?.find(p => stpPM(p.portName, remPortName));
        return entry ? parseInt(entry.state) : null;
      })();
      const states = [s1, s2].filter(s => s !== null);
      const effState = states.length ? Math.min(...states) : null;

      S.stpEdgeData.push({ ip, remIp, lldp: { ...lldp, remPortLabel }, effState, pairKey, pairIdx });
    });
  });

  // ── HTML ──────────────────────────────────────────────────────────────────
  const legend = `<div style="display:flex;gap:20px;font-size:11px;color:var(--text3);margin-bottom:10px;align-items:center">
    <span><svg width="20" height="8"><line x1="0" y1="4" x2="20" y2="4" stroke="#f97316" stroke-width="2.5"/></svg> Root Bridge</span>
    <span><svg width="20" height="8"><line x1="0" y1="4" x2="20" y2="4" stroke="#22c55e" stroke-width="2.5"/></svg> Forwarding</span>
    <span><svg width="20" height="8"><line x1="0" y1="4" x2="20" y2="4" stroke="#ef4444" stroke-width="2.5" stroke-dasharray="5,3"/></svg> Blocking</span>
    <span style="margin-left:auto;font-size:10px;color:var(--text3)">Knoten ziehbar · Hintergrund verschiebbar · Scrollen zum Zoomen</span>
  </div>`;

  const mapHtml = `<div id="stp-map-wrap" style="position:relative;height:480px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);overflow:hidden;margin-bottom:20px">
    <svg id="stp-map-svg" width="100%" height="100%" style="display:block;cursor:default"
      onmousedown="stpBgDragStart(event)" onmousemove="stpMouseMove(event)" onmouseup="stpMouseUp()" onmouseleave="stpMouseUp()" onwheel="stpWheel(event)">
      <defs>
        <filter id="stp-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="3" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <g id="stp-map-g"></g>
    </svg>
    <div style="position:absolute;bottom:8px;right:10px;display:flex;gap:6px">
      <button onclick="stpMapFit()" style="background:var(--bg3);border:1px solid var(--border);border-radius:6px;padding:3px 10px;font-size:11px;cursor:pointer;color:var(--text2)">Einpassen</button>
      <button onclick="stpResetLayout()" style="background:var(--bg3);border:1px solid var(--border);border-radius:6px;padding:3px 10px;font-size:11px;cursor:pointer;color:var(--text2)" title="Gespeicherte Positionen löschen und automatisches Layout wiederherstellen">Layout zurücksetzen</button>
    </div>
  </div>`;

  // ── Per-switch cards ──────────────────────────────────────────────────────
  const cards = [...S.stpEntries].sort((a,b) => {
    const ar = a.global?.isRootBridge ? -1 : 0, br = b.global?.isRootBridge ? -1 : 0;
    return ar !== br ? ar - br : (a.global?.rootCost||999) - (b.global?.rootCost||999);
  }).map(({ ip, global: g, portEntries }) => {
    const dev  = S.deviceStore[ip];
    const isRoot = g?.isRootBridge || String(g?.rootCost) === '0';
    const blockingPorts = (portEntries||[]).filter(p => parseInt(p.state) === 2);
    const fwdPorts      = (portEntries||[]).filter(p => parseInt(p.state) === 5);
    const ROLE_BADGE = {root:'badge-blue',designated:'badge-green',alternate:'badge-red',backup:'badge-orange'};
    const ROLE_LABEL = {root:'Root',designated:'Desig.',alternate:'Alternate',backup:'Backup'};
    const portRows = (portEntries||[]).map(p => {
      const stN = parseInt(p.state);
      const roleBadge = p.role ? `<span class="badge ${ROLE_BADGE[p.role]||'badge-gray'}">${ROLE_LABEL[p.role]||p.role}</span>` : '—';
      return `<tr>
        <td class="mono" style="font-size:12px">${h(p.portName)}</td>
        <td><span class="badge ${STP_BADGE[stN]||'badge-gray'}">${STP_STATE[stN]||'—'}</span></td>
        <td>${roleBadge}</td>
        <td class="mono" style="font-size:11px;color:var(--text3)">${p.priority||'—'}</td>
        <td class="mono" style="font-size:11px;color:var(--text3)">${p.pathCost||'—'}</td>
      </tr>`;
    }).join('');
    return `<div style="background:var(--bg2);border:1px solid ${isRoot?'#f97316':blockingPorts.length?'#ef4444':'var(--border)'};border-radius:var(--radius);margin-bottom:12px;overflow:hidden">
      <div style="padding:10px 14px;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--border);cursor:pointer" onclick="openDeviceDetail('${ip}')">
        <span style="font-weight:700;font-size:14px">${h(dev?.name||ip)}</span>
        ${isRoot ? `<span class="badge badge-orange">★ Root Bridge</span>` : ''}
        ${blockingPorts.length ? `<span class="badge badge-red">⚠ ${blockingPorts.length} Blocking</span>` : ''}
        <span style="font-size:11px;color:var(--text3);flex:1;text-align:right">${h(g?.modeLabel||'STP')} · Pri ${g?.priority??'—'} · ${fwdPorts.length} Forwarding</span>
        ${g?.topChanges>0 ? `<span class="badge badge-yellow">${g.topChanges} Topo-Wechsel</span>` : ''}
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="color:var(--text3)">
          <th style="padding:4px 10px;text-align:left">Port</th>
          <th style="padding:4px 10px;text-align:left">Status</th>
          <th style="padding:4px 10px;text-align:left">Rolle</th>
          <th style="padding:4px 10px;text-align:left">Priorität</th>
          <th style="padding:4px 10px;text-align:left">Pfadkosten</th>
        </tr></thead>
        <tbody>${portRows}</tbody>
      </table>
    </div>`;
  }).join('');

  el.innerHTML = legend + mapHtml + cards;

  // ── Init map: render SVG, then fit ────────────────────────────────────────
  renderStpSvg();
  setTimeout(stpMapFit, 60);
}

// ── Expose functions needed by inline HTML event handlers ─────────────────────
window.stpNodeDragStart = stpNodeDragStart;
window.stpBgDragStart = stpBgDragStart;
window.stpMouseMove = stpMouseMove;
window.stpMouseUp = stpMouseUp;
window.stpWheel = stpWheel;
window.stpResetLayout = stpResetLayout;
window.stpMapFit = stpMapFit;
Object.defineProperty(window, 'stpWasDrag', { get() { return S.stpWasDrag; }, configurable: true });
