import { q, h, parseFetchJson, parseFetchJsonLenient } from '../lib/helpers.js';
import S from '../lib/state.js';

/**
 * NAC: eingebetteter RADIUS (MAC / PAP), Zertifikatsablage, externe Referenz.
 */

function macRowsHtml(rows) {
  if (!rows.length) {
    return '<tr><td colspan="4" class="empty">Keine MACs — im Modus „Nur freigegebene MACs" werden alle Access-Requests abgelehnt</td></tr>';
  }
  return rows.map((row) => `
      <tr>
        <td><input class="search-input nac-mac" style="width:100%;font-family:var(--mono);font-size:12px;box-sizing:border-box" value="${h(row.mac)}"></td>
        <td><input class="search-input nac-label" style="width:100%;box-sizing:border-box" value="${h(row.label || '')}"></td>
        <td style="width:72px"><input class="search-input nac-mac-vlan" type="number" min="1" max="4094" placeholder="VLAN" title="Optional: 1–4094 wenn dynamische VLANs aktiv" style="width:100%;box-sizing:border-box;font-size:12px" value="${row.vlan != null ? h(String(row.vlan)) : ''}"></td>
        <td style="width:44px"><button type="button" class="btn btn-sm btn-danger" onclick="nacRemoveMacRow(this)">×</button></td>
      </tr>`).join('');
}

function papRowsHtml(users) {
  if (!users.length) {
    return '<tr><td colspan="4" class="empty">Keine Benutzer — Access-Reject für alle</td></tr>';
  }
  return users.map((u) => `
      <tr>
        <td><input class="search-input nac-pap-user" style="width:100%;box-sizing:border-box" value="${h(u.user)}"></td>
        <td><input class="search-input nac-pap-pass" type="password" style="width:100%;box-sizing:border-box" value="${h(u.pass)}" placeholder="Passwort" autocomplete="new-password"></td>
        <td style="width:72px"><input class="search-input nac-pap-vlan" type="number" min="1" max="4094" placeholder="VLAN" title="Optional: 1–4094 wenn dynamische VLANs aktiv" style="width:100%;box-sizing:border-box;font-size:12px" value="${u.vlan != null ? h(String(u.vlan)) : ''}"></td>
        <td style="width:44px"><button type="button" class="btn btn-sm btn-danger" onclick="nacRemovePapRow(this)">×</button></td>
      </tr>`).join('');
}

function certRowsHtml(certs) {
  if (!certs.length) {
    return '<tr><td colspan="5" class="empty">Keine Dateien in data/nac-certs</td></tr>';
  }
  return certs.map((c) => {
    const sub = c.subject || c.kind || '—';
    const until = c.validTo || '—';
    const ondel = JSON.stringify(`nacDeleteCert(${JSON.stringify(c.name)})`);
    return `<tr>
      <td style="font-family:var(--mono);font-size:11px">${h(c.name)}</td>
      <td style="font-size:12px">${h(c.kind || '')}</td>
      <td style="font-size:11px;max-width:220px;overflow:hidden;text-overflow:ellipsis" title="${h(sub)}">${h(sub)}</td>
      <td style="font-size:11px">${h(until)}</td>
      <td><button type="button" class="btn btn-sm btn-danger" onclick=${ondel}>Löschen</button></td>
    </tr>`;
  }).join('');
}

