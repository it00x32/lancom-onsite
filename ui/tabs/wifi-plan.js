import S from '../lib/state.js';
import { q, h } from '../lib/helpers.js';

// ══════════════════════════════════════════════════════════════════════════════
// WiFi-Plan
// ══════════════════════════════════════════════════════════════════════════════

let wpScale = 1, wpOffX = 0, wpOffY = 0;
let wpDragging = false, wpDragX = 0, wpDragY = 0;
let wpNodeDrag = null; // {id, ox, oy}
const wpNodes = {}; // id → {id, x, y, label, sub, type, online, channels, clients, own}
let wpBandFilter = 'all'; // 'all' | '2.4 GHz' | '5 GHz' | '6 GHz'
let wpFirstRender = true; // fit viewport on first render (also after reload with saved positions)

export function wpSetBandFilter(band) {
  wpBandFilter = band;
  ['all','2.4','5','6'].forEach(b => {
    const el = document.getElementById('wpf-' + b);
    if (el) el.classList.toggle('active', (b === 'all' ? 'all' : b + ' GHz') === band || (b === 'all' && band === 'all'));
  });
  renderWifiPlanSvg();
}
const _wpSavedPos = (() => { try { return JSON.parse(localStorage.getItem('onsite_wp_pos')||'{}'); } catch(e) { return {}; } })();

function wpApplyTransform() {
  const g = q('wifiplan-g');
  if (g) g.setAttribute('transform', `translate(${wpOffX},${wpOffY}) scale(${wpScale})`);
}
export function wifiPlanZoom(f) { wpScale = Math.max(0.2, Math.min(4, wpScale*f)); wpApplyTransform(); }
export function wifiPlanFit() {
  const ids = Object.keys(wpNodes);
  if (!ids.length) return;
  const xs = ids.map(id=>wpNodes[id].x), ys = ids.map(id=>wpNodes[id].y);
  const minX=Math.min(...xs)-100, maxX=Math.max(...xs)+100;
  const minY=Math.min(...ys)-60,  maxY=Math.max(...ys)+60;
  const ctr = q('wifiplan-container');
  const cw = ctr?.clientWidth||900, ch = ctr?.clientHeight||640;
  wpScale = Math.min(cw/(maxX-minX), ch/(maxY-minY), 2);
  wpOffX  = cw/2 - ((minX+maxX)/2)*wpScale;
  wpOffY  = ch/2 - ((minY+maxY)/2)*wpScale;
  wpApplyTransform();
}
export function wpBgDragStart(e) {
  if (e.target.closest('.wp-node')) return;
  wpDragging=true; wpDragX=e.clientX-wpOffX; wpDragY=e.clientY-wpOffY;
}
export function wpMouseMove(e) {
  if (wpNodeDrag) {
    const svgEl = q('wifiplan-svg');
    const rect = svgEl.getBoundingClientRect();
    wpNodes[wpNodeDrag.id].x = (e.clientX - rect.left - wpOffX) / wpScale;
    wpNodes[wpNodeDrag.id].y = (e.clientY - rect.top  - wpOffY) / wpScale;
    renderWifiPlanSvg();
  } else if (wpDragging) {
    wpOffX=e.clientX-wpDragX; wpOffY=e.clientY-wpDragY; wpApplyTransform();
  }
}
function wpSavePositions() {
  const pos = {};
  Object.values(wpNodes).forEach(n => { pos[n.id] = { x: n.x, y: n.y }; });
  try { localStorage.setItem('onsite_wp_pos', JSON.stringify(pos)); } catch(e) {}
}
export function wpMouseUp() {
  if (wpNodeDrag) wpSavePositions();
  wpDragging=false; wpNodeDrag=null;
}
// Globaler Fallback: Positions speichern wenn Maus irgendwo losgelassen wird
window.addEventListener('mouseup', () => { if (wpNodeDrag) { wpSavePositions(); wpNodeDrag=null; wpDragging=false; } });
export function wpResetLayout() {
  localStorage.removeItem('onsite_wp_pos');
  Object.keys(_wpSavedPos).forEach(k => delete _wpSavedPos[k]);
  Object.values(wpNodes).forEach(n => { n.x = 0; n.y = 0; });
  wpFirstRender = true;
  renderWifiPlan();
}
export function wpWheel(e) {
  e.preventDefault();
  const f = e.deltaY < 0 ? 1.1 : 0.9;
  const rect = q('wifiplan-container').getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  wpOffX = mx - (mx - wpOffX) * f;
  wpOffY = my - (my - wpOffY) * f;
  wpScale = Math.max(0.2, Math.min(4, wpScale * f));
  wpApplyTransform();
}
export function wpNodeDragStart(e, id) {
  e.stopPropagation();
  wpNodeDrag = { id };
}

