import S from '../lib/state.js';
import { q, h, fmtBytes, fmtSpeed, fmtDate, statusBadge, setBadge, extractModel, shortModel, OS_BADGE, TYPE_BADGE, logActivity, getLocations, refreshLocationSelects, matchesLocFilter, parseFetchJson, parseFetchJsonLenient } from '../lib/helpers.js';
import { detectOsFromCriteria, detectDeviceType } from '../criteria.js';
import { resolvePeerDev } from './mesh.js';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import html2canvas from 'html2canvas';

// ═══════════════════════════════════════════════════════════════════════════════
// NETZWERKPLAN (LLDP TOPOLOGY)
// ═══════════════════════════════════════════════════════════════════════════════

let topoNodes = {}; // id → {id,name,type,os,model,online,x,y,ghost,fixed}
let topoEdges = []; // {id,src,tgt,srcPort,dstPort}
let topoLldpMap = {}; // ip → full lldp entries (from sync)
const _topoSavedPos = (() => { try { return JSON.parse(localStorage.getItem('onsite_topo_pos')||'{}'); } catch(e) { return {}; } })();
let topoMacSearch  = '';   // current search string
let topoMacResults = [];   // [{switchIp, switchName, port, mac, ip}]
let topoTx = 0, topoTy = 0, topoScale = 1;
let topoDragNode = null, topoPan = null, topoWasDrag = false;
let topoRootId = '', topoDetailId = null;
let trafficEnabled = false;
let trafficData    = {}; // ip → { ifName → { inBps, outBps, speedBps, utilPct } }
let trafficHistory = {}; // edgeKey → [{inBps, outBps}, ...] (max 12)
let trafficTimer   = null;

const NW = 190, NH = 84, HG = 230, VG = 140;
const TOPO_TYPE_BADGE = {
  switch:   {label:'SW', bg:'rgba(170,218,247,.15)', color:'#aadaf7'},
  'lx-ap':  {label:'AP', bg:'rgba(249,115,22,.15)',  color:'#f97316'},
  'lcos-ap':{label:'AP', bg:'rgba(249,115,22,.15)',  color:'#f97316'},
  router:   {label:'GW', bg:'rgba(37,99,235,.15)',   color:'#7b9fff'},
  firewall: {label:'FW', bg:'rgba(239,68,68,.15)',   color:'#ef4444'},
};

function isTopoAccessPointType(type) {
  const t = type || '';
  return t === 'lx-ap' || t === 'lcos-ap';
}
/** Gerät ist AP und soll laut Filter nicht im Netzwerkplan erscheinen */
function topoIsHiddenApIp(ip) {
  if (!S.topoHideAccessPoints || !ip) return false;
  const d = S.deviceStore[ip];
  return !!(d && isTopoAccessPointType(d.type));
}