export async function renderNac() {
  const root = q('nac-root');
  if (!root) return;
  let data;
  try {
    const r = await fetch('/api/nac');
    data = await parseFetchJson(r);
    if (!r.ok) throw new Error(data.error || 'NAC-Daten konnten nicht geladen werden');
  } catch (e) {
    root.innerHTML = `<div class="status-bar error" style="margin-bottom:12px">${h(e.message)}</div>`;
    return;
  }

  S.nacMacAllowlistCache = Array.isArray(data.macAllowlist) ? data.macAllowlist.map((row) => ({ ...row })) : [];
  window.renderClients?.();

  let certs = [];
  try {
    const cr = await fetch('/api/nac/certs');
    const cj = await parseFetchJsonLenient(cr);
    if (cr.ok && cj.certs) certs = cj.certs;
  } catch (_) {}

  const macs = Array.isArray(data.macAllowlist) ? data.macAllowlist : [];
  const users = Array.isArray(data.radiusUsers) ? data.radiusUsers : [];
  const st = data.embeddedRadiusStatus || {};
  const mode = data.nacAuthMode || 'mac_allowlist';
  const en = !!data.embeddedRadiusEnabled;
  const listenAuth = !!st.listeningAuth;
  const running = en && listenAuth;
  const detailBits = [
    st.listeningAuth ? `Auth UDP ${st.bind || '0.0.0.0'}:${st.authPort}` : '',
    st.listeningAcct ? `Acct ${st.acctPort}` : '',
    st.listeningCoa ? `CoA ${st.coaPort}` : '',
    st.lastError ? `Letzter Fehler: ${st.lastError}` : '',
  ].filter(Boolean);
  const embeddedStatusHtml = !en
    ? '<span style="color:var(--text3)">Aus</span> — RADIUS ist in der Konfiguration deaktiviert.'
    : running
      ? `<span style="color:#22c55e;font-weight:600">Läuft</span>${detailBits.length ? ` · <span style="color:var(--text2);font-weight:400">${h(detailBits.join(' · '))}</span>` : ''}`
      : `<span style="color:var(--orange);font-weight:600">Aktiviert, aber nicht aktiv</span>${detailBits.length ? ` · <span style="color:var(--text2);font-weight:400">${h(detailBits.join(' · '))}</span>` : ''}`;
  const startDis = running;
  /** Stopp erlauben solange aktiv in Konfiguration oder UDP noch offen (sonst kein „Zombie“-Stop möglich). */
  const stopDis = !en && !listenAuth;

  root.innerHTML = `
  <div style="max-width:960px;min-width:0;box-sizing:border-box">
    <p style="font-size:13px;color:var(--text2);line-height:1.55;margin:0 0 14px">
      <strong>NAC</strong>: OnSite kann einen <strong>eingebetteten RADIUS-Server</strong> (UDP) bereitstellen — typischerweise für <strong>MAC-Authentifizierung (MAB)</strong> an Switches/APs oder für Tests.
      <strong>EAP-TLS</strong> unterstützt diese eingebettete Instanz <strong>nicht</strong> — dafür nutzen Sie z. B. <strong>FreeRADIUS</strong> (Menü <em>Sicherheit → FreeRADIUS</em>), Windows <strong>NPS</strong> oder <strong>Cisco ISE</strong>. Die <strong>Zertifikatsablage</strong> unten hilft bei Verwaltung und Überblick; sie ersetzt keinen EAP-TLS-fähigen RADIUS-Server.
    </p>

    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:16px 18px;margin-bottom:14px;min-width:0;overflow-x:auto;box-sizing:border-box">
      <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Eingebetteter RADIUS-Server (OnSite)</div>
      <p style="font-size:12px;color:var(--text2);margin:0 0 10px">UDP-RADIUS auf diesem Host. <strong>Shared Secret</strong> und Ports legen Sie im folgenden Block fest — zum Starten muss ein Secret gesetzt sein (oder bereits gespeichert).</p>
      <div style="display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-bottom:12px;padding:10px 12px;background:var(--bg3);border-radius:var(--radius);border:1px solid var(--border)">
        <span style="font-size:12px;color:var(--text3)">Status:</span>
        <span id="nac-embedded-status-line">${embeddedStatusHtml}</span>
        <div style="flex:1;min-width:8px"></div>
        <button type="button" class="btn btn-sm" onclick="nacEmbeddedRadiusRefresh()">Aktualisieren</button>
        <button type="button" class="btn btn-sm btn-primary" onclick="nacEmbeddedRadiusStart()" ${startDis ? 'disabled' : ''}>Start</button>
        <button type="button" class="btn btn-sm btn-danger" onclick="nacEmbeddedRadiusStop()" ${stopDis ? 'disabled' : ''}>Stopp</button>
      </div>
      <p style="font-size:11px;color:var(--text3);margin:0">Nach <strong>Stopp</strong> werden keine Access-Requests mehr angenommen. <strong>Start</strong> übernimmt die aktuellen Werte aus dem Konfigurationsblock (Ports, MAC/PAP, Secret).</p>
    </div>

    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:16px 18px;margin-bottom:14px">
      <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">RADIUS- &amp; NAC-Konfiguration</div>
      <p style="font-size:12px;color:var(--text2);margin:0 0 10px">Bindung und Ports gelten für diesen Host. <strong>Shared Secret</strong> muss identisch zur Konfiguration am NAS (Switch/AP) sein.</p>
      <input type="hidden" id="nac-embedded-enabled-state" value="${data.embeddedRadiusEnabled ? 'true' : 'false'}">
      <input type="hidden" id="nac-embedded-secret-was-set" value="${data.embeddedRadiusSecretSet ? '1' : '0'}">
      <div style="display:grid;grid-template-columns:1fr 88px 88px 88px 88px;gap:10px;align-items:end;margin-bottom:10px">
        <div>
          <label style="font-size:11px;color:var(--text3)">Listen-Adresse</label>
          <input class="search-input" id="nac-embedded-bind" style="width:100%;box-sizing:border-box" value="${h(data.embeddedRadiusBind || '0.0.0.0')}" placeholder="0.0.0.0">
        </div>
        <div>
          <label style="font-size:11px;color:var(--text3)">Auth-UDP</label>
          <input class="search-input" id="nac-embedded-auth-port" type="number" min="1" max="65535" value="${Number(data.embeddedAuthPort) || 1812}">
        </div>
        <div>
          <label style="font-size:11px;color:var(--text3)">Acct-UDP</label>
          <input class="search-input" id="nac-embedded-acct-port" type="number" min="1" max="65535" value="${Number(data.embeddedAcctPort) || 1813}">
        </div>
        <div>
          <label style="font-size:11px;color:var(--text3)">CoA</label>
          <input class="search-input" id="nac-embedded-coa-port" type="number" min="0" max="65535" title="0 = aus, oft 3799" value="${Number(data.embeddedCoaPort) || 0}">
        </div>
      </div>
      <p style="font-size:11px;color:var(--text3);margin:0 0 10px"><strong>CoA/Disconnect:</strong> Port <code style="font-size:10px">0</code> = aus. Üblich <strong>3799</strong> — muss <em>anders</em> als Auth- und Acct-Port sein. Eingehende <em>CoA-Request</em> / <em>Disconnect-Request</em> werden protokolliert und mit ACK beantwortet (keine Policy-Änderung in OnSite).</p>
      <label style="display:flex;align-items:flex-start;gap:8px;margin-bottom:10px;font-size:13px;cursor:pointer;max-width:52em">
        <input type="checkbox" id="nac-embedded-vlan" ${data.embeddedVlanAssignmentEnabled ? 'checked' : ''} style="margin-top:3px">
        <span><strong>Dynamische VLANs</strong> (802.1Q): Bei erfolgreicher Auth sendet OnSite im <strong>Access-Accept</strong> die RADIUS-Attribute <code style="font-size:11px">Tunnel-Type=VLAN</code>, <code style="font-size:11px">Tunnel-Medium-Type=IEEE-802</code> und <code style="font-size:11px">Tunnel-Private-Group-Id</code> mit der unten pro MAC bzw. pro PAP-Benutzer eingetragenen VLAN-ID (1–4094). Leer lassen = nur Accept ohne VLAN-Zuweisung. Der Switch/AP muss MAB/RADIUS-VLAN unterstützen.</span>
      </label>
      <div style="margin-bottom:10px">
        <label style="font-size:11px;color:var(--text3)">Authentifizierungsmodus</label>
        <select class="search-input" id="nac-auth-mode" style="width:100%;max-width:420px" onchange="nacOnModeChange()">
          <option value="mac_allowlist" ${mode === 'mac_allowlist' ? 'selected' : ''}>Nur freigegebene MAC-Adressen (Calling-Station-Id / User-Name)</option>
          <option value="pap_users" ${mode === 'pap_users' ? 'selected' : ''}>Benutzer/Passwort (PAP, einfach — nur Tests/Lab)</option>
        </select>
      </div>
      <div style="margin-bottom:10px">
        <label style="font-size:11px;color:var(--text3)">Shared Secret ${data.embeddedRadiusSecretSet ? '(gesetzt)' : '(leer)'}</label>
        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">
          <input class="search-input" type="password" id="nac-embedded-secret" style="width:min(360px,100%);font-family:var(--mono)" placeholder="${data.embeddedRadiusSecretSet ? 'Neues Secret eingeben zum Ändern' : 'Secret eingeben'}" autocomplete="new-password">
          <button type="button" class="btn btn-sm btn-ghost" onclick="nacClearEmbeddedSecret()">Secret entfernen</button>
        </div>
      </div>
      <div id="nac-mac-section" style="display:${mode === 'mac_allowlist' ? 'block' : 'none'}">
        <div style="font-size:11px;font-weight:700;color:var(--text3);margin:12px 0 6px">Freigegebene MAC-Adressen</div>
        <div class="table-wrap" style="margin-bottom:8px">
          <table style="width:100%"><thead><tr><th>MAC</th><th>Bezeichnung</th><th style="width:80px">VLAN</th><th style="width:44px"></th></tr></thead>
          <tbody id="nac-mac-body">${macRowsHtml(macs)}</tbody></table>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px;align-items:center">
          <input class="search-input" id="nac-new-mac" style="width:200px;font-family:var(--mono);font-size:12px" placeholder="aa:bb:cc:dd:ee:ff" maxlength="17">
          <input class="search-input" id="nac-new-label" style="width:min(200px,100%)" placeholder="Bezeichnung" maxlength="120">
          <input class="search-input" id="nac-new-vlan" type="number" min="1" max="4094" style="width:88px" placeholder="VLAN" title="Optional">
          <button type="button" class="btn btn-sm" onclick="nacAddMacRow()">Hinzufügen</button>
        </div>
      </div>
      <div id="nac-pap-section" style="display:${mode === 'pap_users' ? 'block' : 'none'}">
        <div style="font-size:11px;font-weight:700;color:var(--text3);margin:12px 0 6px">PAP-Benutzer</div>
        <div class="table-wrap" style="margin-bottom:8px">
          <table style="width:100%"><thead><tr><th>Benutzername</th><th>Passwort</th><th style="width:80px">VLAN</th><th style="width:44px"></th></tr></thead>
          <tbody id="nac-pap-body">${papRowsHtml(users)}</tbody></table>
        </div>
        <button type="button" class="btn btn-sm" onclick="nacAddPapRow()">Benutzer hinzufügen</button>
      </div>
      <button type="button" class="btn btn-sm btn-primary" onclick="saveNacConfig()" style="margin-top:12px">NAC speichern &amp; RADIUS neu starten</button>
    </div>

    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:16px 18px;margin-bottom:14px">
      <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">RADIUS-Protokoll (Accounting &amp; CoA)</div>
      <p style="font-size:12px;color:var(--text2);margin:0 0 10px">Append-only: <code style="font-size:11px">data/nac-radius-log.jsonl</code> — neuester Eintrag zuerst in der Tabelle.</p>
      <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">
        <button type="button" class="btn btn-sm" onclick="loadNacRadiusLog()">Aktualisieren</button>
        <button type="button" class="btn btn-sm btn-danger" onclick="clearNacRadiusLog()">Protokoll leeren</button>
      </div>
      <div class="table-wrap" style="max-height:340px;overflow:auto">
        <table style="width:100%;font-size:11px"><thead><tr><th>Zeit</th><th>Art</th><th>User / Session</th><th>Calling-Station</th><th>Status / Paket</th><th>NAS</th><th>Remote</th></tr></thead>
        <tbody id="nac-radius-log-body"><tr><td colspan="7" class="empty">Lade…</td></tr></tbody></table>
      </div>
    </div>

    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:16px 18px;margin-bottom:14px">
      <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Zertifikate (PEM)</div>
      <p style="font-size:12px;color:var(--text2);margin:0 0 10px">Speicherort: <code style="font-size:11px">data/nac-certs</code>. Für <strong>EAP-TLS</strong> brauchen Sie in der Regel einen separaten RADIUS mit TLS — hier nur Ablage und Übersicht (Laufzeit, Subject).</p>
      <div class="table-wrap" style="margin-bottom:12px">
        <table style="width:100%"><thead><tr><th>Datei</th><th>Typ</th><th>Subject</th><th>Gültig bis</th><th></th></tr></thead>
        <tbody id="nac-cert-body">${certRowsHtml(certs)}</tbody></table>
      </div>
      <div style="display:grid;grid-template-columns:160px 1fr;gap:8px;margin-bottom:8px;align-items:start">
        <div>
          <label style="font-size:11px;color:var(--text3)">Dateiname</label>
          <input class="search-input" id="nac-cert-name" style="width:100%;box-sizing:border-box" placeholder="z. B. server.crt" maxlength="63">
        </div>
        <div>
          <label style="font-size:11px;color:var(--text3)">PEM-Inhalt</label>
          <textarea class="search-input" id="nac-cert-pem" rows="5" style="width:100%;box-sizing:border-box;font-family:var(--mono);font-size:11px" placeholder="-----BEGIN CERTIFICATE-----"></textarea>
        </div>
      </div>
      <button type="button" class="btn btn-sm" onclick="nacUploadCert()">Zertifikat / Key speichern</button>
    </div>

    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:16px 18px;min-width:0;overflow-x:auto;box-sizing:border-box">
      <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Externer RADIUS / Policy (Referenz)</div>
      <div style="display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr) minmax(0,1fr);gap:10px;margin-bottom:10px;align-items:end">
        <div style="min-width:0">
          <label style="display:block;font-size:11px;color:var(--text3);margin-bottom:4px;line-height:1.3">RADIUS-Host</label>
          <input class="search-input" id="nac-radius-host" style="width:100%;max-width:100%;box-sizing:border-box" value="${h(data.radiusHost || '')}">
        </div>
        <div style="min-width:0">
          <label style="display:block;font-size:11px;color:var(--text3);margin-bottom:4px;line-height:1.3">Auth-Port</label>
          <input class="search-input" id="nac-radius-auth" type="number" style="width:100%;max-width:100%;box-sizing:border-box" value="${Number(data.radiusAuthPort) || 1812}">
        </div>
        <div style="min-width:0">
          <label style="display:block;font-size:11px;color:var(--text3);margin-bottom:4px;line-height:1.3;word-break:break-word" title="Accounting-Port">Acct-Port</label>
          <input class="search-input" id="nac-radius-acct" type="number" style="width:100%;max-width:100%;box-sizing:border-box" value="${Number(data.radiusAcctPort) || 1813}">
        </div>
      </div>
      <div style="margin-bottom:10px">
        <label style="font-size:11px;color:var(--text3)">Policy-URL</label>
        <input class="search-input" id="nac-policy-url" style="width:100%;box-sizing:border-box" value="${h(data.policyUrl || '')}">
      </div>
      <div style="margin-bottom:10px">
        <label style="font-size:11px;color:var(--text3)">Notizen</label>
        <textarea class="search-input" id="nac-notes" rows="2" style="width:100%;box-sizing:border-box">${h(data.notes || '')}</textarea>
      </div>
      <button type="button" class="btn btn-sm btn-primary" onclick="saveNacConfig()">Speichern</button>
    </div>
  </div>`;

  loadNacRadiusLog();
}

