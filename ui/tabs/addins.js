import S from '../lib/state.js';
import { q, h } from '../lib/helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// ADD-INS STORE
// ═══════════════════════════════════════════════════════════════════════════════

let addinList = [];
let addinStatus = {}; // key: `${os}/${filename}` → 'idle'|'uploading'|'ok'|'error'
let addinSortCol = 'name';
let addinSortDir = 1; // 1=asc, -1=desc
let addinFilterOs = '';
let addinSearch   = '';

export function setAddinFilterOs(os) {
  addinFilterOs = os;
  const btnToOs = { 'Alle': '', 'LCOS LX': 'LCOS LX', 'SX 3': 'LCOS SX 3', 'SX 4': 'LCOS SX 4', 'SX 5': 'LCOS SX 5', 'FX': 'LCOS FX' };
  document.querySelectorAll('.addin-os-btn').forEach(b => {
    const val = b.textContent in btnToOs ? btnToOs[b.textContent] : b.textContent;
    b.classList.toggle('active', val === os);
  });
  renderAddinList();
}
export function setAddinSearch(val) { addinSearch = val.toLowerCase(); renderAddinList(); }
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

export async function loadAddins() {
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
    // 1. App-ID bestimmen – vorhandene App wiederverwenden oder neu erstellen
    const safeName = (a.name || 'addin')
      .replace(/[^a-zA-Z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'addin';

    let appId;
    try {
      const list = await window.lmcCall?.('configapplication', `/configapplication/accounts/${accountId}/applications`);
      const apps = list.content || list.data || (Array.isArray(list) ? list : []);
      const found = apps.find(x => x.name === safeName);
      if (found) appId = found.id || found.applicationId || found.identifier;
    } catch { /* ignorieren, wir versuchen trotzdem zu erstellen */ }

    if (!appId) {
      const created = await window.lmcCall?.(
        'configapplication',
        `/configapplication/accounts/${accountId}/applications`,
        'POST',
        { name: safeName, comment: a.description || '' }
      );
      appId = created.id || created.applicationId || created.identifier;
      if (!appId) throw new Error('Keine App-ID in der Antwort: ' + JSON.stringify(created).slice(0, 120));
    }

    // 2. Skript hochladen
    await window.lmcCall?.(
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

    // 3. Variablen des Addins als LMC-Config-Variablen hochladen
    const usedVars = extractAddinVars(a.script || '');
    if (usedVars.size > 0) {
      const globals = varsAsDict();
      // Bestehende Cloud-Variablen laden um PUT statt POST zu verwenden
      let cloudByName = {};
      try {
        const existing = await window.lmcCall?.('configvariable', `/configvariable/accounts/${accountId}/variables`);
        const cloudList = existing.content || existing.data || (Array.isArray(existing) ? existing : []);
        cloudList.forEach(v => { cloudByName[v.name] = v; });
      } catch { /* ignorieren, wir versuchen trotzdem POST */ }

      for (const [key, scriptDefault] of usedVars) {
        // Globaler Wert hat Vorrang, dann Script-Default
        const val = key in globals ? globals[key] : scriptDefault;
        if (val === '' && !(key in globals)) continue; // leere Script-Defaults nicht anlegen
        try {
          if (cloudByName[key]) {
            await window.lmcCall?.('configvariable', `/configvariable/accounts/${accountId}/variables/${cloudByName[key].id}`, 'PUT', { value: String(val) });
          } else {
            await window.lmcCall?.('configvariable', `/configvariable/accounts/${accountId}/variables`, 'POST', { name: key, value: String(val) });
          }
        } catch { /* einzelne Variable fehlgeschlagen – weitermachen */ }
      }
    }

    setAddinStatus(index, 'ok');
  } catch(e) {
    setAddinStatus(index, 'err:' + e.message);
    throw e; // weiterwerfen damit saveAndUploadAddin den Fehler anzeigt
  }
}

let addinEditorIndex = null;
let addinIsNew = false;

export function createAddin() {
  addinEditorIndex = null;
  addinIsNew = true;
  q('addin-modal-title').textContent = 'Neues Add-in erstellen';
  q('edit-filepath').textContent = '— wird beim Speichern angelegt —';
  q('edit-name').value  = '';
  q('edit-desc').value  = '';
  document.querySelectorAll('input[name="ef-os"]').forEach((r, i) => { r.checked = i === 0; });
  q('edit-script').value = 'exports.main = function (config, context) {\n    // Dein Code hier\n};';
  q('addin-editor-status').textContent = '';
  renderAddinVars('');
  renderVarsPicker();
  q('addin-modal').style.display = 'flex';
  setTimeout(() => q('edit-name').focus(), 50);
}

export function openAddinEditor(index) {
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
  renderAddinVars(a.script || '');
  renderVarsPicker();
  q('addin-modal').style.display = 'flex';
  setTimeout(() => q('edit-script').focus(), 50);
}

export function closeAddinEditor() {
  q('addin-modal').style.display = 'none';
  addinEditorIndex = null;
  addinIsNew = false;
}

// ── Add-in Variablen ──────────────────────────────────────────────────────────
function extractAddinVars(script) {
  const found = new Map(); // key → defaultVal
  const re = /context\.vars\.([A-Za-z_][A-Za-z0-9_]*)/g;
  let m;
  while ((m = re.exec(script)) !== null) {
    const key = m[1];
    if (found.has(key)) continue;
    // Try to extract || 'default' or || "default" right after context.vars.KEY
    const after = script.slice(m.index + m[0].length);
    const defMatch = after.match(/^\s*\|\|\s*['"]([^'"]*)['"]/);
    found.set(key, defMatch ? defMatch[1] : '');
  }
  return found;
}

export function renderAddinVars(script) {
  const vars    = extractAddinVars(script);
  const globals = varsAsDict();
  const section = q('edit-vars-section');
  const list    = q('edit-vars-list');
  if (vars.size === 0) { section.style.display = 'none'; return; }
  section.style.display = '';
  list.innerHTML = '';
  vars.forEach((scriptDefault, key) => {
    const isGlobal = key in globals;
    const val      = isGlobal ? globals[key] : scriptDefault;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;flex-direction:column;gap:3px';
    const badge = isGlobal
      ? `<span style="font-size:9px;background:rgba(34,197,94,.15);color:#22c55e;border-radius:3px;padding:0 4px;margin-left:4px">global</span>`
      : '';
    row.innerHTML = `
      <span style="font-family:var(--mono);font-size:10px;color:var(--accent);word-break:break-all">${h(key)}${badge}</span>
      <span style="font-family:var(--mono);font-size:11px;color:var(--text2);padding:3px 0">${val !== '' ? h(val) : '<span style="color:var(--text3);font-style:italic">–</span>'}</span>`;
    list.appendChild(row);
  });
}

// ── Globale Variablen ─────────────────────────────────────────────────────────
let _globalVarsCache = null;

export async function fetchGlobalVars() {
  try {
    const r = await fetch('/api/vars');
    _globalVarsCache = await r.json();
  } catch { _globalVarsCache = []; }
}

// Lokales Format: Array von Objekten [{name, label, type, restricted, value}]
// Migration: altes Format {key:value} → Array
function _migrateVars(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') {
    return Object.entries(raw).map(([name, value]) => ({ name, label: '', type: 'STRING', restricted: false, value: String(value) }));
  }
  return [];
}

function loadGlobalVars() {
  return _migrateVars(_globalVarsCache);
}

// Hilfsfunktion für Stellen die noch {name:value} brauchen (addin vars)
function varsAsDict() {
  return Object.fromEntries(loadGlobalVars().map(v => [v.name, v.value ?? '']));
}

function saveGlobalVars(arr) {
  _globalVarsCache = arr;
  fetch('/api/vars', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(arr) });
}

