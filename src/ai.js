const { readSettings, readDevices } = require('./data');
const { alertLog } = require('./alerts');
const { trapLog } = require('./traps');
const { getSyslogEntries } = require('./syslog');
const { getChanges: getTopoChanges } = require('./topo-changes');
const { getEvents: getRoamingEvents, getStats: getRoamingStats } = require('./roaming');
const { getHistory: getWifiHistory } = require('./wifi-history');

// ── Network context snapshot for the LLM ─────────────────────────────────────

function buildNetworkContext() {
  const devs   = readDevices();
  const list   = Object.values(devs);
  const online = list.filter(d => d.online === true);
  const offline = list.filter(d => d.online === false);

  // Geräte mit erweiterten Daten
  const deviceLines = list.map(d => {
    const parts = [d.ip, d.sysName || d.name || '–', d.os || '–',
      d.online === true ? 'online' : d.online === false ? 'OFFLINE' : '?'];
    if (d.type) parts.push(`Typ:${d.type}`);
    if (d.sysLocation) parts.push(`Ort:${d.sysLocation}`);
    if (d.model) parts.push(`Modell:${d.model}`);
    if (d.wlanClients?.length) parts.push(`WLAN:${d.wlanClients.length} Clients`);
    if (d.lldpCount) parts.push(`LLDP:${d.lldpCount} Nachbarn`);
    if (d.poeMain?.power) parts.push(`PoE:${d.poeMain.consumption}W/${d.poeMain.power}W (${Math.round(d.poeMain.consumption/d.poeMain.power*100)}%)`);
    return parts.join(' | ');
  }).join('\n');

  // WLAN-Zusammenfassung
  const allClients = list.flatMap(d => d.wlanClients || []);
  const band24 = allClients.filter(c => c.band === '2.4 GHz').length;
  const band5  = allClients.filter(c => c.band === '5 GHz').length;
  const band6  = allClients.filter(c => c.band === '6 GHz').length;
  const weakClients = allClients.filter(c => parseInt(c.signal) <= -75);
  const wlanSummary = allClients.length
    ? `${allClients.length} Clients (2.4GHz:${band24}, 5GHz:${band5}, 6GHz:${band6}) · ${weakClients.length} mit schwachem Signal (≤-75dBm)`
    : 'Keine WLAN-Daten';

  // WLAN pro AP
  const apLines = list.filter(d => d.wlanClients?.length).map(d => {
    const clients = d.wlanClients;
    const sigs = clients.map(c => parseInt(c.signal)).filter(s => !isNaN(s));
    const avg = sigs.length ? Math.round(sigs.reduce((a,b)=>a+b,0)/sigs.length) : null;
    const ssids = [...new Set(clients.map(c => c.ssid).filter(Boolean))];
    return `  ${d.name||d.ip}: ${clients.length} Clients, Ø ${avg ?? '?'}dBm, SSIDs: ${ssids.join(', ')||'?'}`;
  }).join('\n');

  // PoE-Übersicht
  const poeSwitches = list.filter(d => d.poeMain?.power);
  const totalPoeW = poeSwitches.reduce((s, d) => s + (d.poeMain?.consumption || 0), 0);
  const totalPoeMax = poeSwitches.reduce((s, d) => s + (d.poeMain?.power || 0), 0);
  const poeSummary = poeSwitches.length
    ? `${poeSwitches.length} Switches, ${totalPoeW}W / ${totalPoeMax}W (${totalPoeMax ? Math.round(totalPoeW/totalPoeMax*100) : 0}%)`
    : 'Kein PoE-Daten';
  const poeLines = poeSwitches.map(d => {
    const pct = Math.round(d.poeMain.consumption / d.poeMain.power * 100);
    return `  ${d.name||d.ip}: ${d.poeMain.consumption}W/${d.poeMain.power}W (${pct}%)${pct > 80 ? ' ⚠ HOCH' : ''}`;
  }).join('\n');

  // LLDP-Topologie
  const lldpDevs = list.filter(d => d.lldpData?.length);
  const lldpLines = lldpDevs.slice(0, 15).map(d =>
    `  ${d.name||d.ip}: ${d.lldpData.map(n => `${n.remSysName||'?'}(${n.localPortName||'?'}↔${n.remPortId||n.remPortDesc||'?'})`).join(', ')}`
  ).join('\n');

  // Traps
  const trapLines = trapLog.slice(0, 25).map(t =>
    `${t.ts} | ${t.from} | ${t.trapName || t.trapOid || '?'}`
  ).join('\n');

  // Alerts
  const alertLines = alertLog.slice(0, 25).map(a =>
    `${a.ts} | ${a.type} | ${a.title}`
  ).join('\n');

  // Syslog (letzte 20)
  let syslogLines = '(keine)';
  try {
    const syslog = getSyslogEntries().slice(0, 20);
    if (syslog.length) syslogLines = syslog.map(s => `${s.ts} | ${s.from} | ${s.severity} | ${s.msg?.slice(0,120)}`).join('\n');
  } catch {}

  // Topology Changes (24h)
  let topoChangeLines = '(keine)';
  try {
    const changes = getTopoChanges(24);
    if (changes.length) {
      topoChangeLines = `${changes.length} Änderungen:\n` + changes.slice(0, 15).map(c =>
        `  ${c.ts.slice(11,19)} ${c.type==='added'?'+':'-'} ${c.deviceName}: ${c.remoteName||'?'} (${c.localPort}↔${c.remotePort})`
      ).join('\n');
    }
  } catch {}

  // Roaming (24h)
  let roamingLines = '(keine)';
  try {
    const stats = getRoamingStats(24);
    if (stats.totalEvents > 0) {
      roamingLines = `${stats.totalEvents} Events, ${stats.uniqueClients} Clients`;
      if (stats.clients.length) {
        roamingLines += '\nHäufigste Roamer:\n' + stats.clients.slice(0, 10).map(c =>
          `  ${c.mac}${c.hostname?' ('+c.hostname+')':''}: ${c.roamCount}x zwischen ${c.aps.join(', ')}`
        ).join('\n');
      }
    }
  } catch {}

  // WiFi History Trend
  let wifiTrend = '(keine)';
  try {
    const hist = getWifiHistory(6);
    if (hist.length >= 2) {
      const first = Object.values(hist[0].aps).reduce((s, a) => s + a.clients, 0);
      const last  = Object.values(hist[hist.length-1].aps).reduce((s, a) => s + a.clients, 0);
      const diff  = last - first;
      wifiTrend = `${hist.length} Snapshots (${hist[0].ts.slice(11,16)}–${hist[hist.length-1].ts.slice(11,16)}): ${first}→${last} Clients (${diff >= 0 ? '+' : ''}${diff})`;
    }
  } catch {}

  return [
    `NETZWERK-ÜBERSICHT: ${list.length} Geräte, ${online.length} online, ${offline.length} offline`,
    '',
    'GERÄTE (IP | Name | OS | Status | Details):',
    deviceLines || '(keine Geräte)',
    '',
    `WLAN: ${wlanSummary}`,
    apLines ? `WLAN pro AP:\n${apLines}` : '',
    `WIFI-TREND (6h): ${wifiTrend}`,
    '',
    `POE: ${poeSummary}`,
    poeLines || '',
    '',
    lldpLines ? `LLDP-TOPOLOGIE (${lldpDevs.length} Geräte mit Nachbarn):\n${lldpLines}` : 'LLDP-TOPOLOGIE: (keine Daten)',
    '',
    `TOPOLOGIE-ÄNDERUNGEN (24h): ${topoChangeLines}`,
    '',
    `ROAMING (24h): ${roamingLines}`,
    '',
    'LETZTE SNMP-TRAPS:',
    trapLines || '(keine)',
    '',
    'LETZTE ALERTS:',
    alertLines || '(keine)',
    '',
    'LETZTE SYSLOG-NACHRICHTEN:',
    syslogLines,
  ].filter(l => l !== '').join('\n');
}

