/**
 * Gleiche Heuristik wie ui/tabs/roaming-syslog.js — Roaming-Erkennung aus Syslog-Zeilen.
 */

const MAC_RE = /(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}/g;
const OUI_ONLY_SOURCE = '(?<![0-9A-Fa-f])(?:[0-9A-Fa-f]{2}[:-]){2}[0-9A-Fa-f]{2}(?![:-][0-9A-Fa-f]{2})';
const OUI_ONLY_RE = new RegExp(OUI_ONLY_SOURCE, 'gi');

function normMac(m) {
  return m.replace(/-/g, ':').toUpperCase();
}

function fullMacCoversOui(fullNorm, ouiNorm) {
  return fullNorm.startsWith(ouiNorm) && fullNorm.length > ouiNorm.length;
}

function ouiIsContiguousInFullMac(ouiNorm, fullNorm) {
  const o = ouiNorm.split(':');
  const f = fullNorm.split(':');
  if (o.length !== 3 || f.length < 3) return false;
  const O = o.map((x) => x.toUpperCase());
  for (let i = 0; i <= f.length - 3; i++) {
    if (
      f[i].toUpperCase() === O[0]
      && f[i + 1].toUpperCase() === O[1]
      && f[i + 2].toUpperCase() === O[2]
    ) return true;
  }
  return false;
}

function isRoamingSyslogEntry(e) {
  const t = `${e.message || ''}\n${e.raw || ''}\n${e.program || ''}\n${e.hostname || ''}`.toLowerCase();
  if (/\broam|roaming|reassoc|re-assoc|802\.11r|bss transition|fast transition|dot11r|\b11r\b|pmk\b|okc\b|mobility domain/.test(t)) return true;
  if (/(wlan|wifi|802\.11|hostapd|wpa_supplicant|ath|nl80211)/.test(t)
      && /(reassoc|disassoc|deauth|new bssid|different ap|wechsel|hand-?off|sticky|ft\s|ieee\s*802)/.test(t)) return true;
  if (/(sta|station|client).{0,120}(ap|bss|bssid)/.test(t) && /(chang|switch|move|von|nach|new|another)/.test(t)) return true;
  return false;
}

/** MAC-Keys (inkl. synthetischer OUI:…:00:00:00) wie im Roaming-UI-Tracker */
function extractMacKeysFromSyslogEntry(e) {
  const text = `${e.message || ''} ${e.raw || ''}`;
  MAC_RE.lastIndex = 0;
  OUI_ONLY_RE.lastIndex = 0;
  const fullMacs = [...new Set((text.match(MAC_RE) || []).map(normMac))];
  const ouiRaw = text.match(OUI_ONLY_RE) || [];
  const ouiNormList = [...new Set(ouiRaw.map(normMac))].filter((oui) =>
    !fullMacs.some((f) => fullMacCoversOui(f, oui) || ouiIsContiguousInFullMac(oui, f)),
  );
  return [...fullMacs, ...ouiNormList.map((o) => `${o}:00:00:00`)];
}

module.exports = { isRoamingSyslogEntry, extractMacKeysFromSyslogEntry };
