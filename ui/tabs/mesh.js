/**
 * WIFI MESH tab – WDS link overview and per-device sync.
 * Extracted from app.js lines 2794-3023.
 *
 * Cross-module callbacks (attach to window when integrating):
 *   snmpQ, setDeviceOnline, renderDevices
 */
import S from '../lib/state.js';
import {
  q, h, fmtDate, statusBadge, mkTh, noSortTh, applySort, clickSort,
  setBadge, shortModel, matchesLocFilter, logActivity, OS_BADGE,
} from '../lib/helpers.js';

const _snmpQ = (...a) => window.snmpQ?.(...a);
const _setDeviceOnline = (...a) => window.setDeviceOnline?.(...a);
const _renderDevices = () => window.renderDevices?.();

// ═══════════════════════════════════════════════════════════════════════════════
// WIFI MESH
// ═══════════════════════════════════════════════════════════════════════════════

function rssiStatus(signal, connected) {
  if (!connected) return 'red';
  if (signal == null) return 'orange';
  const pct = Number(signal);
  if (pct >= (S.appSettings.rssiGreen  ?? 80)) return 'green';
  if (pct >= (S.appSettings.rssiYellow ?? 50)) return 'yellow';
  if (pct >= (S.appSettings.rssiOrange ?? 0))  return 'orange';
  return 'red';
}
const RS = {
  green:  { cls:'dot-green',  bcls:'badge-green',  lbl:'Gut'    },
  yellow: { cls:'dot-yellow', bcls:'badge-yellow', lbl:'Mittel' },
  orange: { cls:'dot-orange', bcls:'badge-orange', lbl:'Schwach'},
  red:    { cls:'dot-red',    bcls:'badge-red',    lbl:'Offline'},
};

export function meshSortClick(col) { clickSort(S.meshSort, col, renderMesh); }

export function setMeshFilter(f) {
  S.meshFilter = f;
  ['all','green','yellow','orange','red'].forEach(k => {
    const el = q('mf-'+k); if (el) el.classList.toggle('active', k===f);
  });
  renderMesh();
}

export function setMeshLocFilter(v) { S.meshLocFilter = v; renderMesh(); }

export function resolvePeerDev(mac) {
  const low = (mac||'').toLowerCase();
  if (!low) return null;
  return Object.values(S.deviceStore).find(d => {
    if ((d.mac||'').toLowerCase() === low) return true;
    if (d.macs?.some(m => m.toLowerCase() === low)) return true;
    return false;
  }) || null;
}

export function clearMeshData() {
  if (!confirm('WDS-Verbindungsdaten für alle Geräte löschen?')) return;
  S.meshData.length = 0;
  Object.values(S.deviceStore).forEach(d => { delete d.wdsLinks; });
  fetch('/api/devices', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(S.deviceStore) });
  renderMesh(); _renderDevices();
}