export async function loadNacRadiusLog() {
  const tb = q('nac-radius-log-body');
  if (!tb) return;
  tb.innerHTML = '<tr><td colspan="7" class="empty">Lade…</td></tr>';
  try {
    const r = await fetch('/api/nac/radius-log?limit=400');
    const d = await parseFetchJson(r);
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    const rows = d.entries || [];
    if (!rows.length) {
      tb.innerHTML = '<tr><td colspan="7" class="empty">Keine Einträge</td></tr>';
      return;
    }
    tb.innerHTML = rows.map((e) => {
      const kind = e.kind === 'coa' ? 'CoA' : 'Accounting';
      const detail = e.kind === 'coa' ? String(e.packetCode || '') : String(e.acctStatusType ?? '');
      const userS = [e.userName, e.acctSessionId || e.sessionId].filter(Boolean).join(' · ') || '—';
      const mac = e.callingStationId || '—';
      const nas = e.nasIp || '—';
      return `<tr>
        <td style="white-space:nowrap">${h(String(e.ts || '').slice(0, 24))}</td>
        <td>${h(kind)}</td>
        <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis" title="${h(userS)}">${h(userS)}</td>
        <td style="font-family:var(--mono);max-width:140px;overflow:hidden;text-overflow:ellipsis">${h(mac)}</td>
        <td>${h(detail)}</td>
        <td style="font-family:var(--mono);font-size:10px">${h(nas)}</td>
        <td style="font-family:var(--mono);font-size:10px">${h(e.remote || '')}</td>
      </tr>`;
    }).join('');
  } catch (err) {
    tb.innerHTML = `<tr><td colspan="7" class="empty">${h(err.message)}</td></tr>`;
  }
}

