/**
 * Device store, device table UI, and SNMP query helpers.
 * Extracted from app.js lines 636-752 (device store) and 2584-2793+ (SNMP helpers).
 *
 * Cross-module callbacks (attach to window when integrating):
 *   renderMesh, renderL2tp, renderClients, renderScriptDevices, showTab, startScan,
 *   buildTopoFromStore, deleteDevice, openDeviceDetail
 */
import S from '../lib/state.js';
import {
  q, h, fmtBytes, fmtSpeed, fmtDate, statusBadge, setBadge,
  TYPE_LABELS, TYPE_BADGE, OS_BADGE, mkTh, noSortTh, applySort, clickSort,
  extractModel, shortModel, getLocations, refreshLocationSelects, matchesLocFilter, logActivity,
} from '../lib/helpers.js';

// ── Cross-module callbacks (app attaches to window) ───────────────────────────
const _renderMesh = () => { if (typeof window !== 'undefined' && window.renderMesh) window.renderMesh(); };
const _renderL2tp = () => { if (typeof window !== 'undefined' && window.renderL2tp) window.renderL2tp(); };
const _renderClients = () => { if (typeof window !== 'undefined' && window.renderClients) window.renderClients(); };
const _renderScriptDevices = () => { if (typeof window !== 'undefined' && window.renderScriptDevices) window.renderScriptDevices(); };
const _showTab = (t) => { if (typeof window !== 'undefined' && window.showTab) window.showTab(t); };
const _startScan = () => { if (typeof window !== 'undefined' && window.startScan) window.startScan(); };
const _buildTopoFromStore = () => { if (typeof window !== 'undefined' && window.buildTopoFromStore) window.buildTopoFromStore(); };

// ═══════════════════════════════════════════════════════════════════════════════
// DEVICE STORE (server-side)
// ═══════════════════════════════════════════════════════════════════════════════

export function rebuildCachedData() {
  S.meshData.length = 0;
  S.l2tpData.length = 0;
  S.clientsData.length = 0;
  Object.values(S.deviceStore).forEach(d => {
    if (d.wdsLinks?.length)      S.meshData.push(...d.wdsLinks);
    if (d.l2tpEndpoints?.length) S.l2tpData.push(...d.l2tpEndpoints);
    // Client Explorer: nur Snapshots von Geräten, die nicht explizit offline sind (sonst verbleiben alte WLAN/FDB-Daten sichtbar)
    const onlineOk = d.online !== false;
    if (onlineOk && d.wlanClients?.length) S.clientsData.push(...d.wlanClients);
    if (onlineOk && d.fdbEntries?.length) S.clientsData.push(...d.fdbEntries);
  });
}

export async function loadDevices() {
  try { const r = await fetch('/api/devices'); S.deviceStore = await r.json(); }
  catch { S.deviceStore = {}; }
  rebuildCachedData();
  refreshLocationSelects();
  renderDevices();
  _renderMesh();
  _renderL2tp();
  _renderClients();
  setBadge('devices', Object.keys(S.deviceStore).length || 0);
}

export async function saveDevice(dev) {
  S.deviceStore[dev.ip] = dev;
  await fetch('/api/devices',{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ [dev.ip]: dev }) });
  refreshLocationSelects();
  renderDevices();
  setBadge('devices', Object.keys(S.deviceStore).length);
}

export async function saveDevices(devMap) {
  Object.assign(S.deviceStore, devMap);
  await fetch('/api/devices',{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(devMap) });
  refreshLocationSelects();
  renderDevices();
  setBadge('devices', Object.keys(S.deviceStore).length);
}

export async function deleteDevice(ip) {
  delete S.deviceStore[ip];
  await fetch('/api/devices',{ method:'DELETE', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ ip }) });
  rebuildCachedData();
  renderDevices();
  _renderMesh();
  _renderL2tp();
  _renderClients();
  setBadge('devices', Object.keys(S.deviceStore).length);
}

export async function clearAllDevices() {
  if (!confirm('Alle Geräte löschen?')) return;
  S.deviceStore = {};
  S.meshData.length = 0;
  S.l2tpData.length = 0;
  S.clientsData.length = 0;
  await fetch('/api/devices',{ method:'DELETE', headers:{'Content-Type':'application/json'}, body:'{}' });
  renderDevices();
  _renderMesh();
  _renderL2tp();
  _renderClients();
  setBadge('devices', 0);
}

