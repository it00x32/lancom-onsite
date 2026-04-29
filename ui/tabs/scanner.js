/**
 * SCANNER tab – network scan, device discovery, save/update results.
 * Extracted from app.js lines 3144-3350.
 *
 * Cross-module callbacks (attach to window when integrating):
 *   saveDevice, saveDevices, deleteDevice, openDeviceDetail
 */
import S from '../lib/state.js';
import {
  q, h, extractModel, logActivity, setBadge,
  TYPE_LABELS, TYPE_BADGE, OS_BADGE,
} from '../lib/helpers.js';
import { detectOsFromCriteria, detectDeviceType } from '../criteria.js';

const _saveDevice = (...a) => window.saveDevice?.(...a);
const _saveDevices = (...a) => window.saveDevices?.(...a);
const _deleteDevice = (...a) => window.deleteDevice?.(...a);

// ═══════════════════════════════════════════════════════════════════════════════
// SCANNER
// ═══════════════════════════════════════════════════════════════════════════════

export function setScanStatus(msg,type='') { const el=q('scan-status'); el.className='status-bar'+(type?' '+type:''); el.innerHTML=type==='loading'?`<span class="spinner"></span> ${msg}`:msg; }

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

export async function startScan() {
  const subnet = q('scan-subnet').value.trim();
  if (!subnet) { setScanStatus('Bitte Subnetz eingeben.','error'); return; }

  // Save last subnet (fire and forget — not critical for scan start)
  S.appSettings.lastScanSubnet = subnet;
  fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...S.appSettings})}).catch(()=>{});

  if (S.scanAbort) { S.scanAbort.abort(); }
  const myAbort = new AbortController();
  S.scanAbort = myAbort;
  S.scanFoundCnt=0; S.scanResults.length=0;

  q('btn-scan').disabled=true;
  q('btn-scan-stop').style.display='';
  q('btn-save-all').style.display='none';
  q('btn-update-details').style.display='none';
  q('sep-save-all').style.display='none';
  q('scan-progress-wrap').style.display='';
  q('scan-bar').style.width='0%';
  q('scan-scanned').textContent='0'; q('scan-total').textContent='?'; q('scan-found-lbl').textContent='';
  q('tbl-scan').querySelector('tbody').innerHTML=''; q('cnt-scan').textContent='';
  setScanStatus('Scan läuft…','loading');

  await runWsScan('scan', subnet, handleScanEvent, setScanStatus, myAbort.signal);
  if (S.scanAbort === myAbort) { S.scanAbort = null; }
  q('btn-scan').disabled=false; q('btn-scan-stop').style.display='none';
}

export function stopScan() { if(S.scanAbort){S.scanAbort.abort();S.scanAbort=null;} }

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
    setScanStatus(ev.found>0?`Scan abgeschlossen — ${ev.found} Gerät${ev.found!==1?'e':''} gefunden`:`Scan abgeschlossen — keine Geräte gefunden`, ev.found>0?'ok':'');
    if(ev.found===0) q('tbl-scan').querySelector('tbody').innerHTML=`<tr><td colspan="8" class="empty">Keine Geräte gefunden</td></tr>`;
    setBadge('scanner',ev.found||0);
    if(ev.found>0){ q('btn-save-all').style.display=''; q('btn-update-details').style.display=''; q('sep-save-all').style.display=''; q('btn-save-all').textContent=`Alle ${ev.found} speichern`; }
  }
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

function appendScanRow(dev) {
  S.scanResults.push(dev);
  const tbody=q('tbl-scan').querySelector('tbody');
  const ph=tbody.querySelector('td[colspan]'); if(ph) ph.closest('tr').remove();
  S.scanFoundCnt++;
  q('cnt-scan').textContent=S.scanFoundCnt+' Gerät'+(S.scanFoundCnt!==1?'e':'');
  const devType = detectDeviceType(dev.os, dev.sysDescr);
  const scanDev = { os: dev.os, type: devType };
  const filtered = !matchesImportFilter(scanDev);
  const tr=document.createElement('tr');
  if (filtered) tr.style.opacity = '0.4';
  tr.title = filtered ? 'Kein Treffer im Import-Filter – wird bei „Alle speichern" übersprungen' : '';
  tr.innerHTML=`
    <td class="mono">${h(dev.ip)}</td>
    <td style="font-weight:600">${h(dev.sysName||dev.lcosLxName||extractModel(dev.sysDescr)||'—')}</td>
    <td><span class="badge ${OS_BADGE[dev.os]||'badge-gray'}">${h(dev.os)}</span></td>
    <td><span class="badge ${TYPE_BADGE[devType]||'badge-gray'}">${h(TYPE_LABELS[devType]||devType)}</span></td>
    <td style="color:var(--text2)">${h(dev.sysLocation||'—')}</td>
    <td class="mono" style="color:var(--text3);font-size:12px">${h(dev.serial||'—')}</td>
    <td class="mono" style="color:var(--text3);font-size:11px">${h((dev.sysDescr||'').split(/[\r\n]/)[0].substring(0,55))}</td>
    <td><div style="display:flex;gap:6px">
      <button class="btn btn-sm" onclick="openDeviceDetail('${h(dev.ip)}')">Details</button>
      <button class="btn btn-sm btn-ghost" onclick="saveScanDevice('${h(dev.ip)}')">Speichern</button>
      <button class="btn btn-sm btn-ghost" onclick="updateScanDevice('${h(dev.ip)}')">Update</button>
    </div></td>`;
  tbody.appendChild(tr);
}