function chanOverlapColor(chA, bandA, chB, bandB) {
  // Kein Overlap wenn verschiedene Bänder
  if (bandA !== bandB) return null;
  const a = parseInt(chA), b = parseInt(chB);
  if (isNaN(a) || isNaN(b)) return null;
  if (bandA === '2.4 GHz') {
    const diff = Math.abs(a - b);
    if (diff === 0)  return '#ef4444'; // Co-Channel
    if (diff < 5)   return '#f97316'; // Teilweise Overlap (< 5 Kanäle)
    return null; // kein Overlap
  }
  if (bandA === '5 GHz' || bandA === '6 GHz') {
    if (a === b) return '#ef4444'; // Co-Channel
    // Gleicher 80-MHz-Block?
    const blocks5 = [[36,40,44,48],[52,56,60,64],[100,104,108,112],[116,120,124,128],[132,136,140,144],[149,153,157,161],[165,169,173,177]];
    const blocks6 = [[1,5,9,13],[17,21,25,29],[33,37,41,45],[49,53,57,61],[65,69,73,77],[81,85,89,93],[97,101,105,109],[113,117,121,125],[129,133,137,141],[145,149,153,157],[161,165,169,173],[177,181,185,189]];
    const blocks = bandA === '5 GHz' ? blocks5 : blocks6;
    const inSame = blocks.some(bl => bl.includes(a) && bl.includes(b));
    if (inSame) return '#f97316';
    return null;
  }
  return null;
}

/** Plausible Funkkanäle (Client-MIB / alte Daten können z. B. „7“ bei 5 GHz liefern — Plan nur aus Radio-SNMP) */
function channelPlausibleForBand(band, ch) {
  const n = parseInt(String(ch), 10);
  if (!n || !band) return false;
  if (band === '2.4 GHz') return n >= 1 && n <= 14;
  if (band === '5 GHz') return n >= 36 && n <= 177;
  if (band === '6 GHz') return n >= 1 && n <= 233;
  return false;
}

/** Nur SNMP radioChannels (.57) — kein wlanClients-Fallback (MIB unzuverlässig vs. echter AP-Kanal) */
function wifiPlanChannelsForAp(ap) {
  const rc = ap.radioChannels;
  if (!Array.isArray(rc) || !rc.length) return [];
  return rc
    .map(r => ({
      channel: typeof r.channel === 'number' ? r.channel : parseInt(String(r.channel), 10) || 0,
      band: r.band || '',
      noise: r.noise ?? null,
      utilization: r.utilization ?? null,
    }))
    .filter(r => r.channel > 0 && r.band && channelPlausibleForBand(r.band, r.channel))
    .sort((a, b) => a.channel - b.channel);
}