export async function clearNacRadiusLog() {
  if (!confirm('RADIUS-Protokoll (JSONL) wirklich leeren?')) return;
  try {
    const r = await fetch('/api/nac/radius-log', { method: 'DELETE' });
    const d = await parseFetchJson(r);
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    await loadNacRadiusLog();
  } catch (e) {
    alert(e.message || 'Fehler');
  }
}

export function nacOnModeChange() {
  const mode = q('nac-auth-mode')?.value || 'mac_allowlist';
  const ms = q('nac-mac-section');
  const ps = q('nac-pap-section');
  if (ms) ms.style.display = mode === 'mac_allowlist' ? 'block' : 'none';
  if (ps) ps.style.display = mode === 'pap_users' ? 'block' : 'none';
}

function parseVlanField(el) {
  if (!el) return undefined;
  const s = String(el.value || '').trim();
  if (!s) return undefined;
  const n = parseInt(s, 10);
  if (Number.isNaN(n) || n < 1 || n > 4094) return undefined;
  return n;
}

function nacCollectMacs() {
  const tbody = q('nac-mac-body');
  if (!tbody) return [];
  const out = [];
  tbody.querySelectorAll('tr').forEach((tr) => {
    if (tr.querySelector('td.empty')) return;
    const mac = tr.querySelector('.nac-mac')?.value?.trim().toLowerCase();
    const label = tr.querySelector('.nac-label')?.value?.trim() || '';
    if (!mac) return;
    const vlan = parseVlanField(tr.querySelector('.nac-mac-vlan'));
    const row = { mac, label };
    if (vlan != null) row.vlan = vlan;
    out.push(row);
  });
  return out;
}