export async function saveScanDevice(ip) {
  const dev = S.scanResults.find(d => d.ip === ip);
  if (!dev) return;
  if (S.deviceStore[ip]) {
    setScanStatus(`${ip} ist bereits unter Geräte gespeichert – nicht übernommen.`, 'error');
    return;
  }
  await _saveDevice(buildScanDeviceEntry(dev));
  setScanStatus(`${dev.sysName||ip} gespeichert.`, 'ok');
}

export async function updateScanDevice(ip) {
  const dev = S.scanResults.find(d => d.ip === ip);
  if (!dev || !dev.serial) {
    setScanStatus(`Kein Update möglich – keine Seriennummer für ${ip}`, 'error');
    return;
  }
  const existing = Object.values(S.deviceStore).find(d => d.serial && d.serial === dev.serial);
  if (!existing) {
    setScanStatus(`Kein bestehendes Gerät mit Seriennummer ${dev.serial} gefunden`, 'error');
    return;
  }
  const newEntry = buildScanDeviceEntry(dev);
  newEntry.location = existing.location || newEntry.location;
  if (existing.ip !== dev.ip) await _deleteDevice(existing.ip);
  await _saveDevice({ ...existing, ...newEntry });
  setScanStatus(`${dev.sysName||ip} aktualisiert.`, 'ok');
}

export async function saveScanResults() {
  if (!S.scanResults.length) return;
  const patch = {};
  const skipped = [];
  const filtered = [];
  S.scanResults.forEach(dev => {
    if (S.deviceStore[dev.ip]) { skipped.push(dev.ip); return; }
    const devType = detectDeviceType(dev.os, dev.sysDescr);
    if (!matchesImportFilter({ os: dev.os, type: devType })) { filtered.push(dev.ip); return; }
    patch[dev.ip] = buildScanDeviceEntry(dev);
  });
  const n = Object.keys(patch).length;
  if (n) await _saveDevices(patch);
  let msg = n ? `${n} Gerät${n!==1?'e':''} gespeichert` : 'Keine neuen Geräte';
  if (skipped.length)  msg += ` – ${skipped.length} bereits vorhanden`;
  if (filtered.length) msg += ` – ${filtered.length} durch Import-Filter übersprungen`;
  setScanStatus(msg, !n ? 'error' : 'ok');
}

export async function updateScanDetails() {
  if (!S.scanResults.length) return;
  const patch = {};
  const toDelete = [];
  let updated = 0;

  S.scanResults.forEach(dev => {
    if (!dev.serial) return;
    const existing = Object.values(S.deviceStore).find(d => d.serial && d.serial === dev.serial);
    if (!existing) return;
    const newEntry = buildScanDeviceEntry(dev);
    // preserve manually set location
    newEntry.location = existing.location || newEntry.location;
    if (existing.ip !== dev.ip) toDelete.push(existing.ip);
    patch[dev.ip] = { ...existing, ...newEntry };
    updated++;
  });

  if (!updated) {
    setScanStatus('Keine übereinstimmenden Geräte gefunden (kein Abgleich über Seriennummer möglich)', 'error');
    return;
  }
  // remove old IP entries where IP changed
  for (const ip of toDelete) {
    if (!patch[ip]) await _deleteDevice(ip);
  }
  await _saveDevices(patch);
  setScanStatus(`${updated} Gerät${updated !== 1 ? 'e' : ''} aktualisiert`, 'ok');
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

export function initScanKeyHandler() {
  document.addEventListener('keydown', e => { if(e.key==='Enter'&&e.target.id==='scan-subnet') startScan(); });
}