// ── Nachbar-Matching ──────────────────────────────────────────────────────────
export function resolveTopoNeighbor(entry, srcIp) {
  const sysName     = (entry.remSysName||'').toLowerCase();
  const remMac      = (entry.remMac||'').replace(/[:\-\. ]/g,'').toLowerCase();
  const remPortMac  = (entry.remPortMac||'').replace(/[:\-\. ]/g,'').toLowerCase();
  const remChasIp   = entry.remChassisIp||'';
  const normMac     = m => (m||'').replace(/[:\-\. ]/g,'').toLowerCase();
  const normStr     = s => (s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
  const sysNorm     = normStr(sysName);
  for (const d of Object.values(S.deviceStore)) {
    if (sysName && (d.name||'').toLowerCase() === sysName) return d.ip;
    if (remMac) {
      if (normMac(d.mac) === remMac) return d.ip;
      if (d.macs?.some(m => normMac(m) === remMac)) return d.ip;
    }
    if (remPortMac) {
      if (normMac(d.mac) === remPortMac) return d.ip;
      if (d.macs?.some(m => normMac(m) === remPortMac)) return d.ip;
    }
    if (remChasIp && d.ip === remChasIp) return d.ip;
  }
  if (sysNorm) {
    for (const d of Object.values(S.deviceStore)) {
      const dn = normStr(d.name);
      // "LX-6400-4C4A57" → normiert "lx64004c4a57", Device "LX6400" → "lx6400": startsWith-Match
      if (dn && (sysNorm.startsWith(dn) || dn.startsWith(sysNorm))) return d.ip;
    }
  }
  if (sysName) {
    for (const d of Object.values(S.deviceStore)) {
      const dn = (d.name||'').toLowerCase();
      if (dn && (dn.includes(sysName) || sysName.includes(dn))) return d.ip;
    }
  }
  // Bidirektionale Port-Kreuzreferenz: remSysName leer, aber Port-IDs matchen sich gegenseitig
  // Bsp: A.localPort="7" / A.remPort="LAN-1"  ↔  B.localPort="LAN-1" / B.remPort="7"
  // Führende Nullen normalisieren: "02" === "2"
  const normPort = s => { const t = (s||'').trim(); return /^\d+$/.test(t) ? String(parseInt(t, 10)) : t.toLowerCase(); };
  const myLocal  = normPort(entry.localPortName);
  const myRemote = normPort(entry.remPortId);
  if (myLocal && myRemote && srcIp) {
    for (const [devIp, devEntries] of Object.entries(topoLldpMap)) {
      if (devIp === srcIp) continue;
      for (const de of devEntries) {
        if (normPort(de.localPortName) === myRemote &&
            normPort(de.remPortId)     === myLocal) return devIp;
      }
    }
  }
  return null;
}

// ── Graph aufbauen ────────────────────────────────────────────────────────────
function portLabelForRemote(e, tgtIp, lldpMap) {
  const rpi = (e.remPortId||'').trim();
  const isMac = /^([0-9a-fA-F]{2}[:\- ]){5}[0-9a-fA-F]{2}$/.test(rpi);
  if (!isMac) return rpi;
  if (e.remPortDesc) return e.remPortDesc;
  // Reverse lookup: finde Eintrag des Zielgeräts, der auf uns zeigt
  if (tgtIp) {
    const srcDev = S.deviceStore[e._srcIp] || {};
    const srcMacs = new Set(
      [(srcDev.mac||''), ...(srcDev.macs||[])]
        .map(m => m.replace(/[:\-\. ]/g,'').toLowerCase()).filter(Boolean)
    );
    const rev = (lldpMap[tgtIp]||[]).find(r => {
      const rm  = (r.remMac    ||'').replace(/[:\-\. ]/g,'').toLowerCase();
      const rpm = (r.remPortMac||'').replace(/[:\-\. ]/g,'').toLowerCase();
      if ((rm && srcMacs.has(rm)) || (rpm && srcMacs.has(rpm)) || r.remChassisIp === e._srcIp) return true;
      // Fallback: Gegeneintrag per resolveTopoNeighbor (deckt Port-MAC-only Geräte ab)
      return resolveTopoNeighbor(r, tgtIp) === e._srcIp;
    });
    if (rev?.localPortName) return rev.localPortName;
  }
  return rpi;
}

export function buildTopoGraph(lldpMap) {
  topoNodes = {}; topoEdges = [];

  Object.values(S.deviceStore).filter(d => {
    if (d.online === false) return false;
    if (S.topoLocFilter !== 'all' && (d.location||'') !== S.topoLocFilter) return false;
    if (S.topoHideAccessPoints && isTopoAccessPointType(d.type)) return false;
    return true;
  }).forEach(d => {
    topoNodes[d.ip] = {
      id: d.ip, name: d.name||d.ip, type: d.type||'unknown',
      os: d.os||'', model: d.model||'', location: d.location||'', online: d.online, ghost: false,
      x: 0, y: 0, fixed: false,
    };
  });

  const edgeSet = new Set();
  Object.entries(lldpMap).forEach(([srcIp, entries]) => {
    if (topoIsHiddenApIp(srcIp)) return;
    entries.forEach(e => {
      e._srcIp = srcIp;
      const tgtIp = resolveTopoNeighbor(e, srcIp);
      if (topoIsHiddenApIp(tgtIp)) return;
      let tgtId = tgtIp;
      if (!tgtIp) {
        tgtId = 'ghost_' + (e.remSysName || e.remMac || 'unknown').replace(/[^a-z0-9]/gi,'_');
        if (!topoNodes[tgtId]) {
          const _rpi     = (e.remPortId||'').trim();
          const _portMac = /^([0-9a-fA-F]{2}[:\- ]){5}[0-9a-fA-F]{2}$/.test(_rpi);
          const ghostMac = e.remMac ? e.remMac.toLowerCase()
                         : _portMac ? _rpi.replace(/[\- ]/g,':').toLowerCase() : '';
          const ghostInfo = e.remPortDesc || (!_portMac && e.remSysName && _rpi ? _rpi : '');
          topoNodes[tgtId] = {
            id: tgtId, name: e.remSysName||e.remPortId||'Unbekannt', type:'unknown',
            os:'', model:'', online: undefined, ghost: true, x: 0, y: 0, fixed: false,
            ghostMac, ghostInfo, ghostSrc: srcIp,
          };
        }
      }
      const edgeKey = [srcIp, tgtId].sort().join('||');
      if (edgeSet.has(edgeKey)) {
        const ex = topoEdges.find(ed => ed.id === edgeKey);
        if (ex && ex.src === tgtId && !ex.dstPort) ex.dstPort = e.localPortName;
        if (ex && ex.src === srcIp && !ex.dstPort) ex.dstPort = portLabelForRemote(e, tgtIp, lldpMap);
      } else {
        edgeSet.add(edgeKey);
        topoEdges.push({ id:edgeKey, src:srcIp, tgt:tgtId,
          srcPort: e.localPortName||'', dstPort: portLabelForRemote(e, tgtIp, lldpMap) });
      }
    });
  });
}

// ── BFS Tree Layout ───────────────────────────────────────────────────────────
export function layoutTopo(rootId) {
  const ids = Object.keys(topoNodes);
  if (!ids.length) return {};

  const adj = {};
  ids.forEach(id => { adj[id] = []; });
  topoEdges.forEach(e => {
    if (adj[e.src] !== undefined && topoNodes[e.tgt]) adj[e.src].push(e.tgt);
    if (adj[e.tgt] !== undefined && topoNodes[e.src]) adj[e.tgt].push(e.src);
  });

  let root = ids.includes(rootId) ? rootId : '';
  if (!root) {
    const deg = {};
    ids.forEach(id => { deg[id] = (adj[id]||[]).length; });
    root = [...ids].sort((a,b) => deg[b]-deg[a])[0] || ids[0];
    topoRootId = root;
  }

  const level = {}, byLevel = {};
  const queue = [root]; let head = 0;
  level[root] = 0; byLevel[0] = [root];
  while (head < queue.length) {
    const curr = queue[head++];
    (adj[curr]||[]).forEach(next => {
      if (level[next] === undefined) {
        level[next] = level[curr] + 1;
        if (!byLevel[level[next]]) byLevel[level[next]] = [];
        byLevel[level[next]].push(next);
        queue.push(next);
      }
    });
  }

  const levels = Object.keys(byLevel).map(Number).sort((a,b)=>a-b);
  levels.forEach(lvl => {
    const group = byLevel[lvl];
    const totalW = (group.length - 1) * HG;
    group.forEach((id,i) => { topoNodes[id].x = i*HG - totalW/2; topoNodes[id].y = lvl*VG; });
  });

  const unconnected = ids.filter(id => level[id] === undefined);
  const maxLvl = levels.length ? Math.max(...levels) : 0;
  const unconnY = (maxLvl + 2) * VG;
  const totalUW = (unconnected.length - 1) * HG;
  unconnected.forEach((id,i) => { topoNodes[id].x = i*HG - totalUW/2; topoNodes[id].y = unconnY; });

  // Apply saved positions (override BFS layout for nodes with stored coordinates)
  Object.values(topoNodes).forEach(n => {
    const s = _topoSavedPos[n.id];
    if (s) { n.x = s.x; n.y = s.y; }
  });

  return { level, byLevel, unconnected, maxLvl };
}

// ── Root selector ─────────────────────────────────────────────────────────────
export function buildTopoSelector() {
  const devIds = Object.keys(topoNodes).filter(id => !topoNodes[id].ghost);
  if (!devIds.length) return;
  if (!devIds.includes(topoRootId)) {
    const deg = {};
    devIds.forEach(id => { deg[id] = 0; });
    topoEdges.forEach(e => { if (deg[e.src]!==undefined) deg[e.src]++; if (deg[e.tgt]!==undefined) deg[e.tgt]++; });
    topoRootId = [...devIds].sort((a,b) => deg[b]-deg[a])[0] || devIds[0];
  }
  const sorted = [...devIds].sort((a,b) => (topoNodes[a].name||'').localeCompare(topoNodes[b].name||''));
  const sel = q('topo-root-select');
  sel.innerHTML = sorted.map(id =>
    `<option value="${h(id)}"${id===topoRootId?' selected':''}>${h(topoNodes[id].name)}</option>`
  ).join('');
}

export function topoChangeRoot() {
  topoRootId = q('topo-root-select').value;
  layoutTopo(topoRootId);
  renderTopoSvg();
  setTimeout(topoFit, 50);
}

// ── Theme-aware SVG colours ───────────────────────────────────────────────────
function topoTheme() {
  const dark = document.documentElement.dataset.theme === 'dark';
  return {
    // Node text — matches --text / --text2 from CSS variables
    nodeText:      dark ? '#e8f0f8'             : 'rgba(15,30,55,.92)',
    nodeSub:       dark ? '#7ea8c8'             : 'rgba(74,100,120,.75)',
    nodePort:      dark ? 'rgba(200,225,248,.9)': 'rgba(30,50,80,.88)',
    portStroke:    dark ? 'rgba(10,22,40,.95)'  : 'rgba(240,244,248,.95)',
    // Node backgrounds
    bgOnline:      dark ? 'rgba(52,217,123,.06)': 'rgba(26,138,62,.05)',
    bgOffline:     dark ? 'rgba(240,85,104,.06)': 'rgba(211,47,47,.05)',
    bgUnknown:     dark ? 'rgba(77,166,255,.04)': 'rgba(100,116,139,.05)',
    // Node border + dot colours (new dark palette)
    borderOnline:  dark ? 'rgba(52,217,123,.6)' : 'rgba(26,138,62,.55)',
    borderOffline: dark ? 'rgba(240,85,104,.5)' : 'rgba(211,47,47,.4)',
    borderUnknown: dark ? 'rgba(77,166,255,.3)' : 'rgba(100,116,139,.4)',
    dotOnline:     dark ? '#2dd4a0'             : '#1a8a3e',
    dotOffline:    dark ? '#f05568'             : '#d32f2f',
    dotUnknown:    dark ? 'rgba(126,168,200,.6)': 'rgba(100,116,139,.6)',
    // Ghost nodes
    ghostBg:       dark ? 'rgba(22,40,68,.8)'   : 'rgba(220,230,240,.85)',
    ghostText:     dark ? '#a8c8e8'             : 'rgba(74,100,120,.85)',
    ghostSub:      dark ? '#5e8aaa'             : 'rgba(120,140,160,.75)',
    ghostBorder:   dark ? 'rgba(77,166,255,.25)': 'rgba(100,116,139,.35)',
    // Separator line / label
    sepStroke:     dark ? 'rgba(77,166,255,.1)' : 'rgba(0,40,85,.1)',
    sepText:       dark ? 'rgba(126,168,200,.4)': 'rgba(100,116,139,.4)',
  };
}

// ── Live Bandbreiten-Anzeige ────────────────────────────────────────────────────
let trafficPollCount = 0;

export function toggleTraffic() {
  trafficEnabled = !trafficEnabled;
  const btn = document.getElementById('topo-traffic-btn');
  if (btn) {
    btn.textContent      = trafficEnabled ? 'Traffic: An' : 'Traffic';
    btn.style.color      = trafficEnabled ? '#22c55e' : '';
    btn.style.borderColor= trafficEnabled ? 'rgba(34,197,94,.4)' : '';
  }
  if (trafficEnabled) {
    trafficPollCount = 0;
    setTopoStatus('📡 Bandbreite wird gemessen… (erste Werte nach ~5s)');
    fetchTrafficData();
    trafficTimer = setInterval(fetchTrafficData, 5000);
  } else {
    clearInterval(trafficTimer); trafficTimer = null;
    trafficData = {}; trafficHistory = {};
    setTopoStatus('');
    renderTopoSvg();
  }
}

export async function fetchTrafficData() {
  try {
    const res = await fetch('/api/iftraffic');
    if (!res.ok) { setTopoStatus('⚠ Traffic-Abfrage fehlgeschlagen (HTTP ' + res.status + ')'); return; }
    trafficData = await res.json();
    trafficPollCount++;
    const devCount = Object.keys(trafficData).length;
    if (trafficPollCount === 1) {
      setTopoStatus(`📡 Erste Messung läuft (${devCount} Gerät${devCount!==1?'e':''})… warte auf Delta…`);
    } else {
      // Messwerte aggregieren
      let maxBps = 0;
      Object.values(trafficData).forEach(d => Object.values(d).forEach(i => { maxBps = Math.max(maxBps, i.inBps, i.outBps); }));
      setTopoStatus(`📶 Traffic aktiv · ${devCount} Gerät${devCount!==1?'e':''} · max ${formatBps(maxBps)}`);
    }
    topoEdges.forEach(e => {
      const iface = getIfaceForEdge(e);
      if (!iface) return;
      const key = `${e.src}|${e.srcPort||''}`;
      if (!trafficHistory[key]) trafficHistory[key] = [];
      trafficHistory[key].push({ inBps: iface.inBps, outBps: iface.outBps });
      if (trafficHistory[key].length > 12) trafficHistory[key].shift();
    });
    renderTopoSvg();
    if (topoDetailId) topoOpenDetail(topoDetailId);
  } catch(err) {
    setTopoStatus('⚠ Traffic-Fehler: ' + err.message);
  }
}

function setTopoStatus(msg) {
  const el = q('topo-status');
  if (el) el.textContent = msg;
}

/** MAC nur hex/klein für Vergleich */
function topoMacNormKey(m) {
  return String(m || '').toLowerCase().replace(/[^0-9a-f]/g, '');
}

function topoPortNormKey(p) {
  return String(p || '').toLowerCase().replace(/\s+/g, '').replace(/[\-_]/g, '');
}

/** LLDP remPortId o.ä.: reine MAC → nicht mit FDB-ifName vergleichbar */
function topoIsMacLikePortLabel(s) {
  return /^([0-9a-fA-F]{2}[:\- ]){5}[0-9a-fA-F]{2}$/.test(String(s || '').trim());
}

function topoPortNumTail(p) {
  const m = String(p || '').match(/(\d+)\s*[a-z]?\s*$/i);
  return m ? parseInt(m[1], 10) : null;
}

/** Lokaler Portname auf hostIp zum Nachbarn neighborIp (ifName / LLDP). */
function topoInferLocalPortTowardNeighbor(hostIp, neighborIp) {
  if (!hostIp || !neighborIp || String(neighborIp).startsWith('ghost_')) return '';
  for (const ent of topoLldpMap[hostIp] || []) {
    if (resolveTopoNeighbor(ent, hostIp) === neighborIp && String(ent.localPortName || '').trim()) {
      return String(ent.localPortName).trim();
    }
  }
  return '';
}

/** Für FDB-Vergleich: sinnvolle srcPort/dstPort (MAC-artige / leere Gegenports per LLDP ersetzen). */
function topoPortsForLldpEdge(edge) {
  let sp = String(edge.srcPort || '').trim();
  let dp = String(edge.dstPort || '').trim();
  if (!sp || topoIsMacLikePortLabel(sp)) {
    const t = topoInferLocalPortTowardNeighbor(edge.src, edge.tgt);
    if (t) sp = t;
  }
  if (!dp || topoIsMacLikePortLabel(dp)) {
    const t = topoInferLocalPortTowardNeighbor(edge.tgt, edge.src);
    if (t) dp = t;
  }
  return { srcPort: sp, dstPort: dp };
}

/** FDB-Portname vs. LLDP-Portbezeichnung (gleicher logischer Port trotz unterschiedlicher Schreibweise) */
function topoFdbPortMatchesLldp(fdbPort, lldpPort) {
  const lp = String(lldpPort || '').trim();
  if (!lp) return false;
  const a = topoPortNormKey(fdbPort), b = topoPortNormKey(lldpPort);
  if (a && b && a === b) return true;
  if (a && b && Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a))) return true;
  const na = topoPortNumTail(fdbPort), nb = topoPortNumTail(lldpPort);
  return na !== null && na === nb;
}

/**
 * Dieselbe MAC erscheint auf zwei Switches in der FDB typischerweise auf dem Uplink zueinander.
 * Nur wenn die FDB-Ports zu derselben LLDP-Kante passen (Ports inkl. MAC-artigem Gegenport → ifName per LLDP),
 * einen Treffer weglassen. Kein reiner „eine Kante genügt“-Fallback (Access-Port + Uplink).
 */
function dedupeFdbMacAcrossKnownLldpLinks(results) {
  const known = new Set(Object.keys(S.deviceStore));
  const fdb = [];
  const rest = [];
  for (const r of results) {
    if (r.type === 'fdb') fdb.push(r);
    else rest.push(r);
  }
  const lldpKnown = topoEdges.filter(e =>
    !e.type
    && !String(e.src).startsWith('ghost_')
    && !String(e.tgt).startsWith('ghost_')
    && known.has(e.src)
    && known.has(e.tgt)
  );
  function edgesBetween(a, b) {
    return lldpKnown.filter(e =>
      (e.src === a && e.tgt === b) || (e.src === b && e.tgt === a)
    );
  }
  function strictOk(A, B, edge) {
    const e = topoPortsForLldpEdge(edge);
    if (A.switchIp === edge.src && B.switchIp === edge.tgt) {
      return topoFdbPortMatchesLldp(A.port, e.srcPort) && topoFdbPortMatchesLldp(B.port, e.dstPort);
    }
    if (A.switchIp === edge.tgt && B.switchIp === edge.src) {
      return topoFdbPortMatchesLldp(A.port, e.dstPort) && topoFdbPortMatchesLldp(B.port, e.srcPort);
    }
    return false;
  }
  const drop = new Set();
  for (let i = 0; i < fdb.length; i++) {
    for (let j = i + 1; j < fdb.length; j++) {
      if (drop.has(i) || drop.has(j)) continue;
      const A = fdb[i], B = fdb[j];
      const ma = topoMacNormKey(A.mac), mb = topoMacNormKey(B.mac);
      if (!ma || ma !== mb) continue;
      const eb = edgesBetween(A.switchIp, B.switchIp);
      if (!eb.length) continue;
      if (eb.some(edge => strictOk(A, B, edge))) drop.add(j);
    }
  }
  return rest.concat(fdb.filter((_, i) => !drop.has(i)));
}