export function renderMesh() {
  const srch = (q('mesh-search')?.value||'').toLowerCase();

  // Step 1: Resolve peer device for every entry
  const entries = S.meshData.map(r => ({ ...r, peerDev: resolvePeerDev(r.mac) }));

  // Step 2a: Merge rows where BOTH sides are known devices (one row per bidirectional link)
  const processedKeys = new Set();
  const mergedRows = [];
  for (const r of entries.filter(e => e.peerDev)) {
    const key = [r.deviceIp, r.peerDev.ip].sort().join('|');
    if (processedKeys.has(key)) continue;
    processedKeys.add(key);

    const other = entries.find(o => o !== r && o.deviceIp === r.peerDev.ip && o.peerDev?.ip === r.deviceIp);
    if (other) {
      // Both sides queried → merge; prefer the non-remote (master/AP) side as primary
      const primary   = !r.isRemote ? r : (!other.isRemote ? other : r);
      const secondary = primary === r ? other : r;
      mergedRows.push({ ...primary, peerSignal: secondary.signal, peerConnected: secondary.connected, merged: true });
    } else {
      // Peer known but only one side was queried (offline, not an LX AP, etc.)
      mergedRows.push({ ...r, merged: false });
    }
  }

  // Step 2b: Legacy deduplication for entries where peer is unknown (use isRemote flag)
  const unknownPeerEntries = entries.filter(e => !e.peerDev);
  const nonRemoteMacs = new Set(unknownPeerEntries.filter(r => !r.isRemote && r.mac).map(r => r.mac));
  const singleRows = unknownPeerEntries
    .filter(r => !r.isRemote || !nonRemoteMacs.has(r.mac))
    .map(r => ({ ...r, merged: false }));

  const allRows = [...mergedRows, ...singleRows];

  // Step 3: Filter
  const rows = allRows.filter(r => {
    const st = rssiStatus(r.signal, r.connected);
    if (S.meshFilter !== 'all' && st !== S.meshFilter) return false;
    if (S.meshLocFilter !== 'all' && (S.deviceStore[r.deviceIp]?.location||'') !== S.meshLocFilter) return false;
    if (srch) {
      const peer = r.peerDev?.name || r.peerDev?.ip || '';
      if (!r.deviceName.toLowerCase().includes(srch) &&
          !r.deviceIp.includes(srch) &&
          !(r.mac||'').toLowerCase().includes(srch) &&
          !peer.toLowerCase().includes(srch)) return false;
    }
    return true;
  });

  // Step 3b: Sort
  const meshKeyFn = (r, col) => {
    switch (col) {
      case 'deviceName': return r.deviceName.toLowerCase();
      case 'deviceIp':   return r.deviceIp.split('.').reduce((s,o)=>s*256+parseInt(o),0);
      case 'linkName':   return r.linkName.toLowerCase();
      case 'peer':       return (r.peerDev?.name||r.peerDev?.ip||r.mac||'').toLowerCase();
      case 'band':       return r.band||'';
      case 'signal':     return r.signal??-1;
      case 'txRate':     return r.txRate??-1;
      case 'rxRate':     return r.rxRate??-1;
      case 'status':     return rssiStatus(r.signal, r.connected);
      case 'loc':        return (S.deviceStore[r.deviceIp]?.location||'').toLowerCase();
      default:           return '';
    }
  };
  const sortedRows = applySort(rows, S.meshSort, meshKeyFn);

  setBadge('mesh', allRows.length);
  q('cnt-mesh').textContent = allRows.length ? allRows.length+' Link'+(allRows.length!==1?'s':'') : '';

  // Thead
  q('thead-mesh').innerHTML = `<tr>
    ${mkTh('Access Point','deviceName',S.meshSort,'meshSortClick')}
    ${mkTh('Gerät-IP','deviceIp',S.meshSort,'meshSortClick')}
    ${mkTh('WDS-Link','linkName',S.meshSort,'meshSortClick')}
    ${mkTh('Client','peer',S.meshSort,'meshSortClick')}
    ${mkTh('Band','band',S.meshSort,'meshSortClick')}
    ${mkTh('RSSI','signal',S.meshSort,'meshSortClick')}
    ${mkTh('Eff.-Tx-Rate','txRate',S.meshSort,'meshSortClick')}
    ${mkTh('Eff.-Rx-Rate','rxRate',S.meshSort,'meshSortClick')}
    ${mkTh('Status','status',S.meshSort,'meshSortClick')}
    ${mkTh('Standort','loc',S.meshSort,'meshSortClick')}
    ${noSortTh('')}
  </tr>`;

  const tbody = q('tbl-mesh').querySelector('tbody');
  if (!sortedRows.length) {
    tbody.innerHTML = `<tr><td colspan="11" class="empty">${S.meshData.length ? 'Kein Treffer für aktiven Filter' : 'Sync starten – nur LX Access Points werden abgefragt'}</td></tr>`;
    return;
  }

  tbody.innerHTML = sortedRows.map(r => {
    const st = rssiStatus(r.signal, r.connected);
    const s  = RS[st];

    const peerLabel = r.peerDev
      ? `<span title="${h(r.mac)}" style="font-weight:600">${h(r.peerDev.name||r.peerDev.ip)}</span><br><span class="mono" style="font-size:11px;color:var(--text3)">${h(r.mac)}</span>`
      : `<span class="mono">${h(r.mac||'—')}</span>`;

    const rssiColor = st => `var(--${st})`;
    const localSt   = rssiStatus(r.signal, r.connected);
    const localRssi = r.connected && r.signal != null ? r.signal+'%' : '—';
    let rssiCell;
    if (r.merged) {
      const peerSt  = rssiStatus(r.peerSignal, r.peerConnected);
      const peerVal = r.peerConnected && r.peerSignal != null ? r.peerSignal+'%' : '—';
      rssiCell = `<span style="font-weight:700;color:${rssiColor(localSt)}">${localRssi}</span>`+
                 `<span style="color:var(--text3);font-size:11px"> / </span>`+
                 `<span style="font-weight:700;color:${rssiColor(peerSt)}">${peerVal}</span>`;
    } else {
      rssiCell = `<span style="font-weight:700;color:${rssiColor(localSt)}">${localRssi}</span>`;
    }

    const syncBtns = r.merged && r.peerDev
      ? `<button class="btn btn-sm btn-ghost" onclick="syncMeshDevice('${h(r.deviceIp)}')" title="Sync ${h(r.deviceName)}">&#x21BB;</button>`+
        `<button class="btn btn-sm btn-ghost" onclick="syncMeshDevice('${h(r.peerDev.ip)}')" title="Sync ${h(r.peerDev.name||r.peerDev.ip)}">&#x21BB;</button>`
      : `<button class="btn btn-sm btn-ghost" onclick="syncMeshDevice('${h(r.deviceIp)}')">&#x21BB;</button>`;

    return `<tr>
      <td style="font-weight:600">${h(r.deviceName)}</td>
      <td class="mono">${h(r.deviceIp)}</td>
      <td style="font-weight:500">${h(r.linkName)}</td>
      <td>${peerLabel}</td>
      <td style="color:var(--text2)">${r.band||'—'}</td>
      <td>${rssiCell}</td>
      <td style="color:var(--text2)">${r.txRate!=null?r.txRate+' Mbps':'—'}</td>
      <td style="color:var(--text2)">${r.rxRate!=null?r.rxRate+' Mbps':'—'}</td>
      <td><span class="dot ${s.cls}"></span><span class="badge ${s.bcls}">${s.lbl}</span></td>
      <td style="font-size:12px;color:var(--text2)">${h(S.deviceStore[r.deviceIp]?.location||'—')}</td>
      <td><div style="display:flex;gap:4px">${syncBtns}</div></td>
    </tr>`;
  }).join('');
}