export function saveGlobalVarsManual() {
  saveGlobalVars(_collectGlobalVars());
  const lbl = q('vars-save-lbl');
  if (!lbl) return;
  lbl.style.display = 'inline';
  setTimeout(() => { lbl.style.display = 'none'; }, 2000);
}

export async function syncVarsToCloud() {
  const accountId = q('lmc-account-select').value;
  if (!accountId) { alert('Kein Cloud-Projekt ausgewählt. Bitte zuerst mit der LMC verbinden.'); return; }
  const local = loadGlobalVars();
  const btn = q('btn-vars-sync');
  btn.textContent = 'Sync läuft…'; btn.disabled = true;
  try {
    const existing = await window.lmcCall?.('configvariable', `/configvariable/accounts/${accountId}/variables`);
    const cloudList = existing.content || existing.data || (Array.isArray(existing) ? existing : []);
    const cloudByName = {};
    cloudList.forEach(v => { cloudByName[v.name] = v; });
    const localNames = new Set(local.map(v => v.name));
    let created = 0, updated = 0, deleted = 0, errors = 0;

    // Erstellen / Aktualisieren
    for (const v of local) {
      const payload = {
        name:       v.name,
        label:      v.label       || undefined,
        type:       v.type        || 'STRING',
        restricted: !!v.restricted,
        value:      String(v.value ?? ''),
      };
      try {
        if (cloudByName[v.name]) {
          await window.lmcCall?.('configvariable', `/configvariable/accounts/${accountId}/variables/${cloudByName[v.name].id}`, 'PUT', payload);
          updated++;
        } else {
          await window.lmcCall?.('configvariable', `/configvariable/accounts/${accountId}/variables`, 'POST', payload);
          created++;
        }
      } catch { errors++; }
    }

    // Löschen: Cloud-Variablen die lokal nicht mehr existieren (keine System-Variablen)
    for (const cv of cloudList) {
      if (cv.system) continue;
      if (!localNames.has(cv.name)) {
        try {
          await window.lmcCall?.('configvariable', `/configvariable/accounts/${accountId}/variables/${cv.id}`, 'DELETE');
          deleted++;
        } catch { errors++; }
      }
    }

    const parts = [];
    if (created) parts.push(`${created} erstellt`);
    if (updated) parts.push(`${updated} aktualisiert`);
    if (deleted) parts.push(`${deleted} gelöscht`);
    if (errors)  parts.push(`${errors} Fehler`);
    btn.textContent = `✓ ${parts.join(', ') || 'keine Änderungen'}`;
    btn.style.background = errors ? 'var(--orange)' : 'var(--green)';
    setTimeout(() => { btn.textContent = 'Sync to Cloud'; btn.style.background = ''; btn.disabled = false; }, 3000);
  } catch(err) {
    btn.textContent = 'Fehler: ' + err.message.slice(0, 40);
    btn.style.background = 'var(--red)';
    setTimeout(() => { btn.textContent = 'Sync to Cloud'; btn.style.background = ''; btn.disabled = false; }, 4000);
  }
}

