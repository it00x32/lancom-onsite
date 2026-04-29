import S from '../lib/state.js';
import { q, h, getLocations } from '../lib/helpers.js';
import { renderScriptOutputHtml } from './detail.js';

// ═══════════════════════════════════════════════════════════════════════════════
// SCRIPTING
// ═══════════════════════════════════════════════════════════════════════════════

const ALL_SCRIPT_OS = ['LCOS', 'LCOS LX', 'LCOS FX', 'LCOS SX 3', 'LCOS SX 4', 'LCOS SX 5'];
const OS_SSH_USER = {
  'LCOS SX 3': 'admin', 'LCOS SX 4': 'admin', 'LCOS SX 5': 'admin',
  'LCOS LX': 'root', 'LCOS': 'root', 'LCOS FX': 'root',
};

const SCRIPT_DEV_LABEL_STYLE =
  'display:flex;align-items:center;gap:6px;padding:3px 8px;cursor:pointer;font-size:12px;min-width:0';
const SCRIPT_MANUAL_LABEL_STYLE =
  'display:flex;align-items:center;gap:6px;padding:3px 8px;cursor:pointer;font-size:12px';

let _scripts   = {};   // { os: [scriptObj, ...] }
let _activeScript = null;

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function scriptDeviceList() {
  return q('script-device-list');
}

function populateScriptLocationSelect() {
  const sel = q('script-loc-select');
  if (!sel) return;
  const locs = getLocations();
  const cur = sel.value;
  sel.innerHTML = '<option value="">Standort…</option>' +
    locs.map(l => `<option value="${h(l)}">${h(l)}</option>`).join('');
  if (cur && locs.includes(cur)) sel.value = cur;
}

function scriptDeviceRowHtml(dev, checked) {
  return (
    `<label data-loc="${h(dev.location || '')}" style="${SCRIPT_DEV_LABEL_STYLE}">` +
    `<input type="checkbox" class="script-dev-cb" value="${h(dev.ip)}" data-os="${h(dev.os || '')}"${checked ? ' checked' : ''}>` +
    `<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h(dev.name || dev.ip)}</span>` +
    `<span style="color:var(--text3);font-family:monospace;font-size:11px;flex-shrink:0">${h(dev.ip)}</span></label>`
  );
}

export async function loadScriptList() {
  try {
    const r = await fetch('/api/scripte');
    _scripts = await r.json();
  } catch { _scripts = {}; }
  renderScriptList();
}

export function renderScriptList() {
  const el = q('script-list');
  let html = '';
  for (const os of ALL_SCRIPT_OS) {
    const list = (_scripts[os] || []);
    if (!list.length) continue;
    const hasActive = _activeScript && _activeScript._os === os;
    const open = hasActive; // auto-open group of active script
    const osId = 'sog-' + os.replace(/\s/g,'_');
    html += `<div class="script-os-group">
      <div class="script-os-label" onclick="toggleScriptOsGroup('${osId}')">
        <span>${os}</span>
        <span class="sg-chevron" id="${osId}-chev" style="transform:${open?'':'rotate(-90deg)'}">▾</span>
      </div>
      <div class="script-os-items${open?' open':''}" id="${osId}">`;
    for (const s of list) {
      const active = hasActive && _activeScript._file === s._file ? ' active' : '';
      html += `<div class="script-item${active}" onclick="scriptOpen('${os.replace(/'/g,"\\'")}','${s._file.replace(/'/g,"\\'")}')">
        <span class="script-item-name">${s._protected ? '🔒 ' : ''}${esc(s.name)}</span>
        ${s.description ? `<span class="script-item-desc">${esc(s.description)}</span>` : ''}
      </div>`;
    }
    html += `</div></div>`;
  }
  el.innerHTML = html || '<div style="padding:16px;font-size:12px;color:var(--text3)">Keine Scripts vorhanden</div>';
}

export function scriptOpen(os, file) {
  const s = (_scripts[os] || []).find(x => x._file === file);
  if (!s) return;
  _activeScript = { ...s, _os: os };
  renderScriptList();
  scriptFillForm(_activeScript);
}