export function searchTopoMac(val) {
  topoMacSearch = val.trim().toLowerCase();
  q('topo-mac-clear').style.display = topoMacSearch ? '' : 'none';
  topoMacResults = [];
  if (topoMacSearch.length >= 4) {
    // Eigene Infrastruktur-MACs für Filterung
    const infraMacs = new Set(Object.values(S.deviceStore).map(d => (d.mac||'').toLowerCase()).filter(Boolean));

    // WLAN-Clients bevorzugen – direkteste Verbindung
    const wlanMacs = new Set();
    Object.values(S.deviceStore).forEach(dev => {
      (dev.wlanClients||[]).forEach(c => {
        const mac = (c.mac||'').toLowerCase();
        const ip  = (c.ip||'').toLowerCase();
        const host = (c.hostname||'').toLowerCase();
        if (mac.includes(topoMacSearch) || ip.includes(topoMacSearch) || host.includes(topoMacSearch)) {
          wlanMacs.add(mac);
          topoMacResults.push({ switchIp: dev.ip, switchName: dev.name||dev.ip, port: c.ssid ? `${c.ssid} · ${c.band||'WLAN'}` : 'WLAN', mac: c.mac||'', ip: c.ip||'', hostname: c.hostname||'', type: 'wlan' });
        }
      });
    });

    // FDB-Einträge – nur wenn MAC nicht schon per WLAN gefunden und kein Infrastrukturgerät
    Object.values(S.deviceStore).forEach(dev => {
      (dev.fdbEntries||[]).forEach(e => {
        const mac = (e.mac||'').toLowerCase();
        const ip  = (e.ip||'').toLowerCase();
        if (mac.includes(topoMacSearch) || ip.includes(topoMacSearch)) {
          if (!infraMacs.has(mac) && !wlanMacs.has(mac))
            topoMacResults.push({ switchIp: dev.ip, switchName: dev.name||dev.ip, port: e.port||'?', mac: e.mac||'', ip: e.ip||'', type: 'fdb' });
        }
      });
    });
    topoMacResults = dedupeFdbMacAcrossKnownLldpLinks(topoMacResults);
  }
  renderTopoSvg();
  if (topoMacSearch.length >= 4) {
    setTopoStatus(topoMacResults.length
      ? `${topoMacResults.length} Treffer für „${topoMacSearch}"`
      : `Keine Treffer für „${topoMacSearch}"`);
  } else if (!topoMacSearch) {
    setTopoStatus('');
  }
}

export function clearTopoMacSearch() {
  const inp = q('topo-mac-search');
  if (inp) inp.value = '';
  searchTopoMac('');
}

function getIfaceForEdge(edge) {
  const map = trafficData[edge.src];
  if (!map || !edge.srcPort) return null;

  // 1) Direkter Treffer
  if (map[edge.srcPort]) return map[edge.srcPort];

  // 2) Alle Leerzeichen normalisieren + lowercase + Sonderzeichen entfernen
  const norm = s => (s||'').toLowerCase().replace(/\s+/g, '').replace(/[\-_]/g, '');
  const t = norm(edge.srcPort);
  for (const [k, v] of Object.entries(map)) { if (norm(k) === t) return v; }

  // 3) Port-Nummer-Matching: "9A" → 9, "Port 7" → 7, "GigabitEthernet 1/7" → 7
  const extractNum = s => { const m = (s||'').match(/(\d+)\s*[a-z]?\s*$/i); return m ? parseInt(m[1], 10) : null; };
  const edgeNum = extractNum(edge.srcPort);
  if (edgeNum !== null) {
    const physRe = /^(port|gigabit|switch|ethernet|eth|ge|fe|te|lan)/i;
    for (const [k, v] of Object.entries(map)) {
      if (physRe.test(k) && extractNum(k) === edgeNum) return v;
    }
    for (const [k, v] of Object.entries(map)) {
      if (/^\d+$/.test(k.trim()) && parseInt(k.trim(), 10) === edgeNum) return v;
    }
  }

  return null;
}

function edgeUtilPct(edge) { return getIfaceForEdge(edge)?.utilPct || 0; }

/** LLDP-Kanten: Farbe nach Port-Speed (speedBps aus Traffic-Poll). WDS/L2TP/Geist unverändert. */
function edgeColorWithSpeed(_baseColor, speedBps, e, bothOnline, ghost) {
  if (ghost || e.type === 'wds' || e.type === 'l2tp') return _baseColor;
  if (!speedBps || speedBps <= 0) return _baseColor;
  const O = (on, off) => (bothOnline ? on : off);
  if (speedBps <= 100e6) return `rgba(100,116,139,${O(0.62, 0.28)})`;
  if (speedBps <= 1e9) return `rgba(37,99,235,${O(0.65, 0.26)})`;
  if (speedBps <= 2.5e9) return `rgba(6,182,212,${O(0.78, 0.3)})`;
  if (speedBps <= 10e9) return `rgba(124,58,237,${O(0.8, 0.32)})`;
  return `rgba(217,119,6,${O(0.88, 0.36)})`;
}

function edgeWidthWithTraffic(base, util) {
  return (!trafficEnabled || !util) ? base : base + Math.min(3.5, util / 100 * 3.5);
}
function edgeColorWithTraffic(base, util) {
  if (!trafficEnabled || util < 60) return base;
  return util < 80 ? 'rgba(234,179,8,.85)' : 'rgba(239,68,68,.9)';
}

function formatBps(bps) {
  if (bps >= 1e9) return (bps / 1e9).toFixed(2) + ' Gbps';
  if (bps >= 1e6) return (bps / 1e6).toFixed(1) + ' Mbps';
  if (bps >= 1e3) return (bps / 1e3).toFixed(0) + ' kbps';
  return bps + ' bps';
}

export function trafficEdgeHover(event, src, srcPort) {
  const tt = document.getElementById('traffic-tt');
  if (!tt || !trafficEnabled) return;
  const iface = getIfaceForEdge({src, srcPort});
  if (!iface) { tt.style.display = 'none'; return; }
  const key  = `${src}|${srcPort}`;
  const hist = trafficHistory[key] || [];
  const pts  = hist.length > 1 ? hist : [{ inBps: 0, outBps: 0 }, { inBps: 0, outBps: 0 }];
  const MAX  = Math.max(...pts.map(p => Math.max(p.inBps, p.outBps)), iface.inBps, iface.outBps, 1);
  const W = 120, H = 36, step = W / (pts.length - 1);
  const spark = key => pts.map((p, i) =>
    `${(i * step).toFixed(1)},${(H - p[key] / MAX * H).toFixed(1)}`).join(' ');
  const util     = iface.utilPct.toFixed(1);
  const spd      = iface.speedBps ? ` · ${formatBps(iface.speedBps)}` : '';
  const devName  = S.deviceStore[src]?.name || src;
  const histKey  = `${src}|${srcPort}`;
  const hist2    = trafficHistory[histKey] || [];
  const pts2     = hist2.length > 1 ? hist2 : [{inBps:0,outBps:0},{inBps:0,outBps:0}];
  const MAX2     = Math.max(...pts2.map(p => Math.max(p.inBps, p.outBps)), iface.inBps, iface.outBps, 1);
  const step2    = W / (pts2.length - 1);
  const spark2   = k => pts2.map((p,i)=>`${(i*step2).toFixed(1)},${(H - p[k]/MAX2*H).toFixed(1)}`).join(' ');
  tt.innerHTML = `
    <div style="font-size:10px;color:#94a3b8;margin-bottom:2px">${h(devName)}</div>
    <div style="font-size:11px;font-weight:700;color:#e2e8f0;margin-bottom:5px">Port: ${h(srcPort)}</div>
    <svg width="${W}" height="${H}" style="display:block;margin-bottom:5px;overflow:visible">
      <polyline points="${spark2('outBps')}" fill="none" stroke="#f97316" stroke-width="1.5" stroke-linejoin="round"/>
      <polyline points="${spark2('inBps')}"  fill="none" stroke="#22c55e" stroke-width="1.5" stroke-linejoin="round"/>
    </svg>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:10px">
      <span style="color:#f97316">TX: ${h(formatBps(iface.outBps))}</span>
      <span style="color:#22c55e">RX: ${h(formatBps(iface.inBps))}</span>
      <span style="color:#94a3b8;grid-column:1/-1">${util}% Auslastung${h(spd)}</span>
    </div>`;
  tt.style.display = 'block';
  tt.style.left = (event.clientX + 16) + 'px';
  tt.style.top  = (event.clientY - 20) + 'px';
}
export function trafficEdgeLeave() {
  const tt = document.getElementById('traffic-tt');
  if (tt) tt.style.display = 'none';
}

