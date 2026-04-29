/**
 * L2TPv3 tab – L2TP endpoint overview and per-device sync.
 * Extracted from app.js lines 3024-3143.
 *
 * Cross-module callbacks (attach to window when integrating):
 *   snmpQ, setDeviceOnline, renderDevices
 */
import S from '../lib/state.js';
import {
  q, h, fmtDate, statusBadge, mkTh, noSortTh, applySort, clickSort,
  setBadge, shortModel, matchesLocFilter, logActivity,
} from '../lib/helpers.js';

const _snmpQ = (...a) => window.snmpQ?.(...a);
const _setDeviceOnline = (...a) => window.setDeviceOnline?.(...a);
const _renderDevices = () => window.renderDevices?.();

// ═══════════════════════════════════════════════════════════════════════════════
// L2TPv3
// ═══════════════════════════════════════════════════════════════════════════════

export function l2tpSortClick(col) { clickSort(S.l2tpSort, col, renderL2tp); }

export function setL2tpFilter(f) {
  S.l2tpFilter = f;
  ['all','up','down'].forEach(k => { const el=q('lf-'+k); if(el) el.classList.toggle('active',k===f); });
  renderL2tp();
}

export function setL2tpLocFilter(v) { S.l2tpLocFilter = v; renderL2tp(); }

export function clearL2tpData() {
  if (!confirm('L2TPv3-Endpunktdaten für alle Geräte löschen?')) return;
  S.l2tpData.length = 0;
  Object.values(S.deviceStore).forEach(d => { delete d.l2tpEndpoints; });
  fetch('/api/devices', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(S.deviceStore) });
  renderL2tp(); _renderDevices();
}

export function renderL2tp() {
  const srch = (q('l2tp-search')?.value||'').toLowerCase();
  const filtered = S.l2tpData.filter(r => {
    const up = r.state==='UP';
    if (S.l2tpFilter==='up' && !up) return false;
    if (S.l2tpFilter==='down' && up) return false;
    if (S.l2tpLocFilter !== 'all' && (S.deviceStore[r.deviceIp]?.location||'') !== S.l2tpLocFilter) return false;
    if (srch && !r.deviceName.toLowerCase().includes(srch) && !r.deviceIp.includes(srch)) return false;
    return true;
  });

  const l2tpKeyFn = (r, col) => {
    switch (col) {
      case 'deviceName':   return r.deviceName.toLowerCase();
      case 'deviceIp':     return r.deviceIp.split('.').reduce((s,o)=>s*256+parseInt(o),0);
      case 'endpointName': return (r.endpointName||'').toLowerCase();
      case 'remoteEnd':    return (r.remoteEnd||'').toLowerCase();
      case 'remoteIp':     return (r.remoteIp||'').split('.').reduce((s,o)=>s*256+parseInt(o||'0'),0);
      case 'state':        return r.state||'';
      case 'loc':          return (S.deviceStore[r.deviceIp]?.location||'').toLowerCase();
      default:             return '';
    }
  };
  const rows = applySort(filtered, S.l2tpSort, l2tpKeyFn);

  setBadge('l2tp', S.l2tpData.length);
  q('cnt-l2tp').textContent = S.l2tpData.length ? S.l2tpData.length+' Endpunkt'+(S.l2tpData.length!==1?'e':'') : '';

  q('thead-l2tp').innerHTML = `<tr>
    ${mkTh('Gerätename','deviceName',S.l2tpSort,'l2tpSortClick')}
    ${mkTh('Gerät-IP','deviceIp',S.l2tpSort,'l2tpSortClick')}
    ${mkTh('Endpoint','endpointName',S.l2tpSort,'l2tpSortClick')}
    ${mkTh('Gegenstelle','remoteEnd',S.l2tpSort,'l2tpSortClick')}
    ${mkTh('Remote-IP','remoteIp',S.l2tpSort,'l2tpSortClick')}
    ${mkTh('Status','state',S.l2tpSort,'l2tpSortClick')}
    ${mkTh('Standort','loc',S.l2tpSort,'l2tpSortClick')}
    ${noSortTh('')}
  </tr>`;

  const tbody = q('tbl-l2tp').querySelector('tbody');
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty">${S.l2tpData.length?'Kein Treffer für aktiven Filter':'Sync starten – nur LX Access Points werden abgefragt'}</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(r => {
    const up = r.state==='UP';
    return `<tr>
      <td style="font-weight:600">${h(r.deviceName)}</td>
      <td class="mono">${h(r.deviceIp)}</td>
      <td style="font-weight:500">${h(r.endpointName||'—')}</td>
      <td>${h(r.remoteEnd||'—')}</td>
      <td class="mono" style="color:var(--text2)">${h(r.remoteIp||'—')}</td>
      <td><span class="dot ${up?'dot-green':'dot-red'}"></span><span class="badge ${up?'badge-green':'badge-red'}">${h(r.state||'—')}</span></td>
      <td style="font-size:12px;color:var(--text2)">${h(S.deviceStore[r.deviceIp]?.location||'—')}</td>
      <td><button class="btn btn-sm btn-ghost" onclick="syncL2tpDevice('${h(r.deviceIp)}')">&#x21BB;</button></td>
    </tr>`;
  }).join('');
}

export async function syncL2tpDevice(ip) {
  const dev = S.deviceStore[ip]; if (!dev) return;
  const name = dev.name||dev.ip;
  const st = q('dev-sync-status');
  st.className = 'status-bar loading';
  st.innerHTML = `<span class="spinner"></span> Sync ${h(name)}…`;
  try {
    const result = await _snmpQ(ip, 'l2tp');
    _setDeviceOnline(ip, true);
    S.l2tpData.splice(0, S.l2tpData.length, ...S.l2tpData.filter(r => r.deviceIp!==ip));
    if (result.configured) mergeL2tpResult(ip, name, result);
    await fetch('/api/devices', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(S.deviceStore) });
    renderL2tp();
    const cnt = S.l2tpData.filter(r => r.deviceIp===ip).length;
    st.className = 'status-bar ok';
    st.textContent = `${name}: ${cnt} Endpunkt${cnt!==1?'e':''} aktualisiert`;
  } catch {
    _setDeviceOnline(ip, false);
    st.className = 'status-bar error';
    st.textContent = `${name}: SNMP nicht erreichbar`;
  }
}

export function mergeL2tpResult(ip, name, result) {
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