const SYSTEM_PROMPT = `Du bist der KI-Assistent von OnSite, einem lokalen SNMP-Netzwerk-Management-Dashboard für LANCOM-Infrastruktur.

Du hast Zugriff auf den aktuellen Netzwerkstatus (Geräte, Traps, Alerts) und hilfst Administratoren bei:
- Netzwerk-Analyse und Zusammenfassungen
- Problemdiagnose (Offline-Geräte, Traps, Loops, etc.)
- Konfigurationsempfehlungen für LANCOM-Geräte
- Interpretation von SNMP-Traps und Fehlermeldungen
- Best Practices für Netzwerk-Sicherheit und -Optimierung

Unterstützte LANCOM-Betriebssysteme:
- LCOS: Router/Gateways (SSH via expect, eigene WLAN-MIB)
- LCOS LX: Linux-basierte Access Points
- LCOS FX: Firewalls
- LCOS SX 3/4/5: Switches (Generationen 3, 4, 5; PoE, STP, Sensoren)

Antworte prägnant und praxisorientiert. Nutze die Sprache des Benutzers.`;

// ── OpenAI-compatible streaming (OpenAI, Ollama, Groq, etc.) ─────────────────

async function* openaiStream(messages, settings) {
  const endpoint = (settings.aiEndpoint || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model    = settings.aiModel || 'gpt-4o-mini';
  const apiKey   = settings.aiApiKey || '';

  const ctx = buildNetworkContext();
  const allMessages = [
    { role: 'system', content: `${SYSTEM_PROMPT}\n\n--- AKTUELLER NETZWERKSTATUS ---\n${ctx}` },
    ...messages,
  ];

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const resp = await fetch(`${endpoint}/chat/completions`, {
    method: 'POST', headers,
    body: JSON.stringify({ model, messages: allMessages, stream: true, max_tokens: 4000 }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`API ${resp.status}: ${body.slice(0, 300)}`);
  }

  yield* parseSSE(resp.body, chunk => {
    try {
      const j = JSON.parse(chunk);
      return j.choices?.[0]?.delta?.content || '';
    } catch { return ''; }
  });
}

// ── Anthropic Messages API streaming ─────────────────────────────────────────

async function* anthropicStream(messages, settings) {
  const endpoint = (settings.aiEndpoint || 'https://api.anthropic.com').replace(/\/+$/, '');
  const model    = settings.aiModel || 'claude-sonnet-4-20250514';
  const apiKey   = settings.aiApiKey || '';
  const ctx      = buildNetworkContext();

  const resp = await fetch(`${endpoint}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      system: `${SYSTEM_PROMPT}\n\n--- AKTUELLER NETZWERKSTATUS ---\n${ctx}`,
      messages,
      max_tokens: 4000,
      stream: true,
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`API ${resp.status}: ${body.slice(0, 300)}`);
  }

  yield* parseSSE(resp.body, chunk => {
    try {
      const j = JSON.parse(chunk);
      if (j.type === 'content_block_delta') return j.delta?.text || '';
      return '';
    } catch { return ''; }
  });
}

// ── Generic SSE parser ───────────────────────────────────────────────────────

async function* parseSSE(body, extractContent) {
  const reader  = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') return;
        const content = extractContent(data);
        if (content) yield content;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ── Main entry point ─────────────────────────────────────────────────────────

const PROVIDER_DEFAULTS = {
  gemini:    { endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.0-flash' },
  groq:      { endpoint: 'https://api.groq.com/openai/v1',                         model: 'llama-3.3-70b-versatile' },
  ollama:    { endpoint: 'http://localhost:11434/v1',                               model: 'llama3.2' },
  openai:    { endpoint: 'https://api.openai.com/v1',                               model: 'gpt-4o-mini' },
  anthropic: { endpoint: 'https://api.anthropic.com',                               model: 'claude-sonnet-4-20250514' },
};

async function* chatStream(messages) {
  const s = readSettings();
  const provider = s.aiProvider || 'gemini';
  const defaults = PROVIDER_DEFAULTS[provider] || PROVIDER_DEFAULTS.gemini;

  const settings = {
    ...s,
    aiEndpoint: s.aiEndpoint || defaults.endpoint,
    aiModel:    s.aiModel    || defaults.model,
  };

  if (!settings.aiApiKey && provider !== 'ollama') {
    throw new Error('KI nicht konfiguriert. Bitte unter Einstellungen → KI den API-Key hinterlegen.');
  }

  if (provider === 'anthropic') {
    yield* anthropicStream(messages, settings);
  } else {
    yield* openaiStream(messages, settings);
  }
}

module.exports = { chatStream, buildNetworkContext };