function nacCollectPap() {
  const tbody = q('nac-pap-body');
  if (!tbody) return [];
  const out = [];
  tbody.querySelectorAll('tr').forEach((tr) => {
    if (tr.querySelector('td.empty')) return;
    const user = tr.querySelector('.nac-pap-user')?.value?.trim() || '';
    const pass = tr.querySelector('.nac-pap-pass')?.value || '';
    if (!user) return;
    const vlan = parseVlanField(tr.querySelector('.nac-pap-vlan'));
    const row = { user, pass };
    if (vlan != null) row.vlan = vlan;
    out.push(row);
  });
  return out;
}

export function nacAddMacRow() {
  const macIn = q('nac-new-mac');
  const labIn = q('nac-new-label');
  const mac = (macIn?.value || '').trim().toLowerCase();
  const label = (labIn?.value || '').trim().slice(0, 120);
  const macRe = /^([0-9a-f]{2}):([0-9a-f]{2}):([0-9a-f]{2}):([0-9a-f]{2}):([0-9a-f]{2}):([0-9a-f]{2})$/;
  if (!macRe.test(mac)) {
    alert('MAC im Format aa:bb:cc:dd:ee:ff');
    return;
  }
  const tbody = q('nac-mac-body');
  if (!tbody) return;
  const empty = tbody.querySelector('td.empty');
  if (empty) empty.closest('tr')?.remove();
  const vlanIn = q('nac-new-vlan');
  const vlan = parseVlanField(vlanIn);
  const vlanCell = vlan != null
    ? `<td style="width:72px"><input class="search-input nac-mac-vlan" type="number" min="1" max="4094" placeholder="VLAN" style="width:100%;box-sizing:border-box;font-size:12px" value="${vlan}"></td>`
    : `<td style="width:72px"><input class="search-input nac-mac-vlan" type="number" min="1" max="4094" placeholder="VLAN" style="width:100%;box-sizing:border-box;font-size:12px" value=""></td>`;
  tbody.insertAdjacentHTML('beforeend', `
    <tr>
      <td><input class="search-input nac-mac" style="width:100%;font-family:var(--mono);font-size:12px;box-sizing:border-box" value="${h(mac)}"></td>
      <td><input class="search-input nac-label" style="width:100%;box-sizing:border-box" value="${h(label)}"></td>
      ${vlanCell}
      <td><button type="button" class="btn btn-sm btn-danger" onclick="nacRemoveMacRow(this)">×</button></td>
    </tr>`);
  if (macIn) macIn.value = '';
  if (labIn) labIn.value = '';
  if (vlanIn) vlanIn.value = '';
}