// ── Render ────────────────────────────────────────────────────────────────────
export function renderTopoSvg() {
  const nodes = Object.values(topoNodes);
  q('topo-empty').style.display = nodes.length ? 'none' : '';
  if (!nodes.length) { q('topo-g').innerHTML = ''; return; }

  const hw = NW/2, hh = NH/2;

  function borderPt(cx, cy, tx, ty) {
    const dx = tx-cx, dy = ty-cy;
    if (!dx && !dy) return {x:cx, y:cy+hh};
    const sX = dx ? hw/Math.abs(dx) : Infinity;
    const sY = dy ? hh/Math.abs(dy) : Infinity;
    const s = Math.min(sX, sY);
    return {x: cx+dx*s, y: cy+dy*s};
  }
  const LOFF = 14;
  function labelPt(cx, cy, bx, by) {
    if (Math.abs(Math.abs(by-cy)-hh) < 0.5) {
      return {x:bx, y:cy+Math.sign(by-cy)*(hh+LOFF), anchor:'middle'};
    }
    return {x:cx+Math.sign(bx-cx)*(hw+LOFF), y:by, anchor:bx>cx?'start':'end'};
  }

  let svg = '';
  const tt = topoTheme();

  // Separator for unconnected nodes
  const connectedIds = new Set(topoEdges.flatMap(e => [e.src, e.tgt]));
  const unconn = nodes.filter(n => !connectedIds.has(n.id));
  const conn   = nodes.filter(n =>  connectedIds.has(n.id));
  if (unconn.length && conn.length) {
    const uy = Math.min(...unconn.map(n=>n.y));
    const xs = unconn.map(n=>n.x);
    const x1 = Math.min(...xs)-hw-30, x2 = Math.max(...xs)+hw+30;
    svg += `<line x1="${x1}" y1="${uy-55}" x2="${x2}" y2="${uy-55}" stroke="${tt.sepStroke}" stroke-width="1" stroke-dasharray="6,5"/>`;
    svg += `<text x="${(x1+x2)/2}" y="${uy-64}" text-anchor="middle" font-size="9" font-weight="600" fill="${tt.sepText}" font-family="system-ui,sans-serif" letter-spacing="0.1em">KEINE VERBINDUNG</text>`;
  }

  // Count edges per node pair so we can offset parallel edges
  const pairCount = {}, pairSeen = {};
  topoEdges.forEach(e => {
    const k = [e.src, e.tgt].sort().join('||');
    pairCount[k] = (pairCount[k]||0) + 1;
    pairSeen[k]  = 0;
  });

  // Edge type colors
  function edgeColor(e, bothOnline, ghost) {
    if (ghost) return 'rgba(100,116,139,.4)';
    if (e.type === 'wds')  return bothOnline ? 'rgba(249,115,22,.7)'  : 'rgba(249,115,22,.3)';
    if (e.type === 'l2tp') return bothOnline ? 'rgba(34,197,94,.7)'   : 'rgba(34,197,94,.3)';
    return bothOnline ? 'rgba(37,99,235,.6)' : 'rgba(37,99,235,.25)';
  }

  // Edges
  topoEdges.forEach(e => {
    const f = topoNodes[e.src], t = topoNodes[e.tgt];
    if (!f || !t) return;
    const bothOnline = f.online===true && t.online===true;
    const ghost = f.ghost || t.ghost;

    // Offset parallel edges between same pair
    const pairKey = [e.src, e.tgt].sort().join('||');
    const total = pairCount[pairKey] || 1;
    const idx   = pairSeen[pairKey]++;
    const offset = (idx - (total - 1) / 2) * 44;

    const midY = (f.y + t.y) / 2 + offset;
    const midX = (f.x + t.x) / 2 + (f.y === t.y ? offset : 0);
    const fs = borderPt(f.x, f.y, t.x, t.y);
    const te = borderPt(t.x, t.y, f.x, f.y);

    const iface = ghost ? null : getIfaceForEdge(e);
    const util = ghost ? 0 : (iface?.utilPct || 0);
    const speedBps = iface?.speedBps || 0;
    const base = edgeColor(e, bothOnline, ghost);
    const color = edgeColorWithTraffic(edgeColorWithSpeed(base, speedBps, e, bothOnline, ghost), util);
    const w     = edgeWidthWithTraffic(ghost ? 1.5 : 2, util);
    const disconnected = e.type ? e.connected === false : !bothOnline;
    const dash = (ghost || disconnected) ? ' stroke-dasharray="5,4"' : '';
    const tevt = (trafficEnabled && !ghost && e.srcPort)
      ? ` onmouseenter="trafficEdgeHover(event,'${h(e.src)}','${h(e.srcPort)}')" onmouseleave="trafficEdgeLeave()" style="cursor:crosshair"`
      : '';
    const edgePath = `M${fs.x.toFixed(1)},${fs.y.toFixed(1)} C${fs.x.toFixed(1)},${midY} ${te.x.toFixed(1)},${midY} ${te.x.toFixed(1)},${te.y.toFixed(1)}`;
    if (tevt) {
      svg += `<path d="${edgePath}" stroke="transparent" stroke-width="14" fill="none"${tevt}/>`;
      svg += `<path d="${edgePath}" stroke="${color}" stroke-width="${w}" fill="none"${dash} style="pointer-events:none"/>`;
    } else {
      svg += `<path d="${edgePath}" stroke="${color}" stroke-width="${w}" fill="none"${dash}/>`;
    }

    // Bandbreiten-Label bei aktivem Traffic (TX/RX getrennt)
    if (trafficEnabled && !ghost) {
      if (iface && (iface.outBps > 1000 || iface.inBps > 1000)) {
        const lx = (fs.x + te.x) / 2, ly = (fs.y + te.y) / 2 + offset * 0.5;
        const ts = `text-anchor="middle" font-size="8" font-weight="700" font-family="monospace,system-ui" paint-order="stroke" stroke="${tt.portStroke}" stroke-width="3"`;
        svg += `<text x="${lx.toFixed(1)}" y="${(ly-6).toFixed(1)}" ${ts} fill="#f97316">TX ${h(formatBps(iface.outBps))}</text>`;
        svg += `<text x="${lx.toFixed(1)}" y="${(ly+5).toFixed(1)}" ${ts} fill="#22c55e">RX ${h(formatBps(iface.inBps))}</text>`;
      }
    }

    const ts = `font-size="10" font-weight="600" fill="${tt.nodePort}" font-family="system-ui,sans-serif" paint-order="stroke" stroke="${tt.portStroke}" stroke-width="4" stroke-linejoin="round" dominant-baseline="middle"`;
    if (e.srcPort) { const lp=labelPt(f.x,f.y,fs.x,fs.y); svg+=`<text x="${lp.x.toFixed(1)}" y="${(lp.y+offset*0.3).toFixed(1)}" text-anchor="${lp.anchor}" ${ts} fill="${color}">${h(e.srcPort)}</text>`; }
    if (e.dstPort) { const rp=labelPt(t.x,t.y,te.x,te.y); svg+=`<text x="${rp.x.toFixed(1)}" y="${(rp.y+offset*0.3).toFixed(1)}" text-anchor="${rp.anchor}" ${ts} fill="${color}">${h(e.dstPort)}</text>`; }
  });

  // Nodes
  nodes.forEach(node => {
    const {x, y} = node;
    const rx = x-hw, ry = y-hh;
    const isRoot = node.id === topoRootId;

    if (node.ghost) {
      const dn = node.name.length>22 ? node.name.slice(0,21)+'…' : node.name;
      const gmac  = node.ghostMac  || '';
      const ginfo = node.ghostInfo || '';
      const gSrcName = node.ghostSrc ? (S.deviceStore[node.ghostSrc]?.name || node.ghostSrc) : '';
      const extras = (gmac?1:0) + (ginfo?1:0) + (gSrcName?1:0);
      const nameY  = ry + (extras>=2 ? 17 : extras===1 ? 20 : 25);
      const macY   = ry + (extras>=2 ? 29 : 35);
      const infoY  = ry + (extras>=2 ? 41 : 35);
      const srcY   = ry + (extras>=3 ? 52 : extras===2 ? 52 : extras===1 ? 48 : 42);
      const tagY   = ry + (extras>=3 ? 63 : extras===2 ? 63 : extras===1 ? 58 : 42);
      svg += `<g class="topo-node" opacity="0.65" onmousedown="topoNodeDragStart(event,'${h(node.id)}',event)" onclick="topoNodeClick('${h(node.id)}')">
        <rect class="topo-node-rect" x="${rx}" y="${ry}" width="${NW}" height="${NH+(extras>=2?20:extras===1?10:0)}" rx="8" fill="${tt.ghostBg}" stroke="${tt.ghostBorder}" stroke-width="1.5" stroke-dasharray="6,4"/>
        <text x="${rx+NW/2}" y="${nameY}" text-anchor="middle" font-size="12" font-weight="600" fill="${tt.ghostText}" font-family="system-ui,sans-serif">${h(dn)}</text>
        ${gmac  ? `<text x="${rx+NW/2}" y="${macY}"  text-anchor="middle" font-size="9" fill="${tt.ghostText}" font-family="monospace,system-ui">${h(gmac)}</text>`  : ''}
        ${ginfo ? `<text x="${rx+NW/2}" y="${infoY}" text-anchor="middle" font-size="9" fill="${tt.ghostSub}"  font-family="system-ui,sans-serif">${h(ginfo)}</text>` : ''}
        ${gSrcName ? `<text x="${rx+NW/2}" y="${srcY}" text-anchor="middle" font-size="8" fill="${tt.ghostSub}" font-family="system-ui,sans-serif" opacity="0.7">via ${h(gSrcName)}</text>` : ''}
        <text x="${rx+NW/2}" y="${tagY}" text-anchor="middle" font-size="9" fill="${tt.ghostSub}" font-family="system-ui,sans-serif" font-style="italic">nicht verwaltet</text>
      </g>`;
      return;
    }

    const dotColor    = node.online===true ? tt.dotOnline    : node.online===false ? tt.dotOffline    : tt.dotUnknown;
    // TYPE-BASED COLORS — to revert, replace the next 5 lines with:
    // const borderColor = node.online===true ? tt.borderOnline : node.online===false ? tt.borderOffline : tt.borderUnknown;
    // const bgFill      = node.online===true ? tt.bgOnline : node.online===false ? tt.bgOffline : tt.bgUnknown;
    const TYPE_COLOR_RGB = { router:'37,99,235', firewall:'239,68,68', switch:'14,165,233', 'lx-ap':'249,115,22', 'lcos-ap':'249,115,22' };
    const tcRgb = TYPE_COLOR_RGB[node.type];
    const borderColor = tcRgb ? `rgba(${tcRgb},${node.online===true ? '.65' : '.3'})` : (node.online===true ? tt.borderOnline : node.online===false ? tt.borderOffline : tt.borderUnknown);
    const bgFill      = tcRgb ? `rgba(${tcRgb},${node.online===true ? '.07' : '.03'})` : (node.online===true ? tt.bgOnline : node.online===false ? tt.bgOffline : tt.bgUnknown);
    const glow        = isRoot ? ' filter="url(#topo-glow)"' : '';
    const badge       = TOPO_TYPE_BADGE[node.type];
    const badgeLabel  = badge?.label || '?';
    const badgeBg     = badge?.bg    || 'rgba(100,116,139,.15)';
    const badgeColor  = badge?.color || 'rgba(148,163,184,.9)';
    const dname       = node.name.length>21 ? node.name.slice(0,20)+'…' : node.name;
    const dsub        = (node.model||node.os||'').slice(0,26);
    const dloc        = (node.location||'').slice(0,28);

    svg += `<g class="topo-node" onmousedown="topoNodeDragStart(event,'${h(node.id)}',event)" onclick="topoNodeClick('${h(node.id)}');"${glow}>
      <rect class="topo-node-rect" x="${rx}" y="${ry}" width="${NW}" height="${NH}" rx="8" fill="${bgFill}" stroke="${borderColor}" stroke-width="${isRoot?2.5:1.5}"/>
      ${isRoot?`<rect x="${rx-2}" y="${ry-2}" width="${NW+4}" height="${NH+4}" rx="10" fill="none" stroke="${borderColor}" stroke-width="0.5" opacity="0.4"/>`:''}
      <circle cx="${rx+14}" cy="${y}" r="5" fill="${dotColor}"${node.online===true?' filter="url(#topo-glow)"':''}/>
      <rect x="${rx+NW-34}" y="${ry+6}" width="26" height="14" rx="4" fill="${badgeBg}"/>
      <text x="${rx+NW-21}" y="${ry+16}" text-anchor="middle" font-size="9" font-weight="800" fill="${badgeColor}" font-family="system-ui,sans-serif">${h(badgeLabel)}</text>
      <text x="${rx+26}" y="${ry+26}" font-size="12" font-weight="700" fill="${tt.nodeText}" font-family="system-ui,sans-serif">${h(dname)}</text>
      <text x="${rx+26}" y="${ry+43}" font-size="10" fill="${tt.nodeSub}" font-family="system-ui,sans-serif">${h(dsub||'–')}</text>
      ${dloc?`<text x="${rx+26}" y="${ry+59}" font-size="9" fill="${tt.nodeSub}" font-family="system-ui,sans-serif" opacity="0.7">&#128205; ${h(dloc)}</text>`:''}
    </g>`;
  });

  // ── MAC-Suche Overlay ──────────────────────────────────────────────────────
  if (topoMacResults.length) {
    // Gruppiere Treffer nach Switch
    const bySwitch = {};
    topoMacResults.forEach(r => {
      if (!bySwitch[r.switchIp]) bySwitch[r.switchIp] = [];
      bySwitch[r.switchIp].push(r);
    });
    const hw = NW/2, hh = NH/2;
    const CW = 150, CH = 52, CGAP = 16;

    Object.entries(bySwitch).forEach(([switchIp, results]) => {
      const node = topoNodes[switchIp];
      if (!node) return;

      // Highlight-Ring um den Switch-Knoten
      svg += `<rect x="${(node.x-hw-5).toFixed(1)}" y="${(node.y-hh-5).toFixed(1)}" width="${NW+10}" height="${NH+10}" rx="12" fill="none" stroke="rgba(251,191,36,.85)" stroke-width="2" stroke-dasharray="6,3"/>`;

      // Client-Knoten unterhalb des Switches, nebeneinander angeordnet
      const totalW = results.length * CW + (results.length - 1) * CGAP;
      const startX = node.x - totalW / 2 + CW / 2;
      const cy     = node.y + hh + 70;

      results.forEach((r, i) => {
        const cx = startX + i * (CW + CGAP);
        // Verbindungslinie Switch → Client
        const isWlan = r.type === 'wlan';
        const boxColor = isWlan ? 'rgba(34,197,94,' : 'rgba(251,191,36,';
        const extraLines = [r.hostname, r.ip].filter(Boolean);
        const boxH = CH + extraLines.length * 14;
        svg += `<line x1="${node.x.toFixed(1)}" y1="${(node.y+hh).toFixed(1)}" x2="${cx.toFixed(1)}" y2="${(cy-boxH/2).toFixed(1)}" stroke="${boxColor}.55)" stroke-width="1.5" stroke-dasharray="4,3"/>`;
        // Port-Label auf der Linie
        const lx = (node.x + cx) / 2 + 6, ly = (node.y + hh + cy - boxH/2) / 2 - 3;
        svg += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" font-size="9" font-weight="700" fill="${boxColor}.9)" font-family="system-ui,sans-serif" paint-order="stroke" stroke="var(--bg2)" stroke-width="3">${h(r.port)}</text>`;
        // Client-Box
        svg += `<rect x="${(cx-CW/2).toFixed(1)}" y="${(cy-boxH/2).toFixed(1)}" width="${CW}" height="${boxH}" rx="8" fill="${boxColor}.08)" stroke="${boxColor}.7)" stroke-width="1.5"/>`;
        svg += `<text x="${cx.toFixed(1)}" y="${(cy-boxH/2+18).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="700" fill="${boxColor}.95)" font-family="monospace,system-ui">${h(r.mac)}</text>`;
        let lineY = cy - boxH/2 + 34;
        if (r.hostname) { svg += `<text x="${cx.toFixed(1)}" y="${lineY.toFixed(1)}" text-anchor="middle" font-size="10" fill="${boxColor}.8)" font-family="system-ui,sans-serif">${h(r.hostname.length>20?r.hostname.slice(0,19)+'…':r.hostname)}</text>`; lineY += 14; }
        if (r.ip)       { svg += `<text x="${cx.toFixed(1)}" y="${lineY.toFixed(1)}" text-anchor="middle" font-size="10" fill="${boxColor}.6)" font-family="monospace,system-ui">${h(r.ip)}</text>`; }
      });
    });
  }

  q('topo-g').innerHTML = svg;
}

