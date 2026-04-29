const fs = require('fs');
const path = require('path');
const { BASE_DIR, DATA_DIR, FREERADIUS_JSON, FREERADIUS_CLIENTS_FILE, FREERADIUS_DIR } = require('./config');

const DEFAULT_FR = {
  notes: '',
  /** [{ name, ipaddr, secret }] — FreeRADIUS clients.conf */
  clients: [
    { name: 'default', ipaddr: '*', secret: 'testing123' },
  ],
};

function sanitizeClientName(name) {
  const s = String(name || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  return s.slice(0, 64) || 'client';
}

function sanitizeIpaddr(ip) {
  const s = String(ip || '').trim().slice(0, 128);
  if (!s) return '*';
  return s;
}

function escapeSecret(secret) {
  return String(secret || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}

function readFreeRadiusConfig() {
  try {
    const j = JSON.parse(fs.readFileSync(FREERADIUS_JSON, 'utf8'));
    const clients = Array.isArray(j.clients) ? j.clients : DEFAULT_FR.clients;
    let list = clients.map((c) => ({
      name: sanitizeClientName(c.name),
      ipaddr: sanitizeIpaddr(c.ipaddr),
      secret: String(c.secret || ''),
    })).filter((c) => c.name && c.secret).slice(0, 64);
    if (!list.length) list = [...DEFAULT_FR.clients];
    return {
      ...DEFAULT_FR,
      ...j,
      clients: list,
    };
  } catch {
    return { ...DEFAULT_FR, clients: [...DEFAULT_FR.clients] };
  }
}

function normalizeFreeRadiusPayload(body) {
  const b = body && typeof body === 'object' ? body : {};
  const existing = readFreeRadiusConfig();
  const raw = Array.isArray(b.clients) ? b.clients : existing.clients;
  const seen = new Set();
  const clients = [];
  for (const row of raw.slice(0, 64)) {
    const name = sanitizeClientName(row.name);
    if (seen.has(name)) continue;
    seen.add(name);
    let secret = String(row.secret != null ? row.secret : '').trim();
    if (!secret) {
      const prev = existing.clients.find((c) => c.name === name);
      if (prev && prev.secret) secret = prev.secret;
    }
    if (!secret) continue;
    clients.push({
      name,
      ipaddr: sanitizeIpaddr(row.ipaddr),
      secret: secret.slice(0, 256),
    });
  }
  if (!clients.length) {
    clients.push({ name: 'default', ipaddr: '*', secret: 'testing123' });
  }
  return {
    notes: String(b.notes != null ? b.notes : existing.notes || '').trim().slice(0, 4000),
    clients,
  };
}

function generateClientsConf(cfg) {
  const lines = [
    '# -*- text -*-',
    '# Erzeugt von OnSite — nicht manuell bearbeiten (Änderungen unter Sicherheit → FreeRADIUS speichern)',
    `# ${new Date().toISOString()}`,
    '',
  ];
  for (const c of cfg.clients) {
    lines.push(`client ${c.name} {`);
    lines.push(`    ipaddr = ${c.ipaddr}`);
    lines.push(`    secret = "${escapeSecret(c.secret)}"`);
    lines.push('    nas_type = other');
    lines.push('}');
    lines.push('');
  }
  return lines.join('\n');
}

function ensureFrDirs() {
  if (!fs.existsSync(FREERADIUS_DIR)) fs.mkdirSync(FREERADIUS_DIR, { recursive: true });
}

function writeFreeRadiusConfig(cfg) {
  ensureFrDirs();
  fs.writeFileSync(FREERADIUS_JSON, JSON.stringify(cfg, null, 2), 'utf8');
  fs.writeFileSync(FREERADIUS_CLIENTS_FILE, generateClientsConf(cfg), 'utf8');
}

module.exports = {
  DEFAULT_FR,
  readFreeRadiusConfig,
  normalizeFreeRadiusPayload,
  generateClientsConf,
  writeFreeRadiusConfig,
};
