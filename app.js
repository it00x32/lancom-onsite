// ═══════════════════════════════════════════════════════════════════════════════
// THEME
// ═══════════════════════════════════════════════════════════════════════════════

function initTheme() {
  const saved = localStorage.getItem('lancom_theme') || 'light';
  applyTheme(saved);
}

function toggleTheme() {
  const current = document.documentElement.dataset.theme || 'light';
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

function applyTheme(theme) {
  if (theme === 'dark') {
    document.documentElement.dataset.theme = 'dark';
    document.getElementById('theme-toggle-btn').textContent = '🌙';
  } else {
    delete document.documentElement.dataset.theme;
    document.getElementById('theme-toggle-btn').textContent = '☀️';
  }
  localStorage.setItem('lancom_theme', theme);
  // Re-render topology SVG so theme-aware colours take effect immediately
  if (document.getElementById('panel-topology')?.classList.contains('active')) {
    renderTopoSvg();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function q(id) { return document.getElementById(id); }
function h(s)  { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function fmtBytes(n) {
  n = Number(n)||0;
  if (n < 1024)    return n + ' B';
  if (n < 1048576) return (n/1024).toFixed(1) + ' KB';
  if (n < 1073741824) return (n/1048576).toFixed(1) + ' MB';
  return (n/1073741824).toFixed(2) + ' GB';
}
function fmtSpeed(mbps, bps) {
  if (mbps > 0) return mbps >= 1000 ? (mbps/1000)+'Gbit/s' : mbps+'Mbit/s';
  const b = Number(bps)||0; if (!b) return '—';
  return b >= 1e9 ? (b/1e9)+'Gbit/s' : b >= 1e6 ? (b/1e6)+'Mbit/s' : (b/1e3)+'kbit/s';
}
function fmtUptime(raw) {
  if (!raw) return '—';
  const m = raw.match(/\((\d+)\)/); if (!m) return raw;
  let s = Math.floor(parseInt(m[1])/100);
  const d=Math.floor(s/86400); s%=86400; const hh=Math.floor(s/3600); s%=3600; const mm=Math.floor(s/60); s%=60;
  return (d?d+'d ':'')+String(hh).padStart(2,'0')+':'+String(mm).padStart(2,'0')+':'+String(s).padStart(2,'0');
}
function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('de-DE',{dateStyle:'short',timeStyle:'short'});
}
function statusBadge(val) {
  const up = val==='1'||String(val).startsWith('up');
  return up ? `<span class="dot dot-green"></span><span class="badge badge-green">UP</span>`
             : `<span class="dot dot-red"></span><span class="badge badge-red">DOWN</span>`;
}
function setBadge(id, n) { const el=q('badge-'+id); if(el) el.textContent = n>0?n:''; }

const TYPE_LABELS = {
  'lx-ap':'Access Point','lcos-ap':'Access Point',
  'switch':'Switch','router':'Router','firewall':'Firewall','unknown':'Unbekannt'
};
const TYPE_BADGE = {
  'lx-ap':'badge-green','lcos-ap':'badge-blue','switch':'badge-yellow',
  'router':'badge-gray','firewall':'badge-orange','unknown':'badge-gray'
};
const OS_BADGE = {
  'LCOS LX':   'badge-green',
  'LCOS FX':   'badge-orange',
  'LCOS SX 3': 'badge-yellow',
  'LCOS SX 4': 'badge-yellow',
  'LCOS SX 5': 'badge-yellow',
  'LCOS':      'badge-blue',
  'LANCOM':    'badge-gray',
};

const FILTER_OS_OPTS   = ['LCOS','LCOS LX','LCOS SX 3','LCOS SX 4','LCOS SX 5','LCOS FX'];
const FILTER_TYPE_OPTS = ['Router','Access Point','Switch','Firewall'];

// Betriebssystem aus Text anhand editierbarer Kriterien ermitteln
function detectOsFromCriteria(text) {
  const c = appCriteria || { osCriteria: [] };
  const upper = (text || '').toUpperCase();
  for (const rule of c.osCriteria) {
    if ((rule.match || []).some(kw => upper.includes(kw.toUpperCase()))) return rule.os;
  }
  return null;
}

// Gerätetyp aus OS + sysDescr ermitteln
// LCOS LX/SX/FX sind durch das OS eindeutig – nur für LCOS werden Kriterien geprüft
function detectDeviceType(os, sysDescr) {
  if ((os || '').startsWith('LCOS LX')) return 'lx-ap';
  if ((os || '').startsWith('LCOS SX')) return 'switch';
  if ((os || '').startsWith('LCOS FX')) return 'firewall';
  if ((os || '').startsWith('LCOS')) {
    const c = appCriteria || { typeCriteria: [] };
    const desc = (sysDescr || '').toUpperCase();
    for (const rule of c.typeCriteria) {
      const kw = rule.keywords || [];
      if (!kw.length || kw.some(k => desc.includes(k.toUpperCase()))) {
        if (rule.type === 'Access Point') return 'lcos-ap';
        if (rule.type === 'Router')       return 'router';
      }
    }
  }
  return 'unknown';
}

// ── Kriterien laden / speichern / rendern ──────────────────────────────────────

const DEFAULT_CRITERIA_CLIENT = {
  osCriteria: [
    {os:'LCOS LX',   match:['LCOS LX','LCOS-LX','LX-','LW-','OW-','OX-']},
    {os:'LCOS FX',   match:['LCOS FX','LCOS-FX']},
    {os:'LCOS SX 3', match:['LCOS SX 3.','LCOS-SX 3.','GS-2']},
    {os:'LCOS SX 4', match:['LCOS SX 4.','LCOS-SX 4.','GS-3']},
    {os:'LCOS SX 5', match:['LCOS SX 5.','LCOS-SX 5.']},
    {os:'LCOS',      match:['LCOS','LN-']},
  ],
  typeCriteria: [
    {type:'Access Point', keywords:['OAP','IAP','LN']},
    {type:'Router',       keywords:[]},
  ],
};

async function loadCriteria() {
  try { const r = await fetch('/api/criteria'); appCriteria = await r.json(); }
  catch { appCriteria = JSON.parse(JSON.stringify(DEFAULT_CRITERIA_CLIENT)); }
  renderCriteriaTables(appCriteria);
}

async function saveCriteria() {
  appCriteria = collectCriteria();
  await fetch('/api/criteria', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(appCriteria) });
  const lbl = q('crit-save-lbl'); lbl.style.display='';
  setTimeout(() => { lbl.style.display='none'; }, 2500);
}

async function resetCriteria() {
  appCriteria = JSON.parse(JSON.stringify(DEFAULT_CRITERIA_CLIENT));
  renderCriteriaTables(appCriteria);
  await fetch('/api/criteria', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(appCriteria) });
  const lbl = q('crit-save-lbl'); lbl.style.display='';
  setTimeout(() => { lbl.style.display='none'; }, 2500);
}

function renderCriteriaTables(c) {
  const osBody   = q('os-crit-body');
  const typeBody = q('type-crit-body');
  if (!osBody || !typeBody) return;
  osBody.innerHTML = (c.osCriteria || []).map(r => `
    <tr>
      <td><span class="crit-label" data-val="${h(r.os||'')}">${h(r.os||'')}</span></td>
      <td><input class="crit-input" value="${h((r.match||[]).join(', '))}" placeholder="keyword1, keyword2"></td>
    </tr>`).join('');
  typeBody.innerHTML = (c.typeCriteria || []).map(r => `
    <tr>
      <td><span class="crit-label" data-val="${h(r.type||'')}">${h(r.type||'')}</span></td>
      <td><input class="crit-input" value="${h((r.keywords||[]).join(', '))}" placeholder="OAP, IAP"></td>
    </tr>`).join('');
}

function collectCriteria() {
  const osCriteria = [...q('os-crit-body').rows].map(tr => {
    const os = tr.querySelector('[data-val]').dataset.val;
    const kw = tr.querySelector('input').value;
    return { os, match: kw.split(',').map(s=>s.trim()).filter(s=>s) };
  });
  const typeCriteria = [...q('type-crit-body').rows].map(tr => {
    const type = tr.querySelector('[data-val]').dataset.val;
    const kw   = tr.querySelector('input').value;
    return { type, keywords: kw.split(',').map(s=>s.trim()).filter(s=>s) };
  });
  return { osCriteria, typeCriteria };
}
function extractModel(sysDescr) {
  if (!sysDescr) return '';
  return sysDescr.split(/[\r\n]/)[0].replace(/LCOS\s+\S+/,'').trim().substring(0,50);
}

// ═══════════════════════════════════════════════════════════════════════════════
// APP STATE
// ═══════════════════════════════════════════════════════════════════════════════

let appSettings  = {};
let appCriteria  = null;
let deviceStore  = {};   // keyed by IP, server-side
let meshData     = [];   // live WDS data
let l2tpData     = [];   // live L2TP data
let meshFilter   = 'all';
let l2tpFilter   = 'all';
let devFilter    = 'all';
let devLocFilter  = 'all';
let meshLocFilter = 'all';
let l2tpLocFilter = 'all';
let topoLocFilter = 'all';
let meshSort     = { col: null, dir: 1 };
let l2tpSort     = { col: null, dir: 1 };
let devSort      = { col: 'ip', dir: 1 };
let scanResults  = [];
let scanAbort    = null;
let scanFoundCnt = 0;

// ═══════════════════════════════════════════════════════════════════════════════
// SETTINGS (server-side)
// ═══════════════════════════════════════════════════════════════════════════════

// ── Sortier-Hilfsfunktionen ────────────────────────────────────────────────────
function mkTh(label, col, sort, clickFn) {
  const active = sort.col === col;
  const cls = active ? (sort.dir === 1 ? 'sortable sort-asc' : 'sortable sort-desc') : 'sortable';
  return `<th class="${cls}" onclick="${clickFn}('${col}')">${label}</th>`;
}
function noSortTh(label) { return `<th>${label}</th>`; }

function applySort(arr, sort, keyFn) {
  if (!sort.col) return arr;
  return [...arr].sort((a, b) => {
    const va = keyFn(a, sort.col), vb = keyFn(b, sort.col);
    if (va === vb) return 0;
    return (va < vb ? -1 : 1) * sort.dir;
  });
}

function clickSort(sort, col, renderFn) {
  if (sort.col === col) sort.dir *= -1;
  else { sort.col = col; sort.dir = 1; }
  renderFn();
}

function meshSortClick(col)  { clickSort(meshSort, col, renderMesh); }
function l2tpSortClick(col)  { clickSort(l2tpSort, col, renderL2tp); }
function devSortClick(col)   { clickSort(devSort,  col, renderDevices); }

function setDevFilter(f) {
  devFilter = f;
  ['all','online','offline'].forEach(k => {
    const el = q('df-'+k); if (el) el.classList.toggle('active', k === f);
  });
  renderDevices();
}

function getLocations() {
  const locs = new Set();
  Object.values(deviceStore).forEach(d => { if (d.location) locs.add(d.location); });
  return [...locs].sort();
}

function refreshLocationSelects() {
  const locs = getLocations();
  const filterOpts = `<option value="all">Alle Standorte</option>` + locs.map(l => `<option value="${h(l)}">${h(l)}</option>`).join('');
  const scanOpts   = `<option value="">Kein Standort</option>` + locs.map(l => `<option value="${h(l)}">${h(l)}</option>`).join('');
  [['dev-loc-filter', filterOpts], ['mesh-loc-filter', filterOpts],
   ['l2tp-loc-filter', filterOpts], ['topo-loc-filter', filterOpts],
   ['scan-loc-select', scanOpts]].forEach(([id, opts]) => {
    const el = q(id); if (!el) return;
    const cur = el.value; el.innerHTML = opts;
    if (cur) el.value = cur;
  });
}

function matchesLocFilter(d) { return devLocFilter === 'all' || (d.location||'') === devLocFilter; }
function setDevLocFilter(v)  { devLocFilter  = v; renderDevices(); }
function setMeshLocFilter(v) { meshLocFilter = v; renderMesh(); }
function setL2tpLocFilter(v) { l2tpLocFilter = v; renderL2tp(); }
function setTopoLocFilter(v) { topoLocFilter = v; buildTopoFromStore(); }

// ═══════════════════════════════════════════════════════════════════════════════
// SDN / VLAN
// ═══════════════════════════════════════════════════════════════════════════════

let vlans = [];

function showSdnTab(name) {
  ['vlan'].forEach(t => {
    q('sdntab-'+t).classList.toggle('active', t===name);
    q('sdnpanel-'+t).classList.toggle('active', t===name);
  });
}

function renderVlans() {
  const tbody = q('vlan-tbody');
  if (!vlans.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty">Keine VLANs konfiguriert</td></tr>';
    return;
  }
  tbody.innerHTML = vlans.map((v, i) => `
    <tr>
      <td><input class="settings-input" style="min-width:140px" value="${h(v.name)}" oninput="vlans[${i}].name=this.value"></td>
      <td><input class="settings-input" type="number" min="1" max="4095" style="width:90px" value="${v.vlanId}" oninput="vlans[${i}].vlanId=parseInt(this.value)||''"></td>
      <td style="text-align:center"><input type="radio" name="mgmt-vlan" ${v.isManagement?'checked':''} onchange="setManagementVlan(${i})" style="accent-color:var(--cyan);width:16px;height:16px;cursor:pointer"></td>
      <td><button class="btn btn-sm btn-ghost" onclick="deleteVlan(${i})" ${vlans.length===1?'disabled':''}>Löschen</button></td>
    </tr>`).join('');
}

function addVlan() {
  vlans.push({ name: '', vlanId: '', isManagement: false });
  renderVlans();
}

function deleteVlan(i) {
  const wasMgmt = vlans[i].isManagement;
  vlans.splice(i, 1);
  if (wasMgmt && vlans.length) vlans[0].isManagement = true;
  renderVlans();
}

function setManagementVlan(i) {
  vlans.forEach((v, idx) => v.isManagement = idx === i);
}

function validateVlans() {
  // Reset highlights
  document.querySelectorAll('#tbl-vlan input[type=text], #tbl-vlan input[type=number]')
    .forEach(el => el.style.borderColor = '');

  const rows = [...(q('vlan-tbody')?.rows || [])];

  for (let i = 0; i < vlans.length; i++) {
    const v = vlans[i];
    if (!String(v.name).trim()) {
      rows[i]?.cells[0].querySelector('input')?.style.setProperty('border-color', 'var(--red)');
      return 'Name darf nicht leer sein.';
    }
    const id = parseInt(v.vlanId);
    if (isNaN(id) || id < 1 || id > 4095) {
      rows[i]?.cells[1].querySelector('input')?.style.setProperty('border-color', 'var(--red)');
      return 'VLAN ID muss eine Zahl zwischen 1 und 4095 sein.';
    }
  }

  const ids = vlans.map(v => parseInt(v.vlanId));
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) {
    rows.forEach((row, i) => {
      if (dupes.includes(parseInt(vlans[i].vlanId)))
        row.cells[1].querySelector('input')?.style.setProperty('border-color', 'var(--red)');
    });
    return `VLAN ID ${dupes[0]} ist mehrfach vergeben.`;
  }

  if (!vlans.some(v => v.isManagement)) return 'Ein VLAN muss als Management VLAN festgelegt sein.';
  return null;
}

