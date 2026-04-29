import S from '../lib/state.js';
import { q, h, extractModel, OS_BADGE, TYPE_LABELS, TYPE_BADGE } from '../lib/helpers.js';
import { detectOsFromCriteriaForLmc, inferLmcDeviceType, detectDeviceType } from '../criteria.js';

// ═══════════════════════════════════════════════════════════════════════════════
// LMC IMPORT
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// ROLLOUT SCAN
// ═══════════════════════════════════════════════════════════════════════════════

let rolloutFoundCnt = 0;

function runWsScan(type, subnet, onEvent, onError, signal) {
  return new Promise(resolve => {
    const wsProto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${wsProto}://${location.host}/ws`);
    ws.onopen = () => ws.send(JSON.stringify({ type, subnet }));
    ws.onmessage = ({ data }) => { try { onEvent(JSON.parse(data)); } catch {} };
    ws.onerror = () => onError('WebSocket-Fehler', 'error');
    ws.onclose = () => resolve();
    signal.addEventListener('abort', () => { ws.close(); onError('Scan abgebrochen.', ''); resolve(); }, { once: true });
  });
}

export function matchesImportFilter(dev) {
  const filterOS   = S.appSettings.filterOS   || [];
  const filterType = S.appSettings.filterType || [];
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

function getScanLocation() {
  const newLoc = (q('scan-loc-new')?.value||'').trim();
  if (newLoc) return newLoc;
  return q('scan-loc-select')?.value || '';
}

function buildScanDeviceEntry(dev) {
  const type = detectDeviceType(dev.os, dev.sysDescr);
  return {
    ip: dev.ip, name: dev.sysName||dev.lcosLxName||extractModel(dev.sysDescr)||dev.ip, model: extractModel(dev.sysDescr)||dev.lcosLxName||'',
    os: dev.os, type, mac: dev.mac||'', serial: dev.serial||'', sysDescr: dev.sysDescr,
    sysLocation: dev.sysLocation, location: getScanLocation(),
    source: 'scanner', online: true, lastSeen: new Date().toISOString(),
  };
}

export function setRolloutStatus(msg, type='') {
  const el = q('rollout-status');
  el.className = 'status-bar' + (type ? ' ' + type : '');
  el.innerHTML = type === 'loading' ? `<span class="spinner"></span> ${msg}` : msg;
}

export async function startRolloutScan() {
  const subnet = q('rollout-subnet').value.trim();
  if (!subnet) { setRolloutStatus('Bitte Subnetz eingeben.', 'error'); return; }

  S.appSettings.lastRolloutSubnet = subnet;
  fetch('/api/settings', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({...S.appSettings}) }).catch(()=>{});

  if (S.rolloutScanAbort) { S.rolloutScanAbort.abort(); S.rolloutScanAbort = null; }
  S.rolloutScanAbort = new AbortController();
  rolloutFoundCnt = 0;

  q('btn-rollout').disabled = true;
  q('btn-rollout-stop').style.display = '';
  q('tbl-rollout').querySelector('tbody').innerHTML = '';
  q('cnt-rollout').textContent = '';
  q('rollout-found-lbl').textContent = '';
  q('btn-rollout-all').style.display = 'none';
  q('rollout-progress-wrap').style.display = '';
  q('rollout-bar').style.width = '0%';
  q('rollout-progress-lbl').textContent = 'Suche läuft…';
  setRolloutStatus('Scan läuft…', 'loading');

  const myAbort = S.rolloutScanAbort;
  await runWsScan('rollout-scan', subnet, handleRolloutEvent, setRolloutStatus, myAbort.signal);
  q('btn-rollout').disabled = false;
  q('btn-rollout-stop').style.display = 'none';
  S.rolloutScanAbort = null;
}

export function stopRolloutScan() { if (S.rolloutScanAbort) { S.rolloutScanAbort.abort(); S.rolloutScanAbort = null; } }

export async function rolloutAll() {
  const rows = [...q('tbl-rollout').querySelectorAll('tbody tr[data-ip]')]
    .filter(tr => tr.querySelector('button.btn'));  // nur Zeilen mit Rollout-Button (= unbekannte Geräte)
  if (!rows.length) return;
  const btn = q('btn-rollout-all');
  btn.disabled = true;
  btn.textContent = `⏳ 0/${rows.length} fertig`;
  let done = 0;
  await Promise.all(rows.map(async (tr) => {
    const ip     = tr.dataset.ip;
    const os     = tr.dataset.os;
    const mac    = tr.dataset.mac;
    const rowBtn = tr.querySelector('button.btn');
    if (!rowBtn) return;
    await rolloutSetPassword(ip, os, mac, rowBtn);
    done++;
    btn.textContent = `⏳ ${done}/${rows.length} fertig`;
  }));
  btn.disabled = false;
  btn.textContent = '▶ Alle';
}

