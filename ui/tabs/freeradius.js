import { q, h } from '../lib/helpers.js';

/**
 * FreeRADIUS (Docker): NAS-clients, Container-Status, Start/Stopp.
 */

/** @param {{ available?: boolean, running?: boolean, status?: string, error?: string }} d */
function frDockerStatusLineHtml(d) {
  if (!d.available && d.error) {
    return `<span style="color:var(--orange)">${h(d.error)}</span>`;
  }
  if (d.running) {
    return `<span style="color:#22c55e;font-weight:600">Läuft</span> <span style="font-size:11px;color:var(--text3)">(${h(d.status || '')})</span>`;
  }
  if (d.status === 'not_found') {
    return '<span style="color:var(--text3)">Kein Container — Start legt ihn an</span>';
  }
  return `<span style="color:var(--text3)">Gestoppt</span> <span style="font-size:11px">(${h(d.status || '—')})</span>`;
}

function frRowsHtml(clients) {
  if (!clients.length) {
    return '<tr><td colspan="4" class="empty">Keine Clients — mindestens einen Eintrag speichern</td></tr>';
  }
  return clients.map((c) => `
      <tr>
        <td><input class="search-input fr-client-name" style="width:100%;box-sizing:border-box" value="${h(c.name)}" placeholder="z. B. nas_core"></td>
        <td><input class="search-input fr-ipaddr" style="width:100%;font-family:var(--mono);font-size:12px;box-sizing:border-box" value="${h(c.ipaddr)}" placeholder="* oder 192.168.0.0/24"></td>
        <td><input class="search-input fr-secret" type="password" style="width:100%;box-sizing:border-box" value="${h(c.secret)}" autocomplete="new-password" placeholder="Shared Secret"></td>
        <td style="width:44px"><button type="button" class="btn btn-sm btn-danger" onclick="frRemoveClientRow(this)">×</button></td>
      </tr>`).join('');
}

export async function renderFreeRadius() {
  const root = q('freeradius-root');
  if (!root) return;

  let fr = { clients: [], notes: '' };
  try {
    const frRes = await fetch('/api/freeradius/config');
    const frJson = await frRes.json();
    if (frRes.ok && frJson.clients) fr = frJson;
  } catch (e) {
    root.innerHTML = `<div class="status-bar error" style="margin-bottom:12px">${h(e.message || 'FreeRADIUS-Daten konnten nicht geladen werden')}</div>`;
    return;
  }

  let frDocker = { available: false, running: false };
  try {
    const dRes = await fetch('/api/freeradius/docker');
    const dJson = await dRes.json();
    if (dRes.ok) frDocker = dJson;
  } catch (_) {}

  const frStartDis = !frDocker.available || frDocker.running === true;
  const frStopDis = !frDocker.available || frDocker.status === 'not_found';

  root.innerHTML = `
  <div style="max-width:960px;min-width:0;box-sizing:border-box">
    <p style="font-size:13px;color:var(--text2);line-height:1.55;margin:0 0 14px">
      <strong>FreeRADIUS</strong> im Docker-Container: NAS-<strong>clients</strong> (Shared Secret, erlaubte Quell-IP/CIDR). OnSite schreibt <code style="font-size:11px">docker/freeradius/clients.conf</code> und <code style="font-size:11px">data/freeradius.json</code>. Nach Änderungen den Container <strong>neu starten</strong> oder unten <strong>Stopp</strong>/<strong>Start</strong> (siehe <code style="font-size:11px">docker/freeradius/README.md</code>).
    </p>

    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:16px 18px;margin-bottom:14px;min-width:0;overflow-x:auto;box-sizing:border-box">
      <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Container &amp; Docker Compose</div>
      <div style="display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-bottom:12px;padding:10px 12px;background:var(--bg3);border-radius:var(--radius);border:1px solid var(--border)">
        <span style="font-size:12px;color:var(--text3)">Container <code style="font-size:11px">onsite-freeradius</code>:</span>
        <span id="fr-docker-status-text">${frDockerStatusLineHtml(frDocker)}</span>
        <div style="flex:1;min-width:8px"></div>
        <button type="button" class="btn btn-sm" onclick="refreshFreeRadiusDockerStatus()">Aktualisieren</button>
        <button type="button" class="btn btn-sm btn-primary" onclick="freeRadiusDockerStart()" ${frStartDis ? 'disabled' : ''}>Start</button>
        <button type="button" class="btn btn-sm btn-danger" onclick="freeRadiusDockerStop()" ${frStopDis ? 'disabled' : ''}>Stopp</button>
      </div>

      <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">NAS-Clients</div>
      <p style="font-size:12px;color:var(--text2);margin:0 0 10px">Mindestens einen Client mit Secret und erlaubter Quelle speichern.</p>
      <div class="table-wrap" style="margin-bottom:8px">
        <table style="width:100%"><thead><tr><th>Name</th><th>IP / CIDR</th><th>Secret</th><th style="width:44px"></th></tr></thead>
        <tbody id="fr-clients-body">${frRowsHtml(Array.isArray(fr.clients) ? fr.clients : [])}</tbody></table>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;align-items:center">
        <button type="button" class="btn btn-sm" onclick="frAddClientRow()">Client hinzufügen</button>
        <button type="button" class="btn btn-sm btn-primary" onclick="saveFreeRadiusConfig()">Speichern</button>
      </div>
      <label style="font-size:11px;color:var(--text3)">Notizen</label>
      <textarea class="search-input" id="fr-notes" rows="2" style="width:100%;box-sizing:border-box;margin-top:4px" placeholder="Optional">${h(fr.notes || '')}</textarea>
    </div>
  </div>`;
}