async function saveVlans() {
  const err = validateVlans();
  if (err) { showVlanStatus(err, 'error'); return; }
  try {
    await fetch('/api/sdn', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ vlans }) });
    showVlanStatus('Gespeichert.', 'ok');
  } catch { showVlanStatus('Fehler beim Speichern.', 'error'); }
}

function showVlanStatus(msg, cls) {
  const s = q('vlan-status');
  s.textContent = msg; s.className = 'status-bar ' + cls; s.style.display = '';
  if (cls === 'ok') setTimeout(() => { s.style.display = 'none'; }, 3000);
}

async function loadVlans() {
  try {
    const r = await fetch('/api/sdn');
    const data = await r.json();
    vlans = data.vlans || [];
  } catch {
    vlans = [{ name: 'Management', vlanId: 1, isManagement: true }];
  }
  renderVlans();
}

function showCfgTab(name) {
  ['snmp','import','rssi'].forEach(t => {
    q('cfgtab-'+t).classList.toggle('active', t===name);
    q('cfgpanel-'+t).classList.toggle('active', t===name);
  });
}

function onSnmpVersionChange() {
  const v3 = q('cfg-snmp-version').value === '3';
  q('cfg-v3-section').style.display = v3 ? '' : 'none';
  if (v3) onV3LevelChange();
}
function onV3LevelChange() {
  const lvl = q('cfg-v3-seclevel').value;
  q('cfg-v3-auth-block').style.display = (lvl === 'authNoPriv' || lvl === 'authPriv') ? '' : 'none';
  q('cfg-v3-priv-block').style.display = (lvl === 'authPriv') ? '' : 'none';
}

async function loadSettings() {
  try {
    const r = await fetch('/api/settings'); appSettings = await r.json();
  } catch { appSettings = { snmpReadCommunity:'public', snmpWriteCommunity:'private', snmpVersion:'2c', rssiGreen:80, rssiYellow:50, rssiOrange:0 }; }
  q('cfg-snmp-read').value    = appSettings.snmpReadCommunity  || 'public';
  q('cfg-snmp-write').value   = appSettings.snmpWriteCommunity || 'private';
  q('cfg-snmp-version').value = appSettings.snmpVersion        || '2c';
  q('cfg-rssi-green').value   = appSettings.rssiGreen  ?? 80;
  q('cfg-rssi-yellow').value  = appSettings.rssiYellow ?? 50;
  q('cfg-rssi-orange').value  = appSettings.rssiOrange ?? 0;
  // SNMPv3
  q('cfg-v3-secname').value   = appSettings.snmpV3SecurityName  || '';
  q('cfg-v3-seclevel').value  = appSettings.snmpV3SecurityLevel || 'authPriv';
  q('cfg-v3-authproto').value = appSettings.snmpV3AuthProtocol  || 'SHA';
  q('cfg-v3-authpass').value  = appSettings.snmpV3AuthPassword  || '';
  q('cfg-v3-privproto').value = appSettings.snmpV3PrivProtocol  || 'AES';
  q('cfg-v3-privpass').value  = appSettings.snmpV3PrivPassword  || '';
  // Import-Filter
  const _fOS   = appSettings.filterOS   || [];
  const _fType = appSettings.filterType || [];
  FILTER_OS_OPTS.forEach((v,i)   => { const el=q(`cfg-os-${i}`);   if(el) el.checked=_fOS.includes(v); });
  FILTER_TYPE_OPTS.forEach((v,i) => { const el=q(`cfg-type-${i}`); if(el) el.checked=_fType.includes(v); });
  onSnmpVersionChange();
  if (appSettings.lastScanSubnet) q('scan-subnet').value = appSettings.lastScanSubnet;
}

async function saveSettings() {
  appSettings = {
    ...appSettings,
    snmpReadCommunity:  q('cfg-snmp-read').value.trim(),
    snmpWriteCommunity: q('cfg-snmp-write').value.trim(),
    snmpVersion:        q('cfg-snmp-version').value,
    rssiGreen:  parseInt(q('cfg-rssi-green').value)  ?? 80,
    rssiYellow: parseInt(q('cfg-rssi-yellow').value) ?? 50,
    rssiOrange: parseInt(q('cfg-rssi-orange').value) ?? 0,
    snmpV3SecurityName:  q('cfg-v3-secname').value.trim(),
    snmpV3SecurityLevel: q('cfg-v3-seclevel').value,
    snmpV3AuthProtocol:  q('cfg-v3-authproto').value,
    snmpV3AuthPassword:  q('cfg-v3-authpass').value,
    snmpV3PrivProtocol:  q('cfg-v3-privproto').value,
    snmpV3PrivPassword:  q('cfg-v3-privpass').value,
    filterOS:   FILTER_OS_OPTS.filter((_,i)   => q(`cfg-os-${i}`)?.checked),
    filterType: FILTER_TYPE_OPTS.filter((_,i) => q(`cfg-type-${i}`)?.checked),
  };
  await fetch('/api/settings',{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(appSettings) });
  const lbl = q('settings-save-lbl');
  lbl.style.display=''; setTimeout(()=>{ lbl.style.display='none'; }, 2500);
  renderMesh();
  renderL2tp();
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEVICE STORE (server-side)
// ═══════════════════════════════════════════════════════════════════════════════

function rebuildCachedData() {
  meshData = [];
  l2tpData = [];
  Object.values(deviceStore).forEach(d => {
    if (d.wdsLinks?.length)      meshData.push(...d.wdsLinks);
    if (d.l2tpEndpoints?.length) l2tpData.push(...d.l2tpEndpoints);
  });
}

async function loadDevices() {
  try { const r = await fetch('/api/devices'); deviceStore = await r.json(); }
  catch { deviceStore = {}; }
  rebuildCachedData();
  refreshLocationSelects();
  renderDevices();
  renderMesh();
  renderL2tp();
  setBadge('devices', Object.keys(deviceStore).length || 0);
}

async function saveDevice(dev) {
  deviceStore[dev.ip] = dev;
  await fetch('/api/devices',{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ [dev.ip]: dev }) });
  refreshLocationSelects();
  renderDevices();
  setBadge('devices', Object.keys(deviceStore).length);
}

async function saveDevices(devMap) {
  Object.assign(deviceStore, devMap);
  await fetch('/api/devices',{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(devMap) });
  refreshLocationSelects();
  renderDevices();
  setBadge('devices', Object.keys(deviceStore).length);
}

async function deleteDevice(ip) {
  delete deviceStore[ip];
  await fetch('/api/devices',{ method:'DELETE', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ ip }) });
  rebuildCachedData();
  renderDevices();
  renderMesh();
  renderL2tp();
  setBadge('devices', Object.keys(deviceStore).length);
}

async function clearAllDevices() {
  if (!confirm('Alle Geräte löschen?')) return;
  deviceStore = {};
  meshData = [];
  l2tpData = [];
  await fetch('/api/devices',{ method:'DELETE', headers:{'Content-Type':'application/json'}, body:'{}' });
  renderDevices();
  renderMesh();
  renderL2tp();
  setBadge('devices', 0);
}