export async function syncMeshDevice(ip) {
  const dev = S.deviceStore[ip];
  if (!dev) return;
  const name = dev.name||dev.sysName||ip;
  const st = q('dev-sync-status');
  st.className = 'status-bar loading';
  st.innerHTML = `<span class="spinner"></span> Sync ${h(name)}…`;
  try {
    const result = await _snmpQ(ip, 'wds');
    _setDeviceOnline(ip, true);
    S.meshData.splice(0, S.meshData.length, ...S.meshData.filter(r => r.deviceIp !== ip));
    if (result.configured) mergeMeshResult(ip, name, result);
    await fetch('/api/devices', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(S.deviceStore) });
    renderMesh();
    const cnt = S.meshData.filter(r => r.deviceIp === ip).length;
    st.className = 'status-bar ok';
    st.textContent = `${name}: ${cnt} WDS-Link${cnt!==1?'s':''} aktualisiert`;
  } catch {
    _setDeviceOnline(ip, false);
    st.className = 'status-bar error';
    st.textContent = `${name}: SNMP nicht erreichbar`;
  }
}

export function mergeMeshResult(ip, name, result) {
  const linkMap = {};
  (result.configLinks||[]).forEach(cl => { linkMap[cl.linkName] = {...cl}; });
  (result.statusEntries||[]).forEach(se => {
    if (!linkMap[se.linkName]) linkMap[se.linkName]={};
    Object.assign(linkMap[se.linkName], se);
  });
  const stored = [];
  Object.values(linkMap).forEach(l => {
    const entry = {
      deviceName: name, deviceIp: ip,
      linkName:   l.linkName||'—',
      band:       l.radio===1?'2.4 GHz':l.radio===2?'5 GHz':'—',
      signal:     l.signal??null,
      connected:  !!l.connected,
      mac:        l.mac||'',
      txRate:     l.txRate??null, rxRate: l.rxRate??null, wpaVersion: l.wpaVersion,
      isRemote:   !!l.remote,
    };
    S.meshData.push(entry);
    stored.push(entry);
  });
  if (S.deviceStore[ip]) S.deviceStore[ip].wdsLinks = stored;
}