function handleRolloutEvent(ev) {
  if (ev.type === 'found') {
    appendRolloutRow(ev.device);
    q('rollout-found-lbl').textContent = rolloutFoundCnt + ' gefunden';
  } else if (ev.type === 'progress') {
    q('rollout-progress-lbl').textContent = `Suche läuft… ${ev.scanned} / ${ev.total} IPs geprüft`;
    q('rollout-bar').style.width = Math.round(ev.scanned / ev.total * 100) + '%';
  } else if (ev.type === 'done') {
    q('rollout-bar').style.width = '100%';
    q('rollout-progress-lbl').textContent = 'Scan abgeschlossen';
    setRolloutStatus(
      rolloutFoundCnt > 0
        ? `Scan abgeschlossen — ${rolloutFoundCnt} LANCOM-Gerät${rolloutFoundCnt !== 1 ? 'e' : ''} gefunden`
        : 'Scan abgeschlossen — keine LANCOM-Geräte gefunden',
      rolloutFoundCnt > 0 ? 'ok' : ''
    );
    if (rolloutFoundCnt === 0) {
      q('tbl-rollout').querySelector('tbody').innerHTML = `<tr><td colspan="6" class="empty">Keine LANCOM-Geräte gefunden</td></tr>`;
    }
  }
}

function appendRolloutRow(dev) {
  const tbody = q('tbl-rollout').querySelector('tbody');
  const ph = tbody.querySelector('td[colspan]'); if (ph) ph.closest('tr').remove();
  rolloutFoundCnt++;
  q('cnt-rollout').textContent = rolloutFoundCnt + ' Gerät' + (rolloutFoundCnt !== 1 ? 'e' : '');
  const normMac = m => (m||'').replace(/[:\-\. ]/g,'').toLowerCase();
  const mac = normMac(dev.mac);
  const knownDev = Object.values(S.deviceStore).find(d =>
    d.ip === dev.ip || (mac && normMac(d.mac) === mac)
  );
  const known = !!knownDev;
  const rowId = 'rrow-' + dev.ip.replace(/\./g, '-');
  const tr = document.createElement('tr');
  tr.id = rowId;
  tr.dataset.ip  = dev.ip;
  tr.dataset.os  = dev.os  || '';
  tr.dataset.mac = dev.mac || '';
  if (known) tr.style.cssText = 'background:rgba(34,197,94,.07)';
  if (!known) q('btn-rollout-all').style.display = '';
  tr.innerHTML = `
    <td style="font-family:var(--mono);font-size:12px">
      ${h(dev.ip)}
      ${known ? `<span style="font-size:9px;background:rgba(34,197,94,.15);color:#22c55e;border-radius:3px;padding:1px 5px;margin-left:5px" title="${h(knownDev.name||dev.ip)}">✓ bekannt</span>` : ''}
    </td>
    <td style="font-family:var(--mono);font-size:12px;color:var(--accent)">${h(dev.mac)}</td>
    <td style="font-size:12px;color:var(--text2)">${h(dev.vendor || 'LANCOM Systems')}</td>
    <td style="font-size:12px;color:var(--text3)">${h(dev.hostname || '–')}</td>
    <td>${dev.os ? `<span class="badge ${OS_BADGE[dev.os]||'badge-gray'}">${h(dev.os)}</span>` : '<span style="font-size:11px;color:var(--text3)">–</span>'}</td>
    <td>
      ${!known ? `<button class="btn btn-sm" onclick="rolloutSetPassword('${dev.ip}', '${h(dev.os||'')}', '${h(dev.mac||'')}', this)" style="white-space:nowrap">Rollout</button>` : ''}
    </td>`;
  tbody.appendChild(tr);
}