// ── Export ─────────────────────────────────────────────────────────────────────
export function exportDevices(format) {
  const devs = Object.values(S.deviceStore);
  if (!devs.length) { alert('Keine Geräte vorhanden.'); return; }
  let content, mime, ext;
  if (format === 'json') {
    content = JSON.stringify(devs, null, 2);
    mime = 'application/json'; ext = 'json';
  } else {
    const cols = ['ip','name','mac','model','serial','os','type','source','location','lastSeen'];
    const esc = v => `"${String(v||'').replace(/"/g,'""')}"`;
    content = '\uFEFF' + [cols.join(';'), ...devs.map(d => cols.map(c => esc(d[c])).join(';'))].join('\r\n');
    mime = 'text/csv;charset=utf-8'; ext = 'csv';
  }
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([content], { type: mime })),
    download: `lancom-geraete-${new Date().toISOString().slice(0,10)}.${ext}`,
  });
  a.click(); URL.revokeObjectURL(a.href);
}

// ── Auto-Sync ──────────────────────────────────────────────────────────────────
export function setAutoSync(minutes) {
  if (S.autoSyncTimer) { clearInterval(S.autoSyncTimer); S.autoSyncTimer = null; }
  if (minutes > 0) S.autoSyncTimer = setInterval(autoSyncRun, minutes * 60000);
}

async function autoSyncRun() {
  const prevStates = Object.fromEntries(Object.entries(S.deviceStore).map(([ip,d]) => [ip, d.online]));
  await checkAllDeviceStatus();
  for (const [ip, d] of Object.entries(S.deviceStore)) {
    if (prevStates[ip] !== false && d.online === false) notifyOffline(d);
  }
}

// ── Desktop-Benachrichtigungen ─────────────────────────────────────────────────
function notifyOffline(dev) {
  if (!S.appSettings.notifyOffline) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  new Notification(`OnSite: ${dev.name||dev.ip} offline`, { body: `IP: ${dev.ip}${dev.os?' · '+dev.os:''}`, tag: `offline-${dev.ip}` });
}

export async function requestNotifyPermission() {
  if (!('Notification' in window)) { alert('Ihr Browser unterstützt keine Desktop-Benachrichtigungen.'); return; }
  const result = await Notification.requestPermission();
  const el = q('notify-perm-status');
  if (el) el.textContent = result === 'granted' ? '✓ Erlaubt' : '✗ Verweigert';
}

// ── Sort click handler for device table ──────────────────────────────────────
export function devSortClick(col) { clickSort(S.devSort, col, renderDevices); }

// ── Filter handlers ───────────────────────────────────────────────────────────
export function setDevFilter(f) {
  S.devFilter = f;
  ['all','online','offline'].forEach(k => {
    const el = q('df-'+k); if (el) el.classList.toggle('active', k === f);
  });
  renderDevices();
}

export function setDevLocFilter(v) { S.devLocFilter = v; renderDevices(); }

// ═══════════════════════════════════════════════════════════════════════════════
// RENDER DEVICES TABLE
// ═══════════════════════════════════════════════════════════════════════════════

