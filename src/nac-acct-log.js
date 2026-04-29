const fs = require('fs');
const { NAC_ACCT_LOG_FILE } = require('./config');

const MAX_BYTES = 6 * 1024 * 1024;
const TRIM_LINES = 5000;

function attrVal(v) {
  if (v == null) return '';
  if (Buffer.isBuffer(v)) {
    const s = v.toString('ascii');
    if (/^[\x20-\x7e]+$/.test(s)) return s;
    return v.toString('hex');
  }
  if (typeof v === 'object' && v !== null && typeof v.toString === 'function') return String(v);
  return String(v);
}

function trimIfHuge() {
  try {
    const st = fs.statSync(NAC_ACCT_LOG_FILE);
    if (st.size <= MAX_BYTES) return;
    const raw = fs.readFileSync(NAC_ACCT_LOG_FILE, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    if (lines.length <= TRIM_LINES) return;
    const keep = lines.slice(-TRIM_LINES);
    fs.writeFileSync(NAC_ACCT_LOG_FILE, `${keep.join('\n')}\n`, 'utf8');
  } catch (_) {}
}

/**
 * @param {Record<string, unknown>} entry
 */
function appendNacRadiusLog(entry) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    ...entry,
  }) + '\n';
  fs.appendFileSync(NAC_ACCT_LOG_FILE, line, 'utf8');
  trimIfHuge();
}

function readNacAcctLog(limit = 200) {
  const n = Math.min(1000, Math.max(1, parseInt(limit, 10) || 200));
  try {
    if (!fs.existsSync(NAC_ACCT_LOG_FILE)) return [];
    const raw = fs.readFileSync(NAC_ACCT_LOG_FILE, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    const slice = lines.slice(-n).map((l) => JSON.parse(l));
    return slice.reverse();
  } catch {
    return [];
  }
}

function clearNacAcctLog() {
  fs.writeFileSync(NAC_ACCT_LOG_FILE, '', 'utf8');
}

function attrsForLog(attrs) {
  if (!attrs || typeof attrs !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(attrs)) {
    out[k] = attrVal(v);
  }
  return out;
}

module.exports = {
  appendNacRadiusLog,
  readNacAcctLog,
  clearNacAcctLog,
  attrsForLog,
  attrVal,
};