function renderDevices() {
  const srch = (q('dev-search')?.value||'').toLowerCase();
  const ipNum = ip => ip.split('.').reduce((s,o) => s*256+parseInt(o), 0);

  let devs = Object.values(deviceStore).filter(d => {
    if (srch && !(d.name||d.ip||'').toLowerCase().includes(srch) && !d.ip.includes(srch)) return false;
    if (devFilter === 'online'  && d.online !== true)  return false;
    if (devFilter === 'offline' && d.online !== false) return false;
    if (devLocFilter !== 'all'  && (d.location||'') !== devLocFilter) return false;
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
  devs = devSort.col
    ? applySort(devs, devSort, keyFn)
    : devs.sort((a,b) => ipNum(a.ip) - ipNum(b.ip));

  const total = Object.keys(deviceStore).length;
  setBadge('devices', total);
  q('cnt-devices').textContent = total ? total+' Gerät'+(total!==1?'e':'') : '';

  // Thead
  q('thead-devices').innerHTML = `<tr>
    ${mkTh('Gerätename','name',devSort,'devSortClick')}
    ${mkTh('IP-Adresse','ip',devSort,'devSortClick')}
    ${mkTh('MAC-Adresse','mac',devSort,'devSortClick')}
    ${mkTh('MACs','macs',devSort,'devSortClick')}
    ${mkTh('LLDP','lldp',devSort,'devSortClick')}
    ${mkTh('WDS','wds',devSort,'devSortClick')}
    ${mkTh('L2TPv3','l2tp',devSort,'devSortClick')}
    ${mkTh('Modell','model',devSort,'devSortClick')}
    ${mkTh('Seriennummer','serial',devSort,'devSortClick')}
    ${mkTh('Betriebssystem','os',devSort,'devSortClick')}
    ${mkTh('Typ','type',devSort,'devSortClick')}
    ${mkTh('Quelle','source',devSort,'devSortClick')}
    ${mkTh('Standort','location',devSort,'devSortClick')}
    ${mkTh('Zuletzt gesehen','lastSeen',devSort,'devSortClick')}
    ${noSortTh('')}
  </tr>`;

  const tbody = q('tbl-devices').querySelector('tbody');
  if (!devs.length) {
    tbody.innerHTML = `<tr><td colspan="15" class="empty">Keine Geräte ${srch||devFilter!=='all'||devLocFilter!=='all'?'gefunden':'– Scanner oder LMC Import verwenden'}</td></tr>`;
    return;
  }
  tbody.innerHTML = devs.map(dev => {
    const typLbl = TYPE_LABELS[dev.type]||'Unbekannt';
    const typCls = TYPE_BADGE[dev.type]||'badge-gray';
    const srcLbl = dev.source==='lmc' ? '<span class="badge badge-blue">LMC</span>' : '<span class="badge badge-gray">Scanner</span>';
    return `<tr>
      <td style="font-weight:600"><span class="dot ${dev.online===true?'dot-green':dev.online===false?'dot-red':'dot-gray'}" title="${dev.online===true?'Online':dev.online===false?'Offline':'Unbekannt'}"></span>${h(dev.name||'—')}</td>
      <td class="mono"><a href="https://${h(dev.ip)}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">${h(dev.ip)}</a></td>
      <td class="mono" style="font-size:12px;color:var(--text2)">${h(dev.mac||'—')}</td>
      <td style="font-size:12px;text-align:center;color:${dev.macs?.length?'var(--accent)':'var(--text3)'}" title="${dev.macs?.length?dev.macs.join('\n'):'Noch kein MAC-Sync'}">${dev.macs?.length??'—'}</td>
      <td style="font-size:12px;text-align:center;color:${dev.lldpCount?'var(--accent)':'var(--text3)'}" title="${dev.lldpNeighbors?.length?dev.lldpNeighbors.join('\n'):'Noch kein LLDP Sync'}">${dev.lldpCount??'—'}</td>
      <td style="font-size:12px;text-align:center;color:${dev.wdsLinks?.length?'var(--orange)':'var(--text3)'}" title="${dev.wdsLinks?.length?dev.wdsLinks.map(l=>l.linkName||l.mac||'?').join('\n'):'Keine WDS-Daten'}">${dev.wdsLinks?.length??'—'}</td>
      <td style="font-size:12px;text-align:center;color:${dev.l2tpEndpoints?.length?'var(--green)':'var(--text3)'}" title="${dev.l2tpEndpoints?.length?dev.l2tpEndpoints.map(e=>e.endpointName||e.remoteIp||'?').join('\n'):'Keine L2TP-Daten'}">${dev.l2tpEndpoints?.length??'—'}</td>
      <td style="color:var(--text2);font-size:12px">${h(dev.model||'—')}</td>
      <td class="mono" style="font-size:12px;color:var(--text3)">${h(dev.serial||'—')}</td>
      <td><span class="badge ${OS_BADGE[dev.os]||'badge-gray'}">${h(dev.os||'—')}</span></td>
      <td><span class="badge ${typCls}">${typLbl}</span></td>
      <td>${srcLbl}</td>
      <td style="font-size:12px;color:var(--text2)">${h(dev.location||'—')}</td>
      <td style="color:var(--text3);font-size:11px">${fmtDate(dev.lastSeen)}</td>
      <td><div style="display:flex;gap:6px">
        <button class="btn btn-sm" onclick="openDeviceDetail('${h(dev.ip)}')">Details</button>
        <button class="btn btn-sm btn-danger" onclick="deleteDevice('${h(dev.ip)}')">&#x2715;</button>
      </div></td>
    </tr>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════════════════════════════
// SNMP QUERY HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

async function snmpQ(host, type, extra = {}) {
  const r = await fetch('/snmp',{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({host,type,...extra}) });
  const d = await r.json(); if (d.error) throw new Error(d.error); return d;
}

function devCredentials(ip) {
  const d = deviceStore[ip];
  return {
    community: d?.community || appSettings.snmpReadCommunity || 'public',
    version:   d?.version   || appSettings.snmpVersion       || '2c',
  };
}

function setDeviceOnline(ip, online) {
  if (!deviceStore[ip]) return;
  deviceStore[ip].online = online;
  renderDevices();
}

async function checkAllDeviceStatus() {
  const btn  = q('btn-check-status');
  const st   = q('dev-sync-status');
  const wrap = q('dev-progress-wrap');
  const bar  = q('dev-progress-bar');
  const txt  = q('dev-progress-text');
  const devList = Object.values(deviceStore).filter(matchesLocFilter);
  if (!devList.length) {
    st.className = 'status-bar error';
    st.textContent = devLocFilter !== 'all' ? `Keine Geräte im Standort „${devLocFilter}".` : 'Keine Geräte vorhanden.'; return;
  }

  btn.disabled = true; btn.textContent = '…';
  st.className = ''; st.textContent = '';
  wrap.style.display = 'block'; bar.style.width = '0%';
  txt.textContent = `0 / ${devList.length}`;

  let done = 0, online = 0;
  const total = devList.length;

  try {
    const CONCURRENCY = 5;
    async function checkOne(dev) {
      try {
        await snmpQ(dev.ip, 'ping');
        if (deviceStore[dev.ip]) { deviceStore[dev.ip].online = true; online++; }
      } catch {
        if (deviceStore[dev.ip]) deviceStore[dev.ip].online = false;
      }
      done++;
      bar.style.width = Math.round(done / total * 100) + '%';
      txt.textContent = `${done} / ${total}`;
    }
    for (let i = 0; i < devList.length; i += CONCURRENCY) {
      await Promise.all(devList.slice(i, i + CONCURRENCY).map(checkOne));
      renderDevices();
    }
    await fetch('/api/devices', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(deviceStore) });
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

async function syncDeviceMacs() {
  const btn  = q('btn-mac-sync');
  const st   = q('dev-sync-status');
  const wrap = q('dev-progress-wrap');
  const bar  = q('dev-progress-bar');
  const txt  = q('dev-progress-text');
  const devList = Object.values(deviceStore).filter(d => d.online !== false && matchesLocFilter(d));
  if (!devList.length) {
    st.className = 'status-bar error';
    st.textContent = devLocFilter !== 'all' ? `Keine Online-Geräte im Standort „${devLocFilter}".` : 'Keine Online-Geräte – bitte zuerst "Status" ausführen.'; return;
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
          const result = await snmpQ(dev.ip, 'ifmacs');
          if (deviceStore[dev.ip] && result.macs?.length) deviceStore[dev.ip].macs = result.macs;
        } catch {}
        done++;
        bar.style.width = Math.round(done / total * 100) + '%';
        txt.textContent = `${done} / ${total}`;
      }
    }
    await Promise.all(Array(Math.min(CONCURRENCY, devList.length)).fill(null).map(worker));
    await fetch('/api/devices', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(deviceStore) });
    renderMesh(); renderDevices();
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
async function lldpSyncCore(devList, onProgress) {
  const CONCURRENCY = 3;
  const queue = [...devList];
  let done = 0;
  async function worker() {
    while (queue.length) {
      const dev = queue.shift();
      try {
        const result = await snmpQ(dev.ip, 'lldp');
        if (deviceStore[dev.ip]) {
          deviceStore[dev.ip].lldpCount     = result.entries?.length ?? 0;
          deviceStore[dev.ip].lldpNeighbors = (result.entries||[])
            .map(e => e.remSysName||e.remPortId||'?').filter(Boolean);
          deviceStore[dev.ip].lldpData = (result.entries||[]).map(e => ({
            localPortName: e.localPortName||'',
            remSysName:    e.remSysName||'',
            remPortId:     e.remPortId||'',
            remPortDesc:   e.remPortDesc||'',
            remMac:        e.remMac||'',
          }));
        }
      } catch { /* Gerät unterstützt LLDP evtl. nicht */ }
      done++;
      if (onProgress) onProgress(done, devList.length, dev);
    }
  }
  await Promise.all(Array(Math.min(CONCURRENCY, devList.length || 1)).fill(null).map(worker));
}

async function syncDeviceLldp() {
  const btn  = q('btn-lldp-sync');
  const st   = q('dev-sync-status');
  const wrap = q('dev-progress-wrap');
  const bar  = q('dev-progress-bar');
  const txt  = q('dev-progress-text');
  const devList = Object.values(deviceStore).filter(d => d.online !== false && matchesLocFilter(d));
  if (!devList.length) {
    st.className = 'status-bar error';
    st.textContent = devLocFilter !== 'all' ? `Keine Online-Geräte im Standort „${devLocFilter}".` : 'Keine Online-Geräte – bitte zuerst "Status" ausführen.'; return;
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
    await fetch('/api/devices', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(deviceStore) });
    renderDevices();
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

// ═══════════════════════════════════════════════════════════════════════════════
// WIFI MESH
// ═══════════════════════════════════════════════════════════════════════════════

function rssiStatus(signal, connected) {
  if (!connected) return 'red';
  if (signal == null) return 'orange';
  const pct = Number(signal);
  if (pct >= (appSettings.rssiGreen  ?? 80)) return 'green';
  if (pct >= (appSettings.rssiYellow ?? 50)) return 'yellow';
  if (pct >= (appSettings.rssiOrange ?? 0))  return 'orange';
  return 'red';
}
const RS = {
  green:  { cls:'dot-green',  bcls:'badge-green',  lbl:'Gut'    },
  yellow: { cls:'dot-yellow', bcls:'badge-yellow', lbl:'Mittel' },
  orange: { cls:'dot-orange', bcls:'badge-orange', lbl:'Schwach'},
  red:    { cls:'dot-red',    bcls:'badge-red',    lbl:'Offline'},
};

function setMeshFilter(f) {
  meshFilter = f;
  ['all','green','yellow','orange','red'].forEach(k => {
    const el = q('mf-'+k); if (el) el.classList.toggle('active', k===f);
  });
  renderMesh();
}

function resolvePeerDev(mac) {
  const low = (mac||'').toLowerCase();
  if (!low) return null;
  return Object.values(deviceStore).find(d => {
    if ((d.mac||'').toLowerCase() === low) return true;
    if (d.macs?.some(m => m.toLowerCase() === low)) return true;
    return false;
  }) || null;
}

function clearMeshData() {
  if (!confirm('WDS-Verbindungsdaten für alle Geräte löschen?')) return;
  meshData = [];
  Object.values(deviceStore).forEach(d => { delete d.wdsLinks; });
  fetch('/api/devices', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(deviceStore) });
  renderMesh(); renderDevices();
}

function renderMesh() {
  const srch = (q('mesh-search')?.value||'').toLowerCase();

  // Step 1: Resolve peer device for every entry
  const entries = meshData.map(r => ({ ...r, peerDev: resolvePeerDev(r.mac) }));

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
    if (meshFilter !== 'all' && st !== meshFilter) return false;
    if (meshLocFilter !== 'all' && (deviceStore[r.deviceIp]?.location||'') !== meshLocFilter) return false;
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
      case 'loc':        return (deviceStore[r.deviceIp]?.location||'').toLowerCase();
      default:           return '';
    }
  };
  const sortedRows = applySort(rows, meshSort, meshKeyFn);

  setBadge('mesh', allRows.length);
  q('cnt-mesh').textContent = allRows.length ? allRows.length+' Link'+(allRows.length!==1?'s':'') : '';

  // Thead
  q('thead-mesh').innerHTML = `<tr>
    ${mkTh('Gerätename','deviceName',meshSort,'meshSortClick')}
    ${mkTh('Gerät-IP','deviceIp',meshSort,'meshSortClick')}
    ${mkTh('WDS-Link','linkName',meshSort,'meshSortClick')}
    ${mkTh('Gegenstelle','peer',meshSort,'meshSortClick')}
    ${mkTh('Band','band',meshSort,'meshSortClick')}
    ${mkTh('RSSI','signal',meshSort,'meshSortClick')}
    ${mkTh('Eff.-Tx-Rate','txRate',meshSort,'meshSortClick')}
    ${mkTh('Eff.-Rx-Rate','rxRate',meshSort,'meshSortClick')}
    ${mkTh('Status','status',meshSort,'meshSortClick')}
    ${mkTh('Standort','loc',meshSort,'meshSortClick')}
    ${noSortTh('')}
  </tr>`;

  const tbody = q('tbl-mesh').querySelector('tbody');
  if (!sortedRows.length) {
    tbody.innerHTML = `<tr><td colspan="11" class="empty">${meshData.length ? 'Kein Treffer für aktiven Filter' : 'Sync starten – nur LX Access Points werden abgefragt'}</td></tr>`;
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
      <td style="font-size:12px;color:var(--text2)">${h(deviceStore[r.deviceIp]?.location||'—')}</td>
      <td><div style="display:flex;gap:4px">${syncBtns}</div></td>
    </tr>`;
  }).join('');
}

async function syncMeshDevice(ip) {
  const dev = deviceStore[ip];
  if (!dev) return;
  const name = dev.name||dev.sysName||ip;
  const st = q('dev-sync-status');
  st.className = 'status-bar loading';
  st.innerHTML = `<span class="spinner"></span> Sync ${h(name)}…`;
  try {
    const result = await snmpQ(ip, 'wds');
    setDeviceOnline(ip, true);
    meshData = meshData.filter(r => r.deviceIp !== ip);
    if (result.configured) mergeMeshResult(ip, name, result);
    await fetch('/api/devices', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(deviceStore) });
    renderMesh();
    const cnt = meshData.filter(r => r.deviceIp === ip).length;
    st.className = 'status-bar ok';
    st.textContent = `${name}: ${cnt} WDS-Link${cnt!==1?'s':''} aktualisiert`;
  } catch {
    setDeviceOnline(ip, false);
    st.className = 'status-bar error';
    st.textContent = `${name}: SNMP nicht erreichbar`;
  }
}

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
    meshData.push(entry);
    stored.push(entry);
  });
  if (deviceStore[ip]) deviceStore[ip].wdsLinks = stored;
}

// ═══════════════════════════════════════════════════════════════════════════════
// L2TPv3
// ═══════════════════════════════════════════════════════════════════════════════

function setL2tpFilter(f) {
  l2tpFilter = f;
  ['all','up','down'].forEach(k => { const el=q('lf-'+k); if(el) el.classList.toggle('active',k===f); });
  renderL2tp();
}

function clearL2tpData() {
  if (!confirm('L2TPv3-Endpunktdaten für alle Geräte löschen?')) return;
  l2tpData = [];
  Object.values(deviceStore).forEach(d => { delete d.l2tpEndpoints; });
  fetch('/api/devices', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(deviceStore) });
  renderL2tp(); renderDevices();
}

function renderL2tp() {
  const srch = (q('l2tp-search')?.value||'').toLowerCase();
  const filtered = l2tpData.filter(r => {
    const up = r.state==='UP';
    if (l2tpFilter==='up' && !up) return false;
    if (l2tpFilter==='down' && up) return false;
    if (l2tpLocFilter !== 'all' && (deviceStore[r.deviceIp]?.location||'') !== l2tpLocFilter) return false;
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
      case 'loc':          return (deviceStore[r.deviceIp]?.location||'').toLowerCase();
      default:             return '';
    }
  };
  const rows = applySort(filtered, l2tpSort, l2tpKeyFn);

  setBadge('l2tp', l2tpData.length);
  q('cnt-l2tp').textContent = l2tpData.length ? l2tpData.length+' Endpunkt'+(l2tpData.length!==1?'e':'') : '';

  q('thead-l2tp').innerHTML = `<tr>
    ${mkTh('Gerätename','deviceName',l2tpSort,'l2tpSortClick')}
    ${mkTh('Gerät-IP','deviceIp',l2tpSort,'l2tpSortClick')}
    ${mkTh('Endpoint','endpointName',l2tpSort,'l2tpSortClick')}
    ${mkTh('Gegenstelle','remoteEnd',l2tpSort,'l2tpSortClick')}
    ${mkTh('Remote-IP','remoteIp',l2tpSort,'l2tpSortClick')}
    ${mkTh('Status','state',l2tpSort,'l2tpSortClick')}
    ${mkTh('Standort','loc',l2tpSort,'l2tpSortClick')}
    ${noSortTh('')}
  </tr>`;

  const tbody = q('tbl-l2tp').querySelector('tbody');
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty">${l2tpData.length?'Kein Treffer für aktiven Filter':'Sync starten – nur LX Access Points werden abgefragt'}</td></tr>`;
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
      <td style="font-size:12px;color:var(--text2)">${h(deviceStore[r.deviceIp]?.location||'—')}</td>
      <td><button class="btn btn-sm btn-ghost" onclick="syncL2tpDevice('${h(r.deviceIp)}')">&#x21BB;</button></td>
    </tr>`;
  }).join('');
}

async function syncL2tpDevice(ip) {
  const dev = deviceStore[ip]; if (!dev) return;
  const name = dev.name||dev.ip;
  const st = q('dev-sync-status');
  st.className = 'status-bar loading';
  st.innerHTML = `<span class="spinner"></span> Sync ${h(name)}…`;
  try {
    const result = await snmpQ(ip, 'l2tp');
    setDeviceOnline(ip, true);
    l2tpData = l2tpData.filter(r => r.deviceIp!==ip);
    if (result.configured) mergeL2tpResult(ip, name, result);
    await fetch('/api/devices', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(deviceStore) });
    renderL2tp();
    const cnt = l2tpData.filter(r => r.deviceIp===ip).length;
    st.className = 'status-bar ok';
    st.textContent = `${name}: ${cnt} Endpunkt${cnt!==1?'e':''} aktualisiert`;
  } catch {
    setDeviceOnline(ip, false);
    st.className = 'status-bar error';
    st.textContent = `${name}: SNMP nicht erreichbar`;
  }
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
    l2tpData.push(entry);
    stored.push(entry);
  });
  if (deviceStore[ip]) deviceStore[ip].l2tpEndpoints = stored;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCANNER
// ═══════════════════════════════════════════════════════════════════════════════

function setScanStatus(msg,type='') { const el=q('scan-status'); el.className='status-bar'+(type?' '+type:''); el.innerHTML=type==='loading'?`<span class="spinner"></span> ${msg}`:msg; }

async function startScan() {
  const subnet = q('scan-subnet').value.trim();
  if (!subnet) { setScanStatus('Bitte Subnetz eingeben.','error'); return; }

  // Save last subnet (fire and forget — not critical for scan start)
  appSettings.lastScanSubnet = subnet;
  fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...appSettings})}).catch(()=>{});

  if (scanAbort) { scanAbort.abort(); scanAbort=null; }
  scanAbort = new AbortController();
  scanFoundCnt=0; scanResults=[];

  q('btn-scan').disabled=true;
  q('btn-scan-stop').style.display='';
  q('btn-save-all').style.display='none';
  q('sep-save-all').style.display='none';
  q('scan-progress-wrap').style.display='';
  q('scan-bar').style.width='0%';
  q('scan-scanned').textContent='0'; q('scan-total').textContent='?'; q('scan-found-lbl').textContent='';
  q('tbl-scan').querySelector('tbody').innerHTML=''; q('cnt-scan').textContent='';
  setScanStatus('Scan läuft…','loading');

  try {
    const resp = await fetch('/scan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({subnet}),signal:scanAbort.signal});
    if (!resp.ok) { const e=await resp.json().catch(()=>({error:resp.statusText})); throw new Error(e.error||'Serverfehler'); }
    const reader=resp.body.getReader(); const dec=new TextDecoder(); let buf='';
    while (true) {
      const {done,value}=await reader.read(); if(done) break;
      buf+=dec.decode(value,{stream:true}); const lines=buf.split('\n'); buf=lines.pop();
      for (const line of lines) { if(!line.startsWith('data: ')) continue; try{handleScanEvent(JSON.parse(line.slice(6)));}catch{} }
    }
  } catch(err) {
    if(err.name!=='AbortError') setScanStatus('Fehler: '+err.message,'error');
    else setScanStatus('Scan abgebrochen.','');
  }
  q('btn-scan').disabled=false; q('btn-scan-stop').style.display='none'; scanAbort=null;
}

function stopScan() { if(scanAbort){scanAbort.abort();scanAbort=null;} }

function handleScanEvent(ev) {
  if (ev.type==='start') {
    q('scan-total').textContent=ev.total;
  } else if (ev.type==='progress'||ev.type==='found') {
    const pct=ev.total>0?Math.round(ev.scanned/ev.total*100):0;
    q('scan-bar').style.width=pct+'%';
    q('scan-scanned').textContent=ev.scanned; q('scan-total').textContent=ev.total;
    if(ev.found>0) q('scan-found-lbl').textContent=`${ev.found} Gerät${ev.found!==1?'e':''} gefunden`;
    if(ev.type==='found') appendScanRow(ev.device);
    setScanStatus(`Scanne ${ev.scanned} / ${ev.total}…`,'loading');
  } else if (ev.type==='done') {
    q('scan-bar').style.width='100%';
    setScanStatus(ev.found>0?`Scan abgeschlossen — ${ev.found} Gerät${ev.found!==1?'e':''} gefunden`:`Scan abgeschlossen — keine LANCOM-Geräte gefunden`, ev.found>0?'ok':'');
    if(ev.found===0) q('tbl-scan').querySelector('tbody').innerHTML=`<tr><td colspan="8" class="empty">Keine LANCOM-Geräte gefunden</td></tr>`;
    setBadge('scanner',ev.found||0);
    if(ev.found>0){ q('btn-save-all').style.display=''; q('sep-save-all').style.display=''; q('btn-save-all').textContent=`Alle ${ev.found} speichern`; }
  }
}

function matchesImportFilter(dev) {
  const filterOS   = appSettings.filterOS   || [];
  const filterType = appSettings.filterType || [];
  if (!filterOS.length && !filterType.length) return true;
  const devOs = dev.os || '';
  // Altdaten "LCOS SX" ohne Versionsangabe passt auf jeden LCOS SX-Filter
  const osOk = !filterOS.length || filterOS.some(f =>
    f === devOs || (devOs === 'LCOS SX' && f.startsWith('LCOS SX'))
  );
  // Typvergleich via TYPE_LABELS (lx-ap und lcos-ap → "Access Point")
  const devTypeLabel = TYPE_LABELS[dev.type||''] || dev.type || '';
  const typeOk = !filterType.length || filterType.includes(devTypeLabel);
  return osOk && typeOk;
}

function appendScanRow(dev) {
  scanResults.push(dev);
  const tbody=q('tbl-scan').querySelector('tbody');
  const ph=tbody.querySelector('td[colspan]'); if(ph) ph.closest('tr').remove();
  scanFoundCnt++;
  q('cnt-scan').textContent=scanFoundCnt+' Gerät'+(scanFoundCnt!==1?'e':'');
  const devType = detectDeviceType(dev.os, dev.sysDescr);
  const scanDev = { os: dev.os, type: devType };
  const filtered = !matchesImportFilter(scanDev);
  const tr=document.createElement('tr');
  if (filtered) tr.style.opacity = '0.4';
  tr.title = filtered ? 'Kein Treffer im Import-Filter – wird bei „Alle speichern" übersprungen' : '';
  tr.innerHTML=`
    <td class="mono">${h(dev.ip)}</td>
    <td style="font-weight:600">${h(dev.sysName||'—')}</td>
    <td><span class="badge ${OS_BADGE[dev.os]||'badge-gray'}">${h(dev.os)}</span></td>
    <td><span class="badge ${TYPE_BADGE[devType]||'badge-gray'}">${h(TYPE_LABELS[devType]||devType)}</span></td>
    <td style="color:var(--text2)">${h(dev.sysLocation||'—')}</td>
    <td class="mono" style="color:var(--text3);font-size:12px">${h(dev.serial||'—')}</td>
    <td class="mono" style="color:var(--text3);font-size:11px">${h((dev.sysDescr||'').split(/[\r\n]/)[0].substring(0,55))}</td>
    <td><div style="display:flex;gap:6px">
      <button class="btn btn-sm" onclick="openDeviceDetail('${dev.ip}')">Details</button>
      <button class="btn btn-sm btn-ghost" onclick="saveScanDevice('${h(dev.ip)}')">Speichern</button>
    </div></td>`;
  tbody.appendChild(tr);
}

async function saveScanDevice(ip) {
  const dev = scanResults.find(d => d.ip === ip);
  if (!dev) return;
  if (deviceStore[ip]) {
    setScanStatus(`${ip} ist bereits unter Geräte gespeichert – nicht übernommen.`, 'error');
    return;
  }
  await saveDevice(buildScanDeviceEntry(dev));
  setScanStatus(`${dev.sysName||ip} gespeichert.`, 'ok');
}

async function saveScanResults() {
  if (!scanResults.length) return;
  const patch = {};
  const skipped = [];
  const filtered = [];
  scanResults.forEach(dev => {
    if (deviceStore[dev.ip]) { skipped.push(dev.ip); return; }
    const devType = detectDeviceType(dev.os, dev.sysDescr);
    if (!matchesImportFilter({ os: dev.os, type: devType })) { filtered.push(dev.ip); return; }
    patch[dev.ip] = buildScanDeviceEntry(dev);
  });
  const n = Object.keys(patch).length;
  if (n) await saveDevices(patch);
  let msg = n ? `${n} Gerät${n!==1?'e':''} gespeichert` : 'Keine neuen Geräte';
  if (skipped.length)  msg += ` – ${skipped.length} bereits vorhanden`;
  if (filtered.length) msg += ` – ${filtered.length} durch Import-Filter übersprungen`;
  setScanStatus(msg, !n ? 'error' : 'ok');
}

function getScanLocation() {
  const newLoc = (q('scan-loc-new')?.value||'').trim();
  if (newLoc) return newLoc;
  return q('scan-loc-select')?.value || '';
}

function buildScanDeviceEntry(dev) {
  const type = detectDeviceType(dev.os, dev.sysDescr);
  return {
    ip: dev.ip, name: dev.sysName||dev.ip, model: extractModel(dev.sysDescr),
    os: dev.os, type, mac: dev.mac||'', serial: dev.serial||'', sysDescr: dev.sysDescr,
    sysLocation: dev.sysLocation, location: getScanLocation(),
    source: 'scanner', online: true, lastSeen: new Date().toISOString(),
  };
}

document.addEventListener('keydown', e => { if(e.key==='Enter'&&e.target.id==='scan-subnet') startScan(); });

// ═══════════════════════════════════════════════════════════════════════════════
// LMC IMPORT
// ═══════════════════════════════════════════════════════════════════════════════

function setLmcStatus(msg,type='') { const el=q('lmc-status'); el.className='status-bar'+(type?' '+type:''); el.innerHTML=type==='loading'?`<span class="spinner"></span> ${msg}`:msg; }

function lmcGetToken() { return q('lmc-token').value.trim(); }

function lmcToggleSave() {
  if (q('lmc-save-token').checked) localStorage.setItem('lmc_token', lmcGetToken());
  else localStorage.removeItem('lmc_token');
}

async function lmcCall(service, apiPath, method='GET', body=null) {
  const token = lmcGetToken(); if (!token) throw new Error('Kein API Token eingegeben');
  const r = await fetch('/api/lmc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({service,path:apiPath,method,token,body})});
  let d;
  try { d = await r.json(); } catch { throw new Error(`Server-Antwort ist kein gültiges JSON (HTTP ${r.status}) – prüfe API Token`); }
  if (!r.ok || d.error) {
    const detail = d.fieldErrors?.length ? ' → ' + d.fieldErrors.map(e => `${e.field}: ${e.message} (Wert: "${e.rejectedValue}")`).join(', ') : '';
    throw new Error((d.message || d.error || `HTTP ${r.status}`) + detail);
  }
  return d;
}

async function lmcTest() {
  if (!lmcGetToken()) { setLmcStatus('Bitte API Token eingeben.','error'); return; }
  setLmcStatus('Verbindung wird getestet…','loading');
  try {
    const accounts = await lmcCall('auth','/accounts');
    const list = Array.isArray(accounts)?accounts:(accounts?.accounts||accounts?.content||[]);
    if (!list.length) throw new Error('Keine Accounts gefunden');

    const sel = q('lmc-account-select');
    sel.innerHTML='<option value="">– bitte wählen –</option>';
    list.forEach(a => {
      const name = a.name||a.identifier||a.id;
      const opt  = document.createElement('option'); opt.value=a.id||a.identifier; opt.textContent=name;
      sel.appendChild(opt);
    });
    if (list.length===1) {
      sel.value = list[0].id||list[0].identifier;
      lmcActivate(list[0].name||list[0].identifier||list[0].id);
    }
    q('lmc-project-card').style.display='';
    setLmcStatus(`Verbindung erfolgreich – ${list.length} Account${list.length!==1?'s':''} gefunden`,'ok');
    if (q('lmc-save-token').checked) localStorage.setItem('lmc_token', lmcGetToken());
  } catch(err) { setLmcStatus('Fehler: '+err.message,'error'); }
}

q('lmc-account-select').addEventListener('change', e => {
  if (e.target.value) {
    const sel = q('lmc-account-select');
    lmcActivate(sel.options[sel.selectedIndex].textContent);
  } else {
    q('lmc-tabs-wrap').style.display = 'none';
  }
});

function lmcActivate(projectName) {
  q('lmc-conn-text').textContent = `Verbunden · Projekt: ${projectName}`;
  q('lmc-conn-bar').style.display = 'flex';
  q('lmc-connect-card').style.display = 'none';
  q('lmc-project-card').style.display = 'none';
  q('lmc-tabs-wrap').style.display = '';
}

function lmcDisconnect() {
  q('lmc-conn-bar').style.display = 'none';
  q('lmc-connect-card').style.display = '';
  q('lmc-project-card').style.display = 'none';
  q('lmc-tabs-wrap').style.display = 'none';
  q('lmc-account-select').innerHTML = '<option value="">– bitte wählen –</option>';
  q('lmc-result-wrap').style.display = 'none';
  setLmcStatus('', '');
}

function showLmcTab(name) {
  ['sync','addins'].forEach(t => {
    q('lmctab-'+t)?.classList.toggle('active', t===name);
    q('lmcpanel-'+t)?.classList.toggle('active', t===name);
  });
  if (name === 'addins') loadAddins();
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADD-INS STORE
// ═══════════════════════════════════════════════════════════════════════════════

let addinList = [];
let addinStatus = {}; // key: `${os}/${filename}` → 'idle'|'uploading'|'ok'|'error'
let addinSortCol = 'name';
let addinSortDir = 1; // 1=asc, -1=desc
let addinFilterOs = '';
let addinSearch   = '';

function setAddinFilterOs(os) {
  addinFilterOs = os;
  document.querySelectorAll('.addin-os-btn').forEach(b => {
    const val = b.textContent === 'Alle' ? '' :
                b.textContent === 'LCOS LX' ? 'LCOS LX' :
                b.textContent === 'SX 3' ? 'LCOS SX 3' :
                b.textContent === 'SX 4' ? 'LCOS SX 4' :
                b.textContent === 'SX 5' ? 'LCOS SX 5' :
                b.textContent === 'FX'   ? 'LCOS FX'   : b.textContent;
    b.classList.toggle('active', val === os);
  });
  renderAddinList();
}
function setAddinSearch(val) { addinSearch = val.toLowerCase(); renderAddinList(); }
function setAddinSortCol(col) {
  if (addinSortCol === col) addinSortDir *= -1; else { addinSortCol = col; addinSortDir = 1; }
  renderAddinList();
}

const OS_BADGE_LMC = {
  'LCOS':      'badge-blue',
  'LCOS LX':   'badge-green',
  'LCOS SX 3': 'badge-yellow',
  'LCOS SX 4': 'badge-yellow',
  'LCOS SX 5': 'badge-yellow',
  'LCOS FX':   'badge-orange',
};

async function loadAddins() {
  const wrap = q('addins-list');
  if (!wrap) return;
  wrap.innerHTML = '<div class="empty"><span class="spinner"></span> Add-ins werden geladen…</div>';
  try {
    const list = await fetch('/api/addins').then(r => r.json());
    addinList = list;
    renderAddinList();
  } catch(e) {
    wrap.innerHTML = `<div class="empty" style="color:var(--red)">Fehler: ${h(e.message)}</div>`;
  }
}

function renderAddinList() {
  const wrap = q('addins-list');
  if (!addinList.length) {
    wrap.innerHTML = '<div class="empty">Keine Add-ins gefunden – lege JSON-Dateien im Ordner <code>addins/&lt;OS&gt;/</code> an</div>';
    return;
  }

  // Filter + Suche (mit Original-Index merken)
  let rows = addinList.map((a, i) => ({ a, i }));
  if (addinFilterOs) rows = rows.filter(r => r.a.os === addinFilterOs);
  if (addinSearch)   rows = rows.filter(r =>
    (r.a.name||'').toLowerCase().includes(addinSearch) ||
    (r.a.description||'').toLowerCase().includes(addinSearch) ||
    (r.a.os||'').toLowerCase().includes(addinSearch)
  );

  // Sortierung
  const keyFn = r => {
    if (addinSortCol === 'os')   return r.a.os || '';
    if (addinSortCol === 'desc') return r.a.description || '';
    return r.a.name || '';
  };
  rows.sort((a, b) => addinSortDir * keyFn(a).localeCompare(keyFn(b)));

  const arw = col => addinSortCol === col ? (addinSortDir === 1 ? ' ▲' : ' ▼') : ' ⇅';
  const th  = (col, label) =>
    `<th style="cursor:pointer;user-select:none;white-space:nowrap" onclick="setAddinSortCol('${col}')">${label}<span style="opacity:.5;font-size:10px">${arw(col)}</span></th>`;

  wrap.innerHTML = `
    <table>
      <thead><tr>
        ${th('os',   'Betriebssystem')}
        ${th('name', 'Name')}
        ${th('desc', 'Beschreibung')}
        <th>Status</th><th></th>
      </tr></thead>
      <tbody>
        ${rows.length ? rows.map(({ a, i }) => {
          const key = `${a.os}/${a.filename}`;
          const st  = addinStatus[key] || 'idle';
          const stCell = st === 'uploading' ? '<span class="spinner"></span>'
                       : st === 'ok'        ? '<span style="color:var(--green)">✓ Hochgeladen</span>'
                       : st.startsWith('err')? `<span style="color:var(--red);font-size:11px" title="${h(st.slice(4))}">✗ ${h(st.slice(4)).slice(0,40)}</span>`
                       : '';
          return `<tr>
            <td><span class="badge ${OS_BADGE_LMC[a.os]||'badge-gray'}">${h(a.os)}</span></td>
            <td style="font-weight:600">${h(a.name)}</td>
            <td style="font-size:12px;color:var(--text2)">${h(a.description||'—')}</td>
            <td id="addin-st-${i}" style="font-size:12px;min-width:100px">${stCell}</td>
            <td><div style="display:flex;gap:6px">
              <button class="btn btn-sm btn-ghost" onclick="openAddinEditor(${i})">Bearbeiten</button>
              <button class="btn btn-sm btn-ghost" onclick="uploadAddin(${i})">Hochladen</button>
              <button class="btn btn-sm btn-ghost" style="color:var(--red)" onclick="deleteAddin(${i})">Löschen</button>
            </div></td>
          </tr>`;
        }).join('') : `<tr><td colspan="5" style="text-align:center;color:var(--text3);padding:24px">Keine Treffer</td></tr>`}
      </tbody>
    </table>`;
}

function setAddinStatus(index, status) {
  const a = addinList[index];
  if (!a) return;
  const key = `${a.os}/${a.filename}`;
  addinStatus[key] = status;
  const cell = q(`addin-st-${index}`);
  if (!cell) return;
  cell.innerHTML = status === 'uploading' ? '<span class="spinner"></span>'
                 : status === 'ok'        ? '<span style="color:var(--green)">✓ Hochgeladen</span>'
                 : status.startsWith('err')? `<span style="color:var(--red);font-size:11px" title="${h(status.slice(4))}">✗ ${h(status.slice(4)).slice(0,40)}</span>`
                 : '';
}

async function uploadAddin(index) {
  const a = addinList[index];
  if (!a) return;
  const accountId = q('lmc-account-select').value;
  if (!accountId) { alert('Kein Projekt ausgewählt.'); return; }

  setAddinStatus(index, 'uploading');
  try {
    // 1. Anwendung erstellen (Name muss [a-zA-Z0-9\-]+ entsprechen)
    const safeName = (a.name || 'addin')
      .replace(/[^a-zA-Z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'addin';
    const created = await lmcCall(
      'configapplication',
      `/configapplication/accounts/${accountId}/applications`,
      'POST',
      { name: safeName, comment: a.description || '' }
    );
    const appId = created.id || created.applicationId || created.identifier;
    if (!appId) throw new Error('Keine App-ID in der Antwort: ' + JSON.stringify(created).slice(0, 120));

    // 2. Skript hochladen
    await lmcCall(
      'configapplication',
      `/configapplication/accounts/${accountId}/applications/${appId}/script`,
      'POST',
      {
        content:    a.script || '',
        lcos:       !!a.lcos,
        lcosLx:     !!a.lcosLx,
        swos:       !!a.swos,
        lcosSxSdk4: !!a.lcosSxSdk4,
        lcosSxXs:   !!a.lcosSxXs,
        lcosFx:     !!a.lcosFx,
      }
    );
    setAddinStatus(index, 'ok');
  } catch(e) {
    setAddinStatus(index, 'err:' + e.message);
    throw e; // weiterwerfen damit saveAndUploadAddin den Fehler anzeigt
  }
}

let addinEditorIndex = null;
let addinIsNew = false;

function createAddin() {
  addinEditorIndex = null;
  addinIsNew = true;
  q('addin-modal-title').textContent = 'Neues Add-in erstellen';
  q('edit-filepath').textContent = '— wird beim Speichern angelegt —';
  q('edit-name').value  = '';
  q('edit-desc').value  = '';
  document.querySelectorAll('input[name="ef-os"]').forEach((r, i) => { r.checked = i === 0; });
  q('edit-script').value = 'exports.main = function (config, context) {\n    // Dein Code hier\n};';
  q('addin-editor-status').textContent = '';
  q('addin-modal').style.display = 'flex';
  setTimeout(() => q('edit-name').focus(), 50);
}

function openAddinEditor(index) {
  const a = addinList[index];
  if (!a) return;
  addinEditorIndex = index;
  addinIsNew = false;

  q('addin-modal-title').textContent = `Add-in bearbeiten: ${a.name}`;
  q('edit-filepath').textContent = `addins/${a.os}/${a.filename}`;
  q('edit-name').value  = a.name        || '';
  q('edit-desc').value  = a.description || '';
  document.querySelectorAll('input[name="ef-os"]').forEach(r => { r.checked = r.value === a.os; });
  q('edit-script').value = a.script || '';
  q('addin-editor-status').textContent = '';
  q('addin-modal').style.display = 'flex';
  setTimeout(() => q('edit-script').focus(), 50);
}

function closeAddinEditor() {
  q('addin-modal').style.display = 'none';
  addinEditorIndex = null;
  addinIsNew = false;
}

const OS_FLAGS_MAP = {
  'LCOS':      { lcos:true,  lcosLx:false, swos:false, lcosSxSdk4:false, lcosSxXs:false, lcosFx:false },
  'LCOS LX':   { lcos:false, lcosLx:true,  swos:false, lcosSxSdk4:false, lcosSxXs:false, lcosFx:false },
  'LCOS SX 3': { lcos:false, lcosLx:false, swos:true,  lcosSxSdk4:false, lcosSxXs:false, lcosFx:false },
  'LCOS SX 4': { lcos:false, lcosLx:false, swos:false, lcosSxSdk4:true,  lcosSxXs:false, lcosFx:false },
  'LCOS SX 5': { lcos:false, lcosLx:false, swos:false, lcosSxSdk4:false, lcosSxXs:true,  lcosFx:false },
  'LCOS FX':   { lcos:false, lcosLx:false, swos:false, lcosSxSdk4:false, lcosSxXs:false, lcosFx:true  },
};

function collectEditorData() {
  const os = document.querySelector('input[name="ef-os"]:checked')?.value || 'LCOS';
  return {
    name:        q('edit-name').value.trim(),
    description: q('edit-desc').value.trim(),
    os,
    ...( OS_FLAGS_MAP[os] || {} ),
    script:      q('edit-script').value,
  };
}

function setEditorStatus(msg, ok) {
  const el = q('addin-editor-status');
  el.style.color = ok ? 'var(--green)' : 'var(--red)';
  el.textContent = msg;
}

async function saveAddin() {
  const data = collectEditorData();
  if (!data.name) { setEditorStatus('Name darf nicht leer sein.', false); return; }

  if (addinIsNew) {
    // Dateiname aus Name ableiten
    const filename = data.name.toLowerCase()
      .replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') + '.json';
    try {
      const r = await fetch('/api/addin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, ...data }),
      });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`);

      const newEntry = { ...data, filename };
      addinList.push(newEntry);
      addinEditorIndex = addinList.length - 1;
      addinIsNew = false;
      q('addin-modal-title').textContent = `Add-in bearbeiten: ${data.name}`;
      q('edit-filepath').textContent = `addins/${data.os}/${filename}`;
      renderAddinList();
      setEditorStatus('✓ Gespeichert', true);
    } catch(e) { setEditorStatus('Fehler: ' + e.message, false); }
    return;
  }

  if (addinEditorIndex === null) return;
  const a = addinList[addinEditorIndex];

  try {
    const r = await fetch('/api/addin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ originalOs: a.os, filename: a.filename, ...data }),
    });
    const d = await r.json();
    if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`);

    addinList[addinEditorIndex] = { ...a, ...data };
    q('edit-filepath').textContent = `addins/${data.os}/${a.filename}`;
    renderAddinList();
    setEditorStatus('✓ Gespeichert', true);
  } catch(e) { setEditorStatus('Fehler: ' + e.message, false); }
}

async function saveAndUploadAddin() {
  await saveAddin();
  const el = q('addin-editor-status');
  if (!el.textContent.startsWith('✓')) return; // Save fehlgeschlagen
  setEditorStatus('Wird hochgeladen…', true);
  try {
    await uploadAddin(addinEditorIndex);
    setEditorStatus('✓ Gespeichert & hochgeladen', true);
  } catch(e) { setEditorStatus('Gespeichert, Upload fehlgeschlagen: ' + e.message, false); }
}

// Tab-Taste im Editor → 4 Leerzeichen
document.addEventListener('keydown', e => {
  if (e.key === 'Tab' && document.activeElement?.id === 'edit-script') {
    e.preventDefault();
    const ta = document.activeElement;
    const s = ta.selectionStart, end = ta.selectionEnd;
    ta.value = ta.value.slice(0, s) + '    ' + ta.value.slice(end);
    ta.selectionStart = ta.selectionEnd = s + 4;
  }
  if (e.key === 'Escape' && q('addin-modal')?.style.display !== 'none') closeAddinEditor();
});

async function deleteAddin(index) {
  const a = addinList[index];
  if (!a) return;
  if (!confirm(`Add-in "${a.name}" wirklich löschen?`)) return;
  try {
    const r = await fetch('/api/addin?os=' + encodeURIComponent(a.os) + '&file=' + encodeURIComponent(a.filename), { method: 'DELETE' });
    const d = await r.json();
    if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`);
    addinList.splice(index, 1);
    renderAddinList();
  } catch(e) { alert('Fehler beim Löschen: ' + e.message); }
}

