const fs   = require('fs');
const path = require('path');

const PORT        = parseInt(process.argv[2] || process.env.PORT || '3004', 10);
// UI + GET /api/version — bei Änderungen hochzählen: PATCH = Fixes/Kleinigkeiten, MINOR = Features/UX, MAJOR = Breaking
const APP_VERSION = 'v0.11.1';

// PKG-Binary-Erkennung: beschreibbare Dateien neben der Binary, nicht im Snapshot
const IS_PKG  = !!process.pkg;
const BASE_DIR = IS_PKG ? path.dirname(process.execPath) : path.join(__dirname, '..');

const ALL_OS = ['LCOS', 'LCOS LX', 'LCOS FX', 'LCOS SX 3', 'LCOS SX 4', 'LCOS SX 5'];

// ── Datenpersistenz ───────────────────────────────────────────────────────────
// Optional: ONSITE_DATA_DIR=/var/lib/onsite/data — Daten außerhalb des App-Ordners (Updates ohne Überschreiben)
const DATA_DIR       = process.env.ONSITE_DATA_DIR
  ? path.resolve(process.env.ONSITE_DATA_DIR)
  : path.join(BASE_DIR, 'data');
const SCRIPTE_DIR    = path.join(BASE_DIR, 'scripte');
if (!fs.existsSync(SCRIPTE_DIR)) fs.mkdirSync(SCRIPTE_DIR, { recursive: true });
const ROLLOUT_FILENAME = '__rollout__.json';
// ROLLOUT-Script für jedes OS beim Start erstellen falls nicht vorhanden
for (const _os of ALL_OS) {
  const _d = path.join(SCRIPTE_DIR, _os);
  if (!fs.existsSync(_d)) fs.mkdirSync(_d, { recursive: true });
  const _f = path.join(_d, ROLLOUT_FILENAME);
  if (!fs.existsSync(_f)) fs.writeFileSync(_f, JSON.stringify({
    name: 'ROLLOUT', description: 'Wird nach jedem Rollout automatisch ausgeführt', os: [_os], commands: [],
  }, null, 2));
}
const SETTINGS_FILE  = path.join(DATA_DIR, 'settings.json');
const DEVICES_FILE   = path.join(DATA_DIR, 'devices.json');
const CRITERIA_FILE  = path.join(DATA_DIR, 'criteria.json');
const SDN_FILE       = path.join(DATA_DIR, 'sdn.json');
const LICENSE_FILE   = path.join(DATA_DIR, 'license.json');
const TRIAL_FILE     = path.join(DATA_DIR, 'trial.json');
const VARS_FILE      = path.join(DATA_DIR, 'vars.json');
const NAC_FILE       = path.join(DATA_DIR, 'nac.json');
const NAC_CERTS_DIR  = path.join(DATA_DIR, 'nac-certs');
const NAC_ACCT_LOG_FILE = path.join(DATA_DIR, 'nac-radius-log.jsonl');
const FREERADIUS_JSON = path.join(DATA_DIR, 'freeradius.json');
const FREERADIUS_DIR  = path.join(BASE_DIR, 'docker', 'freeradius');
const FREERADIUS_CLIENTS_FILE = path.join(FREERADIUS_DIR, 'clients.conf');
const TRAPS_FILE     = path.join(DATA_DIR, 'traps.json');
const TRAFFIC_HISTORY_FILE = path.join(DATA_DIR, 'traffic-history.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(NAC_CERTS_DIR)) fs.mkdirSync(NAC_CERTS_DIR, { recursive: true });
if (!fs.existsSync(FREERADIUS_DIR)) fs.mkdirSync(FREERADIUS_DIR, { recursive: true });

module.exports = {
  PORT,
  APP_VERSION,
  IS_PKG,
  BASE_DIR,
  ALL_OS,
  DATA_DIR,
  SCRIPTE_DIR,
  ROLLOUT_FILENAME,
  SETTINGS_FILE,
  DEVICES_FILE,
  CRITERIA_FILE,
  SDN_FILE,
  LICENSE_FILE,
  TRIAL_FILE,
  VARS_FILE,
  NAC_FILE,
  NAC_CERTS_DIR,
  NAC_ACCT_LOG_FILE,
  FREERADIUS_JSON,
  FREERADIUS_DIR,
  FREERADIUS_CLIENTS_FILE,
  TRAPS_FILE,
  TRAFFIC_HISTORY_FILE,
};