export async function loadVarsFromCloud() {
  const accountId = q('lmc-account-select').value;
  if (!accountId) { alert('Kein Cloud-Projekt ausgewählt. Bitte zuerst mit der LMC verbinden.'); return; }
  try {
    const existing = await window.lmcCall?.('configvariable', `/configvariable/accounts/${accountId}/variables`);
    const cloudList = existing.content || existing.data || (Array.isArray(existing) ? existing : []);
    if (!cloudList.length) { alert('Keine Variablen im Cloud-Projekt gefunden.'); return; }
    const merged = [...loadGlobalVars()];
    const byName = Object.fromEntries(merged.map((v, i) => [v.name, i]));
    cloudList.filter(v => !v.system).forEach(cv => {
      const entry = {
        name:       cv.name,
        label:      cv.label       || '',
        type:       cv.type        || 'STRING',
        restricted: !!cv.restricted,
        value:      String(cv.value ?? ''),
      };
      if (cv.name in byName) merged[byName[cv.name]] = entry;
      else merged.push(entry);
    });
    saveGlobalVars(merged);
    renderGlobalVarsList();
  } catch(err) { alert('Fehler beim Laden: ' + err.message); }
}

export function renderGlobalVarsList() {
  const vars = loadGlobalVars();
  const list = q('global-vars-list');
  list.innerHTML = '';
  vars.forEach(v => list.appendChild(makeGlobalVarRow(v)));
  if (!vars.length) {
    list.innerHTML = '<span style="font-size:12px;color:var(--text3)">Noch keine globalen Variablen definiert.</span>';
  }
}

