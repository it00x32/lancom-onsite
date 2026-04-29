import S from '../lib/state.js';
import { q, h } from '../lib/helpers.js';
import { devCredentials } from './devices.js';

/** Lädt Netzliste: zuerst /snmp (wie alle SNMP-Aufrufe), bei altem Server ohne case → /api/lx-wlan-networks */
async function loadLxWlanNetworksData(ip) {
  try {
    const d = await window.snmpQ?.(ip, 'lx-wlan-networks', { os: 'LCOS LX' });
    if (d) return d;
  } catch (e) {
    const msg = e.message || '';
    if (!msg.includes('Unbekannter Typ')) throw e;
  }
  const creds = devCredentials(ip);
  const r = await fetch('/api/lx-wlan-networks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ host: ip, ...creds }),
  });
  const text = await r.text();
  if (text.trim().startsWith('<')) {
    throw new Error(
      'Server liefert HTML statt JSON. Node neu starten (aktuelle api.js) oder Proxy prüfen. '
      + 'Hinweis: case „lx-wlan-networks“ fehlt im laufenden Prozess.',
    );
  }
  let d;
  try {
    d = JSON.parse(text);
  } catch {
    throw new Error('Ungültige API-Antwort');
  }
  if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}

async function applyLxWlanSsidRequest(ip, networkName, ssid) {
  const creds = devCredentials(ip);
  const writeCommunity = (S.appSettings.snmpWriteCommunity || '').trim() || creds.community;
  const extra = { networkName, ssid, writeCommunity, community: creds.community, version: creds.version };
  try {
    await window.snmpQ?.(ip, 'lx-wlan-set-ssid', extra);
    return;
  } catch (e) {
    const msg = e.message || '';
    if (!msg.includes('Unbekannter Typ')) throw e;
  }
  const r = await fetch('/api/lx-wlan-ssid', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ host: ip, networkName, ssid, writeCommunity, community: creds.community, version: creds.version }),
  });
  const text = await r.text();
  if (text.trim().startsWith('<')) {
    throw new Error('Server liefert HTML statt JSON – Node neu starten oder Proxy prüfen.');
  }
  let d;
  try {
    d = JSON.parse(text);
  } catch {
    throw new Error('Ungültige API-Antwort');
  }
  if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`);
}

/** Tab „WiFi Settings“: SSID-Konfiguration LCOS LX per SNMP (Setup-Tabelle). */
export function renderWifiSettings() {
  const el = q('wifi-settings-content');
  if (!el) return;
  const lxAll = Object.values(S.deviceStore || {}).filter((d) => d.type === 'lx-ap');
  const lxAps = lxAll.filter((d) => d.online === true);
  if (!lxAll.length) {
    el.innerHTML = `<div style="padding:24px;color:var(--text3);text-align:center;max-width:520px;margin:0 auto">Keine LCOS-LX-Access-Points in der Geräteliste. Bitte unter <b>Geräte</b> ein Gerät mit Typ <b>lx-ap</b> anlegen.</div>`;
    return;
  }
  if (!lxAps.length) {
    el.innerHTML = `<div style="padding:24px;color:var(--text3);text-align:center;max-width:520px;margin:0 auto">Kein LCOS-LX-AP mit Status <b>Online</b>. Im Tab <b>Geräte</b> Ping oder Status-Check ausführen — in der Auswahl erscheinen nur erreichbare Access Points.</div>`;
    return;
  }
  el.innerHTML = `
    <p style="font-size:11px;color:var(--text3);margin:0 0 12px">SNMP-Tabelle <code style="font-size:10px">1.3.6.1.4.1.2356.13.2.20.1</code> — Lesen per SNMP. Zum Setzen: Schreib-Community unter Einstellungen hinterlegen (oder dieselbe Zeichenkette wie in der Geräteliste, wenn ein gemeinsames Passwort genutzt wird). „NotWritable“ bedeutet oft, dass die Firmware diese OID schreibgeschützt ausliefert — dann SSID per Web-UI, CLI oder LMC.</p>
    <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px">
      <label style="font-size:12px;color:var(--text2)">Access Point</label>
      <select id="lx-wlan-ap-sel" class="search-input" style="min-width:220px">
        ${lxAps.map((a) => `<option value="${h(a.ip)}">${h(a.name || a.ip)}</option>`).join('')}
      </select>
      <button type="button" class="btn btn-sm" onclick="loadLxWlanNetworks()">Netze laden</button>
      <span id="lx-wlan-net-status" style="font-size:12px;color:var(--text3)"></span>
    </div>
    <div id="lx-wlan-net-table-wrap"></div>`;
}

export async function loadLxWlanNetworks() {
  const sel = q('lx-wlan-ap-sel');
  const st = q('lx-wlan-net-status');
  const wrap = q('lx-wlan-net-table-wrap');
  if (!sel || !wrap) return;
  const ip = sel.value;
  if (st) { st.textContent = 'Lade…'; st.style.color = 'var(--text3)'; }
  try {
    const d = await loadLxWlanNetworksData(ip);
    const nets = d?.networks || [];
    if (!nets.length) {
      wrap.innerHTML = '<div style="font-size:12px;color:var(--text3)">Keine Einträge — Walk liefert keine passenden OIDs oder noch keine WLAN-Netze.</div>';
      if (st) st.textContent = '';
      return;
    }
    wrap.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr style="color:var(--text3)"><th style="text-align:left;padding:4px 8px">Profil (Index)</th><th style="text-align:left;padding:4px 8px">SSID (SNMP)</th><th style="text-align:left;padding:4px 8px">Neue SSID</th><th></th></tr></thead>
      <tbody>
      ${nets.map((row) => {
        const name = row.networkName;
        const cur = row.ssid != null && row.ssid !== '' ? row.ssid : '—';
        const enc = encodeURIComponent(name);
        return `<tr style="border-top:1px solid var(--border)">
          <td style="padding:6px 8px;font-family:var(--mono);font-size:11px">${h(name)}</td>
          <td style="padding:6px 8px">${h(String(cur))}</td>
          <td style="padding:6px 8px"><input class="search-input lx-wlan-ssid-input" style="width:min(220px,100%)" maxlength="32" placeholder="max. 32 Zeichen"></td>
          <td style="padding:6px 8px"><button type="button" class="btn btn-sm" data-net="${enc}" onclick="applyLxWlanSsid(this)">Setzen</button></td>
        </tr>`;
      }).join('')}
      </tbody></table>`;
    if (st) { st.textContent = `${nets.length} Netz(e)`; st.style.color = 'var(--text3)'; }
  } catch (e) {
    if (st) { st.textContent = e.message || 'Fehler'; st.style.color = 'var(--red)'; }
    wrap.innerHTML = '';
  }
}

export async function applyLxWlanSsid(btn) {
  const sel = q('lx-wlan-ap-sel');
  const ip = sel?.value;
  const networkName = decodeURIComponent(btn.getAttribute('data-net') || '');
  const tr = btn.closest('tr');
  const inp = tr?.querySelector('input.lx-wlan-ssid-input');
  const ssid = inp?.value?.trim() || '';
  if (!ip || !networkName) return;
  if (!ssid.length) {
    window.alert?.('Neue SSID eingeben');
    return;
  }
  try {
    await applyLxWlanSsidRequest(ip, networkName, ssid);
    await loadLxWlanNetworks();
  } catch (e) {
    window.alert?.(e.message || 'SNMP SET fehlgeschlagen');
  }
}