async function uploadAllAddins() {
  const btn = q('btn-upload-all-addins');
  if (btn) { btn.disabled = true; btn.textContent = 'Wird hochgeladen…'; }
  for (let i = 0; i < addinList.length; i++) {
    await uploadAddin(i);
  }
  if (btn) { btn.disabled = false; btn.textContent = 'Alle hochladen'; }
}

let lmcResults = [];  // alle vom LMC empfangenen Geräte (aufbereitet)
let lmcOnline  = {};  // ip → heartbeat-Status

async function lmcSync() {
  const accountId = q('lmc-account-select').value;
  if (!accountId) { setLmcStatus('Bitte Projekt auswählen.','error'); return; }
  setLmcStatus('Geräte werden abgerufen…','loading');
  try {
    const resp = await lmcCall('devices', `/accounts/${accountId}/devices`);
    const devs = Array.isArray(resp)?resp:(resp?.devices||resp?.content||[]);

    lmcResults = [];
    lmcOnline  = {};
    devs.forEach(d => {
      const ip = d.status?.ip||d.status?.ipAddress||d.ipAddress||'';
      if (!ip) return;
      const name    = d.name||d.label||d.status?.deviceLabel||d.status?.name||ip;
      const model   = d.status?.model||d.model||'';
      const fwLabel = (d.status?.fwLabel||d.fwLabel||'').toUpperCase();
      const devType = (d.status?.type||'').toUpperCase();
      const modelUp = model.toUpperCase();
      // OS-Erkennung via editierbare Kriterien
      let os = detectOsFromCriteria(fwLabel) || detectOsFromCriteria(modelUp);
      if (!os) {
        // Fallback: Versionsnummer aus fwLabel extrahieren, z.B. "4.00.0022" → LCOS SX 4
        if (devType==='SWITCH') {
          const v = fwLabel.match(/\b([3-9])\.\d{2}/)?.[1];
          os = v ? `LCOS SX ${v}` : 'LCOS SX 4';
        } else if (devType==='FIREWALL') os='LCOS FX';
        else os='LCOS';
      }
      const type = detectDeviceType(os, model);
      const mac    = (d.status?.mac||d.status?.ethMac||d.mac||'').toLowerCase();
      const serial = d.status?.serial||d.status?.serialNumber||d.status?.serialNum||d.serial||d.serialNumber||'';
      const location = d.siteName||d.location?.name||d.locationName||d.site?.name||d.status?.location?.name||d.status?.locationName||d.status?.location||'';
      const isOn = d.heartbeatState?.toUpperCase()==='ACTIVE'||d.status?.heartbeatState?.toUpperCase()==='ACTIVE';
      lmcOnline[ip] = isOn;
      lmcResults.push({ ip, name, model, os, type, mac, serial, location, source:'lmc', lmcId:d.id||'', lastSeen:new Date().toISOString() });
    });

    renderLmcTable();
  } catch(err) { setLmcStatus('Fehler: '+err.message,'error'); }
}