function makeGlobalVarRow(v = {}) {
  const row = document.createElement('div');
  row.style.cssText = 'display:grid;grid-template-columns:1fr 1fr auto auto 1.4fr auto auto;align-items:center;gap:6px;padding:5px 0;border-bottom:1px solid var(--border2)';
  const is = 'padding:4px 7px;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text1);font-size:11px;font-family:var(--mono);outline:none;width:100%;box-sizing:border-box';
  const pwVal = v.restricted ? v.value ?? '' : '';
  const txVal = !v.restricted ? v.value ?? '' : '';
  row.innerHTML = `
    <input type="text"  placeholder="variablen_name" value="${h(v.name  ||'')}" data-role="gv-name"       style="${is}">
    <input type="text"  placeholder="Anzeigename"     value="${h(v.label ||'')}" data-role="gv-label"      style="${is}">
    <select data-role="gv-type" style="${is};padding-right:4px">
      <option value="STRING"    ${(v.type||'STRING')==='STRING'    ?'selected':''}>STRING</option>
      <option value="JSON"      ${(v.type||'')==='JSON'            ?'selected':''}>JSON</option>
      <option value="USER_TYPE" ${(v.type||'')==='USER_TYPE'       ?'selected':''}>USER_TYPE</option>
    </select>
    <label title="Als Passwort" style="display:flex;align-items:center;gap:3px;font-size:11px;color:var(--text2);cursor:pointer;white-space:nowrap">
      <input type="checkbox" data-role="gv-restricted" ${v.restricted?'checked':''} onchange="gvTogglePassword(this)"> 🔒
    </label>
    <input type="${v.restricted?'password':'text'}" placeholder="Wert" value="${h(v.restricted?pwVal:txVal)}" data-role="gv-value" style="${is}">
    <button class="btn btn-sm" onclick="saveGlobalVarsManual()" title="Speichern" style="padding:3px 8px;flex-shrink:0">💾</button>
    <button class="btn btn-sm btn-ghost" onclick="removeGlobalVarRow(this)" style="padding:3px 7px;flex-shrink:0;color:var(--red)">✕</button>`;
  return row;
}

export function gvTogglePassword(cb) {
  const row = cb.closest('div');
  const inp = row.querySelector('[data-role=gv-value]');
  inp.type = cb.checked ? 'password' : 'text';
}

export function addGlobalVar() {
  const list = q('global-vars-list');
  if (list.querySelector('span')) list.innerHTML = '';
  list.appendChild(makeGlobalVarRow({ name:'', label:'', type:'STRING', restricted:false, value:'' }));
  list.lastElementChild.querySelector('input').focus();
}

function _collectGlobalVars() {
  const vars = [];
  q('global-vars-list').querySelectorAll('div[style]').forEach(row => {
    const name = row.querySelector('[data-role=gv-name]')?.value.trim();
    if (!name) return;
    vars.push({
      name,
      label:      row.querySelector('[data-role=gv-label]')?.value.trim() || '',
      type:       row.querySelector('[data-role=gv-type]')?.value || 'STRING',
      restricted: !!row.querySelector('[data-role=gv-restricted]')?.checked,
      value:      row.querySelector('[data-role=gv-value]')?.value ?? '',
    });
  });
  return vars;
}

