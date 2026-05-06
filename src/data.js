const fs = require('fs');
const {
  SETTINGS_FILE,
  DEVICES_FILE,
  CRITERIA_FILE,
  SDN_FILE,
  VARS_FILE,
  NAC_FILE,
} = require('./config');

const DEFAULT_SDN = {
  vlans: [{ name: 'Management', vlanId: 1, isManagement: true }],
};
function readSdn()      { try { return JSON.parse(fs.readFileSync(SDN_FILE,'utf8')); } catch { return JSON.parse(JSON.stringify(DEFAULT_SDN)); } }
function writeSdn(data) { fs.writeFileSync(SDN_FILE, JSON.stringify(data, null, 2)); }

const DEFAULT_CRITERIA = {
  osCriteria: [
    { os: 'LCOS LX',   match: ['LCOS LX', 'LCOS-LX', 'LX-', 'LW-', 'OW-', 'OX-'] },
    { os: 'LCOS FX',   match: ['LCOS FX', 'LCOS-FX'] },
    { os: 'LCOS SX 3', match: ['LCOS SX 3.', 'LCOS-SX 3.', 'GS-2'] },
    { os: 'LCOS SX 4', match: ['LCOS SX 4.', 'LCOS-SX 4.', 'GS-3'] },
    { os: 'LCOS SX 5', match: ['LCOS SX 5.', 'LCOS-SX 5.', 'GS-4', 'XS-4', 'XS-5', 'XS-6', 'YS-7', 'CS-'] },
    { os: 'LCOS',      match: ['LCOS', 'LN-'] },
  ],
  typeCriteria: [
    { type: 'Access Point', keywords: ['OAP', 'IAP', 'LN'] },
    { type: 'Router',       keywords: [] },
  ],
};

const DEFAULT_SETTINGS = {
  snmpReadCommunity:  'public',
  snmpWriteCommunity: 'private',
  snmpVersion:        '2c',
  rssiGreen:  80,
  rssiYellow: 50,
  rssiOrange:  0,
  lastScanSubnet: '',
  snmpV3SecurityName:  '',
  snmpV3SecurityLevel: 'authPriv',
  snmpV3AuthProtocol:  'SHA',
  snmpV3AuthPassword:  '',
  snmpV3PrivProtocol:  'AES',
  snmpV3PrivPassword:  '',
  filterOS:   [],
  filterType: [],
  lmcHost:    'cloud.lancom.de',
  alertsEnabled: false,
  alertCooldownSec: 300,
  alertMonitorIntervalMin: 5,
  alertEmail:   { enabled: false, host: '', port: 587, secure: false, user: '', pass: '', from: '', to: '' },
  alertWebhook: { enabled: false, url: '', type: 'generic' },
  alertTelegram: { enabled: false, botToken: '', chatId: '', silent: false },
  alertRules:   { offline: true, online: true, trap: false, trapFilter: '', tempThreshold: 0, loop: true },
  scheduledScanHours: 0,
  scheduledScanSubnet: '',
  scheduledAutoSave: false,
  aiProvider: 'gemini',
  aiEndpoint: '',
  aiApiKey:   '',
  aiModel:    '',
  trafficPollInterval: 60,
  trafficHistoryEnabled: true,
  trafficRetentionHours: 24,
  trafficAutoStart: false,
  trafficWarnThreshold: 80,
  devicePassword: '',
  autoSyncMinutes: 0,
  notifyOffline: false,
  powerPricePerKwh: 0.3,
  filterOSOptions: [
    { v: 'LCOS', on: false },
    { v: 'LCOS LX', on: false },
    { v: 'LCOS SX 3', on: false },
    { v: 'LCOS SX 4', on: false },
    { v: 'LCOS SX 5', on: false },
    { v: 'LCOS FX', on: false },
  ],
  filterTypeOptions: [
    { v: 'Router', on: false },
    { v: 'Access Point', on: false },
    { v: 'Switch', on: false },
    { v: 'Firewall', on: false },
  ],
};

let _settingsCache  = null;
let _deviceCache    = null;
let _criteriaCache  = null;

