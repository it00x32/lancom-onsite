import S from './lib/state.js';
import { q, h } from './lib/helpers.js';

export const DEFAULT_CRITERIA_CLIENT = {
  osCriteria: [
    {os:'LCOS LX',   match:['LCOS LX','LCOS-LX','LX-','LW-','OW-','OX-']},
    {os:'LCOS FX',   match:['LCOS FX','LCOS-FX']},
    {os:'LCOS SX 3', match:['LCOS SX 3.','LCOS-SX 3.','GS-2']},
    {os:'LCOS SX 4', match:['LCOS SX 4.','LCOS-SX 4.','GS-3']},
    {os:'LCOS SX 5', match:['LCOS SX 5.','LCOS-SX 5.','GS-4','XS-4','XS-5','XS-6','YS-7','CS-']},
    {os:'LCOS',      match:['LCOS','LN-']},
  ],
  typeCriteria: [
    {type:'Access Point', keywords:['OAP','IAP','LN']},
    {type:'Router',       keywords:[]},
  ],
};

// Betriebssystem aus Text anhand editierbarer Kriterien ermitteln
export function detectOsFromCriteria(text) {
  const c = S.appCriteria || { osCriteria: [] };
  const upper = (text || '').toUpperCase();
  for (const rule of c.osCriteria) {
    if ((rule.match || []).some(kw => upper.includes(kw.toUpperCase()))) return rule.os;
  }
  return null;
}

/** LMC liefert oft nur kurze fwLabels (Versionsnummern) — Ein-Zeichen-/Ziffern-Matches würden fast immer „LCOS“ ergeben */
export function detectOsFromCriteriaForLmc(text) {
  const c = S.appCriteria || { osCriteria: [] };
  const upper = (text || '').toUpperCase();
  for (const rule of c.osCriteria || []) {
    for (const kw of rule.match || []) {
      const k = String(kw).trim();
      if (k.length < 3) continue;
      if (/^\d+$/.test(k)) continue;
      if (upper.includes(k.toUpperCase())) return rule.os;
    }
  }
  return null;
}

/**
 * LMC-Geräte: OS aus Kriterien + Modell, Typ aus LMC-Klasse (status.type) wenn sinnvoll.
 */
export function inferLmcDeviceType(os, model, lmcTypeRaw) {
  const osStr = os || '';
  if (osStr.startsWith('LCOS SX')) return 'switch';
  if (osStr.startsWith('LCOS LX')) return 'lx-ap';
  if (osStr.startsWith('LCOS FX')) return 'firewall';
  const lt = (lmcTypeRaw || '').toUpperCase();
  if (lt.includes('SWITCH')) return 'switch';
  if (lt === 'FIREWALL' || lt === 'UTM') return 'firewall';
  if (lt.includes('ROUTER') || lt.includes('GATEWAY')) return 'router';
  if (lt.includes('ACCESS_POINT') || lt === 'AP' || lt.includes('WLAN') || lt.includes('WIFI')) {
    return detectDeviceType(osStr || 'LCOS', model);
  }
  return detectDeviceType(osStr, model);
}

// Gerätetyp aus OS + sysDescr ermitteln
// LCOS LX/SX/FX sind durch das OS eindeutig – nur für LCOS werden Kriterien geprüft
export function detectDeviceType(os, sysDescr) {
  let o = (os || '').trim();
  // SNMP-Scanner liefert bei manchen Geräten nur "LANCOM" (sysObjectId) statt LCOS-Variante
  if (!o || o === 'LANCOM') {
    const desc = (sysDescr || '').toUpperCase();
    if (desc.includes('LCOS SX')) o = 'LCOS SX';
    else if (desc.includes('LCOS LX')) o = 'LCOS LX';
    else if (desc.includes('LCOS FX')) o = 'LCOS FX';
    else if (desc.includes('LCOS')) o = 'LCOS';
  }
  if (o.startsWith('LCOS LX')) return 'lx-ap';
  if (o.startsWith('LCOS SX')) return 'switch';
  if (o.startsWith('LCOS FX')) return 'firewall';
  if (o.startsWith('LCOS')) {
    const c = S.appCriteria || { typeCriteria: [] };
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

export async function loadCriteria() {
  try { const r = await fetch('/api/criteria'); S.appCriteria = await r.json(); }
  catch { S.appCriteria = JSON.parse(JSON.stringify(DEFAULT_CRITERIA_CLIENT)); }
  renderCriteriaTables(S.appCriteria);
}

export async function saveCriteria() {
  S.appCriteria = collectCriteria();
  await fetch('/api/criteria', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(S.appCriteria) });
  const lbl = q('crit-save-lbl'); lbl.style.display='';
  setTimeout(() => { lbl.style.display='none'; }, 2500);
}

export async function resetCriteria() {
  S.appCriteria = JSON.parse(JSON.stringify(DEFAULT_CRITERIA_CLIENT));
  renderCriteriaTables(S.appCriteria);
  await fetch('/api/criteria', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(S.appCriteria) });
  const lbl = q('crit-save-lbl'); lbl.style.display='';
  setTimeout(() => { lbl.style.display='none'; }, 2500);
}

export function renderCriteriaTables(c) {
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

export function collectCriteria() {
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