export function renderDevices() {
  const srch = (q('dev-search')?.value||'').toLowerCase();
  const ipNum = ip => ip.split('.').reduce((s,o) => s*256+parseInt(o), 0);

  let devs = Object.values(S.deviceStore).filter(d => {
    if (srch && !(d.name||d.ip||'').toLowerCase().includes(srch) && !d.ip.includes(srch)) return false;
    if (S.devFilter === 'online'  && d.online !== true)  return false;
    if (S.devFilter === 'offline' && d.online !== false) return false;
    if (S.devLocFilter !== 'all'  && (d.location||'') !== S.devLocFilter) return false;
    return true;
  });

  // Sortierung
  const keyFn = (d, col) => {
    switch (col) {
      case 'name':     return (d.name||'').toLowerCase();
      case 'ip':       return ipNum(d.ip||'0.0.0.0');
      case 'mac':      return (d.mac||'').toLowerCase();
      case 'macs':     return d.macs?.length ?? -1;
      case 'lldp':     return d.lldpCount ?? -1;
      case 'wds':      return d.wdsLinks?.length ?? -1;
      case 'l2tp':     return d.l2tpEndpoints?.length ?? -1;
      case 'wlan':     return d.wlanClients?.length ?? -1;
      case 'model':    return (d.model||'').toLowerCase();
      case 'serial':   return (d.serial||'').toLowerCase();
      case 'os':       return (d.os||'').toLowerCase();
      case 'type':     return (d.type||'').toLowerCase();
      case 'source':   return (d.source||'').toLowerCase();
      case 'location': return (d.location||'').toLowerCase();
      case 'lastSeen': return d.lastSeen||'';
      default:         return '';
    }
  };
  devs = S.devSort.col
    ? applySort(devs, S.devSort, keyFn)
    : devs.sort((a,b) => ipNum(a.ip) - ipNum(b.ip));

  const total = Object.keys(S.deviceStore).length;
  setBadge('devices', total);
  q('cnt-devices').textContent = total ? total+' Gerät'+(total!==1?'e':'') : '';

  // Thead
  q('thead-devices').innerHTML = `<tr>
    ${noSortTh('')}
    ${mkTh('Gerätename','name',S.devSort,'devSortClick')}
    ${mkTh('IP-Adresse','ip',S.devSort,'devSortClick')}
    ${mkTh('MAC-Adresse','mac',S.devSort,'devSortClick')}
    ${mkTh('MACs','macs',S.devSort,'devSortClick')}
    ${mkTh('LLDP','lldp',S.devSort,'devSortClick')}
    ${mkTh('WDS','wds',S.devSort,'devSortClick')}
    ${mkTh('L2TPv3','l2tp',S.devSort,'devSortClick')}
    ${mkTh('WLAN','wlan',S.devSort,'devSortClick')}
    ${mkTh('Modell','model',S.devSort,'devSortClick')}
    ${mkTh('Seriennummer','serial',S.devSort,'devSortClick')}
    ${mkTh('Betriebssystem','os',S.devSort,'devSortClick')}
    ${mkTh('Typ','type',S.devSort,'devSortClick')}
    ${mkTh('Quelle','source',S.devSort,'devSortClick')}
    ${mkTh('Standort','location',S.devSort,'devSortClick')}
    ${mkTh('Zuletzt gesehen','lastSeen',S.devSort,'devSortClick')}
  </tr>`;

  const tbody = q('tbl-devices').querySelector('tbody');
  if (!devs.length) {
    tbody.innerHTML = `<tr><td colspan="16" class="empty">Keine Geräte ${srch||S.devFilter!=='all'||S.devLocFilter!=='all'?'gefunden':'– Scanner oder LMC Import verwenden'}</td></tr>`;
    return;
  }
  tbody.innerHTML = devs.map(dev => {
    const typLbl = TYPE_LABELS[dev.type]||'Unbekannt';
    const typCls = TYPE_BADGE[dev.type]||'badge-gray';
    const srcLbl = dev.source==='lmc' ? '<span class="badge badge-blue">LMC</span>' : '<span class="badge badge-gray">Scanner</span>';
    return `<tr>
      <td><div style="display:flex;gap:6px">
        <button class="btn btn-sm" onclick="openDeviceDetail('${h(dev.ip)}')">Details</button>
        <button class="btn btn-sm btn-danger" onclick="deleteDevice('${h(dev.ip)}')">&#x2715;</button>
      </div></td>
      <td style="font-weight:600"><span class="dot ${dev.online===true?'dot-green':dev.online===false?'dot-red':'dot-gray'}" title="${dev.online===true?'Online':dev.online===false?'Offline':'Unbekannt'}"></span>${h(dev.name||'—')}</td>
      <td class="mono"><a href="https://${h(dev.ip)}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">${h(dev.ip)}</a></td>
      <td class="mono" style="font-size:12px;color:var(--text2)">${h(dev.mac||'—')}</td>
      <td style="font-size:12px;text-align:center;color:${dev.macs?.length?'var(--accent)':'var(--text3)'}" title="${h(dev.macs?.length?dev.macs.join('\n'):'Noch kein MAC-Sync')}">${dev.macs?.length??'—'}</td>
      <td style="font-size:12px;text-align:center;color:${dev.lldpCount?'var(--accent)':'var(--text3)'}" title="${h(dev.lldpNeighbors?.length?dev.lldpNeighbors.join('\n'):'Noch kein LLDP Sync')}">${dev.lldpCount??'—'}</td>
      <td style="font-size:12px;text-align:center;color:${dev.wdsLinks?.length?'var(--orange)':'var(--text3)'}" title="${h(dev.wdsLinks?.length?dev.wdsLinks.map(l=>l.linkName||l.mac||'?').join('\n'):'Keine WDS-Daten')}">${dev.wdsLinks?.length??'—'}</td>
      <td style="font-size:12px;text-align:center;color:${dev.l2tpEndpoints?.length?'var(--green)':'var(--text3)'}" title="${h(dev.l2tpEndpoints?.length?dev.l2tpEndpoints.map(e=>e.endpointName||e.remoteIp||'?').join('\n'):'Keine L2TP-Daten')}">${dev.l2tpEndpoints?.length??'—'}</td>
      <td style="font-size:12px;text-align:center;color:${dev.wlanClients?.length?'var(--cyan)':'var(--text3)'}" title="${h(dev.wlanClients?.length?dev.wlanClients.map(c=>c.mac+(c.ssid?' ('+c.ssid+')':'')).join('\n'):'Noch kein WLAN-Scan')}">${dev.wlanClients?.length??'—'}</td>
      <td style="color:var(--text2);font-size:12px" title="${h(dev.model||'')}">${h(shortModel(dev.model))}</td>
      <td class="mono" style="font-size:12px;color:var(--text3)">${h(dev.serial||'—')}</td>
      <td><span class="badge ${OS_BADGE[dev.os]||'badge-gray'}">${h(dev.os||'—')}</span></td>
      <td><span class="badge ${typCls}">${typLbl}</span></td>
      <td>${srcLbl}</td>
      <td style="font-size:12px;color:var(--text2)">${h(dev.location||'—')}</td>
      <td style="color:var(--text3);font-size:11px">${fmtDate(dev.lastSeen)}</td>
    </tr>`;
  }).join('');
  _renderScriptDevices();
}