export function scriptNew() {
  _activeScript = null;
  renderScriptList();
  scriptFillForm({ name:'', description:'', os:[], commands:[], _file:null, _os:null });
}

function scriptFillForm(s) {
  q('script-empty-hint').style.display = 'none';
  q('script-form').style.display       = 'block';
  q('script-run-box').style.display    = 'flex';
  q('script-output').style.display     = 'none';
  q('script-name').value = s.name || '';
  q('script-desc').value = s.description || '';
  q('script-commands').value = (s.commands || []).join('\n');
  const scriptOs = Array.isArray(s.os) ? s.os[0] : s.os;
  q('script-os-checks').querySelectorAll('input[type=radio]').forEach(rb => {
    rb.checked = rb.value === scriptOs;
  });
  const userEl = q('script-run-user');
  if (userEl && scriptOs) userEl.value = OS_SSH_USER[scriptOs] || 'root';
  // Geräteliste als Checkboxen
  renderScriptDevices();
}

export function renderScriptDevices() {
  const devList = scriptDeviceList();
  if (!devList) return;
  const scriptOs = _activeScript?._os || null;
  const osFilter = scriptOs ? [scriptOs] : null;
  // Preserve checked IPs across re-render
  const checked = new Set([...devList.querySelectorAll('input.script-dev-cb:checked')].map(cb => cb.value));
  const devices = Object.values(S.deviceStore)
    .filter(d => !osFilter || (d.os && osFilter.includes(d.os)))
    .sort((a, b) => (a.name || a.ip).localeCompare(b.name || b.ip));
  devList.innerHTML = devices.length
    ? devices.map(dev => scriptDeviceRowHtml(dev, checked.has(dev.ip))).join('')
    : `<div style="padding:8px 10px;font-size:12px;color:var(--text3)">Keine Geräte in der Geräteliste</div>`;

  populateScriptLocationSelect();
}

function scriptGetForm() {
  const osEl = q('script-os-checks').querySelector('input[type=radio]:checked');
  const os = osEl ? [osEl.value] : [];
  const commands = q('script-commands').value.split('\n').map(l => l.trim()).filter(Boolean);
  return {
    name:        q('script-name').value.trim(),
    description: q('script-desc').value.trim(),
    os,
    commands,
    _file: _activeScript?._file || null,
    _os:   _activeScript?._os   || null,
  };
}

export async function scriptSave() {
  const s = scriptGetForm();
  if (!s.name)           return alert('Name erforderlich');
  if (!s.os.length)      return alert('Bitte ein Betriebssystem auswählen');
  if (!s.commands.length) return alert('Mindestens ein Befehl erforderlich');
  const r = await fetch('/api/scripte', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(s) });
  const d = await r.json();
  if (!d.ok) return alert('Fehler: ' + d.error);
  _activeScript = { ...s, _file: d.file, _os: s.os[0] };
  await loadScriptList();
}

export async function scriptDelete() {
  if (!_activeScript) return;
  if (_activeScript._protected) { alert('Das ROLLOUT-Script kann nicht gelöscht werden.'); return; }
  if (!confirm(`Script "${_activeScript.name}" löschen?`)) return;
  const r = await fetch(`/api/scripte?os=${encodeURIComponent(_activeScript._os)}&file=${encodeURIComponent(_activeScript._file)}`, { method:'DELETE' });
  const d = await r.json();
  if (!d.ok) return alert('Fehler: ' + d.error);
  _activeScript = null;
  q('script-empty-hint').style.display = 'block';
  q('script-form').style.display       = 'none';
  q('script-run-box').style.display    = 'none';
  q('script-output').style.display     = 'none';
  await loadScriptList();
}

export function scriptSelectAll(checked) {
  scriptDeviceList()?.querySelectorAll('input.script-dev-cb').forEach(cb => { cb.checked = checked; });
}