export function renderWifiPlan() {
  const dark = document.documentElement.dataset.theme === 'dark';

  // ── Daten aufbereiten ──────────────────────────────────────────────────────
  const ownAps = Object.values(S.deviceStore).filter(d =>
    (d.type === 'lx-ap' || d.type === 'lcos-ap') && d.online === true,
  );
  const onlineApIps = new Set(ownAps.map(a => a.ip));
  Object.keys(wpNodes).forEach(id => {
    if (id.startsWith('foreign:')) return;
    if (!onlineApIps.has(id)) delete wpNodes[id];
  });
  const hasData = ownAps.some(a => (a.radioChannels||[]).length || (a.neighborAps||[]).length || (a.wlanClients||[]).length);

  q('wifiplan-empty').style.display = hasData ? 'none' : '';
  if (!hasData) { q('wifiplan-g').innerHTML = ''; return; }

  const ownIps = new Set(ownAps.map(a => a.ip));

  // Eigene APs als Knoten
  ownAps.forEach(ap => {
    if (!wpNodes[ap.ip]) {
      const saved = _wpSavedPos[ap.ip];
      wpNodes[ap.ip] = { id: ap.ip, x: saved?.x ?? 0, y: saved?.y ?? 0 };
    }
    const node = wpNodes[ap.ip];
    node.label  = ap.name || ap.ip;
    node.sub    = ap.ip;
    node.type   = ap.type;
    node.online = ap.online !== false;
    node.channels = wifiPlanChannelsForAp(ap);
    node.clients  = (ap.wlanClients||[]).length;
    node.own    = true;
    node.neighborAps = ap.neighborAps || [];
  });

  // Fremde APs aus Nachbar-Scans als Geister-Knoten
  const foreignBssids = {}; // bssid → {bssid, ssid, channel, band, seenBy:[ownIp]}
  ownAps.forEach(ap => {
    (ap.neighborAps||[]).forEach(n => {
      if (ownIps.has(n.ip)) return; // eigener AP → kein Geist
      if (!foreignBssids[n.bssid]) foreignBssids[n.bssid] = { ...n, seenBy: [] };
      if (!foreignBssids[n.bssid].seenBy.includes(ap.ip))
        foreignBssids[n.bssid].seenBy.push(ap.ip);
    });
  });
  // Fremde APs dedupliziert nach erster BSSID des gleichen Geräts (gleiche IP sofern bekannt)
  const foreignById = {};
  Object.values(foreignBssids).forEach(f => {
    const key = f.ip && f.ip !== '0.0.0.0' ? `ip:${f.ip}` : `bssid:${f.bssid}`;
    if (!foreignById[key]) foreignById[key] = { ...f, bands: [] };
    if (f.band && !foreignById[key].bands.includes(f.band)) foreignById[key].bands.push(f.band);
    if (!foreignById[key].ssid && f.ssid) foreignById[key].ssid = f.ssid;
  });
  Object.values(foreignById).forEach(f => {
    const fid = `foreign:${f.bssid}`;
    if (!wpNodes[fid]) { const s = _wpSavedPos[fid]; wpNodes[fid] = { id: fid, x: s?.x ?? 0, y: s?.y ?? 0 }; }
    const node = wpNodes[fid];
    node.label   = f.ssid || f.bssid.slice(0,11);
    node.sub     = f.bssid;
    node.type    = 'foreign';
    node.own     = false;
    node.online  = true;
    const fch = f.channel != null && f.channel !== '' ? parseInt(String(f.channel), 10) : 0;
    node.channels = (fch > 0 && f.band && channelPlausibleForBand(f.band, fch))
      ? [{ channel: fch, band: f.band }]
      : [];
    node.clients  = 0;
    node.seenBy   = f.seenBy;
  });

  const currentForeignIds = new Set(Object.values(foreignById).map(f => `foreign:${f.bssid}`));
  Object.keys(wpNodes).forEach(id => {
    if (!id.startsWith('foreign:')) return;
    if (!currentForeignIds.has(id)) delete wpNodes[id];
  });

  // ── Layout: eigene APs im inneren Kreis, Fremde im äußeren ─────────────────
  const ownIds     = ownAps.map(a => a.ip).filter(id => wpNodes[id]);
  const foreignIds = Object.values(foreignById).map(f => `foreign:${f.bssid}`);

  // Auto-Layout wenn alle Knoten noch auf 0,0 (erste Anzeige oder nach Reset)
  const needsLayout = ownIds.every(id => wpNodes[id].x === 0 && wpNodes[id].y === 0);
  if (needsLayout) {
    const innerR = Math.max(120, ownIds.length * 60);
    const outerR = innerR + Math.max(120, foreignIds.length * 40);
    ownIds.forEach((id, i) => {
      const angle = (2 * Math.PI * i / Math.max(ownIds.length, 1)) - Math.PI/2;
      wpNodes[id].x = Math.round(Math.cos(angle) * innerR);
      wpNodes[id].y = Math.round(Math.sin(angle) * innerR);
    });
    foreignIds.forEach((id, i) => {
      const angle = (2 * Math.PI * i / Math.max(foreignIds.length, 1)) - Math.PI/2;
      wpNodes[id].x = Math.round(Math.cos(angle) * outerR);
      wpNodes[id].y = Math.round(Math.sin(angle) * outerR);
    });
  }
  // Ansicht einpassen: beim ersten Render immer (auch nach Reload mit gespeicherten Positionen)
  if (needsLayout || wpFirstRender) {
    wpFirstRender = false;
    setTimeout(wifiPlanFit, 50);
  }

  // ── Kanten: Interference-Links ─────────────────────────────────────────────
  // Zwischen eigenen APs: alle Kanal-Kombinationen prüfen
  const edges = []; // {a, b, color, label, dashed}
  const edgePairs = new Set();

  function addEdgesForAps(idA, idB, channelsA, channelsB, dashed=false) {
    const pairKey = [idA, idB].sort().join('||');
    if (edgePairs.has(pairKey)) return;
    let worstColor = null;
    let labels = [];
    channelsA.forEach(rA => {
      channelsB.forEach(rB => {
        const c = chanOverlapColor(rA.channel, rA.band, rB.channel, rB.band);
        if (!c) return;
        if (!worstColor || (c === '#ef4444')) worstColor = c;
        else if (c === '#f97316' && worstColor !== '#ef4444') worstColor = c;
        labels.push(`CH${rA.channel}↔CH${rB.channel}`);
      });
    });
    if (worstColor) {
      edgePairs.add(pairKey);
      edges.push({ a: idA, b: idB, color: worstColor, label: labels[0]||'', dashed });
    } else {
      // Keine Interferenz aber sichtbar → graue Linie
      edgePairs.add(pairKey);
      edges.push({ a: idA, b: idB, color: dark ? 'rgba(100,120,150,0.3)' : 'rgba(150,170,200,0.4)', label:'', dashed });
    }
  }

  // Eigene APs untereinander (basierend auf Nachbar-Scan oder immer verbinden wenn > 1)
  for (let i = 0; i < ownIds.length; i++) {
    for (let j = i+1; j < ownIds.length; j++) {
      const nodeA = wpNodes[ownIds[i]], nodeB = wpNodes[ownIds[j]];
      addEdgesForAps(ownIds[i], ownIds[j], nodeA.channels, nodeB.channels, false);
    }
  }

  // Fremde APs → eigene APs die sie sehen
  Object.values(foreignById).forEach(f => {
    const fid = `foreign:${f.bssid}`;
    const fch = f.channel != null && f.channel !== '' ? parseInt(String(f.channel), 10) : 0;
    const fChannels = (fch > 0 && f.band && channelPlausibleForBand(f.band, fch))
      ? [{ channel: fch, band: f.band }]
      : [];
    f.seenBy.forEach(ownIp => {
      const ownChannels = wpNodes[ownIp]?.channels || [];
      addEdgesForAps(fid, ownIp, fChannels, ownChannels, true);
    });
  });

  // ── WDS-Links aus deviceStore ──────────────────────────────────────────────
  const wdsEdges = []; // {a, b, signal, band, txRate, rxRate}
  const wdsPairs = new Set();

  // Strategie 1: gleicher linkName auf beiden APs → sicher verbunden
  const linkNameMap = {}; // linkName → [{apIp, link}]
  ownAps.forEach(ap => {
    (ap.wdsLinks||[]).filter(l => l.connected).forEach(link => {
      if (!linkNameMap[link.linkName]) linkNameMap[link.linkName] = [];
      linkNameMap[link.linkName].push({ apIp: ap.ip, link });
    });
  });
  Object.values(linkNameMap).forEach(entries => {
    for (let i = 0; i < entries.length; i++) {
      for (let j = i+1; j < entries.length; j++) {
        const {apIp: aIp, link: lA} = entries[i];
        const {apIp: bIp, link: lB} = entries[j];
        const pairKey = [aIp, bIp].sort().join('||');
        if (wdsPairs.has(pairKey)) return;
        wdsPairs.add(pairKey);
        const sig = Math.max(lA.signal||0, lB.signal||0);
        wdsEdges.push({ a: aIp, b: bIp, signal: sig, band: lA.band||lB.band, txRate: lA.txRate, rxRate: lA.rxRate });
      }
    }
  });

  // Strategie 2: Fallback — alle APs mit connected WDS-Links untereinander verbinden
  if (!wdsEdges.length) {
    const wdsAps = ownAps.filter(ap => (ap.wdsLinks||[]).some(l => l.connected));
    for (let i = 0; i < wdsAps.length; i++) {
      for (let j = i+1; j < wdsAps.length; j++) {
        const pairKey = [wdsAps[i].ip, wdsAps[j].ip].sort().join('||');
        if (wdsPairs.has(pairKey)) continue;
        wdsPairs.add(pairKey);
        const lA = (wdsAps[i].wdsLinks||[]).find(l => l.connected) || {};
        const lB = (wdsAps[j].wdsLinks||[]).find(l => l.connected) || {};
        const sig = Math.max(lA.signal||0, lB.signal||0);
        wdsEdges.push({ a: wdsAps[i].ip, b: wdsAps[j].ip, signal: sig, band: lA.band||lB.band, txRate: lA.txRate, rxRate: lA.rxRate });
      }
    }
  }

  // WDS-Knoten mit WDS-Info markieren
  wdsEdges.forEach(e => {
    if (wpNodes[e.a]) wpNodes[e.a].hasWds = true;
    if (wpNodes[e.b]) wpNodes[e.b].hasWds = true;
  });

  // Globale WDS-Kanten speichern für renderWifiPlanSvg
  window._wpWdsEdges = wdsEdges;

  // ── Co-Channel-Paare: immer aus gleicher Quelle wie die Knoten (radioChannels), nicht aus WiFi-Analyse-Cache ──
  const _b5 = [[36,40,44,48],[52,56,60,64],[100,104,108,112],[116,120,124,128],[132,136,140,144],[149,153,157,161],[165,169,173,177]];
  const _b6 = [[1,5,9,13],[17,21,25,29],[33,37,41,45],[49,53,57,61],[65,69,73,77],[81,85,89,93],[97,101,105,109],[113,117,121,125],[129,133,137,141],[145,149,153,157],[161,165,169,173],[177,181,185,189]];
  window._wpCoChanPairs = {};
  const coChanEntries = [];
  ownAps.forEach(ap => {
    wifiPlanChannelsForAp(ap).forEach(r => {
      coChanEntries.push({ apIp: ap.ip, band: r.band, channel: String(r.channel) });
    });
  });
  [{ band: '2.4 GHz', blocks: null }, { band: '5 GHz', blocks: _b5 }, { band: '6 GHz', blocks: _b6 }].forEach(({ band, blocks }) => {
    const bEntries = coChanEntries.filter(c => c.band === band && c.channel);
    const chanData = {};
    bEntries.forEach(c => { if (!chanData[c.channel]) chanData[c.channel] = {}; chanData[c.channel][c.apIp] = true; });
    Object.entries(chanData).forEach(([ch, apsObj]) => {
      const aps = Object.keys(apsObj);
      if (aps.length < 2) return;
      for (let i = 0; i < aps.length; i++) for (let j = i+1; j < aps.length; j++) {
        const k = [aps[i], aps[j]].sort().join('||');
        if (!window._wpCoChanPairs[k]) window._wpCoChanPairs[k] = [];
        window._wpCoChanPairs[k].push({ band, label: `CH${ch}`, color: '#ef4444' });
      }
    });
    if (blocks) blocks.forEach(block => {
      const blockAps = {};
      bEntries.filter(c => block.includes(parseInt(c.channel))).forEach(c => { blockAps[c.apIp] = c.channel; });
      const aps = Object.keys(blockAps);
      if (aps.length < 2) return;
      for (let i = 0; i < aps.length; i++) for (let j = i+1; j < aps.length; j++) {
        if (blockAps[aps[i]] === blockAps[aps[j]]) continue;
        const k = [aps[i], aps[j]].sort().join('||');
        if (!window._wpCoChanPairs[k]) window._wpCoChanPairs[k] = [];
        if (!window._wpCoChanPairs[k].some(p => p.band === band))
          window._wpCoChanPairs[k].push({ band, label: `CH${blockAps[aps[i]]}↔${blockAps[aps[j]]}`, color: '#f97316' });
      }
    });
  });
  renderWifiPlanSvg();
}