function renderLmcTable() {
  const newDevs = lmcResults.filter(d => !deviceStore[d.ip] && matchesImportFilter(d));
  const total   = lmcResults.length;
  let msg = `${total} Gerät${total!==1?'e':''} gefunden`;
  const skippedN  = lmcResults.filter(d => deviceStore[d.ip]).length;
  const filteredN = lmcResults.filter(d => !deviceStore[d.ip] && !matchesImportFilter(d)).length;
  if (skippedN)  msg += ` – ${skippedN} bereits vorhanden`;
  if (filteredN) msg += ` – ${filteredN} durch Import-Filter übersprungen`;
  setLmcStatus(msg, total ? 'ok' : '');

  q('lmc-result-wrap').style.display='';
  q('cnt-lmc').textContent = total+' Gerät'+(total!==1?'e':'');
  const hasNew = newDevs.length > 0;
  q('btn-lmc-save-all').style.display = hasNew ? '' : 'none';
  q('sep-lmc-save').style.display     = hasNew ? '' : 'none';
  if (hasNew) q('btn-lmc-save-all').textContent = `Alle ${newDevs.length} speichern`;

  const tbody = q('tbl-lmc').querySelector('tbody');
  tbody.innerHTML = lmcResults.map(dev => {
    const isSkipped  = !!deviceStore[dev.ip];
    const isFiltered = !isSkipped && !matchesImportFilter(dev);
    const isNew      = !isSkipped && !isFiltered;
    const rowStyle   = isFiltered ? ' style="opacity:0.4"' : '';
    const rowTitle   = isFiltered ? ' title="Kein Treffer im Import-Filter"' : '';
    const typCls     = TYPE_BADGE[dev.type]||'badge-gray';
    const typLbl     = TYPE_LABELS[dev.type]||'—';
    const isOn       = lmcOnline[dev.ip];
    const action     = isSkipped  ? '<span class="badge badge-yellow">Vorhanden</span>'
                     : isFiltered ? '<span class="badge badge-gray">Gefiltert</span>'
                     : `<button class="btn btn-sm btn-ghost" id="lmc-save-${h(dev.ip)}" onclick="saveLmcDevice('${h(dev.ip)}')">Speichern</button>`;
    return `<tr${rowStyle}${rowTitle}>
      <td style="font-weight:600">${h(dev.name)}</td>
      <td class="mono">${h(dev.ip)}</td>
      <td style="font-size:12px;color:var(--text2)">${h(dev.model||'—')}</td>
      <td class="mono" style="font-size:12px;color:var(--text3)">${h(dev.serial||'—')}</td>
      <td><span class="badge ${OS_BADGE[dev.os]||'badge-gray'}">${h(dev.os||'—')}</span></td>
      <td><span class="badge ${typCls}">${typLbl}</span></td>
      <td style="font-size:12px;color:var(--text2)">${h(dev.location||'—')}</td>
      <td><span class="dot ${isOn?'dot-green':'dot-red'}"></span>${isOn?'Online':'Offline'}</td>
      <td>${action}</td>
    </tr>`;
  }).join('');
}