export function nacRemoveMacRow(btn) {
  const tr = btn?.closest?.('tr');
  tr?.remove();
  const tbody = q('nac-mac-body');
  if (tbody && !tbody.querySelector('.nac-mac')) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty">Keine MACs</td></tr>';
  }
}

export function nacAddPapRow() {
  const tbody = q('nac-pap-body');
  if (!tbody) return;
  const empty = tbody.querySelector('td.empty');
  if (empty) empty.closest('tr')?.remove();
  tbody.insertAdjacentHTML('beforeend', `
    <tr>
      <td><input class="search-input nac-pap-user" style="width:100%;box-sizing:border-box" value=""></td>
      <td><input class="search-input nac-pap-pass" type="password" style="width:100%;box-sizing:border-box" value="" autocomplete="new-password"></td>
      <td style="width:72px"><input class="search-input nac-pap-vlan" type="number" min="1" max="4094" placeholder="VLAN" style="width:100%;box-sizing:border-box;font-size:12px" value=""></td>
      <td><button type="button" class="btn btn-sm btn-danger" onclick="nacRemovePapRow(this)">×</button></td>
    </tr>`);
}

export function nacRemovePapRow(btn) {
  const tr = btn?.closest?.('tr');
  tr?.remove();
  const tbody = q('nac-pap-body');
  if (tbody && !tbody.querySelector('.nac-pap-user')) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty">Keine Benutzer</td></tr>';
  }
}