// ── Detail panel ──────────────────────────────────────────────────────────────
export function topoNodeClick(id) {
  if (topoWasDrag) { topoWasDrag = false; return; }
  topoOpenDetail(id);
}

export function topoOpenDetail(id) {
  const node = topoNodes[id]; if (!node) return;
  topoDetailId = id;
  const dotColor = node.online===true ? '#a0ed3a' : node.online===false ? '#ff004d' : 'rgba(100,116,139,.6)';
  q('topo-detail-dot').style.background = dotColor;
  q('topo-detail-name').textContent = node.name;
  const subParts = [node.model, node.os, node.ghost ? null : node.id].filter(Boolean);
  q('topo-detail-sub').textContent = subParts.join(' · ') || '–';
  const locEl = q('topo-detail-location');
  if (locEl) { locEl.textContent = node.location || ''; locEl.style.display = node.location ? '' : 'none'; }
  q('topo-detail-setroot').style.display = node.ghost ? 'none' : '';

  const entries = topoLldpMap[id] || [];
  let html = '';

  if (entries.length) {
    html += `<div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">LLDP Nachbarn (${entries.length})</div>`;
    html += `<table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="color:var(--text3);font-size:10px">
      <th style="text-align:left;padding:0 6px 4px 0;font-weight:600">Port</th>
      <th style="text-align:left;padding:0 6px 4px 0;font-weight:600">Nachbar</th>
      <th style="text-align:left;padding:0 0 4px 0;font-weight:600">Gegenstelle</th>
    </tr></thead><tbody>`;
    entries.forEach(e => {
      html += `<tr style="border-top:1px solid var(--border)">
        <td style="padding:5px 6px 5px 0;color:#60a5fa;font-weight:600">${h(e.localPortName||'–')}</td>
        <td style="padding:5px 6px 5px 0;font-weight:600">${h(e.remSysName||e.remPortId||'?')}</td>
        <td style="padding:5px 0;color:var(--text3);font-size:11px">${h(e.remPortDesc||e.remPortId||'–')}</td>
      </tr>`;
    });
    html += `</tbody></table>`;
  }

  // Edges connecting to this node
  const links = topoEdges.filter(e => e.tgt===id || e.src===id);
  if (links.length) {
    const typeColor = { wds:'var(--orange)', l2tp:'var(--green)' };
    const typeLabel = { wds:'WDS', l2tp:'L2TP', undefined:'LLDP' };
    html += `<div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin:14px 0 8px">Verbindungen (${links.length})</div>`;
    links.forEach(e => {
      const otherId = e.src===id ? e.tgt : e.src;
      const other = topoNodes[otherId];
      if (!other) return;
      const myPort = e.src===id ? e.srcPort : e.dstPort;
      const theirPort = e.src===id ? e.dstPort : e.srcPort;
      const tcolor = typeColor[e.type] || '#60a5fa';
      const tlabel = typeLabel[e.type] || 'LLDP';
      html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 8px;background:var(--bg2);border-radius:6px;font-size:12px;margin-bottom:4px">
        <span style="font-weight:600">${h(other.name)}</span>
        <span style="display:flex;gap:6px;align-items:center">
          <span style="font-size:10px;color:${tcolor};font-weight:700">${tlabel}</span>
          <span style="color:var(--text3);font-size:11px">${h([myPort,theirPort].filter(Boolean).join(' → '))}</span>
        </span>
      </div>`;
    });
  }

  // Live Traffic section
  if (trafficEnabled && links.length) {
    let trafficRows = '';
    links.forEach(e => {
      const iface = getIfaceForEdge({src: e.src, srcPort: e.srcPort});
      if (!iface) return;
      const otherId = e.src === id ? e.tgt : e.src;
      const other   = topoNodes[otherId];
      const myPort  = e.src === id ? e.srcPort : e.dstPort;
      // Perspective: if id is the src, TX=outBps, RX=inBps; if id is tgt, directions flip
      const txBps = e.src === id ? iface.outBps : iface.inBps;
      const rxBps = e.src === id ? iface.inBps  : iface.outBps;
      if (txBps < 100 && rxBps < 100) return;
      trafficRows += `<div style="background:var(--bg2);border-radius:6px;padding:6px 8px;margin-bottom:4px;font-size:11px">
        <div style="display:flex;justify-content:space-between;margin-bottom:3px">
          <span style="font-weight:600;color:var(--text1)">${h(other?.name || otherId)}</span>
          <span style="color:var(--text3)">${h(myPort || '–')}</span>
        </div>
        <div style="display:flex;gap:12px">
          <span style="color:#f97316">TX: ${h(formatBps(txBps))}</span>
          <span style="color:#22c55e">RX: ${h(formatBps(rxBps))}</span>
          <span style="color:#64748b">${iface.utilPct.toFixed(1)}%</span>
        </div>
      </div>`;
    });
    if (trafficRows) {
      html += `<div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin:14px 0 8px">Live Traffic</div>${trafficRows}`;
    }
  }

  if (!html) html = `<p style="color:var(--text3);font-size:12px">Keine LLDP-Daten verfügbar.<br>LLDP Sync starten um Verbindungen zu laden.</p>`;
  q('topo-detail-content').innerHTML = html;
  q('topo-detail').style.display = 'flex';
}

export function topoCloseDetail() { q('topo-detail').style.display='none'; topoDetailId=null; }

export function topoSetRootFromDetail() {
  if (!topoDetailId || topoNodes[topoDetailId]?.ghost) return;
  topoRootId = topoDetailId;
  q('topo-root-select').value = topoRootId;
  layoutTopo(topoRootId);
  renderTopoSvg();
  setTimeout(topoFit, 50);
}

// ── Pan / Zoom / Drag ─────────────────────────────────────────────────────────
function topoSvgPt(e) {
  const r = q('topo-svg').getBoundingClientRect();
  return { x:(e.clientX-r.left-topoTx)/topoScale, y:(e.clientY-r.top-topoTy)/topoScale };
}
export function topoNodeDragStart(e, id) {
  e.stopPropagation();
  const pt = topoSvgPt(e), n = topoNodes[id];
  if (!n) return;
  topoDragNode = { id, ox:pt.x-n.x, oy:pt.y-n.y };
  topoWasDrag = false;
}
export function topoBgDragStart(e) {
  if (topoDragNode) return;
  topoPan = { sx:e.clientX, sy:e.clientY, tx:topoTx, ty:topoTy };
}
export function topoMouseMove(e) {
  if (topoDragNode) {
    const pt = topoSvgPt(e), n = topoNodes[topoDragNode.id];
    if (!n) return;
    n.x = pt.x - topoDragNode.ox;
    n.y = pt.y - topoDragNode.oy;
    topoWasDrag = true;
    renderTopoSvg();
  } else if (topoPan) {
    topoTx = topoPan.tx + (e.clientX - topoPan.sx);
    topoTy = topoPan.ty + (e.clientY - topoPan.sy);
    const g = document.getElementById('topo-g');
    if (g) g.setAttribute('transform', `translate(${topoTx},${topoTy}) scale(${topoScale})`);
  }
}
export function topoMouseUp() {
  if (topoDragNode && topoWasDrag) {
    const pos = {};
    Object.values(topoNodes).forEach(n => { pos[n.id] = { x: n.x, y: n.y }; });
    try { localStorage.setItem('onsite_topo_pos', JSON.stringify(pos)); } catch(e) {}
    Object.assign(_topoSavedPos, pos);
  }
  topoDragNode = null; topoPan = null; topoWasDrag = false;
}
window.addEventListener('mouseup', () => {
  if (topoDragNode && topoWasDrag) {
    const pos = {};
    Object.values(topoNodes).forEach(n => { pos[n.id] = { x: n.x, y: n.y }; });
    try { localStorage.setItem('onsite_topo_pos', JSON.stringify(pos)); } catch(e) {}
    Object.assign(_topoSavedPos, pos);
    topoDragNode = null; topoPan = null; topoWasDrag = false;
  }
});
window.topoResetLayout = function() {
  localStorage.removeItem('onsite_topo_pos');
  Object.keys(_topoSavedPos).forEach(k => delete _topoSavedPos[k]);
  layoutTopo(topoRootId);
  renderTopoSvg();
  setTimeout(topoFit, 50);
};
export function topoWheel(e) {
  e.preventDefault();
  const svgEl = q('topo-svg');
  const r = svgEl.getBoundingClientRect();
  const mx = e.clientX - r.left, my = e.clientY - r.top;
  const factor = e.deltaY < 0 ? 1.1 : 0.9;
  const newScale = Math.max(0.1, Math.min(5, topoScale * factor));
  topoTx = mx - (mx - topoTx) * (newScale / topoScale);
  topoTy = my - (my - topoTy) * (newScale / topoScale);
  topoScale = newScale;
  const g = document.getElementById('topo-g');
  if (g) g.setAttribute('transform', `translate(${topoTx},${topoTy}) scale(${topoScale})`);
}
export function topoZoom(factor) {
  topoScale = Math.max(0.1, Math.min(5, topoScale * factor));
  const g = document.getElementById('topo-g');
  if (g) g.setAttribute('transform', `translate(${topoTx},${topoTy}) scale(${topoScale})`);
}
export function topoFit() {
  const svgEl = q('topo-svg');
  const W = svgEl.clientWidth || 900, H = svgEl.clientHeight || 620;
  const nodes = Object.values(topoNodes);
  if (!nodes.length) return;
  const xs = nodes.map(n=>n.x), ys = nodes.map(n=>n.y);
  const minX=Math.min(...xs)-NW/2-20, maxX=Math.max(...xs)+NW/2+20;
  const minY=Math.min(...ys)-NH/2-20, maxY=Math.max(...ys)+NH/2+20;
  const sw=maxX-minX, sh=maxY-minY;
  topoScale = Math.min(W/sw, H/sh, 1.5);
  topoTx = W/2 - (minX+maxX)/2 * topoScale;
  topoTy = H/2 - (minY+maxY)/2 * topoScale;
  const g = document.getElementById('topo-g');
  if (g) g.setAttribute('transform', `translate(${topoTx},${topoTy}) scale(${topoScale})`);
}

// ── WDS Sync (Geräte-Tab) ─────────────────────────────────────────────────────
export async function syncWdsAll() {
  const btn = q('btn-wds-sync');
  const st  = q('dev-sync-status');
  const lxDevs = Object.values(S.deviceStore).filter(d => d.type === 'lx-ap' && d.online !== false && matchesLocFilter(d));
  if (!lxDevs.length) {
    st.className = 'status-bar error';
    st.textContent = S.devLocFilter !== 'all' ? `Keine online LX APs im Standort „${S.devLocFilter}".` : 'Keine online LX Access Points – bitte zuerst "Status" ausführen.'; return;
  }
  btn.disabled = true;
  st.className = 'status-bar loading';
  S.meshData.length = 0;
  let done = 0;
  try {
    for (let i = 0; i < lxDevs.length; i += 4) {
      await Promise.all(lxDevs.slice(i, i + 4).map(async dev => {
        try {
          const result = await window.snmpQ(dev.ip, 'wds');
          if (result.configured) window.mergeMeshResult?.(dev.ip, dev.name||dev.ip, result);
        } catch {}
        done++;
        st.innerHTML = `<span class="spinner"></span> WDS – ${done} / ${lxDevs.length} – ${h(dev.name||dev.ip)}`;
      }));
    }
    await fetch('/api/devices', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(S.deviceStore) });
    st.className = 'status-bar ok';
    st.textContent = `WDS abgeschlossen – ${S.meshData.length} Verbindungen.`;
    window.renderDevices?.(); window.renderMesh?.();
  } catch (e) {
    st.className = 'status-bar error';
    st.textContent = `Fehler: ${e.message}`;
  } finally {
    btn.disabled = false; btn.textContent = 'WDS';
  }
}