// ═══════════════════════════════════════════════════════════════════════════════
// SNMP QUERY HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

export async function snmpQ(host, type, extra = {}) {
  const creds = devCredentials(host);
  const r = await fetch('/snmp',{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({host,type,...creds,...extra}) });
  const d = await r.json(); if (d.error) throw new Error(d.error); return d;
}

export function devCredentials(ip) {
  const d = S.deviceStore[ip];
  let version = d?.version || S.appSettings.snmpVersion || '2c';
  if (version === '1') version = '2c';
  return {
    community: d?.community || S.appSettings.snmpReadCommunity || 'public',
    version,
  };
}

export function setDeviceOnline(ip, online) {
  if (!S.deviceStore[ip]) return;
  const prev = S.deviceStore[ip].online;
  S.deviceStore[ip].online = online;
  if (prev !== online && prev !== undefined) {
    const name = S.deviceStore[ip].name || ip;
    logActivity(online ? `${name} ist online` : `${name} ist offline`, online ? 'ok' : 'warn');
  }
  renderDevices();
}

export async function checkAllDeviceStatus() {
  const btn  = q('btn-check-status');
  const st   = q('dev-sync-status');
  const wrap = q('dev-progress-wrap');
  const bar  = q('dev-progress-bar');
  const txt  = q('dev-progress-text');
  const devList = Object.values(S.deviceStore).filter(matchesLocFilter);
  if (!devList.length) {
    st.className = 'status-bar error';
    st.textContent = S.devLocFilter !== 'all' ? `Keine Geräte im Standort „${S.devLocFilter}".` : 'Keine Geräte vorhanden.'; return;
  }

  btn.disabled = true; btn.textContent = '…';
  st.className = ''; st.textContent = '';
  wrap.style.display = 'block'; bar.style.width = '0%';
  txt.textContent = `0 / ${devList.length}`;

  let done = 0, online = 0;
  const total = devList.length;
  const prevStates = Object.fromEntries(devList.map(d => [d.ip, d.online]));

  try {
    const CONCURRENCY = 5;
    async function checkOne(dev) {
      try {
        await snmpQ(dev.ip, 'ping');
        if (S.deviceStore[dev.ip]) { S.deviceStore[dev.ip].online = true; online++; }
      } catch {
        if (S.deviceStore[dev.ip]) S.deviceStore[dev.ip].online = false;
      }
      if (prevStates[dev.ip] !== false && S.deviceStore[dev.ip]?.online === false) notifyOffline(dev);
      done++;
      bar.style.width = Math.round(done / total * 100) + '%';
      txt.textContent = `${done} / ${total}`;
    }
    for (let i = 0; i < devList.length; i += CONCURRENCY) {
      await Promise.all(devList.slice(i, i + CONCURRENCY).map(checkOne));
      renderDevices();
    }
    await fetch('/api/devices', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(S.deviceStore) });
    S.dashLastStatusCheck = new Date().toISOString();
    logActivity(`Statusprüfung: ${online}/${total} online`);
    st.className = 'status-bar ok';
    st.textContent = `Status aktualisiert – ${online} online, ${total - online} offline.`;
  } catch (e) {
    st.className = 'status-bar error';
    st.textContent = `Fehler: ${e.message}`;
  } finally {
    btn.disabled = false; btn.textContent = 'Status';
    bar.style.width = '100%';
    setTimeout(() => { wrap.style.display = 'none'; bar.style.width = '0%'; }, 1500);
  }
}