export async function nacClearEmbeddedSecret() {
  if (!confirm('Shared Secret wirklich löschen? Der RADIUS-Server startet ohne Secret nicht.')) return;
  try {
    const r = await fetch('/api/nac', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeddedRadiusSecret: '' }),
    });
    const d = await parseFetchJson(r);
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    await renderNac();
  } catch (e) {
    alert(e.message || 'Fehler');
  }
}

export async function nacUploadCert() {
  const name = q('nac-cert-name')?.value?.trim();
  const pem = q('nac-cert-pem')?.value?.trim();
  if (!name || !pem) {
    alert('Dateiname und PEM-Inhalt angeben');
    return;
  }
  try {
    const r = await fetch('/api/nac/cert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, pem }),
    });
    const d = await parseFetchJson(r);
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    if (q('nac-cert-pem')) q('nac-cert-pem').value = '';
    await renderNac();
  } catch (e) {
    alert(e.message || 'Upload fehlgeschlagen');
  }
}

export async function nacDeleteCert(name) {
  if (!confirm(`Datei „${name}“ löschen?`)) return;
  try {
    const r = await fetch(`/api/nac/cert/${encodeURIComponent(name)}`, { method: 'DELETE' });
    const d = await parseFetchJson(r);
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    await renderNac();
  } catch (e) {
    alert(e.message || 'Löschen fehlgeschlagen');
  }
}