function frCollectClients() {
  const tbody = q('fr-clients-body');
  if (!tbody) return [];
  const out = [];
  tbody.querySelectorAll('tr').forEach((tr) => {
    if (tr.querySelector('td.empty')) return;
    const name = tr.querySelector('.fr-client-name')?.value?.trim() || '';
    const ipaddr = tr.querySelector('.fr-ipaddr')?.value?.trim() || '*';
    const secret = tr.querySelector('.fr-secret')?.value || '';
    if (!name) return;
    out.push({ name, ipaddr, secret });
  });
  return out;
}

export function frAddClientRow() {
  const tbody = q('fr-clients-body');
  if (!tbody) return;
  const empty = tbody.querySelector('td.empty');
  if (empty) empty.closest('tr')?.remove();
  tbody.insertAdjacentHTML('beforeend', `
    <tr>
      <td><input class="search-input fr-client-name" style="width:100%;box-sizing:border-box" value=""></td>
      <td><input class="search-input fr-ipaddr" style="width:100%;font-family:var(--mono);font-size:12px;box-sizing:border-box" value="*" placeholder="* oder CIDR"></td>
      <td><input class="search-input fr-secret" type="password" style="width:100%;box-sizing:border-box" value="" autocomplete="new-password"></td>
      <td><button type="button" class="btn btn-sm btn-danger" onclick="frRemoveClientRow(this)">×</button></td>
    </tr>`);
}

export function frRemoveClientRow(btn) {
  const tr = btn?.closest?.('tr');
  tr?.remove();
  const tbody = q('fr-clients-body');
  if (tbody && !tbody.querySelector('.fr-client-name')) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty">Keine Clients</td></tr>';
  }
}

export async function refreshFreeRadiusDockerStatus() {
  await renderFreeRadius();
}

export async function freeRadiusDockerStart() {
  try {
    const r = await fetch('/api/freeradius/docker/start', { method: 'POST' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Start fehlgeschlagen');
    await renderFreeRadius();
  } catch (e) {
    alert(e.message || 'Start fehlgeschlagen');
  }
}

export async function freeRadiusDockerStop() {
  try {
    const r = await fetch('/api/freeradius/docker/stop', { method: 'POST' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Stopp fehlgeschlagen');
    await renderFreeRadius();
  } catch (e) {
    alert(e.message || 'Stopp fehlgeschlagen');
  }
}

export async function saveFreeRadiusConfig() {
  try {
    const r = await fetch('/api/freeradius/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clients: frCollectClients(),
        notes: q('fr-notes')?.value || '',
      }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    alert('Gespeichert. FreeRADIUS-Container neu starten, damit clients.conf wirksam wird (siehe docker/freeradius/README.md).');
    await renderFreeRadius();
  } catch (e) {
    alert(e.message || 'Speichern fehlgeschlagen');
  }
}