export async function syncDeviceMacs() {
  const btn  = q('btn-mac-sync');
  const st   = q('dev-sync-status');
  const wrap = q('dev-progress-wrap');
  const bar  = q('dev-progress-bar');
  const txt  = q('dev-progress-text');
  const devList = Object.values(S.deviceStore).filter(d => d.online !== false && matchesLocFilter(d));
  if (!devList.length) {
    st.className = 'status-bar error';
    st.textContent = S.devLocFilter !== 'all' ? `Keine Online-Geräte im Standort „${S.devLocFilter}".` : 'Keine Online-Geräte – bitte zuerst "Status" ausführen.'; return;
  }

  btn.disabled = true; btn.textContent = '…';
  st.className = ''; st.textContent = '';
  wrap.style.display = 'block'; bar.style.width = '0%';
  txt.textContent = `0 / ${devList.length}`;

  let done = 0;
  const total = devList.length;

  try {
    const CONCURRENCY = 3;
    const queue = [...devList];
    async function worker() {
      while (queue.length) {
        const dev = queue.shift();
        try {
          const isSwitch = dev.type === 'switch';
          const [ifResult, fdbResult] = await Promise.all([
            snmpQ(dev.ip, 'ifmacs'),
            isSwitch ? snmpQ(dev.ip, 'mac') : Promise.resolve(null),
          ]);
          if (S.deviceStore[dev.ip] && ifResult.macs?.length) S.deviceStore[dev.ip].macs = ifResult.macs;
          if (S.deviceStore[dev.ip] && isSwitch && fdbResult?.entries?.length)
            S.deviceStore[dev.ip].fdbEntries = fdbResult.entries.map(e => ({
              ...e, type: 'fdb', sourceIp: dev.ip, sourceName: dev.name || dev.ip
            }));
        } catch {}
        done++;
        bar.style.width = Math.round(done / total * 100) + '%';
        txt.textContent = `${done} / ${total}`;
      }
    }
    await Promise.all(Array(Math.min(CONCURRENCY, devList.length)).fill(null).map(worker));
    rebuildCachedData();
    await fetch('/api/devices', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(S.deviceStore) });
    _renderMesh(); renderDevices(); _renderClients();
    st.className = 'status-bar ok';
    st.textContent = `MAC-Adressen aktualisiert – ${devList.length} Geräte abgefragt.`;
  } catch (e) {
    st.className = 'status-bar error';
    st.textContent = `Fehler: ${e.message}`;
  } finally {
    btn.disabled = false; btn.textContent = 'MAC';
    bar.style.width = '100%';
    setTimeout(() => { wrap.style.display = 'none'; bar.style.width = '0%'; }, 1500);
  }
}