function readCriteria() {
  if (_criteriaCache) return _criteriaCache;
  try { _criteriaCache = JSON.parse(fs.readFileSync(CRITERIA_FILE, 'utf8')); }
  catch { _criteriaCache = JSON.parse(JSON.stringify(DEFAULT_CRITERIA)); }
  return _criteriaCache;
}
function writeCriteria(data) {
  _criteriaCache = data;
  fs.writeFileSync(CRITERIA_FILE, JSON.stringify(data, null, 2));
}

function readSettings() {
  if (_settingsCache) return _settingsCache;
  try { _settingsCache = { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) }; }
  catch { _settingsCache = { ...DEFAULT_SETTINGS }; }
  return _settingsCache;
}
function writeSettings(data) {
  const patch = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  // Merge onto current persisted settings so partial POSTs (e.g. lastScanSubnet only)
  // do not reset omitted keys to DEFAULT_SETTINGS (SNMP v3 passwords would otherwise clear).
  _settingsCache = { ...readSettings(), ...patch };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(_settingsCache, null, 2));
}
function readDevices() {
  if (_deviceCache) return _deviceCache;
  try { _deviceCache = JSON.parse(fs.readFileSync(DEVICES_FILE, 'utf8')); }
  catch { _deviceCache = {}; }
  return _deviceCache;
}
function writeDevices(data) {
  _deviceCache = data;
  fs.writeFileSync(DEVICES_FILE, JSON.stringify(data, null, 2));
}
function readVars() {
  try { return JSON.parse(fs.readFileSync(VARS_FILE, 'utf8')); }
  catch { return {}; }
}
function writeVars(data) {
  fs.writeFileSync(VARS_FILE, JSON.stringify(data, null, 2));
}

const DEFAULT_NAC = {
  radiusHost: '',
  radiusAuthPort: 1812,
  radiusAcctPort: 1813,
  policyUrl: '',
  notes: '',
  /** @deprecated — wird bei Lesezugriff nach macAllowlist gemischt */
  trustedMacs: [],
  /** Freigegebene MACs für eingebetteten RADIUS (MAC-Modus) */
  macAllowlist: [],
  /** Eingebetteter RADIUS (UDP) */
  embeddedRadiusEnabled: false,
  embeddedRadiusBind: '0.0.0.0',
  embeddedAuthPort: 1812,
  embeddedAcctPort: 1813,
  /** 0 = aus; Standard CoA/Disconnect 3799 */
  embeddedCoaPort: 0,
  embeddedRadiusSecret: '',
  /** mac_allowlist | pap_users */
  nacAuthMode: 'mac_allowlist',
  /** Nur bei pap_users: [{ user, pass, vlan? }] */
  radiusUsers: [],
  /** Access-Accept: Tunnel-Type/Medium/Private-Group-Id (802.1Q VLAN) */
  embeddedVlanAssignmentEnabled: false,
};

function readNac() {
  try {
    const j = JSON.parse(fs.readFileSync(NAC_FILE, 'utf8'));
    const trusted = Array.isArray(j.trustedMacs) ? j.trustedMacs : [];
    const allow = Array.isArray(j.macAllowlist) ? j.macAllowlist : [];
    const macAllowlist = allow.length ? allow : trusted;
    const merged = {
      ...DEFAULT_NAC,
      ...j,
      trustedMacs: trusted,
      macAllowlist,
      radiusUsers: Array.isArray(j.radiusUsers) ? j.radiusUsers : [],
    };
    const ev = merged.embeddedRadiusEnabled;
    merged.embeddedRadiusEnabled = ev === true || ev === 'true' || ev === 1 || ev === '1';
    return merged;
  } catch {
    return { ...DEFAULT_NAC };
  }
}

function writeNac(data) {
  fs.writeFileSync(NAC_FILE, JSON.stringify({ ...DEFAULT_NAC, ...data }, null, 2));
}

module.exports = {
  DEFAULT_SETTINGS,
  DEFAULT_CRITERIA,
  DEFAULT_SDN,
  readSettings,
  writeSettings,
  readDevices,
  writeDevices,
  readCriteria,
  writeCriteria,
  readSdn,
  writeSdn,
  readVars,
  writeVars,
  DEFAULT_NAC,
  readNac,
  writeNac,
};