export function removeGlobalVarRow(btn) {
  btn.closest('div').remove();
  const list = q('global-vars-list');
  if (!list.children.length) {
    list.innerHTML = '<span style="font-size:12px;color:var(--text3)">Noch keine globalen Variablen definiert.</span>';
  }
  saveGlobalVars(_collectGlobalVars());
}

function applyVarsToScript(script) {
  return script;
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
  const script = applyVarsToScript(q('edit-script').value);
  // Reflect updated script back into textarea so user sees the changes
  q('edit-script').value = script;
  return {
    name:        q('edit-name').value.trim(),
    description: q('edit-desc').value.trim(),
    os,
    ...( OS_FLAGS_MAP[os] || {} ),
    script,
  };
}

function setEditorStatus(msg, ok) {
  const el = q('addin-editor-status');
  el.style.color = ok ? 'var(--green)' : 'var(--red)';
  el.textContent = msg;
}

function renderVarsPicker() {
  const sel = q('vars-picker-select');
  if (!sel) return;
  const vars = loadGlobalVars();
  sel.innerHTML = '<option value="">— Variable einfügen —</option>';
  vars.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v.name;
    opt.textContent = v.name + (v.label ? ` (${v.label})` : '');
    sel.appendChild(opt);
  });
}

export function insertVarAtCursor() {
  const sel  = q('vars-picker-select');
  const ta   = q('edit-script');
  if (!sel?.value || !ta) return;
  const text = `context.vars.${sel.value}`;
  const s = ta.selectionStart, e = ta.selectionEnd;
  ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
  ta.selectionStart = ta.selectionEnd = s + text.length;
  ta.focus();
  sel.value = '';
  renderAddinVars(ta.value);
}

function autoAddMissingVars(script) {
  const used    = extractAddinVars(script);
  const existing = loadGlobalVars();
  const existingNames = new Set(existing.map(v => v.name));
  const added = [];
  used.forEach((scriptDefault, key) => {
    if (existingNames.has(key)) return;
    existing.push({ name: key, label: '', type: 'STRING', restricted: false, value: scriptDefault || '' });
    added.push(key);
  });
  if (added.length) {
    saveGlobalVars(existing);
    setEditorStatus(`✓ Neue Variable${added.length > 1 ? 'n' : ''} angelegt: ${added.join(', ')}`, true);
  }
}

export async function saveAddin() {
  const data = collectEditorData();
  if (!data.name) { setEditorStatus('Name darf nicht leer sein.', false); return; }
  autoAddMissingVars(data.script || '');

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

export async function saveAndUploadAddin() {
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

export async function deleteAddin(index) {
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

export async function uploadAllAddins() {
  const btn = q('btn-upload-all-addins');
  if (btn) { btn.disabled = true; btn.textContent = 'Wird hochgeladen…'; }
  for (let i = 0; i < addinList.length; i++) {
    await uploadAddin(i);
  }
  if (btn) { btn.disabled = false; btn.textContent = 'Alle hochladen'; }
}

// LMC-Geräte-Sync: Implementierung nur in rollout.js (hier kein zweites lmcResults — sonst überschrieb addins.js window.lmcSync die funktionierende Variante)

// Expose to window for inline onclick handlers
if (typeof window !== 'undefined') {
  Object.assign(window, {
    loadAddins, createAddin, setAddinFilterOs, setAddinSearch, setAddinSortCol,
    openAddinEditor, closeAddinEditor, uploadAddin, deleteAddin, uploadAllAddins,
    saveGlobalVarsManual, gvTogglePassword, removeGlobalVarRow, addGlobalVar,
    loadVarsFromCloud, syncVarsToCloud, renderGlobalVarsList, fetchGlobalVars,
    insertVarAtCursor, saveAddin, saveAndUploadAddin,
  });
}