function collectNacConfigBody(overrides = {}) {
  const en = overrides.embeddedRadiusEnabled !== undefined
    ? !!overrides.embeddedRadiusEnabled
    : (q('nac-embedded-enabled-state')?.value === 'true');
  const body = {
    radiusHost: q('nac-radius-host')?.value || '',
    radiusAuthPort: parseInt(q('nac-radius-auth')?.value, 10) || 1812,
    radiusAcctPort: parseInt(q('nac-radius-acct')?.value, 10) || 1813,
    policyUrl: q('nac-policy-url')?.value || '',
    notes: q('nac-notes')?.value || '',
    embeddedRadiusEnabled: en,
    embeddedRadiusBind: q('nac-embedded-bind')?.value || '0.0.0.0',
    embeddedAuthPort: parseInt(q('nac-embedded-auth-port')?.value, 10) || 1812,
    embeddedAcctPort: parseInt(q('nac-embedded-acct-port')?.value, 10) || 1813,
    embeddedCoaPort: Math.min(65535, Math.max(0, parseInt(q('nac-embedded-coa-port')?.value, 10) || 0)),
    embeddedVlanAssignmentEnabled: !!q('nac-embedded-vlan')?.checked,
    nacAuthMode: q('nac-auth-mode')?.value || 'mac_allowlist',
    macAllowlist: nacCollectMacs(),
    radiusUsers: nacCollectPap(),
  };
  const sec = q('nac-embedded-secret')?.value;
  if (sec && sec.trim()) body.embeddedRadiusSecret = sec.trim();
  return body;
}

export async function nacEmbeddedRadiusRefresh() {
  await renderNac();
}

export async function nacEmbeddedRadiusStart() {
  const typed = (q('nac-embedded-secret')?.value || '').trim();
  const wasSet = q('nac-embedded-secret-was-set')?.value === '1';
  if (!typed && !wasSet) {
    alert('Bitte zuerst ein Shared Secret im Konfigurationsblock setzen (und bei Bedarf „NAC speichern“).');
    return;
  }
  try {
    const r = await fetch('/api/nac', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(collectNacConfigBody({ embeddedRadiusEnabled: true })),
    });
    const d = await parseFetchJson(r);
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    await renderNac();
  } catch (e) {
    alert(e.message || 'Start fehlgeschlagen');
  }
}

export async function nacEmbeddedRadiusStop() {
  if (!confirm('Eingebetteten RADIUS-Server wirklich stoppen?')) return;
  try {
    const r = await fetch('/api/nac', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(collectNacConfigBody({ embeddedRadiusEnabled: false })),
    });
    const d = await parseFetchJson(r);
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    await renderNac();
  } catch (e) {
    alert(e.message || 'Stopp fehlgeschlagen');
  }
}

export async function saveNacConfig() {
  const st = q('nac-save-status');
  if (st) st.textContent = 'Speichern…';
  const body = collectNacConfigBody();
  try {
    const r = await fetch('/api/nac', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await parseFetchJson(r);
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    if (st) st.textContent = 'Gespeichert.';
    setTimeout(() => { if (st) st.textContent = ''; }, 4000);
    await renderNac();
  } catch (e) {
    if (st) st.textContent = '';
    alert(e.message || 'Speichern fehlgeschlagen');
  }
}