// Gemeinsame LLDP-Kernlogik – onProgress(done, total, dev) optional
export async function lldpSyncCore(devList, onProgress) {
  const CONCURRENCY = 3;
  const queue = [...devList];
  let done = 0;
  async function worker() {
    while (queue.length) {
      const dev = queue.shift();
      try {
        const result = await snmpQ(dev.ip, 'lldp');
        if (S.deviceStore[dev.ip]) {
          S.deviceStore[dev.ip].lldpCount     = result.entries?.length ?? 0;
          S.deviceStore[dev.ip].lldpNeighbors = (result.entries||[])
            .map(e => e.remSysName||e.remPortId||'?').filter(Boolean);
          S.deviceStore[dev.ip].lldpData = (result.entries||[]).map(e => ({
            localPortName: e.localPortName||'',
            remSysName:    e.remSysName||'',
            remPortId:     e.remPortId||'',
            remPortDesc:   e.remPortDesc||'',
            remMac:        e.remMac||'',
            remPortMac:    e.remPortMac||'',
            remChassisIp:  e.remChassisIp||'',
          }));
        }
      } catch { /* Gerät unterstützt LLDP evtl. nicht */ }
      done++;
      if (onProgress) onProgress(done, devList.length, dev);
    }
  }
  await Promise.all(Array(Math.min(CONCURRENCY, devList.length || 1)).fill(null).map(worker));
}

export async function syncDeviceLldp() {
  const btn  = q('btn-lldp-sync');
  const st   = q('dev-sync-status');
  const wrap = q('dev-progress-wrap');
  const bar  = q('dev-progress-bar');
  const txt  = q('dev-progress-text');
  const devList = Object.values(S.deviceStore).filter(d => d.online !== false && matchesLocFilter(d));
  if (!devList.length) {
    st.className = 'status-bar error';
    st.textContent = S.devLocFilter !== 'all' ? `Keine Online-Geräte im Standort „${S.devLocFilter}".` : 'Keine Online-Geräte – bitte zuerst "Status" ausführen.'; return;
  }

  btn.disabled = true; btn.textContent = '…';
  st.className = ''; st.textContent = '';
  wrap.style.display = 'block'; bar.style.width = '0%';
  txt.textContent = `0 / ${devList.length}`;

  try {
    await lldpSyncCore(devList, (done, total) => {
      bar.style.width = Math.round(done / total * 100) + '%';
      txt.textContent = `${done} / ${total}`;
    });
    await fetch('/api/devices', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(S.deviceStore) });
    renderDevices();
    window.checkTopoChanges?.();
    st.className = 'status-bar ok';
    st.textContent = `LLDP aktualisiert – ${devList.length} Geräte abgefragt.`;
  } catch (e) {
    st.className = 'status-bar error';
    st.textContent = `Fehler: ${e.message}`;
  } finally {
    btn.disabled = false; btn.textContent = 'LLDP';
    bar.style.width = '100%';
    setTimeout(() => { wrap.style.display = 'none'; bar.style.width = '0%'; }, 1500);
  }
}