/** Markiert nur Geräte des gewählten Standorts (laut Gerätedaten); manuell hinzugefügte IPs bleiben unverändert. */
export function scriptSelectDevicesByLocation() {
  const sel = q('script-loc-select');
  const devList = scriptDeviceList();
  if (!sel || !devList) return;
  const target = sel.value;
  if (!target) {
    alert('Bitte einen Standort wählen.');
    return;
  }
  devList.querySelectorAll('input.script-dev-cb').forEach(cb => {
    const label = cb.closest('label');
    if (!label || !label.hasAttribute('data-loc')) return;
    const loc = label.getAttribute('data-loc') || '';
    cb.checked = loc === target;
  });
}

export function scriptAddCustomIp() {
  const ip = q('script-run-ip').value.trim();
  if (!ip) return;
  const list = scriptDeviceList();
  if (!list) return;
  // Nicht doppelt hinzufügen
  if ([...list.querySelectorAll('input.script-dev-cb')].some(cb => cb.value === ip)) {
    q('script-run-ip').value = '';
    return;
  }
  const label = document.createElement('label');
  label.setAttribute('data-loc', '');
  label.style.cssText = SCRIPT_MANUAL_LABEL_STYLE;
  label.innerHTML = `<input type="checkbox" class="script-dev-cb" value="${h(ip)}" checked>` +
    `<span style="flex:1;font-family:monospace">${h(ip)}</span>`;
  list.appendChild(label);
  q('script-run-ip').value = '';
}

export async function scriptRun() {
  const scriptOs = (_activeScript && _activeScript._os) || '';
  const devList = scriptDeviceList();
  const checkedCbs = devList ? [...devList.querySelectorAll('input.script-dev-cb:checked')] : [];
  const ips = checkedCbs.map(cb => cb.value);
  const manualIp = q('script-run-ip').value.trim();
  if (manualIp && !ips.includes(manualIp)) ips.push(manualIp);
  if (!ips.length) return alert('Bitte mindestens ein Gerät auswählen oder eine IP eingeben');

  const user = q('script-run-user').value.trim();
  const pass = q('script-run-pass').value;
  if (!user || !pass) return alert('User und Passwort erforderlich');
  const commands = q('script-commands').value.split('\n').map(l => l.trim()).filter(Boolean);
  if (!commands.length) return alert('Keine Befehle vorhanden');

  const btn = q('script-run-btn');
  btn.disabled = true;
  q('script-output').style.display = 'block';
  q('script-output-body').innerHTML = '';

  for (let i = 0; i < ips.length; i++) {
    const ip = ips[i];
    btn.textContent = `⏳ ${i + 1}/${ips.length} · ${ip}`;

    const block = document.createElement('div');
    block.innerHTML = `<div style="padding:8px 14px;color:var(--text3);font-size:12px">Verbinde mit ${h(ip)}…</div>`;
    q('script-output-body').appendChild(block);
    block.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    try {
      const r = await fetch('/api/scripte/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip, user, pass, commands, os: scriptOs }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      block.innerHTML = renderScriptOutputHtml(d.results, ip);
    } catch (e) {
      block.innerHTML =
        `<div class="script-result-block">` +
        `<div style="padding:6px 14px;font-weight:600;font-size:12px;color:var(--text2)"># ${h(ip)}</div>` +
        `<div class="script-result-error">Fehler: ${h(e.message)}</div></div>`;
    }
  }

  btn.disabled = false;
  btn.textContent = '▶ Ausführen';
}

// ── Expose functions needed by inline HTML event handlers ─────────────────────
window.loadScriptList = loadScriptList;
window.renderScriptList = renderScriptList;
window.scriptOpen = scriptOpen;
window.scriptNew = scriptNew;
window.renderScriptDevices = renderScriptDevices;
window.scriptSave = scriptSave;
window.scriptDelete = scriptDelete;
window.scriptSelectAll = scriptSelectAll;
window.scriptSelectDevicesByLocation = scriptSelectDevicesByLocation;
window.scriptAddCustomIp = scriptAddCustomIp;
window.scriptRun = scriptRun;
