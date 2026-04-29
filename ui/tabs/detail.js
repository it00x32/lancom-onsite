import S from '../lib/state.js';
import { q, h, fmtBytes, fmtSpeed, fmtDate, statusBadge, extractModel, shortModel, OS_BADGE, TYPE_BADGE, TYPE_LABELS, logActivity } from '../lib/helpers.js';
import { detectDeviceType } from '../criteria.js';

// ═══════════════════════════════════════════════════════════════════════════════
// DEVICE DETAIL VIEW
// ═══════════════════════════════════════════════════════════════════════════════

let selectedDevice = null;

function fmtUptime(ticks) {
  if (ticks == null) return '—';
  if (typeof ticks === 'string') {
    const m = ticks.match(/\((\d+)\)/);
    ticks = m ? parseInt(m[1]) : parseInt(ticks);
  }
  if (isNaN(ticks)) return '—';
  let s = Math.floor(ticks / 100);
  const d = Math.floor(s / 86400); s %= 86400;
  const hh = Math.floor(s / 3600);  s %= 3600;
  const m = Math.floor(s / 60);    s %= 60;
  if (d > 0) return `${d}d ${hh}h ${m}m`;
  if (hh > 0) return `${hh}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

export function openDeviceDetail(ip) {
  const dev = S.deviceStore[ip] || { ip, community: S.appSettings.snmpReadCommunity||'public', version: S.appSettings.snmpVersion||'2c' };
  selectedDevice = dev;
  q('detail-ip').textContent = ip;
  q('detail-community').value = dev.community || S.appSettings.snmpReadCommunity || 'public';
  {
    let v = dev.version || S.appSettings.snmpVersion || '2c';
    if (v === '1') v = '2c';
    q('detail-version').value = v;
  }
  q('detail-badge').textContent = '↩ ' + (dev.name||ip);
  q('detail-badge').style.display = '';
  const isSwitch   = dev.type === 'switch';
  const isLxAp     = dev.type === 'lx-ap';
  q('stab-wlan').style.display        = isSwitch   ? 'none' : '';
  q('stab-vlan-detail').style.display = isSwitch   ? ''     : 'none';
  q('stab-ports').style.display       = isSwitch   ? ''     : 'none';
  q('stab-stp').style.display         = isSwitch   ? ''     : 'none';
  q('stab-poe').style.display         = isSwitch   ? ''     : 'none';
  q('stab-loop').style.display        = isSwitch   ? ''     : 'none';
  // Alte Daten sofort löschen
  q('sys-cards').innerHTML = '<div class="empty"><span class="spinner"></span></div>';
  ['tbl-ifaces','tbl-mac','tbl-wlan','tbl-vlan-detail','tbl-ports','tbl-stp','tbl-poe','tbl-loop','tbl-lldp'].forEach(id => {
    const tb = q(id)?.querySelector('tbody');
    if (tb) tb.innerHTML = '<tr><td colspan="20" class="empty"><span class="spinner"></span></td></tr>';
  });
  q('stp-global').innerHTML = '';
  q('stp-controls').innerHTML = '';
  q('poe-global').innerHTML = '';
  q('poe-controls').innerHTML = '';
  q('loop-controls').innerHTML = '';
  lastStpData = null; lastPoeData = null; lastLoopData = null;
  showStab('system');
  window.showTab?.('detail');
  startSparkPoll(ip);
  queryDetail();
}

export function showStab(name) {
  document.querySelectorAll('#panel-detail .sub-panel').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('#panel-detail .stab').forEach(t=>t.classList.remove('active'));
  q('sub-'+name).classList.add('active');
  q('stab-'+name).classList.add('active');
}

export async function queryDetail() {
  const ip        = q('detail-ip').textContent.trim();
  const community = q('detail-community').value.trim()||'public';
  const version   = q('detail-version').value;
  if (!ip) return;
  // Credentials im deviceStore speichern damit devCredentials() sie findet
  if (S.deviceStore[ip]) {
    S.deviceStore[ip].community = community;
    S.deviceStore[ip].version   = version;
    fetch('/api/devices', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(S.deviceStore) }).catch(()=>{});
  }

  q('detail-main-status').className='status-bar loading';
  q('detail-main-status').innerHTML='<span class="spinner"></span> Abfrage läuft…';

  const t0=Date.now();
  const devType = selectedDevice?.type || '';
  const devOs   = selectedDevice?.os   || '';
  const needsVlan = devType === 'switch';
  const isSwitch  = devType === 'switch';
  const isLxAp    = devType === 'lx-ap';

  const snmpQ = window.snmpQ;
  const qq = (t, o) => (snmpQ?.(ip, t, o) ?? Promise.resolve(null));
  const [sys,ifaces,mac,wlan,lldp,vlan,ports,stp,poe,loop] = await Promise.allSettled([
    qq('system'),
    qq('interfaces'),
    qq('mac'),
    (needsVlan && !isLxAp) ? Promise.resolve({entries:[]}) : qq('wlan',{os:devOs,devType}),
    qq('lldp'),
    needsVlan ? qq('vlan',{os:devOs,devType}) : Promise.resolve(null),
    isSwitch ? qq('ports') : Promise.resolve(null),
    isSwitch ? qq('stp')   : Promise.resolve(null),
    isSwitch ? qq('poe')   : Promise.resolve(null),
    isSwitch ? qq('loop')  : Promise.resolve(null),
  ]);

  if(sys.status==='fulfilled')    renderDetailSystem(sys.value);
  if(ifaces.status==='fulfilled') renderDetailIfaces(ifaces.value);
  if(mac.status==='fulfilled')    renderDetailMac(mac.value);
  if((!needsVlan || isLxAp) && wlan.status==='fulfilled') renderDetailWlan(wlan.value);
  if(lldp.status==='fulfilled')   renderDetailLldp(lldp.value);
  if(needsVlan && vlan.status==='fulfilled' && vlan.value) renderDetailVlan(vlan.value);
  if(isSwitch && ports.status==='fulfilled' && ports.value) renderDetailPorts(ports.value);
  if(isSwitch && stp.status==='fulfilled'   && stp.value)   renderDetailStp(stp.value);
  if(isSwitch && poe.status==='fulfilled'   && poe.value)   renderDetailPoe(poe.value);
  if(isSwitch && loop.status==='fulfilled'  && loop.value)  renderDetailLoop(loop.value);

  q('detail-main-status').className='status-bar ok';
  q('detail-main-status').textContent=`Abfrage erfolgreich (${((Date.now()-t0)/1000).toFixed(1)}s)`;
}

function renderDetailSystem(d) {
  q('sys-cards').innerHTML=[
    {label:'Gerätename',value:d.sysName||'—'},
    {label:'Beschreibung',value:d.sysDescr||'—',mono:true},
    {label:'Standort',value:d.sysLocation||'—'},
    {label:'Kontakt',value:d.sysContact||'—'},
    {label:'Uptime',value:fmtUptime(d.sysUpTime)},
  ].map(c=>`<div class="info-card"><div class="label">${c.label}</div><div class="value${c.mono?' mono':''}">${h(c.value)}</div></div>`).join('');
}

function renderDetailIfaces(data) {
  const tbody=q('tbl-ifaces').querySelector('tbody');
  if(!data.length){tbody.innerHTML=`<tr><td colspan="8" class="empty">Keine Interfaces</td></tr>`;return;}
  const ip = q('detail-ip')?.textContent.trim() || '';
  tbody.innerHTML=data.map(i=>{
    const name = i.name||i.descr||'If'+i.idx;
    const canvasId = `spark-${CSS.escape(ip+':'+name)}`;
    const adminUp = i.adminStatus !== '2' && i.adminStatus !== 'down';
    return `<tr>
      <td style="font-weight:600">${h(name)}</td>
      <td class="mono" style="color:var(--text2)">${i.name&&i.descr!==i.name?h(i.descr):''}</td>
      <td>${statusBadge(i.operStatus)}</td>
      <td style="color:var(--text2)">${fmtSpeed(i.highSpeed,i.speed)}</td>
      <td class="mono">${fmtBytes(i.inOctets)}</td>
      <td class="mono">${fmtBytes(i.outOctets)}</td>
      <td><canvas id="${canvasId}" width="80" height="24" style="display:block;vertical-align:middle"></canvas></td>
      <td>${adminUp
        ? `<button class="btn btn-sm btn-ghost" style="opacity:.6;font-size:11px" onclick="toggleIfaceAdmin('${h(String(i.idx))}',false)">Disable</button>`
        : `<button class="btn btn-sm" style="font-size:11px" onclick="toggleIfaceAdmin('${h(String(i.idx))}',true)">Enable</button>`
      }</td>
    </tr>`;
  }).join('');
}

export async function toggleIfaceAdmin(idx, enable) {
  const detailIp = q('detail-ip');
  if (!detailIp) return;
  const ip = detailIp.textContent.trim();
  const safeIdx = String(idx).replace(/[^0-9]/g, '');
  if (!safeIdx) return;
  try {
    await snmpSet(ip, `1.3.6.1.2.1.2.2.1.7.${safeIdx}`, 'i', enable ? 1 : 2);
    renderDetailIfaces(await (window.snmpQ?.(ip, 'interfaces') ?? []));
  } catch(e) { alert('Fehler: ' + e.message); }
}

// ── Traffic Sparklines ─────────────────────────────────────────────────────────
const _sparkHistory = {}; // "ip:ifname" → number[]
let _sparkPollTimer = null;

function startSparkPoll(ip) {
  stopSparkPoll();
  // Drop history for other IPs to prevent unbounded growth
  for (const key of Object.keys(_sparkHistory)) {
    if (!key.startsWith(`${ip}:`)) delete _sparkHistory[key];
  }
  _sparkPollTimer = setInterval(() => pollSparklines(ip), 15000);
  pollSparklines(ip);
}
export function stopSparkPoll() {
  if (_sparkPollTimer) { clearInterval(_sparkPollTimer); _sparkPollTimer = null; }
}
async function pollSparklines(ip) {
  try {
    const all = await (await fetch(`/api/iftraffic?ip=${encodeURIComponent(ip)}`)).json();
    const ifaces = all[ip]; if (!ifaces) return;
    for (const [name, d] of Object.entries(ifaces)) {
      const key = `${ip}:${name}`;
      if (!_sparkHistory[key]) _sparkHistory[key] = [];
      _sparkHistory[key].push(Math.max(d.inBps, d.outBps));
      if (_sparkHistory[key].length > 30) _sparkHistory[key].shift();
      drawSparkline(document.getElementById(`spark-${CSS.escape(key)}`), _sparkHistory[key]);
    }
  } catch {}
}
function drawSparkline(canvas, data) {
  if (!canvas || data.length < 2) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const max = Math.max(...data, 1);
  const isDark = document.documentElement.dataset.theme === 'dark';
  ctx.strokeStyle = isDark ? '#22d3ee' : '#0891b2';
  ctx.lineWidth = 1.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  data.forEach((v, i) => {
    const x = i / (data.length - 1) * w;
    const y = h - (v / max * (h - 2)) - 1;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function renderDetailMac(data) {
  const tbody=q('tbl-mac').querySelector('tbody');
  if(!data.entries.length){tbody.innerHTML=`<tr><td colspan="3" class="empty">Keine Einträge</td></tr>`;return;}
  tbody.innerHTML=data.entries.map(e=>`<tr>
    <td class="mono">${h(e.mac)}</td>
    <td class="mono" style="color:var(--text2)">${e.ip?h(e.ip):'<span style="color:var(--text3)">—</span>'}</td>
    <td>${h(e.port)}</td>
  </tr>`).join('');
}

function renderDetailWlan(data) {
  const tbody=q('tbl-wlan').querySelector('tbody');
  if(!data.entries.length){tbody.innerHTML=`<tr><td colspan="8" class="empty">Keine WLAN-Clients</td></tr>`;return;}
  tbody.innerHTML=data.entries.map(e=>{
    const sig = e.signal !== '' ? parseInt(e.signal) : null;
    const sigBadge = sig !== null && !isNaN(sig)
      ? `<span class="badge ${sig>=-60?'badge-green':sig>=-75?'badge-yellow':'badge-red'}">${sig} dBm</span>`
      : '—';
    const snr = e.snr !== '' ? parseInt(e.snr) : null;
    const snrBadge = snr !== null && !isNaN(snr)
      ? `<span class="badge ${snr>=40?'badge-green':snr>=25?'badge-yellow':'badge-red'}">${snr} dB</span>`
      : '—';
    const chanStr = e.channel
      ? (e.chanWidth ? `CH ${e.channel} <span style="color:var(--text3);font-size:11px">${h(e.chanWidth)}</span>` : `CH ${e.channel}`)
      : '—';
    return `<tr>
      <td class="mono">${h(e.mac)}</td>
      <td class="mono" style="color:var(--text2)">${e.ip?h(e.ip):'—'}</td>
      <td style="color:var(--text2)">${e.hostname?h(e.hostname):'—'}</td>
      <td>${e.ssid?`<span class="badge badge-blue">${h(e.ssid)}</span>`:'—'}</td>
      <td>${e.band?`<span class="badge badge-gray">${h(e.band)}</span>`:'—'}</td>
      <td style="color:var(--text2);font-size:12px">${chanStr}</td>
      <td>${sigBadge}</td>
      <td>${snrBadge}</td>
    </tr>`;
  }).join('');
}

const LLDP_ADMIN = {1:'Nur Senden',2:'Nur Empfangen',3:'Senden & Empfangen',4:'Deaktiviert'};
const LLDP_ADMIN_BADGE = {1:'badge-yellow',2:'badge-yellow',3:'badge-green',4:'badge-gray'};
let lastLldpData = null;

function renderDetailLldp(data) {
  lastLldpData = data;
  const ctrlEl  = q('lldp-controls');
  const cfgWrap = q('lldp-config-wrap');
  const cfgBody = q('tbl-lldp-cfg')?.querySelector('tbody');
  const tbody   = q('tbl-lldp').querySelector('tbody');

  // Nachbarn
  tbody.innerHTML = data.entries.length
    ? data.entries.map(e => `<tr>
        <td style="font-weight:600">${h(e.localPortName)}</td>
        <td>${h(e.remSysName||'—')}</td>
        <td class="mono" style="color:var(--text2)">${h(e.remPortDesc||e.remPortId||'—')}</td>
        <td style="color:var(--text2);font-size:12px">${h((e.remSysDesc||'').split('\n')[0]||'—')}</td>
      </tr>`).join('')
    : `<tr><td colspan="4" class="empty">Keine LLDP-Nachbarn</td></tr>`;

  // Port-Konfiguration
  if (!data.portConfig?.length) {
    if (cfgWrap) cfgWrap.style.display = 'none';
    if (ctrlEl)  ctrlEl.innerHTML = '';
    return;
  }
  if (cfgWrap) cfgWrap.style.display = '';
  if (ctrlEl) ctrlEl.innerHTML = `
    <button class="btn btn-sm" onclick="toggleLldpAll(true)">Alle aktivieren</button>
    <button class="btn btn-sm btn-danger" onclick="toggleLldpAll(false)">Alle deaktivieren</button>`;
  if (cfgBody) cfgBody.innerHTML = data.portConfig.map(p => {
    const enabled = p.adminStatus !== 4;
    return `<tr>
      <td class="mono">${h(p.portName)}</td>
      <td><span class="badge ${LLDP_ADMIN_BADGE[p.adminStatus]||'badge-gray'}">${LLDP_ADMIN[p.adminStatus]||'—'}</span></td>
      <td><button class="btn btn-sm${enabled?' btn-danger':''}" onclick="toggleLldpPort('${p.cfgOid}',${p.portIndex},${!enabled})">${enabled?'Deaktivieren':'Aktivieren'}</button></td>
    </tr>`;
  }).join('');
}

async function toggleLldpPort(cfgOid, portIndex, enable) {
  const ip = q('detail-ip').textContent.trim();
  if (!ip) return;
  try {
    await snmpSet(ip, cfgOid, 'i', enable ? 3 : 4);
    const data = await (window.snmpQ?.(ip, 'lldp') ?? Promise.resolve({entries:[],portConfig:[]}));
    renderDetailLldp(data);
  } catch(e) { alert('Fehler: ' + e.message); }
}

async function toggleLldpAll(enable) {
  const ip = q('detail-ip').textContent.trim();
  if (!ip || !lastLldpData?.portConfig) return;
  try {
    await Promise.all(lastLldpData.portConfig.map(p => snmpSet(ip, p.cfgOid, 'i', enable ? 3 : 4)));
    const data = await (window.snmpQ?.(ip, 'lldp') ?? Promise.resolve({entries:[],portConfig:[]}));
    renderDetailLldp(data);
  } catch(e) { alert('Fehler: ' + e.message); }
}

function renderDetailVlan(data) {
  const tbody=q('tbl-vlan-detail').querySelector('tbody');
  if(!data.entries.length){tbody.innerHTML=`<tr><td colspan="3" class="empty">Keine VLANs gefunden</td></tr>`;return;}
  tbody.innerHTML=data.entries.map(e=>`<tr>
    <td class="mono" style="font-weight:600">${e.vlanId}</td>
    <td>${h(e.name||'—')}</td>
    <td><span class="badge ${e.active?'badge-green':'badge-gray'}">${e.active?'Aktiv':'Inaktiv'}</span></td>
  </tr>`).join('');
}

function adminBadge(val) {
  // IF-MIB: adminStatus/operStatus 1=up 2=down 3=testing
  if (val==='1'||val==='up')   return '<span class="badge badge-green">Up</span>';
  if (val==='2'||val==='down') return '<span class="badge badge-red">Down</span>';
  return `<span class="badge badge-gray">${h(val||'—')}</span>`;
}

async function snmpSet(host, oid, type, value) {
  const r = await fetch('/snmpset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ host, oid, type, value })
  });
  const data = await r.json();
  if (!r.ok || data.error) throw new Error(data.error || 'SNMP SET fehlgeschlagen');
  return data;
}

let lastStpData = null, lastPoeData = null, lastLoopData = null;

async function toggleStpPort(port, enable) {
  const ip = q('detail-ip').textContent.trim();
  const meta = lastStpData?._meta || { oidBase:'1.3.6.1.2.1.17.2.15.1.4', enableValue:1, disableValue:2 };
  try {
    await snmpSet(ip, `${meta.oidBase}.${port}`, 'i', enable ? meta.enableValue : meta.disableValue);
    const data = await (window.snmpQ?.(ip, 'stp') ?? Promise.resolve({entries:[],portEntries:[]}));
    renderDetailStp(data);
  } catch(e) { alert('Fehler: ' + e.message); }
}

async function toggleStpAll(enable) {
  const ip = q('detail-ip').textContent.trim();
  const meta = lastStpData?._meta || { oidBase:'1.3.6.1.2.1.17.2.15.1.4', enableValue:1, disableValue:2 };
  try {
    for (const p of lastStpData?.portEntries||[])
      await snmpSet(ip, `${meta.oidBase}.${p.port}`, 'i', enable ? meta.enableValue : meta.disableValue);
    const data = await (window.snmpQ?.(ip, 'stp') ?? Promise.resolve({entries:[],portEntries:[]}));
    renderDetailStp(data);
  } catch(e) { alert('Fehler: ' + e.message); }
}

async function setSTPMode() {
  const ip = q('detail-ip').textContent.trim();
  const meta = lastStpData?._meta;
  if (!meta?.globalOid) return;
  const sel = document.getElementById('stp-mode-select');
  if (!sel) return;
  const value = parseInt(sel.value);
  try {
    await snmpSet(ip, meta.globalOid, 'i', value);
    await new Promise(r => setTimeout(r, 800));
    const data = await (window.snmpQ?.(ip, 'stp') ?? Promise.resolve({entries:[],portEntries:[]}));
    renderDetailStp(data);
  } catch(e) { alert('Fehler: ' + e.message); }
}

async function togglePoePort(group, port, enable) {
  const ip = q('detail-ip').textContent.trim();
  try {
    await snmpSet(ip, `1.3.6.1.2.1.105.1.1.1.3.${group}.${port}`, 'i', enable ? 1 : 2);
    const data = await (window.snmpQ?.(ip, 'poe') ?? Promise.resolve({main:{},portEntries:[]}));
    renderDetailPoe(data);
  } catch(e) { alert('Fehler: ' + e.message); }
}

async function togglePoeAll(enable) {
  const ip = q('detail-ip').textContent.trim();
  const ports = lastPoeData?.portEntries || [];
  try {
    for (const p of ports) await snmpSet(ip, `1.3.6.1.2.1.105.1.1.1.3.${p.group}.${p.port}`, 'i', enable ? 1 : 2);
    const data = await (window.snmpQ?.(ip, 'poe') ?? Promise.resolve({main:{},portEntries:[]}));
    renderDetailPoe(data);
  } catch(e) { alert('Fehler: ' + e.message); }
}

async function toggleLoopPort(port, enable) {
  const ip = q('detail-ip').textContent.trim();
  const meta = lastLoopData?._meta || { oidBase:'1.3.6.1.2.1.17.2.15.1.4', enableValue:1, disableValue:2 };
  try {
    await snmpSet(ip, `${meta.oidBase}.${port}`, 'i', enable ? meta.enableValue : meta.disableValue);
    const data = await (window.snmpQ?.(ip, 'loop') ?? Promise.resolve({ports:[]}));
    renderDetailLoop(data);
  } catch(e) { alert('Fehler: ' + e.message); }
}

async function toggleLoopAll(enable) {
  const ip = q('detail-ip').textContent.trim();
  const meta = lastLoopData?._meta || { oidBase:'1.3.6.1.2.1.17.2.15.1.4', enableValue:1, disableValue:2 };
  try {
    for (const p of lastLoopData?.ports||[])
      await snmpSet(ip, `${meta.oidBase}.${p.port}`, 'i', enable ? meta.enableValue : meta.disableValue);
    const data = await (window.snmpQ?.(ip, 'loop') ?? Promise.resolve({ports:[]}));
    renderDetailLoop(data);
  } catch(e) { alert('Fehler: ' + e.message); }
}

function renderDetailPorts(data) {
  const tbody=q('tbl-ports').querySelector('tbody');
  if(!data.entries.length){tbody.innerHTML=`<tr><td colspan="6" class="empty">Keine Ports gefunden</td></tr>`;return;}
  tbody.innerHTML=data.entries.map(e=>`<tr>
    <td class="mono">${h(e.name||'—')}</td>
    <td>${h(e.descr||'—')}</td>
    <td>${adminBadge(e.adminStatus)}</td>
    <td>${adminBadge(e.operStatus)}</td>
    <td class="mono">${(()=>{const s=e.highSpeed||Math.round((e.speed||0)/1000000);if(!s)return'—';return s>=1000?(s/1000).toFixed(s%1000?1:0)+' Gbps':s+' Mbps';})()}</td>
    <td class="mono">${e.pvid||'—'}</td>
  </tr>`).join('');
}

function renderDetailStp(data) {
  lastStpData = data;
  const STP_STATE = {1:'Disabled',2:'Blocking',3:'Listening',4:'Learning',5:'Forwarding',6:'Broken'};
  const STP_BADGE = {1:'badge-gray',2:'badge-orange',3:'badge-yellow',4:'badge-yellow',5:'badge-green',6:'badge-red'};
  const g = data.global||{};
  q('stp-global').innerHTML=[
    {label:'Priorität',    value:g.priority||'—'},
    {label:'Root Bridge',  value:g.designatedRoot||'—', mono:true},
    {label:'Root Port',    value:g.rootPort||'—'},
    {label:'Root-Kosten',  value:g.rootCost!=null ? g.rootCost : '—'},
    {label:'Max Age',      value:g.maxAge ? g.maxAge+'s' : '—'},
    {label:'Hello Time',   value:g.helloTime ? g.helloTime+'s' : '—'},
    {label:'Fwd Delay',    value:g.fwdDelay ? g.fwdDelay+'s' : '—'},
    {label:'Topo-Wechsel', value:g.topChanges||'—'},
  ].map(c=>`<div class="info-card"><div class="label">${c.label}</div><div class="value${c.mono?' mono':''}">${c.value}</div></div>`).join('');
  const tbody=q('tbl-stp').querySelector('tbody');
  const meta = data._meta || {};
  const isPrivate = meta.mibType === 'private';
  if(!data.portEntries.length){
    q('stp-controls').innerHTML='';
    tbody.innerHTML=`<tr><td colspan="6" class="empty">Keine STP-Ports</td></tr>`;
    return;
  }
  const anyEnabled = data.portEntries.some(p => p.portEnabled !== false);
  const modeLabel = data.global?.modeLabel ? ` (${data.global.modeLabel})` : '';
  const modeSelector = meta.globalOid ? `
    <select id="stp-mode-select" style="height:30px;border-radius:6px;border:1px solid var(--border);background:var(--card-bg);color:var(--text1);padding:0 6px;font-size:13px">
      ${(meta.modes||[]).map(m=>`<option value="${m.value}"${String(m.value)===String(data.global?.mode)?'selected':''}>${h(m.label)}</option>`).join('')}
    </select>
    <button class="btn btn-sm" onclick="setSTPMode()">Modus setzen</button>
    <span style="color:var(--border);margin:0 2px">|</span>` : '';
  q('stp-controls').innerHTML=`${modeSelector}
    <button class="btn btn-sm" onclick="toggleStpAll(true)">Alle aktivieren</button>
    <button class="btn btn-sm btn-danger" onclick="toggleStpAll(false)">Alle deaktivieren</button>
    <span style="font-size:12px;color:var(--text2)">STP${h(modeLabel)}: <span class="badge ${anyEnabled?'badge-green':'badge-gray'}">${anyEnabled?'Aktiv':'Inaktiv'}</span></span>`;
  if (isPrivate) {
    // CIST Port Configuration (private MIB: Priorität, Admin-Pfadkosten, Edge)
    q('thead-stp').innerHTML='<tr><th>Port</th><th>Priorität</th><th>Admin Pfadkosten</th><th>Edge</th><th>Aktiv</th><th></th></tr>';
    tbody.innerHTML=data.portEntries.map(p=>{
      const enabled = p.portEnabled !== false;
      const edge = p.edgeAdmin === '1' ? '<span class="badge badge-green">Ja</span>' : '<span class="badge badge-gray">Nein</span>';
      return `<tr>
        <td class="mono">${h(p.portName)}</td>
        <td class="mono">${p.priority||'—'}</td>
        <td class="mono">${p.pathCost||'—'}</td>
        <td>${edge}</td>
        <td><span class="badge ${enabled?'badge-green':'badge-gray'}">${enabled?'Ja':'Nein'}</span></td>
        <td><button class="btn btn-sm${enabled?' btn-danger':''}" onclick="toggleStpPort('${p.port}',${!enabled})">${enabled?'Deaktivieren':'Aktivieren'}</button></td>
      </tr>`;
    }).join('');
  } else {
    // Standard Bridge MIB: Status, Priorität, Pfadkosten, Topo-Wechsel
    q('thead-stp').innerHTML='<tr><th>Port</th><th>Status</th><th>Priorität</th><th>Pfadkosten</th><th>Wechsel</th><th></th></tr>';
    tbody.innerHTML=data.portEntries.map(p=>{
      const stateN=parseInt(p.state);
      const enabled = p.portEnabled !== false;
      return `<tr>
        <td class="mono">${h(p.portName)}</td>
        <td><span class="badge ${STP_BADGE[stateN]||'badge-gray'}">${STP_STATE[stateN]||p.state||'—'}</span></td>
        <td class="mono">${p.priority||'—'}</td>
        <td class="mono">${p.pathCost||'—'}</td>
        <td class="mono">${p.fwdTrans||'—'}</td>
        <td><button class="btn btn-sm${enabled?' btn-danger':''}" onclick="toggleStpPort('${p.port}',${!enabled})">${enabled?'Deaktivieren':'Aktivieren'}</button></td>
      </tr>`;
    }).join('');
  }
}

function renderDetailPoe(data) {
  lastPoeData = data;
  const POE_STATUS = {1:'Disabled',2:'Searching',3:'Delivering',4:'Fault',5:'Test',6:'OtherFault'};
  const POE_BADGE  = {1:'badge-gray',2:'badge-yellow',3:'badge-green',4:'badge-red',5:'badge-yellow',6:'badge-red'};
  const POE_CLASS  = {0:'Class 0',1:'Class 1',2:'Class 2',3:'Class 3',4:'Class 4'};
  const m = data.main||{};
  // Cache in deviceStore für Geräteliste-Übersicht
  if (selectedDevice?.ip && S.deviceStore[selectedDevice.ip] && m.power) {
    S.deviceStore[selectedDevice.ip].poeMain = { power: m.power, consumption: m.consumption||0 };
    window.renderDevices?.();
  }
  const pct = (m.power && m.consumption) ? Math.round(m.consumption / m.power * 100) : null;
  const barColor = pct === null ? 'var(--accent)' : pct > 85 ? '#ef4444' : pct > 65 ? '#f97316' : '#22c55e';
  q('poe-global').innerHTML = `
    ${m.power ? `<div style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">
        <span style="font-size:12px;font-weight:600;color:var(--text2)">PoE Verbrauch</span>
        <span style="font-size:13px;font-weight:700;color:${barColor}">${m.consumption||0}W / ${m.power}W${pct!==null?' ('+pct+'%)':''}</span>
      </div>
      <div style="height:10px;background:var(--bg3);border-radius:6px;overflow:hidden">
        <div style="height:100%;width:${Math.min(pct||0,100)}%;background:${barColor};border-radius:6px;transition:width .4s"></div>
      </div>
    </div>` : ''}
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      ${[{label:'Max. Leistung',value:m.power?m.power+'W':'—'},{label:'Verbrauch',value:m.consumption?m.consumption+'W':'—'},{label:'Status',value:m.operStatus?(m.operStatus==='1'?'On':'Off'):'—'}].map(c=>`<div class="info-card"><div class="label">${c.label}</div><div class="value">${c.value}</div></div>`).join('')}
    </div>`;
  const tbody=q('tbl-poe').querySelector('tbody');
  if(!data.portEntries.length){
    q('poe-controls').innerHTML='';
    tbody.innerHTML=`<tr><td colspan="5" class="empty">Keine PoE-Ports gefunden</td></tr>`;
    return;
  }
  const anyEnabled = data.portEntries.some(e => e.adminEnable==='1'||e.adminEnable==='true');
  q('poe-controls').innerHTML=`
    <button class="btn btn-sm" onclick="togglePoeAll(true)">Alle aktivieren</button>
    <button class="btn btn-sm btn-danger" onclick="togglePoeAll(false)">Alle deaktivieren</button>
    <span style="font-size:12px;color:var(--text2)">PoE: <span class="badge ${anyEnabled?'badge-green':'badge-gray'}">${anyEnabled?'Aktiv':'Inaktiv'}</span></span>`;
  tbody.innerHTML=data.portEntries.map(e=>{
    const stN=parseInt(e.detectionStatus);
    const admin=e.adminEnable==='1'||e.adminEnable==='true';
    return `<tr>
      <td class="mono">${e.group}.${e.port}</td>
      <td>${admin?'<span class="badge badge-green">An</span>':'<span class="badge badge-gray">Aus</span>'}</td>
      <td><span class="badge ${POE_BADGE[stN]||'badge-gray'}">${POE_STATUS[stN]||e.detectionStatus||'—'}</span></td>
      <td>${POE_CLASS[parseInt(e.powerClass)]||e.powerClass||'—'}</td>
      <td><button class="btn btn-sm${admin?' btn-danger':''}" onclick="togglePoePort(${e.group},${e.port},${!admin})">${admin?'Deaktivieren':'Aktivieren'}</button></td>
    </tr>`;
  }).join('');
}

function renderDetailLoop(data) {
  lastLoopData = data;
  const tbody=q('tbl-loop').querySelector('tbody');
  if(!data.ports.length){
    q('loop-controls').innerHTML='';
    tbody.innerHTML=`<tr><td colspan="3" class="empty">Keine Daten</td></tr>`;
    return;
  }
  const anyEnabled = data.ports.some(p => p.portEnabled !== false);
  q('loop-controls').innerHTML=`
    <button class="btn btn-sm" onclick="toggleLoopAll(true)">Alle aktivieren</button>
    <button class="btn btn-sm btn-danger" onclick="toggleLoopAll(false)">Alle deaktivieren</button>
    <span style="font-size:12px;color:var(--text2)">Loop Protection: <span class="badge ${anyEnabled?'badge-green':'badge-gray'}">${anyEnabled?'Aktiv':'Inaktiv'}</span></span>`;

  // LP-Status Anzeige: bevorzuge lpStatus (HTTP-basiert), fallback auf STP-State
  const STP_LP = {1:'Kein Link',2:'Blockiert',3:'Lernen',4:'Lernen',5:'Normal',6:'Fehler'};
  const STP_LP_BADGE = {1:'badge-gray',2:'badge-orange',3:'badge-yellow',4:'badge-yellow',5:'badge-green',6:'badge-red'};
  const LP_STATUS = { ok:'Normal', loop:'Loop erkannt!', down:'Kein Link', disabled:'LP inaktiv' };
  const LP_BADGE  = { ok:'badge-green', loop:'badge-red', down:'badge-gray', disabled:'badge-gray' };

  tbody.innerHTML=data.ports.map(p=>{
    const enabled = p.portEnabled !== false;
    let lpBadge;
    if (p.lpStatus) {
      // HTTP-basiert: echte LP-Zustände
      const label = LP_STATUS[p.lpStatus] || p.lpStatus;
      const badge = LP_BADGE[p.lpStatus] || 'badge-gray';
      const title = p.lpTime ? ` title="Loop erkannt: ${h(p.lpTime)}"` : '';
      lpBadge = `<span class="badge ${badge}"${title}>${label}</span>`;
    } else {
      // SNMP-Fallback: STP-State als LP-Näherung
      const stateN = parseInt(p.state);
      lpBadge = `<span class="badge ${STP_LP_BADGE[stateN]||'badge-gray'}">${STP_LP[stateN]||'—'}</span>`;
    }
    return `<tr>
      <td class="mono">${h(p.portName)}</td>
      <td>${lpBadge}</td>
      <td><button class="btn btn-sm${enabled?' btn-danger':''}" onclick="toggleLoopPort('${p.port}',${!enabled})">${enabled?'Deaktivieren':'Aktivieren'}</button></td>
    </tr>`;
  }).join('');
}

// ── renderScriptOutputHtml (null-safe r0.commands) ─────────────────────────────
export function renderScriptOutputHtml(results, ip) {
  const r0 = results?.[0];
  const cmdCount = r0?.combined ? (r0.commands?.length ?? 0) : (results?.length ?? 0);
  let lines = [`# Gerät: ${ip}  |  ${cmdCount} Befehl(e)  |  ${new Date().toLocaleString('de-DE')}`, ''];
  if (r0?.combined) {
    // Single SSH session — show all commands, then combined output
    for (const cmd of (r0.commands ?? [])) lines.push(`$ ${cmd}`);
    lines.push(`[exit ${r0.exitCode}]`, '');
    if (r0.stdout && r0.stdout.trim()) lines.push(r0.stdout.trimEnd(), '');
    if (r0.stderr && r0.stderr.trim()) lines.push(r0.stderr.trimEnd());
  } else {
    for (const r of (results ?? [])) {
      lines.push(`$ ${r.cmd}  [exit ${r.exitCode}]`);
      if (r.stdout && r.stdout.trim()) lines.push(r.stdout.trimEnd());
      if (r.stderr && r.stderr.trim()) lines.push(r.stderr.trimEnd());
      lines.push('');
    }
  }
  return `<pre style="margin:0;padding:14px 16px;font-family:'JetBrains Mono',monospace;font-size:12px;line-height:1.6;color:var(--text1);white-space:pre-wrap;word-break:break-all">${esc(lines.join('\n'))}</pre>`;
}

// Expose for inline onclick handlers
window.toggleIfaceAdmin = toggleIfaceAdmin;
window.toggleLldpPort = toggleLldpPort;
window.toggleLldpAll = toggleLldpAll;
window.toggleStpPort = toggleStpPort;
window.toggleStpAll = toggleStpAll;
window.setSTPMode = setSTPMode;
window.togglePoePort = togglePoePort;
window.togglePoeAll = togglePoeAll;
window.toggleLoopPort = toggleLoopPort;
window.toggleLoopAll = toggleLoopAll;