export async function rolloutSetPassword(ip, os, mac, btn) {
  if (!S.appSettings.devicePassword) {
    alert('Kein Gerätepasswort in den Einstellungen gespeichert.');
    return;
  }
  const statusEl = btn.parentElement;
  btn.disabled = true;
  btn.textContent = '⏳';
  try {
    const r = await fetch('/api/rollout/set-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip, os, mac }),
    });
    const d = await r.json();
    const logHtml = d.log
      ? `<details style="margin-top:4px"><summary style="font-size:10px;color:var(--text3);cursor:pointer">Log</summary><pre style="font-size:10px;font-family:var(--mono);color:var(--text2);white-space:pre-wrap;margin:4px 0 0;padding:6px;background:var(--bg2);border-radius:4px">${h(d.log)}</pre></details>`
      : '';
    let scriptHtml = '';
    if (d.scriptResults && d.scriptResults.length) {
      const r0 = d.scriptResults[0];
      const cmdCount = r0?.combined ? r0.commands.length : d.scriptResults.length;
      if (cmdCount > 0) {
        const raw = window.renderScriptOutputHtml?.(d.scriptResults, ip);
        const body = raw ? raw.replace(/^<pre[^>]*>/, '').replace(/<\/pre>$/, '') : '';
        scriptHtml = `<details open style="margin-top:4px"><summary style="font-size:10px;color:var(--accent);cursor:pointer;font-weight:600">ROLLOUT-Script Ausgabe</summary><pre style="font-size:10px;font-family:var(--mono);color:var(--text1);white-space:pre-wrap;margin:4px 0 0;padding:6px;background:var(--bg2);border-radius:4px">${body}</pre></details>`;
      }
    }
    if (d.ok) {
      let savedOk = false;
      if (d.snmpDevice) {
        const entry = buildScanDeviceEntry(d.snmpDevice);
        await window.saveDevice?.(entry);
        await window.loadDevices?.();
        window.renderDevices?.();
        savedOk = true;
      }
      const savedBadge = savedOk ? ` <span style="font-size:10px;background:rgba(34,197,94,.15);color:#22c55e;border-radius:3px;padding:1px 5px">✓ in Geräteliste</span>` : '';
      statusEl.innerHTML = (d.alreadySet
        ? `<span style="color:var(--green);font-size:11px">✓ Passwort bereits gesetzt (${h(d.user)})</span>`
        : `<span style="color:var(--green);font-size:11px">✓ Passwort gesetzt (${h(d.user)})</span>`) + savedBadge + scriptHtml + logHtml;
    } else {
      statusEl.innerHTML = `<span style="color:var(--red);font-size:11px">✗ ${h(d.error || 'Fehlgeschlagen')}</span>` + logHtml;
    }
  } catch (e) {
    statusEl.innerHTML = `<span style="color:var(--red);font-size:11px">✗ ${h(e.message)}</span>`;
  }
}

export function setLmcStatus(msg,type='') {
  const connectCard = q('lmc-connect-card');
  const elId = (connectCard && connectCard.style.display !== 'none') ? 'lmc-connect-status' : 'lmc-status';
  const el = q(elId) || q('lmc-status');
  if (!el) return;
  el.className='status-bar'+(type?' '+type:''); el.innerHTML=type==='loading'?`<span class="spinner"></span> ${msg}`:msg;
}

function lmcGetToken() { return q('lmc-token').value.trim(); }
function lmcGetHost()  { const el = q('lmc-host'); return (el ? el.value.trim() : '') || 'cloud.lancom.de'; }

export function lmcToggleSave() {
  if (q('lmc-save-token').checked) localStorage.setItem('lmc_token', lmcGetToken());
  else localStorage.removeItem('lmc_token');
}

export async function lmcCall(service, apiPath, method='GET', body=null) {
  const token = lmcGetToken(); if (!token) throw new Error('Kein API Token eingegeben');
  const host  = lmcGetHost();
  const r = await fetch('/api/lmc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({service,path:apiPath,method,token,body,host})});
  // 204 No Content (z.B. bei DELETE) → kein JSON-Body erwartet
  if (r.status === 204) return {};
  let d;
  try { const t = await r.text(); d = t ? JSON.parse(t) : {}; }
  catch { throw new Error(`Server-Antwort ist kein gültiges JSON (HTTP ${r.status}) – prüfe API Token`); }
  if (!r.ok || d.error) {
    const detail = d.fieldErrors?.length ? ' → ' + d.fieldErrors.map(e => `${e.field}: ${e.message} (Wert: "${e.rejectedValue}")`).join(', ') : '';
    throw new Error((d.message || d.error || `HTTP ${r.status}`) + detail);
  }
  return d;
}

export async function lmcTest() {
  if (!lmcGetToken()) { setLmcStatus('Bitte API Token eingeben.','error'); return; }
  setLmcStatus('Verbindung wird getestet…','loading');
  try { S.appSettings.lmcHost = lmcGetHost(); fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(S.appSettings)}).catch(()=>{}); } catch(_) {}
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