async function saveLmcDevice(ip) {
  const dev = lmcResults.find(d => d.ip === ip);
  if (!dev) return;
  if (deviceStore[ip]) { setLmcStatus(`${ip} bereits vorhanden.`,'error'); return; }
  await saveDevice(dev);
  setLmcStatus(`${dev.name||ip} gespeichert.`,'ok');
  renderLmcTable();
}

async function saveLmcResults() {
  const patch = {};
  lmcResults.forEach(dev => {
    if (!deviceStore[dev.ip] && matchesImportFilter(dev)) patch[dev.ip] = dev;
  });
  const n = Object.keys(patch).length;
  if (!n) return;
  await saveDevices(patch);
  const msg = `${n} Gerät${n!==1?'e':''} gespeichert.`;
  setLmcStatus(msg,'ok');
  renderLmcTable();
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEVICE DETAIL VIEW
// ═══════════════════════════════════════════════════════════════════════════════

let selectedDevice = null;

function openDeviceDetail(ip) {
  const dev = deviceStore[ip] || { ip, community: appSettings.snmpReadCommunity||'public', version: appSettings.snmpVersion||'2c' };
  selectedDevice = dev;
  q('detail-ip').textContent = ip;
  q('detail-community').value = dev.community || appSettings.snmpReadCommunity || 'public';
  q('detail-version').value   = dev.version   || appSettings.snmpVersion       || '2c';
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
  showTab('detail');
  queryDetail();
}

function showStab(name) {
  document.querySelectorAll('#panel-detail .sub-panel').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('#panel-detail .stab').forEach(t=>t.classList.remove('active'));
  q('sub-'+name).classList.add('active');
  q('stab-'+name).classList.add('active');
}

async function queryDetail() {
  const ip        = q('detail-ip').textContent.trim();
  const community = q('detail-community').value.trim()||'public';
  const version   = q('detail-version').value;
  if (!ip) return;

  q('detail-main-status').className='status-bar loading';
  q('detail-main-status').innerHTML='<span class="spinner"></span> Abfrage läuft…';

  const t0=Date.now();
  const devType = selectedDevice?.type || '';
  const devOs   = selectedDevice?.os   || '';
  const needsVlan = devType === 'switch';
  const isSwitch  = devType === 'switch';
  const isLxAp    = devType === 'lx-ap';

  const [sys,ifaces,mac,wlan,lldp,vlan,ports,stp,poe,loop] = await Promise.allSettled([
    snmpQ(ip,'system'),
    snmpQ(ip,'interfaces'),
    snmpQ(ip,'mac'),
    (needsVlan && !isLxAp) ? Promise.resolve({entries:[]}) : snmpQ(ip,'wlan'),
    snmpQ(ip,'lldp'),
    needsVlan ? snmpQ(ip,'vlan',{os:devOs,devType}) : Promise.resolve(null),
    isSwitch ? snmpQ(ip,'ports') : Promise.resolve(null),
    isSwitch ? snmpQ(ip,'stp')   : Promise.resolve(null),
    isSwitch ? snmpQ(ip,'poe')   : Promise.resolve(null),
    isSwitch ? snmpQ(ip,'loop')  : Promise.resolve(null),
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
  if(!data.length){tbody.innerHTML=`<tr><td colspan="6" class="empty">Keine Interfaces</td></tr>`;return;}
  tbody.innerHTML=data.map(i=>`<tr>
    <td style="font-weight:600">${h(i.name||i.descr||'If'+i.idx)}</td>
    <td class="mono" style="color:var(--text2)">${i.name&&i.descr!==i.name?h(i.descr):''}</td>
    <td>${statusBadge(i.operStatus)}</td>
    <td style="color:var(--text2)">${fmtSpeed(i.highSpeed,i.speed)}</td>
    <td class="mono">${fmtBytes(i.inOctets)}</td>
    <td class="mono">${fmtBytes(i.outOctets)}</td>
  </tr>`).join('');
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
  if(!data.entries.length){tbody.innerHTML=`<tr><td colspan="6" class="empty">Keine WLAN-Clients</td></tr>`;return;}
  tbody.innerHTML=data.entries.map(e=>{
    const sig = e.signal ? parseInt(e.signal) : null;
    const sigBadge = sig !== null
      ? `<span class="badge ${sig>=-60?'badge-green':sig>=-75?'badge-yellow':'badge-red'}">${sig} dBm</span>`
      : '—';
    return `<tr>
      <td class="mono">${h(e.mac)}</td>
      <td class="mono" style="color:var(--text2)">${e.ip?h(e.ip):'—'}</td>
      <td>${h(e.ssid)||'—'}</td>
      <td>${e.band?`<span class="badge badge-gray">${h(e.band)}</span>`:'—'}</td>
      <td style="color:var(--text2)">${e.channel?'CH '+e.channel:'—'}</td>
      <td>${sigBadge}</td>
    </tr>`;
  }).join('');
}

function renderDetailLldp(data) {
  const tbody=q('tbl-lldp').querySelector('tbody');
  if(!data.entries.length){tbody.innerHTML=`<tr><td colspan="4" class="empty">Keine LLDP-Nachbarn</td></tr>`;return;}
  tbody.innerHTML=data.entries.map(e=>`<tr>
    <td style="font-weight:600">${h(e.localPortName)}</td>
    <td>${h(e.remSysName||'—')}</td>
    <td class="mono" style="color:var(--text2)">${h(e.remPortDesc||e.remPortId||'—')}</td>
    <td style="color:var(--text2);font-size:12px">${h((e.remSysDesc||'').split('\n')[0]||'—')}</td>
  </tr>`).join('');
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
    const data = await snmpQ(ip, 'stp');
    renderDetailStp(data);
  } catch(e) { alert('Fehler: ' + e.message); }
}

async function toggleStpAll(enable) {
  const ip = q('detail-ip').textContent.trim();
  const meta = lastStpData?._meta || { oidBase:'1.3.6.1.2.1.17.2.15.1.4', enableValue:1, disableValue:2 };
  try {
    for (const p of lastStpData?.portEntries||[])
      await snmpSet(ip, `${meta.oidBase}.${p.port}`, 'i', enable ? meta.enableValue : meta.disableValue);
    const data = await snmpQ(ip, 'stp');
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
    const data = await snmpQ(ip, 'stp');
    renderDetailStp(data);
  } catch(e) { alert('Fehler: ' + e.message); }
}

async function togglePoePort(group, port, enable) {
  const ip = q('detail-ip').textContent.trim();
  try {
    await snmpSet(ip, `1.3.6.1.2.1.105.1.1.1.3.${group}.${port}`, 'i', enable ? 1 : 2);
    const data = await snmpQ(ip, 'poe');
    renderDetailPoe(data);
  } catch(e) { alert('Fehler: ' + e.message); }
}

async function togglePoeAll(enable) {
  const ip = q('detail-ip').textContent.trim();
  const ports = lastPoeData?.portEntries || [];
  try {
    for (const p of ports) await snmpSet(ip, `1.3.6.1.2.1.105.1.1.1.3.${p.group}.${p.port}`, 'i', enable ? 1 : 2);
    const data = await snmpQ(ip, 'poe');
    renderDetailPoe(data);
  } catch(e) { alert('Fehler: ' + e.message); }
}

async function toggleLoopPort(port, enable) {
  const ip = q('detail-ip').textContent.trim();
  const meta = lastLoopData?._meta || { oidBase:'1.3.6.1.2.1.17.2.15.1.4', enableValue:1, disableValue:2 };
  try {
    await snmpSet(ip, `${meta.oidBase}.${port}`, 'i', enable ? meta.enableValue : meta.disableValue);
    const data = await snmpQ(ip, 'loop');
    renderDetailLoop(data);
  } catch(e) { alert('Fehler: ' + e.message); }
}

async function toggleLoopAll(enable) {
  const ip = q('detail-ip').textContent.trim();
  const meta = lastLoopData?._meta || { oidBase:'1.3.6.1.2.1.17.2.15.1.4', enableValue:1, disableValue:2 };
  try {
    for (const p of lastLoopData?.ports||[])
      await snmpSet(ip, `${meta.oidBase}.${p.port}`, 'i', enable ? meta.enableValue : meta.disableValue);
    const data = await snmpQ(ip, 'loop');
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
  q('poe-global').innerHTML=[
    {label:'Max. Leistung', value: m.power       ? m.power+'W'       : '—'},
    {label:'Verbrauch',     value: m.consumption ? m.consumption+'W' : '—'},
    {label:'Status',        value: m.operStatus  ? (m.operStatus==='1'?'On':'Off') : '—'},
  ].map(c=>`<div class="info-card"><div class="label">${c.label}</div><div class="value">${c.value}</div></div>`).join('');
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
  const STP_STATE = {1:'Disabled',2:'Blocking',3:'Listening',4:'Learning',5:'Forwarding',6:'Broken'};
  const STP_BADGE = {1:'badge-gray',2:'badge-orange',3:'badge-yellow',4:'badge-yellow',5:'badge-green',6:'badge-red'};
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
  tbody.innerHTML=data.ports.map(p=>{
    const stateN=parseInt(p.state);
    const enabled = p.portEnabled !== false;
    return `<tr>
      <td class="mono">${h(p.portName)}</td>
      <td><span class="badge ${STP_BADGE[stateN]||'badge-gray'}">${STP_STATE[stateN]||p.state||'—'}</span></td>
      <td><button class="btn btn-sm${enabled?' btn-danger':''}" onclick="toggleLoopPort('${p.port}',${!enabled})">${enabled?'Deaktivieren':'Aktivieren'}</button></td>
    </tr>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════════════════════════════
// NETZWERKPLAN (LLDP TOPOLOGY)
// ═══════════════════════════════════════════════════════════════════════════════

let topoNodes = {}; // id → {id,name,type,os,model,online,x,y,ghost,fixed}
let topoEdges = []; // {id,src,tgt,srcPort,dstPort}
let topoLldpMap = {}; // ip → full lldp entries (from sync)
let topoTx = 0, topoTy = 0, topoScale = 1;
let topoDragNode = null, topoPan = null, topoWasDrag = false;
let topoRootId = '', topoDetailId = null;

const NW = 190, NH = 72, HG = 230, VG = 140;
const TOPO_TYPE_BADGE = {
  switch:   {label:'SW', bg:'rgba(170,218,247,.15)', color:'#aadaf7'},
  'lx-ap':  {label:'AP', bg:'rgba(249,115,22,.15)',  color:'#f97316'},
  'lcos-ap':{label:'AP', bg:'rgba(249,115,22,.15)',  color:'#f97316'},
  router:   {label:'GW', bg:'rgba(37,99,235,.15)',   color:'#7b9fff'},
  firewall: {label:'FW', bg:'rgba(239,68,68,.15)',   color:'#ef4444'},
};

// ── Nachbar-Matching ──────────────────────────────────────────────────────────
function resolveTopoNeighbor(entry) {
  const sysName = (entry.remSysName||'').toLowerCase();
  const remMac  = (entry.remMac||'').toLowerCase();
  for (const d of Object.values(deviceStore)) {
    if (sysName && (d.name||'').toLowerCase() === sysName) return d.ip;
    if (remMac) {
      if ((d.mac||'').toLowerCase() === remMac) return d.ip;
      if (d.macs?.some(m => m.toLowerCase() === remMac)) return d.ip;
    }
  }
  if (sysName) {
    for (const d of Object.values(deviceStore)) {
      const dn = (d.name||'').toLowerCase();
      if (dn && (dn.includes(sysName) || sysName.includes(dn))) return d.ip;
    }
  }
  return null;
}

// ── Graph aufbauen ────────────────────────────────────────────────────────────
function buildTopoGraph(lldpMap) {
  topoNodes = {}; topoEdges = [];

  Object.values(deviceStore).filter(d => {
    if (d.online === false) return false;
    if (topoLocFilter !== 'all' && (d.location||'') !== topoLocFilter) return false;
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
    entries.forEach(e => {
      const tgtIp = resolveTopoNeighbor(e);
      let tgtId = tgtIp;
      if (!tgtIp) {
        tgtId = 'ghost_' + (e.remSysName || e.remMac || 'unknown').replace(/[^a-z0-9]/gi,'_');
        if (!topoNodes[tgtId]) {
          topoNodes[tgtId] = {
            id: tgtId, name: e.remSysName||e.remPortId||'Unbekannt', type:'unknown',
            os:'', model:'', online: undefined, ghost: true, x: 0, y: 0, fixed: false,
          };
        }
      }
      const edgeKey = [srcIp, tgtId].sort().join('||');
      if (edgeSet.has(edgeKey)) {
        const ex = topoEdges.find(ed => ed.id === edgeKey);
        if (ex && ex.src === tgtId && !ex.dstPort) ex.dstPort = e.localPortName;
        if (ex && ex.src === srcIp && !ex.dstPort) ex.dstPort = e.remPortId||e.remPortDesc||'';
      } else {
        edgeSet.add(edgeKey);
        topoEdges.push({ id:edgeKey, src:srcIp, tgt:tgtId,
          srcPort: e.localPortName||'', dstPort: e.remPortId||e.remPortDesc||'' });
      }
    });
  });
}

// ── BFS Tree Layout ───────────────────────────────────────────────────────────
function layoutTopo(rootId) {
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

  return { level, byLevel, unconnected, maxLvl };
}

// ── Root selector ─────────────────────────────────────────────────────────────
function buildTopoSelector() {
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

function topoChangeRoot() {
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

// ── Render ────────────────────────────────────────────────────────────────────
function renderTopoSvg() {
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

  const tt = topoTheme();

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

    const color = edgeColor(e, bothOnline, ghost);
    const w = ghost ? 1.5 : 2;
    const disconnected = e.type ? e.connected === false : !bothOnline;
    const dash = (ghost || disconnected) ? ' stroke-dasharray="5,4"' : '';
    svg += `<path d="M${fs.x.toFixed(1)},${fs.y.toFixed(1)} C${fs.x.toFixed(1)},${midY} ${te.x.toFixed(1)},${midY} ${te.x.toFixed(1)},${te.y.toFixed(1)}" stroke="${color}" stroke-width="${w}" fill="none"${dash}/>`;

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
      svg += `<g opacity="0.65" onclick="topoNodeClick('${h(node.id)}')">
        <rect x="${rx}" y="${ry}" width="${NW}" height="${NH}" rx="8" fill="${tt.ghostBg}" stroke="${tt.ghostBorder}" stroke-width="1.5" stroke-dasharray="6,4"/>
        <text x="${rx+NW/2}" y="${ry+25}" text-anchor="middle" font-size="12" font-weight="600" fill="${tt.ghostText}" font-family="system-ui,sans-serif">${h(dn)}</text>
        <text x="${rx+NW/2}" y="${ry+42}" text-anchor="middle" font-size="9" fill="${tt.ghostSub}" font-family="system-ui,sans-serif" font-style="italic">nicht verwaltet</text>
      </g>`;
      return;
    }

    const dotColor    = node.online===true ? tt.dotOnline    : node.online===false ? tt.dotOffline    : tt.dotUnknown;
    const borderColor = node.online===true ? tt.borderOnline : node.online===false ? tt.borderOffline : tt.borderUnknown;
    const bgFill      = node.online===true ? tt.bgOnline : node.online===false ? tt.bgOffline : tt.bgUnknown;
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

  q('topo-g').innerHTML = svg;
}

// ── Detail panel ──────────────────────────────────────────────────────────────
function topoNodeClick(id) {
  if (topoWasDrag) { topoWasDrag = false; return; }
  topoOpenDetail(id);
}

function topoOpenDetail(id) {
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

  if (!html) html = `<p style="color:var(--text3);font-size:12px">Keine LLDP-Daten verfügbar.<br>LLDP Sync starten um Verbindungen zu laden.</p>`;
  q('topo-detail-content').innerHTML = html;
  q('topo-detail').style.display = 'flex';
}

function topoCloseDetail() { q('topo-detail').style.display='none'; topoDetailId=null; }

function topoSetRootFromDetail() {
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
function topoNodeDragStart(e, id) {
  e.stopPropagation();
  const pt = topoSvgPt(e), n = topoNodes[id];
  if (!n) return;
  topoDragNode = { id, ox:pt.x-n.x, oy:pt.y-n.y };
  topoWasDrag = false;
}
function topoBgDragStart(e) {
  if (topoDragNode) return;
  topoPan = { sx:e.clientX, sy:e.clientY, tx:topoTx, ty:topoTy };
}
function topoMouseMove(e) {
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
function topoMouseUp()  { topoDragNode = null; topoPan = null; }
function topoWheel(e) {
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
function topoZoom(factor) {
  topoScale = Math.max(0.1, Math.min(5, topoScale * factor));
  const g = document.getElementById('topo-g');
  if (g) g.setAttribute('transform', `translate(${topoTx},${topoTy}) scale(${topoScale})`);
}
function topoFit() {
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
async function syncWdsAll() {
  const btn = q('btn-wds-sync');
  const st  = q('dev-sync-status');
  const lxDevs = Object.values(deviceStore).filter(d => d.type === 'lx-ap' && d.online !== false && matchesLocFilter(d));
  if (!lxDevs.length) {
    st.className = 'status-bar error';
    st.textContent = devLocFilter !== 'all' ? `Keine online LX APs im Standort „${devLocFilter}".` : 'Keine online LX Access Points – bitte zuerst "Status" ausführen.'; return;
  }
  btn.disabled = true;
  st.className = 'status-bar loading';
  meshData = [];
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
    await fetch('/api/devices', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(deviceStore) });
    st.className = 'status-bar ok';
    st.textContent = `WDS abgeschlossen – ${meshData.length} Verbindungen.`;
    renderDevices(); renderMesh();
  } catch (e) {
    st.className = 'status-bar error';
    st.textContent = `Fehler: ${e.message}`;
  } finally {
    btn.disabled = false; btn.textContent = 'WDS';
  }
}

// ── L2TPv3 Sync (Geräte-Tab) ──────────────────────────────────────────────────
async function syncL2tpAll() {
  const btn = q('btn-l2tp-sync2');
  const st  = q('dev-sync-status');
  const lxDevs = Object.values(deviceStore).filter(d => d.type === 'lx-ap' && d.online !== false && matchesLocFilter(d));
  if (!lxDevs.length) {
    st.className = 'status-bar error';
    st.textContent = devLocFilter !== 'all' ? `Keine online LX APs im Standort „${devLocFilter}".` : 'Keine online LX Access Points – bitte zuerst "Status" ausführen.'; return;
  }
  btn.disabled = true;
  st.className = 'status-bar loading';
  l2tpData = [];
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
    await fetch('/api/devices', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(deviceStore) });
    st.className = 'status-bar ok';
    st.textContent = `L2TPv3 abgeschlossen – ${l2tpData.length} Endpunkte.`;
    renderDevices(); renderL2tp();
  } catch (e) {
    st.className = 'status-bar error';
    st.textContent = `Fehler: ${e.message}`;
  } finally {
    btn.disabled = false; btn.textContent = 'L2TPv3';
  }
}