// ── L2TPv3 Sync (Geräte-Tab) ──────────────────────────────────────────────────
export async function syncL2tpAll() {
  const btn = q('btn-l2tp-sync2');
  const st  = q('dev-sync-status');
  const lxDevs = Object.values(S.deviceStore).filter(d => d.type === 'lx-ap' && d.online !== false && matchesLocFilter(d));
  if (!lxDevs.length) {
    st.className = 'status-bar error';
    st.textContent = S.devLocFilter !== 'all' ? `Keine online LX APs im Standort „${S.devLocFilter}".` : 'Keine online LX Access Points – bitte zuerst "Status" ausführen.'; return;
  }
  btn.disabled = true;
  st.className = 'status-bar loading';
  S.l2tpData.length = 0;
  let done = 0;
  try {
    for (let i = 0; i < lxDevs.length; i += 4) {
      await Promise.all(lxDevs.slice(i, i + 4).map(async dev => {
        try {
          const result = await window.snmpQ(dev.ip, 'l2tp');
          if (result.configured) window.mergeL2tpResult?.(dev.ip, dev.name||dev.ip, result);
        } catch {}
        done++;
        st.innerHTML = `<span class="spinner"></span> L2TPv3 – ${done} / ${lxDevs.length} – ${h(dev.name||dev.ip)}`;
      }));
    }
    await fetch('/api/devices', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(S.deviceStore) });
    st.className = 'status-bar ok';
    st.textContent = `L2TPv3 abgeschlossen – ${S.l2tpData.length} Endpunkte.`;
    window.renderDevices?.(); window.renderL2tp?.();
  } catch (e) {
    st.className = 'status-bar error';
    st.textContent = `Fehler: ${e.message}`;
  } finally {
    btn.disabled = false; btn.textContent = 'L2TPv3';
  }
}

// ── WLAN Clients + Switch-FDB Sammlung (syncWlanClients in wifi-dash.js) ───────

export function setClientsFilter(f) {
  S.clientsFilter = f;
  ['all','wlan','fdb'].forEach(id => q('clf-'+id)?.classList.toggle('active', id === f));
  window.renderClients?.();
}