q('lmc-account-select')?.addEventListener('change', e => {
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

export function lmcDisconnect() {
  q('lmc-conn-bar').style.display = 'none';
  q('lmc-connect-card').style.display = '';
  q('lmc-project-card').style.display = 'none';
  q('lmc-tabs-wrap').style.display = 'none';
  q('lmc-account-select').innerHTML = '<option value="">– bitte wählen –</option>';
  q('lmc-result-wrap').style.display = 'none';
  setLmcStatus('', '');
}

export function showLmcTab(name) {
  ['sync','addins','vars','activation'].forEach(t => {
    q('lmctab-'+t)?.classList.toggle('active', t===name);
    q('lmcpanel-'+t)?.classList.toggle('active', t===name);
  });
  if (name === 'addins') window.loadAddins?.();
  if (name === 'vars') { window.renderGlobalVarsList?.(); window.fetchGlobalVars?.().then(() => window.renderGlobalVarsList?.()); }
  if (name === 'activation') window.loadActivationTokens?.();
}

// ── LMC Sync / Save ───────────────────────────────────────────────────────────

let lmcResults = [];  // alle vom LMC empfangenen Geräte (aufbereitet)
let lmcOnline  = {};  // ip → heartbeat-Status

export async function lmcSync() {
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
      const devType = (d.status?.type||d.type||'').toUpperCase();
      const modelUp = model.toUpperCase();
      const nameUp  = (name || '').toUpperCase();
      // OS: längere Zeichenkette (fw + Modell + Name), ohne Ein-Zeichen-False-Positives aus criteria
      const blob = [fwLabel, modelUp, nameUp].filter(Boolean).join(' · ');
      let os = detectOsFromCriteriaForLmc(blob) || detectOsFromCriteriaForLmc(modelUp);
      if (!os) {
        if (devType === 'SWITCH' || devType.includes('SWITCH')) {
          const v = fwLabel.match(/\b([3-9])\.\d{2}/)?.[1];
          os = v ? `LCOS SX ${v}` : 'LCOS SX 4';
        } else if (devType === 'FIREWALL' || devType === 'UTM') os = 'LCOS FX';
        else if (devType.includes('ACCESS') || devType === 'AP' || devType.includes('WLAN') || devType.includes('WIFI')) {
          os = modelUp.includes('LINUX') || fwLabel.includes('LCOS LX') ? 'LCOS LX' : 'LCOS';
        } else os = 'LCOS';
      }
      const type = inferLmcDeviceType(os, model, devType);
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
  const newDevs = lmcResults.filter(d => !S.deviceStore[d.ip] && matchesImportFilter(d));
  const total   = lmcResults.length;
  let msg = `${total} Gerät${total!==1?'e':''} gefunden`;
  const skippedN  = lmcResults.filter(d => S.deviceStore[d.ip]).length;
  const filteredN = lmcResults.filter(d => !S.deviceStore[d.ip] && !matchesImportFilter(d)).length;
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
    const isSkipped  = !!S.deviceStore[dev.ip];
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

export async function saveLmcDevice(ip) {
  const dev = lmcResults.find(d => d.ip === ip);
  if (!dev) return;
  if (S.deviceStore[ip]) { setLmcStatus(`${ip} bereits vorhanden.`,'error'); return; }
  await window.saveDevice?.(dev);
  setLmcStatus(`${dev.name||ip} gespeichert.`,'ok');
  renderLmcTable();
}

export async function saveLmcResults() {
  const patch = {};
  lmcResults.forEach(dev => {
    if (!S.deviceStore[dev.ip] && matchesImportFilter(dev)) patch[dev.ip] = dev;
  });
  const n = Object.keys(patch).length;
  if (!n) return;
  await window.saveDevices?.(patch);
  const msg = `${n} Gerät${n!==1?'e':''} gespeichert.`;
  setLmcStatus(msg,'ok');
  renderLmcTable();
}

// ── Scan Device Save/Update (für Scanner-Tabelle) ──────────────────────────────

export async function saveScanDevice(ip) {
  const dev = S.scanResults.find(d => d.ip === ip);
  if (!dev) return;
  if (S.deviceStore[ip]) {
    window.setScanStatus?.(`${ip} ist bereits unter Geräte gespeichert – nicht übernommen.`, 'error');
    return;
  }
  await window.saveDevice?.(buildScanDeviceEntry(dev));
  window.setScanStatus?.(`${dev.sysName||ip} gespeichert.`, 'ok');
}

export async function updateScanDevice(ip) {
  const dev = S.scanResults.find(d => d.ip === ip);
  if (!dev || !dev.serial) {
    window.setScanStatus?.(`Kein Update möglich – keine Seriennummer für ${ip}`, 'error');
    return;
  }
  const existing = Object.values(S.deviceStore).find(d => d.serial && d.serial === dev.serial);
  if (!existing) {
    window.setScanStatus?.(`Kein bestehendes Gerät mit Seriennummer ${dev.serial} gefunden`, 'error');
    return;
  }
  const newEntry = buildScanDeviceEntry(dev);
  newEntry.location = existing.location || newEntry.location;
  if (existing.ip !== dev.ip) await window.deleteDevice?.(existing.ip);
  await window.saveDevice?.({ ...existing, ...newEntry });
  window.setScanStatus?.(`${dev.sysName||ip} aktualisiert.`, 'ok');
}