// ── All-in-one sync for Netzwerkplan ─────────────────────────────────────────
async function syncTopologyAll() {
  const btn = q('btn-topo-sync-all');
  const st  = q('dev-sync-status');
  const allDevs = Object.values(deviceStore).filter(matchesLocFilter);
  if (!allDevs.length) {
    st.className = 'status-bar error';
    st.textContent = devLocFilter !== 'all' ? `Keine Geräte im Standort „${devLocFilter}".` : 'Keine Geräte gespeichert – bitte zuerst Geräte importieren.';
    return;
  }

  btn.disabled = true; btn.textContent = '⟳ Läuft…';
  st.className = 'status-bar loading';

  try {
    // ── Phase 1: Online/Offline-Status für alle Geräte prüfen ────────────────
    st.innerHTML = `<span class="spinner"></span> Phase 1/5: Status prüfen – 0 / ${allDevs.length}`;
    let done = 0;

    async function checkStatus(dev) {
      try {
        await snmpQ(dev.ip, 'ping');
        if (deviceStore[dev.ip]) deviceStore[dev.ip].online = true;
      } catch {
        if (deviceStore[dev.ip]) deviceStore[dev.ip].online = false;
      }
      done++;
      st.innerHTML = `<span class="spinner"></span> Phase 1/5: Status prüfen – ${done} / ${allDevs.length} – ${h(dev.name||dev.ip)}`;
      renderDevices();
    }
    const CONC_STATUS = 5;
    for (let i = 0; i < allDevs.length; i += CONC_STATUS) {
      await Promise.all(allDevs.slice(i, i + CONC_STATUS).map(checkStatus));
    }

    // ── Phase 2: WiFi Mesh (nur lx-ap, nur online) ───────────────────────────
    const lxOnline = Object.values(deviceStore).filter(d => d.type === 'lx-ap' && d.online === true && matchesLocFilter(d));
    meshData = [];
    done = 0;
    st.innerHTML = `<span class="spinner"></span> Phase 2/5: WiFi Mesh – 0 / ${lxOnline.length}`;

    async function syncWds(dev) {
      try {
        const result = await snmpQ(dev.ip, 'wds');
        if (result.configured) mergeMeshResult(dev.ip, dev.name||dev.ip, result);
      } catch {}
      done++;
      st.innerHTML = `<span class="spinner"></span> Phase 2/5: WiFi Mesh – ${done} / ${lxOnline.length} – ${h(dev.name||dev.ip)}`;
    }
    const CONC_WDS = 4;
    for (let i = 0; i < lxOnline.length; i += CONC_WDS) {
      await Promise.all(lxOnline.slice(i, i + CONC_WDS).map(syncWds));
    }

    // ── Phase 3: L2TPv3 (nur lx-ap, nur online) ─────────────────────────────
    l2tpData = [];
    done = 0;
    st.innerHTML = `<span class="spinner"></span> Phase 3/5: L2TPv3 – 0 / ${lxOnline.length}`;

    async function syncL2tpDev(dev) {
      try {
        const result = await snmpQ(dev.ip, 'l2tp');
        if (result.configured) mergeL2tpResult(dev.ip, dev.name||dev.ip, result);
      } catch {}
      done++;
      st.innerHTML = `<span class="spinner"></span> Phase 3/5: L2TPv3 – ${done} / ${lxOnline.length} – ${h(dev.name||dev.ip)}`;
    }
    const CONC_L2TP = 4;
    for (let i = 0; i < lxOnline.length; i += CONC_L2TP) {
      await Promise.all(lxOnline.slice(i, i + CONC_L2TP).map(syncL2tpDev));
    }

    // ── Phase 4: LLDP – identisch mit "LLDP Sync" unter Geräte ──────────────
    const onlineDevs = Object.values(deviceStore).filter(d => d.online !== false && matchesLocFilter(d));
    st.innerHTML = `<span class="spinner"></span> Phase 4/5: LLDP – 0 / ${onlineDevs.length}`;
    await lldpSyncCore(onlineDevs, (d, total, dev) => {
      st.innerHTML = `<span class="spinner"></span> Phase 4/5: LLDP – ${d} / ${total} – ${h(dev.name||dev.ip)}`;
    });

    // ── Phase 5: MAC-Adressen ─────────────────────────────────────────────────
    done = 0;
    st.innerHTML = `<span class="spinner"></span> Phase 5/5: MAC-Adressen – 0 / ${onlineDevs.length}`;
    const macQueue = [...onlineDevs];
    async function macWorker() {
      while (macQueue.length) {
        const dev = macQueue.shift();
        try {
          const result = await snmpQ(dev.ip, 'ifmacs');
          if (deviceStore[dev.ip] && result.macs?.length) deviceStore[dev.ip].macs = result.macs;
        } catch {}
        done++;
        st.innerHTML = `<span class="spinner"></span> Phase 5/5: MAC-Adressen – ${done} / ${onlineDevs.length} – ${h(dev.name||dev.ip)}`;
      }
    }
    await Promise.all(Array(Math.min(3, onlineDevs.length || 1)).fill(null).map(macWorker));

    // ── Speichern ────────────────────────────────────────────────────────────
    st.innerHTML = `<span class="spinner"></span> Daten werden gespeichert…`;
    try {
      await fetch('/api/devices', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(deviceStore) });
    } catch (e) {
      console.error('Fehler beim Speichern:', e);
    }

    st.className = 'status-bar ok';
    st.textContent = 'Sync abgeschlossen.';
    renderDevices();
    renderMesh();
    renderL2tp();
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
function buildTopoFromStore() {
  // LLDP edges
  topoLldpMap = {};
  Object.values(deviceStore).forEach(dev => {
    if (dev.lldpData?.length) topoLldpMap[dev.ip] = dev.lldpData;
  });
  buildTopoGraph(topoLldpMap); // builds nodes + LLDP edges

  // Track all existing edge pairs (both directions)
  const existingPairs = new Set(topoEdges.map(e => [e.src, e.tgt].sort().join('||')));

  // WDS / Mesh edges
  const edgeIdSet = new Set(topoEdges.map(e => e.id));
  let wdsCnt = 0;
  Object.values(deviceStore).forEach(dev => {
    (dev.wdsLinks||[]).forEach(link => {
      if (!link.mac) return;
      const peerDev = resolvePeerDev(link.mac);
      if (!peerDev || peerDev.ip === dev.ip) return;
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
  Object.values(deviceStore).forEach(dev => {
    (dev.l2tpEndpoints||[]).forEach(ep => {
      const remoteIp = ep.remoteIp;
      if (!remoteIp || remoteIp === dev.ip) return;
      if (!topoNodes[remoteIp]) {
        const rd = deviceStore[remoteIp];
        topoNodes[remoteIp] = {
          id: remoteIp, name: rd ? (rd.name||remoteIp) : remoteIp,
          type: rd?.type||'unknown', os: rd?.os||'', model: rd?.model||'',
          location: rd?.location||'', online: rd ? rd.online : false, ghost: !rd, x: 0, y: 0, fixed: false,
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
  const devWithLldp = Object.values(deviceStore).filter(d => d.lldpData?.length).length;
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

// ═══════════════════════════════════════════════════════════════════════════════
// TAB NAVIGATION
// ═══════════════════════════════════════════════════════════════════════════════

function showTab(name) {
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
  const tab=q('tab-'+name); if(tab) tab.classList.add('active');
  const panel=q('panel-'+name); if(panel) panel.classList.add('active');
  if(name !== 'detail') { q('detail-badge').style.display='none'; }
  if(name==='devices')  renderDevices();
  if(name==='topology') buildTopoFromStore();
  if(name==='sdn')      showSdnTab('vlan');
}

// ═══════════════════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════════════════

(async function init() {
  initTheme();
  fetch('/api/version').then(r=>r.json()).then(d=>{ const el=q('version-tag'); if(el) el.textContent=d.version; }).catch(()=>{});
  await loadSettings();
  await loadCriteria();
  await loadVlans();
  await loadDevices();
  // Restore LMC token if saved
  const savedToken = localStorage.getItem('lmc_token');
  if (savedToken) { q('lmc-token').value=savedToken; q('lmc-save-token').checked=true; }
  // URL params
  const p = new URLSearchParams(location.search);
  if (p.get('host')) openDeviceDetail(p.get('host'));
})();