// ── mergeMeshResult / mergeL2tpResult (used by syncWdsAll, syncL2tpAll, syncTopologyAll) ──
function mergeMeshResult(ip, name, result) {
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

function mergeL2tpResult(ip, name, result) {
  const epMap = {};
  (result.configEndpoints||[]).forEach(ep => { epMap[ep.name]={...ep}; });
  (result.statusEntries||[]).forEach(se => {
    const k=se.endpointName||se.remoteEnd; if(!epMap[k])epMap[k]={};
    Object.assign(epMap[k],se);
  });
  const stored = [];
  Object.values(epMap).forEach(ep => {
    const entry = {
      deviceName:name, deviceIp:ip, endpointName:ep.name||ep.endpointName||'—',
      remoteEnd:ep.remoteEnd||'—', remoteIp:ep.remoteIp||'—', port:ep.port,
      state:ep.state||'—', iface:ep.iface||'—', connStartTime:ep.connStartTime||'',
    };
    S.l2tpData.push(entry);
    stored.push(entry);
  });
  if (S.deviceStore[ip]) S.deviceStore[ip].l2tpEndpoints = stored;
}

// ── WDS Sync (Geräte-Tab) ────────────────────────────────────────────────────
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
          const result = await snmpQ(dev.ip, 'wds');
          if (result.configured) mergeMeshResult(dev.ip, dev.name||dev.ip, result);
        } catch {}
        done++;
        st.innerHTML = `<span class="spinner"></span> WDS – ${done} / ${lxDevs.length} – ${h(dev.name||dev.ip)}`;
      }));
    }
    await fetch('/api/devices', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(S.deviceStore) });
    st.className = 'status-bar ok';
    st.textContent = `WDS abgeschlossen – ${S.meshData.length} Verbindungen.`;
    renderDevices(); _renderMesh();
  } catch (e) {
    st.className = 'status-bar error';
    st.textContent = `Fehler: ${e.message}`;
  } finally {
    btn.disabled = false; btn.textContent = 'WDS';
  }
}

// ── L2TPv3 Sync (Geräte-Tab) ───────────────────────────────────────────────────
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
          const result = await snmpQ(dev.ip, 'l2tp');
          if (result.configured) mergeL2tpResult(dev.ip, dev.name||dev.ip, result);
        } catch {}
        done++;
        st.innerHTML = `<span class="spinner"></span> L2TPv3 – ${done} / ${lxDevs.length} – ${h(dev.name||dev.ip)}`;
      }));
    }
    await fetch('/api/devices', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(S.deviceStore) });
    st.className = 'status-bar ok';
    st.textContent = `L2TPv3 abgeschlossen – ${S.l2tpData.length} Endpunkte.`;
    renderDevices(); _renderL2tp();
  } catch (e) {
    st.className = 'status-bar error';
    st.textContent = `Fehler: ${e.message}`;
  } finally {
    btn.disabled = false; btn.textContent = 'L2TPv3';
  }
}

// ── Geräte Sync: jump to SNMP Scan and start ────────────────────────────────────
export function geraeteSync() {
  _showTab('scanner');
  setTimeout(_startScan, 50);
}

// ── All-in-one sync for Netzwerkplan ──────────────────────────────────────────
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
        await snmpQ(dev.ip, 'ping');
        if (S.deviceStore[dev.ip]) S.deviceStore[dev.ip].online = true;
      } catch {
        if (S.deviceStore[dev.ip]) S.deviceStore[dev.ip].online = false;
      }
      done++;
      st.innerHTML = `<span class="spinner"></span> Phase 1/6: Status prüfen – ${done} / ${allDevs.length} – ${h(dev.name||dev.ip)}`;
      renderDevices();
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
        const result = await snmpQ(dev.ip, 'wds');
        if (result.configured) mergeMeshResult(dev.ip, dev.name||dev.ip, result);
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
        const result = await snmpQ(dev.ip, 'l2tp');
        if (result.configured) mergeL2tpResult(dev.ip, dev.name||dev.ip, result);
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
    await lldpSyncCore(onlineDevs, (d, total, dev) => {
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
            snmpQ(dev.ip, 'ifmacs'),
            isSwitch ? snmpQ(dev.ip, 'mac') : Promise.resolve(null),
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
          const result = await snmpQ(dev.ip, 'wlan', { os: dev.os || '', devType: dev.type });
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

    rebuildCachedData();
    S.dashLastDataSync = new Date().toISOString();
    const onlineCnt = Object.values(S.deviceStore).filter(d => d.online === true).length;
    logActivity(`Datensync: ${onlineCnt} Geräte online`);
    st.className = 'status-bar ok';
    st.textContent = 'Sync abgeschlossen.';
    renderDevices();
    _renderMesh();
    _renderL2tp();
    _renderClients();
    _buildTopoFromStore();

  } catch (e) {
    st.className = 'status-bar error';
    st.textContent = `Fehler: ${e.message}`;
    console.error('syncTopologyAll:', e);
  } finally {
    btn.disabled = false; btn.textContent = '⟳ Daten Abrufen';
  }
}