export function clearClientsData() {
  if (!confirm('Client Explorer Daten löschen?')) return;
  S.clientsData = [];
  Object.values(S.deviceStore).forEach(d => { delete d.wlanClients; delete d.fdbEntries; });
  fetch('/api/devices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(S.deviceStore) });
  window.renderClients?.();
  setBadge('clients', 0);
}

function normalizeExplorerMac(s) {
  if (s == null) return null;
  const hex = String(s).replace(/[^0-9a-fA-F]/g, '').toLowerCase();
  if (hex.length !== 12) return null;
  return hex.match(/.{2}/g).join(':');
}

/** POST-Body wie beim Speichern unter NAC (ohne Secret-Feld). */
function buildNacPostBodyFromApi(data, macAllowlist) {
  return {
    radiusHost: data.radiusHost || '',
    radiusAuthPort: Number(data.radiusAuthPort) || 1812,
    radiusAcctPort: Number(data.radiusAcctPort) || 1813,
    policyUrl: data.policyUrl || '',
    notes: data.notes || '',
    embeddedRadiusEnabled: !!data.embeddedRadiusEnabled,
    embeddedRadiusBind: data.embeddedRadiusBind || '0.0.0.0',
    embeddedAuthPort: Number(data.embeddedAuthPort) || 1812,
    embeddedAcctPort: Number(data.embeddedAcctPort) || 1813,
    embeddedCoaPort: Math.min(65535, Math.max(0, Number(data.embeddedCoaPort) || 0)),
    embeddedVlanAssignmentEnabled: !!data.embeddedVlanAssignmentEnabled,
    nacAuthMode: data.nacAuthMode || 'mac_allowlist',
    macAllowlist,
    radiusUsers: Array.isArray(data.radiusUsers) ? data.radiusUsers : [],
  };
}

let nacAllowlistFetchPromise = null;

function ensureNacAllowlistLoaded() {
  if (Array.isArray(S.nacMacAllowlistCache)) return;
  if (nacAllowlistFetchPromise) return;
  nacAllowlistFetchPromise = fetch('/api/nac')
    .then((r) => parseFetchJsonLenient(r))
    .then((data) => {
      if (data && Array.isArray(data.macAllowlist)) {
        S.nacMacAllowlistCache = data.macAllowlist.map((row) => ({ ...row }));
      } else if (S.nacMacAllowlistCache === null) {
        S.nacMacAllowlistCache = [];
      }
    })
    .catch(() => {
      if (S.nacMacAllowlistCache === null) S.nacMacAllowlistCache = [];
    })
    .finally(() => {
      nacAllowlistFetchPromise = null;
      window.renderClients?.();
    });
}

function lookupNacEntry(macRaw) {
  const norm = normalizeExplorerMac(macRaw);
  if (!norm || !Array.isArray(S.nacMacAllowlistCache)) return null;
  return S.nacMacAllowlistCache.find((e) => String(e.mac || '').trim().toLowerCase() === norm) || null;
}

let clientsNacClickBound = false;

function bindClientsNacClickOnce() {
  if (clientsNacClickBound) return;
  const tbl = q('tbl-clients');
  if (!tbl) return;
  tbl.addEventListener('click', (e) => {
    const rm = e.target.closest('button[data-nac-remove]');
    if (rm) {
      e.preventDefault();
      const mac = rm.getAttribute('data-nac-mac') || '';
      clientsRemoveMacFromNac(mac);
      return;
    }
    const btn = e.target.closest('button[data-nac-add]');
    if (!btn) return;
    e.preventDefault();
    const mac = btn.getAttribute('data-nac-mac') || '';
    const host = btn.getAttribute('data-nac-host') || '';
    clientsAddMacToNac(mac, host);
  });
  clientsNacClickBound = true;
}

/** MAC in die NAC-Freigaben (eingebetteter RADIUS, Modus MAC-Allowlist) übernehmen */
export async function clientsAddMacToNac(macRaw, hostnameHint) {
  const mac = normalizeExplorerMac(macRaw);
  if (!mac) {
    alert('Ungültige MAC-Adresse');
    return;
  }
  try {
    const r = await fetch('/api/nac');
    const data = await parseFetchJson(r);
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    const list = Array.isArray(data.macAllowlist) ? [...data.macAllowlist] : [];
    if (list.some((e) => String(e.mac || '').trim().toLowerCase() === mac)) {
      alert('Diese MAC ist bereits in den freigegebenen Adressen (NAC).');
      return;
    }
    const label = String(hostnameHint || '').trim().slice(0, 120);
    list.push({ mac, label });
    const body = buildNacPostBodyFromApi(data, list);
    const pr = await fetch('/api/nac', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const out = await parseFetchJson(pr);
    if (!pr.ok) throw new Error(out.error || `HTTP ${pr.status}`);
    let msg = `MAC ${mac} wurde unter NAC → freigegebene MAC-Adressen gespeichert.`;
    if (data.nacAuthMode !== 'mac_allowlist') {
      msg += '\n\nHinweis: Der eingebettete RADIUS nutzt die MAC-Liste nur im Modus „Nur freigegebene MAC-Adressen“ — bei PAP bitte in NAC umschalten.';
    }
    alert(msg);
    if (Array.isArray(out.macAllowlist)) {
      S.nacMacAllowlistCache = out.macAllowlist.map((row) => ({ ...row }));
    }
    window.renderClients?.();
    window.renderNac?.();
  } catch (e) {
    alert(e.message || 'Speichern fehlgeschlagen');
  }
}

/** MAC aus der NAC-Freigabeliste entfernen (eingebetteter RADIUS). */
export async function clientsRemoveMacFromNac(macRaw) {
  const mac = normalizeExplorerMac(macRaw);
  if (!mac) {
    alert('Ungültige MAC-Adresse');
    return;
  }
  if (!window.confirm(`MAC ${mac} aus den NAC-Freigaben (freigegebene MAC-Adressen) entfernen?`)) return;
  try {
    const r = await fetch('/api/nac');
    const data = await parseFetchJson(r);
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    const prev = Array.isArray(data.macAllowlist) ? data.macAllowlist : [];
    const list = prev.filter((e) => String(e.mac || '').trim().toLowerCase() !== mac);
    if (list.length === prev.length) {
      alert('Diese MAC war nicht in der NAC-Liste.');
      return;
    }
    const body = buildNacPostBodyFromApi(data, list);
    const pr = await fetch('/api/nac', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const out = await parseFetchJson(pr);
    if (!pr.ok) throw new Error(out.error || `HTTP ${pr.status}`);
    let msg = `MAC ${mac} wurde aus den freigegebenen MAC-Adressen entfernt.`;
    if (data.nacAuthMode !== 'mac_allowlist') {
      msg += '\n\nHinweis: Die MAC-Liste wirkt nur im Modus „Nur freigegebene MAC-Adressen“.';
    }
    alert(msg);
    if (Array.isArray(out.macAllowlist)) {
      S.nacMacAllowlistCache = out.macAllowlist.map((row) => ({ ...row }));
    }
    window.renderClients?.();
    window.renderNac?.();
  } catch (e) {
    alert(e.message || 'Entfernen fehlgeschlagen');
  }
}

export function renderClients() {
  ensureNacAllowlistLoaded();
  bindClientsNacClickOnce();
  const srch     = (q('clients-search')?.value || '').toLowerCase();
  const filtered = S.clientsData.filter(r => {
    if (S.clientsFilter !== 'all' && r.type !== S.clientsFilter) return false;
    if (srch) {
      const hay = [r.mac, r.ip, r.hostname, r.ssid, r.port, r.sourceName].join(' ').toLowerCase();
      if (!hay.includes(srch)) return false;
    }
    return true;
  });
  const tbody = q('tbl-clients')?.querySelector('tbody');
  if (!tbody) return;
  setBadge('clients', S.clientsData.length || null);
  q('cnt-clients').textContent = filtered.length ? `${filtered.length}` : '';
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="11" class="empty">${S.clientsData.length ? 'Keine Einträge für diesen Filter' : '„WLAN Clients" im Geräte-Tab starten um Daten zu laden'}</td></tr>`;
    return;
  }
  // Uplink-Erkennung: Ports mit ≥ 3 MACs vom selben Switch sind wahrscheinlich Uplinks
  const portMacCount = {};
  S.clientsData.filter(r => r.type === 'fdb' && r.port).forEach(r => {
    const key = (r.sourceName || '') + '|' + r.port;
    portMacCount[key] = (portMacCount[key] || 0) + 1;
  });
  const UPLINK_THRESHOLD = parseInt(q('uplink-threshold')?.value, 10) || 3;

  tbody.innerHTML = filtered.map(r => {
    const typeTag = r.type === 'wlan'
      ? `<span class="badge badge-blue">WLAN</span>`
      : `<span class="badge badge-gray">Switch-MAC</span>`;
    const sig = r.signal != null && r.signal !== '' ? parseInt(r.signal) : null;
    const sigBadge = sig !== null && !isNaN(sig)
      ? `<span class="badge ${sig>=-60?'badge-green':sig>=-75?'badge-yellow':'badge-red'}">${sig} dBm</span>`
      : '—';
    const portKey = (r.sourceName || '') + '|' + r.port;
    const isUplink = r.type === 'fdb' && r.port && (portMacCount[portKey] || 0) >= UPLINK_THRESHOLD;
    const ssidOrPort = r.type === 'wlan'
      ? (r.ssid ? `<span class="badge badge-blue">${h(r.ssid)}</span>` : '—')
      : (r.port ? `<span style="color:var(--text2);font-size:12px">${h(r.port)}</span>${isUplink ? ` <span class="badge badge-orange" title="${portMacCount[portKey]} MACs an diesem Port">Uplink</span>` : ''}` : '—');
    const chanStr = r.channel
      ? (r.chanWidth ? `CH ${r.channel} <span style="color:var(--text3);font-size:11px">${h(r.chanWidth)}</span>` : `CH ${r.channel}`)
      : '—';
    const nacEntry = lookupNacEntry(r.mac);
    const labelTrim = nacEntry && String(nacEntry.label || '').trim();
    const nacLabelCell = nacEntry
      ? (labelTrim
        ? `<span style="color:var(--text2);font-size:12px" title="Bezeichnung aus NAC">${h(labelTrim)}</span>${nacEntry.vlan != null && nacEntry.vlan !== '' ? ` <span class="badge badge-gray" title="Dynamisches VLAN (NAC)">VLAN ${h(String(nacEntry.vlan))}</span>` : ''}`
        : '<span style="font-size:11px;color:var(--text3)">In NAC, ohne Bezeichnung</span>')
      : '—';
    const nacActionCell = nacEntry
      ? `<button type="button" class="btn btn-sm btn-danger" data-nac-remove="1" data-nac-mac="${h(r.mac)}" title="Aus freigegebenen MAC-Adressen (NAC) entfernen">Entfernen</button>`
      : `<button type="button" class="btn btn-sm" data-nac-add="1" data-nac-mac="${h(r.mac)}" data-nac-host="${h(r.hostname || '')}" title="Zur NAC-Freigabeliste hinzufügen (eingebetteter RADIUS)">Hinzufügen</button>`;
    return `<tr>
      <td style="color:var(--text2)">${h(r.sourceName)}</td>
      <td>${typeTag}</td>
      <td class="mono" style="cursor:pointer;color:var(--accent)" onclick="openTopoWithMac('${h(r.mac)}')" title="Im Netzwerkplan anzeigen">${h(r.mac)}</td>
      <td class="mono" style="color:var(--text2)">${r.ip ? h(r.ip) : '—'}</td>
      <td style="color:var(--text2)">${r.hostname ? h(r.hostname) : '—'}</td>
      <td>${ssidOrPort}</td>
      <td>${r.band ? `<span class="badge badge-gray">${h(r.band)}</span>` : '—'}</td>
      <td style="color:var(--text2);font-size:12px">${r.type === 'wlan' ? chanStr : '—'}</td>
      <td>${r.type === 'wlan' ? sigBadge : '—'}</td>
      <td style="max-width:200px;word-break:break-word">${nacLabelCell}</td>
      <td style="white-space:nowrap">${nacActionCell}</td>
    </tr>`;
  }).join('');
}

// ── Netzwerkplan mit MAC-Suche öffnen ────────────────────────────────────────
export function openTopoWithMac(mac) {
  window.showTab?.('topology');
  // Small delay so buildTopoFromStore (called by showTab) finishes rendering before we overlay the search
  setTimeout(() => {
    const inp = q('topo-mac-search');
    if (inp) { inp.value = mac; searchTopoMac(mac); }
  }, 80);
}

// ── Geräte Sync: jump to SNMP Scan and start ─────────────────────────────────
export function geraeteSync() {
  window.showTab?.('scanner');
  setTimeout(() => window.startScan?.(), 50);
}

// ── All-in-one sync for Netzwerkplan ─────────────────────────────────────────
export async function syncTopologyAll() {
  const btn = q('btn-topo-sync-all');
  const st  = q('dev-sync-status');
  const allDevs = Object.values(S.deviceStore).filter(matchesLocFilter);
  if (!allDevs.length) {
    st.className = 'status-bar error';
    st.textContent = S.devLocFilter !== 'all' ? `Keine Geräte im Standort „${S.devLocFilter}".` : 'Keine Geräte gespeichert – bitte zuerst Geräte importieren.';
    return;
  }

  btn.disabled = true; btn.textContent = '⟳ Läuft…';
  st.className = 'status-bar loading';

  try {
    // ── Phase 1: Online/Offline-Status für alle Geräte prüfen ────────────────
    st.innerHTML = `<span class="spinner"></span> Phase 1/6: Status prüfen – 0 / ${allDevs.length}`;
    let done = 0;

    async function checkStatus(dev) {
      try {
        await window.snmpQ(dev.ip, 'ping');
        if (S.deviceStore[dev.ip]) S.deviceStore[dev.ip].online = true;
      } catch {
        if (S.deviceStore[dev.ip]) S.deviceStore[dev.ip].online = false;
      }
      done++;
      st.innerHTML = `<span class="spinner"></span> Phase 1/6: Status prüfen – ${done} / ${allDevs.length} – ${h(dev.name||dev.ip)}`;
      window.renderDevices?.();
    }
    const CONC_STATUS = 5;
    for (let i = 0; i < allDevs.length; i += CONC_STATUS) {
      await Promise.all(allDevs.slice(i, i + CONC_STATUS).map(checkStatus));
    }

    // ── Phase 2: WiFi Mesh (nur lx-ap, nur online) ───────────────────────────
    const lxOnline = Object.values(S.deviceStore).filter(d => d.type === 'lx-ap' && d.online === true && matchesLocFilter(d));
    S.meshData.length = 0;
    done = 0;
    st.innerHTML = `<span class="spinner"></span> Phase 2/6: WiFi Mesh – 0 / ${lxOnline.length}`;

    async function syncWds(dev) {
      try {
        const result = await window.snmpQ(dev.ip, 'wds');
        if (result.configured) window.mergeMeshResult?.(dev.ip, dev.name||dev.ip, result);
      } catch {}
      done++;
      st.innerHTML = `<span class="spinner"></span> Phase 2/6: WiFi Mesh – ${done} / ${lxOnline.length} – ${h(dev.name||dev.ip)}`;
    }
    const CONC_WDS = 4;
    for (let i = 0; i < lxOnline.length; i += CONC_WDS) {
      await Promise.all(lxOnline.slice(i, i + CONC_WDS).map(syncWds));
    }

    // ── Phase 3: L2TPv3 (nur lx-ap, nur online) ─────────────────────────────
    S.l2tpData.length = 0;
    done = 0;
    st.innerHTML = `<span class="spinner"></span> Phase 3/6: L2TPv3 – 0 / ${lxOnline.length}`;

    async function syncL2tpDev(dev) {
      try {
        const result = await window.snmpQ(dev.ip, 'l2tp');
        if (result.configured) window.mergeL2tpResult?.(dev.ip, dev.name||dev.ip, result);
      } catch {}
      done++;
      st.innerHTML = `<span class="spinner"></span> Phase 3/6: L2TPv3 – ${done} / ${lxOnline.length} – ${h(dev.name||dev.ip)}`;
    }
    const CONC_L2TP = 4;
    for (let i = 0; i < lxOnline.length; i += CONC_L2TP) {
      await Promise.all(lxOnline.slice(i, i + CONC_L2TP).map(syncL2tpDev));
    }

    // ── Phase 4: LLDP – identisch mit "LLDP Sync" unter Geräte ──────────────
    const onlineDevs = Object.values(S.deviceStore).filter(d => d.online !== false && matchesLocFilter(d));
    st.innerHTML = `<span class="spinner"></span> Phase 4/6: LLDP – 0 / ${onlineDevs.length}`;
    await window.lldpSyncCore?.(onlineDevs, (d, total, dev) => {
      st.innerHTML = `<span class="spinner"></span> Phase 4/6: LLDP – ${d} / ${total} – ${h(dev.name||dev.ip)}`;
    });

    // ── Phase 5: MAC-Adressen ─────────────────────────────────────────────────
    done = 0;
    st.innerHTML = `<span class="spinner"></span> Phase 5/6: MAC-Adressen – 0 / ${onlineDevs.length}`;
    const macQueue = [...onlineDevs];
    async function macWorker() {
      while (macQueue.length) {
        const dev = macQueue.shift();
        try {
          const isSwitch = dev.type === 'switch';
          const [ifResult, fdbResult] = await Promise.all([
            window.snmpQ(dev.ip, 'ifmacs'),
            isSwitch ? window.snmpQ(dev.ip, 'mac') : Promise.resolve(null),
          ]);
          if (S.deviceStore[dev.ip] && ifResult.macs?.length) S.deviceStore[dev.ip].macs = ifResult.macs;
          if (S.deviceStore[dev.ip] && isSwitch && fdbResult?.entries?.length)
            S.deviceStore[dev.ip].fdbEntries = fdbResult.entries.map(e => ({
              ...e, type: 'fdb', sourceIp: dev.ip, sourceName: dev.name || dev.ip
            }));
        } catch {}
        done++;
        st.innerHTML = `<span class="spinner"></span> Phase 5/6: MAC-Adressen – ${done} / ${onlineDevs.length} – ${h(dev.name||dev.ip)}`;
      }
    }
    await Promise.all(Array(Math.min(3, onlineDevs.length || 1)).fill(null).map(macWorker));

    // ── Phase 6: WLAN Clients (alle APs) ─────────────────────────────────────
    const apOnline = Object.values(S.deviceStore).filter(d => (d.type === 'lx-ap' || d.type === 'lcos-ap') && d.online !== false && matchesLocFilter(d));
    done = 0;
    st.innerHTML = `<span class="spinner"></span> Phase 6/6: WLAN Clients – 0 / ${apOnline.length}`;
    for (let i = 0; i < apOnline.length; i += 4) {
      await Promise.all(apOnline.slice(i, i + 4).map(async dev => {
        try {
          const result = await window.snmpQ(dev.ip, 'wlan', { os: dev.os || '', devType: dev.type });
          if (S.deviceStore[dev.ip]) {
            S.deviceStore[dev.ip].wlanClients = result.entries.map(e => ({
              ...e, sourceIp: dev.ip, sourceName: dev.name || dev.ip, type: 'wlan',
            }));
          }
        } catch { if (S.deviceStore[dev.ip]) S.deviceStore[dev.ip].wlanClients = []; }
        done++;
        st.innerHTML = `<span class="spinner"></span> Phase 6/6: WLAN Clients – ${done} / ${apOnline.length} – ${h(dev.name||dev.ip)}`;
      }));
    }

    // ── Speichern ────────────────────────────────────────────────────────────
    st.innerHTML = `<span class="spinner"></span> Daten werden gespeichert…`;
    try {
      await fetch('/api/devices', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(S.deviceStore) });
    } catch (e) {
      console.error('Fehler beim Speichern:', e);
    }

    window.rebuildCachedData?.();
    S.dashLastDataSync = new Date().toISOString();
    const onlineCnt = Object.values(S.deviceStore).filter(d => d.online === true).length;
    logActivity(`Datensync: ${onlineCnt} Geräte online`);
    st.className = 'status-bar ok';
    st.textContent = 'Sync abgeschlossen.';
    window.renderDevices?.();
    window.renderMesh?.();
    window.renderL2tp?.();
    window.renderClients?.();
    buildTopoFromStore();

  } catch (e) {
    st.className = 'status-bar error';
    st.textContent = `Fehler: ${e.message}`;
    console.error('syncTopologyAll:', e);
  } finally {
    btn.disabled = false; btn.textContent = '⟳ Daten Abrufen';
  }
}

// ── Build topology from stored device data ────────────────────────────────────
export function buildTopoFromStore() {
  const hideApCb = q('topo-hide-ap');
  if (hideApCb) hideApCb.checked = !!S.topoHideAccessPoints;

  // LLDP edges
  topoLldpMap = {};
  Object.values(S.deviceStore).forEach(dev => {
    if (dev.lldpData?.length) topoLldpMap[dev.ip] = dev.lldpData;
  });
  buildTopoGraph(topoLldpMap); // builds nodes + LLDP edges

  // Track all existing edge pairs (both directions)
  const existingPairs = new Set(topoEdges.map(e => [e.src, e.tgt].sort().join('||')));

  // WDS / Mesh edges
  const edgeIdSet = new Set(topoEdges.map(e => e.id));
  let wdsCnt = 0;
  Object.values(S.deviceStore).forEach(dev => {
    if (topoIsHiddenApIp(dev.ip)) return;
    (dev.wdsLinks||[]).forEach(link => {
      if (!link.mac) return;
      const peerDev = resolvePeerDev(link.mac);
      if (!peerDev || peerDev.ip === dev.ip) return;
      if (topoIsHiddenApIp(peerDev.ip)) return;
      // Ensure peer node exists even when offline (offline devices are excluded from buildTopoGraph)
      if (!topoNodes[peerDev.ip]) {
        topoNodes[peerDev.ip] = {
          id: peerDev.ip, name: peerDev.name||peerDev.ip,
          type: peerDev.type||'unknown', os: peerDev.os||'', model: peerDev.model||'',
          location: peerDev.location||'', online: peerDev.online, ghost: false, x: 0, y: 0, fixed: false,
        };
      }
      const edgeId = 'wds:' + [dev.ip, peerDev.ip].sort().join('||');
      if (edgeIdSet.has(edgeId)) return;
      edgeIdSet.add(edgeId);
      topoEdges.push({ id: edgeId, src: dev.ip, tgt: peerDev.ip,
        srcPort: link.linkName||'WDS', dstPort: '',
        type: 'wds', label: link.band||'WDS', connected: link.connected });
      wdsCnt++;
    });
  });

  // L2TP edges – Ziel wird auch dann als Knoten ergänzt wenn es offline ist
  let l2tpCnt = 0;
  Object.values(S.deviceStore).forEach(dev => {
    if (topoIsHiddenApIp(dev.ip)) return;
    (dev.l2tpEndpoints||[]).forEach(ep => {
      const remoteIp = ep.remoteIp;
      if (!remoteIp || remoteIp === dev.ip) return;
      if (topoIsHiddenApIp(remoteIp)) return;
      if (!topoNodes[remoteIp]) {
        const rd = S.deviceStore[remoteIp];
        topoNodes[remoteIp] = {
          id: remoteIp, name: rd ? (rd.name||remoteIp) : remoteIp,
          type: rd?.type||'unknown', os: rd?.os||'', model: rd?.model||'',
          location: rd?.location||'', online: rd ? rd.online : false, ghost: !rd, x: 0, y: 0, fixed: false,
          ghostMac: '', ghostInfo: ep.endpointName ? `L2TP · ${ep.endpointName}` : 'L2TP',
          ghostSrc: dev.ip,
        };
      }
      const edgeId = 'l2tp:' + [dev.ip, remoteIp].sort().join('||');
      if (edgeIdSet.has(edgeId)) return;
      edgeIdSet.add(edgeId);
      topoEdges.push({ id: edgeId, src: dev.ip, tgt: remoteIp,
        srcPort: ep.endpointName||'L2TP', dstPort: '',
        type: 'l2tp', label: 'L2TP', connected: ep.state==='connected' });
      l2tpCnt++;
    });
  });

  buildTopoSelector();
  layoutTopo(topoRootId);
  renderTopoSvg();
  setTimeout(topoFit, 60);

  const nc = Object.keys(topoNodes).length;
  const ec = topoEdges.length;
  const devWithLldp = Object.values(S.deviceStore).filter(d => d.lldpData?.length).length;
  const st = q('topo-status');

  if (!devWithLldp && !wdsCnt && !l2tpCnt) {
    st.className = 'status-bar error';
    st.textContent = 'Keine Verbindungsdaten gespeichert – bitte LLDP Sync, Mesh Sync oder L2TP Sync unter den jeweiligen Tabs ausführen.';
  } else {
    const parts = [];
    if (devWithLldp) parts.push(`LLDP: ${devWithLldp} Gerät${devWithLldp!==1?'e':''}`);
    if (wdsCnt)      parts.push(`WDS: ${wdsCnt} Link${wdsCnt!==1?'s':''}`);
    if (l2tpCnt)     parts.push(`L2TP: ${l2tpCnt} Verbindung${l2tpCnt!==1?'en':''}`);
    st.className = 'status-bar ok';
    st.textContent = `${nc} Knoten, ${ec} Kante${ec!==1?'n':''} – ${parts.join(' · ')}`;
  }
}

/** Alle LLDP-Zeilen aus der Geräteliste (gespeicherte lldpData). */
function collectTopoLldpTableBody() {
  const rows = [];
  for (const dev of Object.values(S.deviceStore)) {
    const dName = dev.name || dev.ip || '';
    const dIp = dev.ip || '';
    const loc = dev.location || '';
    for (const e of dev.lldpData || []) {
      const tgtIp = resolveTopoNeighbor(e, dIp) || '';
      rows.push([
        dName,
        dIp,
        loc,
        e.localPortName || '',
        e.remSysName || '',
        e.remPortId || '',
        e.remPortDesc || '',
        e.remMac || '',
        e.remPortMac || '',
        e.remChassisIp || '',
        tgtIp,
      ]);
    }
  }
  rows.sort((a, b) => `${a[0]}${a[3]}`.localeCompare(`${b[0]}${b[3]}`, 'de'));
  return rows;
}

/** PDF: aktuelle Kartensicht (#topo-container) + Tabelle aller LLDP-Einträge. */
export async function exportTopoPdf() {
  const st = q('topo-status');
  const setErr = (msg) => {
    if (st) { st.className = 'status-bar error'; st.textContent = msg; }
    else alert(msg);
  };
  const clearSt = () => {
    if (st) { st.textContent = ''; st.className = 'status-bar'; }
  };

  try {
    topoCloseDetail();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    const ctr = q('topo-container');
    if (!ctr) {
      setErr('Netzwerkplan nicht gefunden.');
      return;
    }

    if (st) {
      st.className = 'status-bar';
      st.textContent = 'PDF wird erstellt…';
    }

    const bgVar = getComputedStyle(document.documentElement).getPropertyValue('--bg2').trim();
    const canvas = await html2canvas(ctr, {
      scale: 2,
      backgroundColor: bgVar || '#f0f4f8',
      logging: false,
      useCORS: true,
      allowTaint: true,
    });
    const imgData = canvas.toDataURL('image/png');

    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 10;
    doc.setFontSize(11);
    doc.text('OnSite – Netzwerkplan', margin, margin + 4);
    const imgTop = margin + 12;
    const maxW = pageW - 2 * margin;
    const maxH = pageH - imgTop - margin;
    const imgProps = doc.getImageProperties(imgData);
    let w = maxW;
    let h = (imgProps.height * w) / imgProps.width;
    if (h > maxH) {
      h = maxH;
      w = (imgProps.width * h) / imgProps.height;
    }
    doc.addImage(imgData, 'PNG', margin, imgTop, w, h);

    const head = [[
      'Quellgerät',
      'Quell-IP',
      'Standort',
      'Lokaler Port',
      'Nachbar (SysName)',
      'Remote-Port-ID',
      'Remote-Port-Info',
      'Chassis-MAC',
      'Port-MAC',
      'Chassis-IP',
      'Gegenstelle IP',
    ]];
    const body = collectTopoLldpTableBody();

    doc.addPage('a4', 'landscape');
    if (!body.length) {
      doc.setFontSize(10);
      doc.text('Keine LLDP-Daten in der Geräteliste – bitte unter Geräte „LLDP“ synchronisieren.', margin, margin + 8);
    } else {
      autoTable(doc, {
        head,
        body,
        startY: margin + 2,
        styles: { fontSize: 6.5, cellPadding: 0.8, overflow: 'linebreak' },
        headStyles: { fillColor: [37, 99, 235], fontSize: 7 },
        margin: { left: margin, right: margin, top: margin },
      });
    }

    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    doc.save(`netzwerkplan-${ts}.pdf`);

    if (st) {
      st.className = 'status-bar ok';
      st.textContent = 'PDF gespeichert.';
      setTimeout(clearSt, 5000);
    }
  } catch (e) {
    console.error(e);
    setErr('Fehler: ' + (e.message || String(e)));
  }
}