export function renderWifiPlanSvg() {
  const dark = document.documentElement.dataset.theme === 'dark';
  const NW = 200;
  const bandColor = b => b === '2.4 GHz' ? '#f97316' : b === '5 GHz' ? '#22c55e' : b === '6 GHz' ? '#818cf8' : '#7ea8c8';

  // Knotenhöhe: variabel je nach Anzahl Radios (22px pro Radio-Zeile + 54px Header)
  function nodeH(node) { return 54 + Math.max(1, (node.channels||[]).length) * 22; }

  function borderPt(node, tx, ty) {
    const NH = nodeH(node), hw = NW/2, hh = NH/2;
    const dx=tx-node.x, dy=ty-node.y;
    if (!dx && !dy) return {x:node.x, y:node.y+hh};
    const sX = dx ? hw/Math.abs(dx) : Infinity;
    const sY = dy ? hh/Math.abs(dy) : Infinity;
    const s  = Math.min(sX, sY);
    return {x: node.x+dx*s, y: node.y+dy*s};
  }

  const nodes = Object.values(wpNodes);
  q('wifiplan-empty').style.display = nodes.length ? 'none' : '';
  if (!nodes.length) { q('wifiplan-g').innerHTML = ''; return; }

  const ownNodes    = nodes.filter(n => n.own);
  const foreignNodes= nodes.filter(n => !n.own);
  const wdsEdges    = window._wpWdsEdges || [];

  let svg = '';
  const bgStr = dark ? '#0d1b2a' : '#f0f4f8';

  // ── Reichweite-Kreise ─────────────────────────────────────────────────────
  ownNodes.forEach(node => {
    if (!node.online) return;
    const r = 110 + (node.channels||[]).length * 10;
    svg += `<circle cx="${node.x}" cy="${node.y}" r="${r}" fill="${dark?'rgba(249,115,22,0.03)':'rgba(249,115,22,0.025)'}" stroke="${dark?'rgba(249,115,22,0.10)':'rgba(249,115,22,0.07)'}" stroke-dasharray="5,5"/>`;
  });

  // ── WDS-Kanten (dicker, orange) ───────────────────────────────────────────
  wdsEdges.forEach(e => {
    const nA = wpNodes[e.a], nB = wpNodes[e.b]; if (!nA || !nB) return;
    const fs = borderPt(nA, nB.x, nB.y);
    const te = borderPt(nB, nA.x, nA.y);
    const sigVal = e.signal ? -e.signal : null; // WDS signal ist positiv = abs(dBm)
    const sigColor = !sigVal ? '#f97316' : sigVal >= -65 ? '#22c55e' : sigVal >= -75 ? '#84cc16' : '#f97316';
    const midX = (fs.x+te.x)/2, midY = (fs.y+te.y)/2;
    const label = e.signal ? `${-e.signal} dBm` : 'WDS';
    const rateLabel = e.txRate ? ` · ${e.txRate}/${e.rxRate} Mbps` : '';
    svg += `<line x1="${fs.x.toFixed(1)}" y1="${fs.y.toFixed(1)}" x2="${te.x.toFixed(1)}" y2="${te.y.toFixed(1)}" stroke="${sigColor}" stroke-width="3.5" opacity="0.75"/>`;
    svg += `<rect x="${(midX-36).toFixed(1)}" y="${(midY-10).toFixed(1)}" width="72" height="16" rx="4" fill="${bgStr}" opacity="0.85"/>`;
    svg += `<text x="${midX.toFixed(1)}" y="${(midY+1).toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="9" fill="${sigColor}" font-family="system-ui" font-weight="700">WDS ${h(label)}${h(rateLabel)}</text>`;
  });

  // ── Interferenz-Kanten zwischen eigenen APs (nur aus WiFi-Analyse) ──────────
  ownNodes.forEach((nodeA, i) => {
    for (let j = i+1; j < ownNodes.length; j++) {
      const nodeB = ownNodes[j];
      const hasWds = wdsEdges.some(e => (e.a===nodeA.id&&e.b===nodeB.id)||(e.a===nodeB.id&&e.b===nodeA.id));
      const pairKey = [nodeA.id, nodeB.id].sort().join('||');
      const allPairs = (window._wpCoChanPairs||{})[pairKey] || [];
      const activePairs = wpBandFilter === 'all' ? allPairs : allPairs.filter(p => p.band === wpBandFilter);

      const neutralColor = dark ? 'rgba(100,140,200,0.13)' : 'rgba(100,130,180,0.13)';
      let lineColor = neutralColor;
      let label = '';
      if (activePairs.length) {
        const hasCoChan = activePairs.some(p => p.color === '#ef4444');
        lineColor = hasCoChan ? '#ef4444' : '#f97316';
        label = activePairs.map(p => p.label).join(' · ');
      }

      const fs = borderPt(nodeA, nodeB.x, nodeB.y);
      const te = borderPt(nodeB, nodeA.x, nodeA.y);
      const midX = (fs.x+te.x)/2, midY = (fs.y+te.y)/2;
      const strokeW = activePairs.length ? (hasWds ? 1.5 : 2.2) : (hasWds ? 1 : 1.2);
      svg += `<line x1="${fs.x.toFixed(1)}" y1="${fs.y.toFixed(1)}" x2="${te.x.toFixed(1)}" y2="${te.y.toFixed(1)}" stroke="${lineColor}" stroke-width="${strokeW}" ${hasWds?'stroke-dasharray="4,3"':''}/>`;
      if (label) {
        const labelY = hasWds ? midY + 14 : midY;
        const lw = label.length * 5 + 10;
        svg += `<rect x="${(midX-lw/2).toFixed(1)}" y="${(labelY-8).toFixed(1)}" width="${lw}" height="14" rx="3" fill="${bgStr}" opacity="0.85"/>`;
        svg += `<text x="${midX.toFixed(1)}" y="${(labelY+1).toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="8" fill="${lineColor}" font-family="system-ui" font-weight="700">${h(label)}</text>`;
      }
    }
  });

  // ── Kanten: Fremde APs → eigene APs ──────────────────────────────────────
  foreignNodes.forEach(fNode => {
    (fNode.seenBy||[]).forEach(ownIp => {
      const ownNode = wpNodes[ownIp]; if (!ownNode) return;
      const fs = borderPt(fNode, ownNode.x, ownNode.y);
      const te = borderPt(ownNode, fNode.x, fNode.y);
      let lineColor = dark ? 'rgba(120,120,120,0.25)' : 'rgba(150,150,150,0.25)';
      (fNode.channels||[]).forEach(rF => {
        (ownNode.channels||[]).forEach(rO => {
          const c = chanOverlapColor(rF.channel, rF.band, rO.channel, rO.band);
          if (c === '#ef4444') lineColor = 'rgba(239,68,68,0.5)';
          else if (c === '#f97316' && !lineColor.includes('239')) lineColor = 'rgba(249,115,22,0.4)';
        });
      });
      svg += `<line x1="${fs.x.toFixed(1)}" y1="${fs.y.toFixed(1)}" x2="${te.x.toFixed(1)}" y2="${te.y.toFixed(1)}" stroke="${lineColor}" stroke-width="1.2" stroke-dasharray="5,4"/>`;
    });
  });

  // ── Knoten: eigene APs ────────────────────────────────────────────────────
  ownNodes.forEach(node => {
    const NH = nodeH(node), hw = NW/2, hh = NH/2;
    const rx = node.x-hw, ry = node.y-hh;
    const dotC    = node.online ? '#22c55e' : '#ef4444';
    const borderC = node.hasWds ? (dark?'rgba(249,115,22,0.9)':'rgba(200,90,10,0.8)') : (dark?'rgba(249,115,22,0.6)':'rgba(200,90,10,0.5)');
    const bgC     = dark ? 'rgba(249,115,22,0.09)' : 'rgba(249,115,22,0.05)';
    const textC   = dark ? '#e8f0f8' : 'rgba(15,30,55,.92)';
    const subC    = dark ? '#7ea8c8' : 'rgba(74,100,120,.75)';
    const cntLabel = node.clients > 0 ? ` · ${node.clients}` : '';

    let radioRows = '';
    (node.channels||[]).sort((a, b) => (Number(a.channel) || 0) - (Number(b.channel) || 0)).forEach((r, ri) => {
      const ry2 = ry + 50 + ri * 22;
      const bc = bandColor(r.band);
      const util = r.utilization ?? null;
      const noise = r.noise ?? null;
      // Layout (NW=200): [CH rx+10] [Band rx+46] [Noise rx+76] | [Bar rx+120,w=40] [% rx+164]
      const barW = 40, barH = 5, barX = rx + 120;
      const utilPct = util !== null ? Math.min(util, 100) : 0;
      const utilColor = utilPct > 70 ? '#ef4444' : utilPct > 40 ? '#f97316' : '#22c55e';
      const bandShort = r.band.replace(' GHz','G');
      radioRows += `<text x="${rx+10}" y="${ry2+4}" font-size="9" font-weight="700" fill="${bc}" font-family="monospace,system-ui">CH${r.channel}</text>`;
      radioRows += `<text x="${rx+46}" y="${ry2+4}" font-size="8" fill="${bc}" opacity="0.75" font-family="system-ui">${bandShort}</text>`;
      if (noise !== null) {
        radioRows += `<text x="${rx+76}" y="${ry2+4}" font-size="7.5" fill="${subC}" font-family="monospace,system-ui">${noise}dBm</text>`;
      }
      if (util !== null) {
        radioRows += `<rect x="${barX}" y="${ry2-1}" width="${barW}" height="${barH}" rx="2" fill="${dark?'rgba(255,255,255,0.10)':'rgba(0,0,0,0.10)'}"/>`;
        radioRows += `<rect x="${barX}" y="${ry2-1}" width="${Math.round(barW*utilPct/100)}" height="${barH}" rx="2" fill="${utilColor}"/>`;
        radioRows += `<text x="${barX+barW+4}" y="${ry2+4}" font-size="8" fill="${utilColor}" font-family="system-ui" font-weight="700">${util}%</text>`;
      }
    });

    const wdsBadge = node.hasWds ? `<rect x="${rx+NW-58}" y="${ry+5}" width="22" height="13" rx="4" fill="rgba(34,197,94,0.2)"/><text x="${rx+NW-47}" y="${ry+14}" text-anchor="middle" font-size="8" font-weight="700" fill="#22c55e" font-family="system-ui">WDS</text>` : '';

    svg += `<g class="wp-node" style="cursor:move" onmousedown="wpNodeDragStart(event,'${h(node.id)}')" onclick="openDeviceDetail('${h(node.id)}')">
      <rect x="${rx}" y="${ry}" width="${NW}" height="${NH}" rx="8" fill="${bgC}" stroke="${borderC}" stroke-width="${node.hasWds?2.5:1.8}" filter="url(#wp-glow)"/>
      <circle cx="${rx+10}" cy="${ry+18}" r="4" fill="${dotC}"/>
      ${wdsBadge}
      <rect x="${rx+NW-30}" y="${ry+5}" width="22" height="13" rx="4" fill="rgba(249,115,22,0.2)"/>
      <text x="${rx+NW-19}" y="${ry+14}" text-anchor="middle" font-size="8" font-weight="800" fill="#f97316" font-family="system-ui">AP</text>
      <text x="${rx+18}" y="${ry+20}" font-size="12" font-weight="700" fill="${textC}" font-family="system-ui,sans-serif">${h(node.label)}</text>
      <text x="${rx+18}" y="${ry+34}" font-size="8.5" fill="${subC}" font-family="system-ui,sans-serif">${h(node.id)}${cntLabel ? ` <tspan fill="var(--cyan)">${h(cntLabel)} &#9679;</tspan>` : ''}</text>
      <line x1="${rx+6}" y1="${ry+41}" x2="${rx+NW-6}" y2="${ry+41}" stroke="${dark?'rgba(255,255,255,0.06)':'rgba(0,0,0,0.06)'}" stroke-width="1"/>
      ${radioRows}
    </g>`;
  });

  // ── Knoten: Fremde APs ────────────────────────────────────────────────────
  foreignNodes.forEach(node => {
    const NH = nodeH(node), hw = NW/2, hh = NH/2;
    const rx = node.x-hw, ry = node.y-hh;
    const borderC = dark ? 'rgba(100,120,150,0.35)' : 'rgba(100,120,150,0.35)';
    const bgC   = dark ? 'rgba(20,32,52,0.85)' : 'rgba(218,226,238,0.85)';
    const textC = dark ? '#7a9db8' : 'rgba(74,100,120,.80)';

    let radioRows = '';
    (node.channels||[]).forEach((r, ri) => {
      const ry2 = ry + 48 + ri * 20;
      const bc = bandColor(r.band);
      radioRows += `<text x="${rx+10}" y="${ry2+4}" font-size="9" font-weight="700" fill="${bc}" font-family="monospace">CH${r.channel}</text>`;
      radioRows += `<text x="${rx+46}" y="${ry2+4}" font-size="8" fill="${textC}" font-family="system-ui">${r.band.replace(' GHz','G')}</text>`;
    });

    svg += `<g class="wp-node" style="cursor:move" onmousedown="wpNodeDragStart(event,'${h(node.id)}')">
      <rect x="${rx}" y="${ry}" width="${NW}" height="${NH}" rx="8" fill="${bgC}" stroke="${borderC}" stroke-width="1.2" stroke-dasharray="5,3"/>
      <rect x="${rx+NW-44}" y="${ry+5}" width="36" height="13" rx="4" fill="${dark?'rgba(100,120,150,0.2)':'rgba(100,120,150,0.15)'}"/>
      <text x="${rx+NW-26}" y="${ry+14}" text-anchor="middle" font-size="8" font-weight="700" fill="${textC}" font-family="system-ui">FREMD</text>
      <text x="${rx+10}" y="${ry+20}" font-size="11" font-weight="600" fill="${textC}" font-family="system-ui">${h(node.label)}</text>
      <text x="${rx+10}" y="${ry+34}" font-size="8" fill="${textC}" opacity="0.6" font-family="monospace">${h(node.sub)}</text>
      <line x1="${rx+6}" y1="${ry+41}" x2="${rx+NW-6}" y2="${ry+41}" stroke="${dark?'rgba(255,255,255,0.04)':'rgba(0,0,0,0.04)'}" stroke-width="1"/>
      ${radioRows}
    </g>`;
  });

  q('wifiplan-g').innerHTML = svg;
  wpApplyTransform();

  // Legende
  const leg = q('wifiplan-legend');
  if (leg) leg.innerHTML =
    `<span style="color:#22c55e">━━</span> WDS-Link (RSSI) &nbsp;` +
    `<span style="color:#ef4444">━</span> Co-Channel &nbsp;` +
    `<span style="color:#f97316">━</span> Teilw. Overlap &nbsp;` +
    `<span style="color:${dark?'rgba(100,140,200,0.9)':'rgba(100,130,180,0.8)'}">━</span> Kein Overlap &nbsp;` +
    `<span style="color:${dark?'rgba(120,120,120,0.7)':'rgba(150,150,150,0.7)'}">╌</span> Fremd-AP &nbsp;` +
    `<span style="color:#f97316">█░</span> Kanalauslastung`;
}

// ── Expose functions needed by inline HTML event handlers ─────────────────────
window.wpSetBandFilter = wpSetBandFilter;
window.wifiPlanZoom = wifiPlanZoom;
window.wifiPlanFit = wifiPlanFit;
window.wpBgDragStart = wpBgDragStart;
window.wpMouseMove = wpMouseMove;
window.wpMouseUp = wpMouseUp;
window.wpResetLayout = wpResetLayout;
window.wpWheel = wpWheel;
window.wpNodeDragStart = wpNodeDragStart;
window.renderWifiPlan = renderWifiPlan;
window.renderWifiPlanSvg = renderWifiPlanSvg;
