import S from '../lib/state.js';
import { q, h } from '../lib/helpers.js';
import { lmcCall } from './rollout.js';

// ── Activation Key ────────────────────────────────────────────────────────────

export function setActivationStatus(msg, ok) {
  const el = q('activation-status');
  el.style.color = ok ? 'var(--green)' : 'var(--red)';
  el.textContent = msg;
  if (msg) setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 4000);
}

export async function loadActivationTokens() {
  const accountId = q('lmc-account-select').value;
  if (!accountId) return;
  q('activation-list').innerHTML = '<span style="font-size:12px;color:var(--text3)">Lädt…</span>';
  try {
    const list = await lmcCall('devices', `/accounts/${accountId}/pairings`);
    renderActivationTokens(Array.isArray(list) ? list : []);
  } catch (e) {
    q('activation-list').innerHTML = `<span style="font-size:12px;color:var(--red)">Fehler: ${h(e.message)}</span>`;
  }
}

function renderActivationTokens(tokens) {
  const el = q('activation-list');
  if (!tokens.length) {
    el.innerHTML = '<span style="font-size:12px;color:var(--text3)">Keine aktiven Activation Keys vorhanden.</span>';
    return;
  }
  el.innerHTML = '';
  tokens.forEach(t => {
    const exp = t.expiration ? new Date(t.expiration) : null;
    const expStr = exp ? exp.toLocaleString('de-DE') : '–';
    const expired = exp && exp < new Date();
    const card = document.createElement('div');
    card.style.cssText = 'display:flex;align-items:center;gap:12px;padding:12px 14px;background:var(--card);border:1px solid var(--border);border-radius:6px;flex-wrap:wrap';
    card.innerHTML = `
      <div style="flex:1;min-width:0">
        <div style="font-family:var(--mono);font-size:13px;color:var(--accent);word-break:break-all;margin-bottom:4px">${h(t.token)}</div>
        <div style="font-size:11px;color:${expired ? 'var(--red)' : 'var(--text3)'}">
          Gültig bis: ${expStr}${expired ? ' (abgelaufen)' : ''}
        </div>
      </div>
      <button class="btn btn-sm btn-ghost" onclick="navigator.clipboard.writeText('${h(t.token)}').then(()=>setActivationStatus('✓ Kopiert','ok'))" title="Kopieren">📋</button>
      <button class="btn btn-sm btn-ghost" style="color:var(--red)" onclick="activationDelete('${h(t.token)}')">Löschen</button>`;
    el.appendChild(card);
  });
}

export async function activationCreate() {
  const accountId = q('lmc-account-select').value;
  if (!accountId) { setActivationStatus('Kein Projekt ausgewählt', false); return; }
  const validity = parseInt(q('activation-validity').value);
  try {
    setActivationStatus('Wird erstellt…', true);
    await lmcCall('devices', `/accounts/${accountId}/pairings`, 'POST', { validity });
    setActivationStatus('✓ Erstellt', true);
    await loadActivationTokens();
  } catch (e) {
    setActivationStatus('Fehler: ' + e.message, false);
  }
}

export async function activationDelete(token) {
  const accountId = q('lmc-account-select').value;
  if (!accountId) return;
  if (!confirm('Activation Key löschen?')) return;
  try {
    await lmcCall('devices', `/accounts/${accountId}/pairings/${encodeURIComponent(token)}`, 'DELETE');
    setActivationStatus('✓ Gelöscht', true);
    await loadActivationTokens();
  } catch (e) {
    setActivationStatus('Fehler: ' + e.message, false);
  }
}
