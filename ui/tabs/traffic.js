import S from '../lib/state.js';
import { q, h, mkTh, applySort, clickSort } from '../lib/helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TRAFFIC TAB — Live LLDP-Uplink Traffic Monitor with per-link Charts
// ═══════════════════════════════════════════════════════════════════════════════

let polling = false;
let pollTimer = null;
let pollCount = 0;
let liveData = {};       // ip → { ifName → { inBps, outBps, speedBps, utilPct } }
let historyCache = {};   // full history from backend
let selectedDev = '';
let selectedRange = 'live';
let selectedLink = '';   // edgeKey "ip|port" — which link's chart to show
let localHistory = {};   // edgeKey → [{ts, in, out}] ring-buffer (max 120)
let trafficSort = { col: 'util', dir: 'desc' };
let cachedEdges = [];    // cached edge list for lookups

function formatBps(bps) {
  if (bps >= 1e9) return (bps / 1e9).toFixed(2) + ' Gbps';
  if (bps >= 1e6) return (bps / 1e6).toFixed(1) + ' Mbps';
  if (bps >= 1e3) return (bps / 1e3).toFixed(0) + ' kbps';
  return bps + ' bps';
}

function formatBpsShort(bps) {
  if (bps >= 1e9) return (bps / 1e9).toFixed(1) + 'G';
  if (bps >= 1e6) return (bps / 1e6).toFixed(0) + 'M';
  if (bps >= 1e3) return (bps / 1e3).toFixed(0) + 'k';
  return bps + '';
}

// ── LLDP edge extraction from deviceStore ────────────────────────────────────
function getLldpEdges() {
  const edges = [];
  const seen = new Set();
  for (const dev of Object.values(S.deviceStore)) {
    if (!dev.lldpData?.length) continue;
    for (const entry of dev.lldpData) {
      const srcIp = dev.ip;
      const srcPort = entry.localPortName || '';
      const remName = entry.remSysName || entry.remPortId || '';
      const remPort = entry.remPortId || entry.remPortDesc || '';
      const tgtIp = resolveNeighborIp(entry, srcIp);
      const key = [srcIp, tgtIp || remName, srcPort].sort().join('||');
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({
        srcIp, srcPort, srcName: dev.name || dev.ip,
        tgtIp, tgtPort: remPort, tgtName: tgtIp ? (S.deviceStore[tgtIp]?.name || tgtIp) : remName,
        key: srcIp + '|' + srcPort,
      });
    }
  }
  cachedEdges = edges;
  return edges;
}

function resolveNeighborIp(entry, srcIp) {
  if (entry.remChassisIp && entry.remChassisIp !== '0.0.0.0' && S.deviceStore[entry.remChassisIp]) {
    return entry.remChassisIp;
  }
  const remMac = (entry.remMac || '').replace(/[\-\. ]/g, ':').toLowerCase();
  for (const d of Object.values(S.deviceStore)) {
    if (d.ip === srcIp) continue;
    const macs = [d.mac, ...(d.macs || [])].map(m => (m || '').replace(/[\-\. ]/g, ':').toLowerCase()).filter(Boolean);
    if (remMac && macs.includes(remMac)) return d.ip;
  }
  return null;
}

function edgeByKey(key) {
  return cachedEdges.find(e => e.key === key);
}

// ── Polling ──────────────────────────────────────────────────────────────────

export function trafficTogglePoll() {
  if (polling) stopPoll(); else startPoll();
}

function startPoll() {
  polling = true;
  pollCount = 0;
  const btn = q('traffic-toggle-btn');
  if (btn) { btn.textContent = '■ Stop'; btn.classList.add('btn-danger'); }
  setStatus('📡 Starte Traffic-Messung…');
  fetchLive();
  const interval = (S.appSettings?.trafficPollInterval || 60) * 1000;
  pollTimer = setInterval(fetchLive, interval);
}

function stopPoll() {
  polling = false;
  clearInterval(pollTimer);
  pollTimer = null;
  const btn = q('traffic-toggle-btn');
  if (btn) { btn.textContent = '▶ Start'; btn.classList.remove('btn-danger'); }
  setStatus('');
}

async function fetchLive() {
  try {
    const params = new URLSearchParams({ lldp: '1' });
    if (selectedDev) params.set('ip', selectedDev);
    const res = await fetch('/api/iftraffic?' + params);
    if (!res.ok) { setStatus('⚠ HTTP ' + res.status); return; }
    liveData = await res.json();
    pollCount++;

    const ts = Date.now();
    const edges = getLldpEdges();
    for (const e of edges) {
      const ifMap = liveData[e.srcIp];
      if (!ifMap) continue;
      const iface = findIface(ifMap, e.srcPort);
      if (!iface) continue;
      if (!localHistory[e.key]) localHistory[e.key] = [];
      localHistory[e.key].push({ ts, in: iface.inBps, out: iface.outBps });
      if (localHistory[e.key].length > 120) localHistory[e.key].shift();
    }

    // Auto-select first link if none selected
    if (!selectedLink && edges.length) {
      selectedLink = edges[0].key;
    }

    const devCount = Object.keys(liveData).length;
    if (pollCount === 1) {
      setStatus(`📡 Erste Messung (${devCount} Gerät${devCount !== 1 ? 'e' : ''})… warte auf Delta…`);
    } else {
      let maxBps = 0;
      Object.values(liveData).forEach(d => Object.values(d).forEach(i => { maxBps = Math.max(maxBps, i.inBps, i.outBps); }));
      setStatus(`📶 Live · ${devCount} Gerät${devCount !== 1 ? 'e' : ''} · max ${formatBps(maxBps)}`);
    }

    renderTable();
    renderChart();
  } catch (err) {
    setStatus('⚠ Fehler: ' + err.message);
  }
}

function findIface(ifMap, portName) {
  if (!ifMap || !portName) return null;
  if (ifMap[portName]) return ifMap[portName];
  const norm = s => (s || '').toLowerCase().replace(/[\s\-_]/g, '');
  const t = norm(portName);
  for (const [k, v] of Object.entries(ifMap)) { if (norm(k) === t) return v; }
  // Extract port number: "9A" → 9, "Port 7" → 7, "GigabitEthernet 1/7" → 7
  const extractNum = s => { const m = (s || '').match(/(\d+)\s*[a-z]?\s*$/i); return m ? parseInt(m[1], 10) : null; };
  const edgeNum = extractNum(portName);
  if (edgeNum !== null) {
    const physRe = /^(port|gigabit|switch|ethernet|eth|ge|fe|te|lan)/i;
    for (const [k, v] of Object.entries(ifMap)) {
      if (physRe.test(k) && extractNum(k) === edgeNum) return v;
    }
    for (const [k, v] of Object.entries(ifMap)) {
      if (/^\d+$/.test(k.trim()) && parseInt(k.trim(), 10) === edgeNum) return v;
    }
  }
  return null;
}

// ── History loading ──────────────────────────────────────────────────────────

async function fetchHistory() {
  try {
    const url = selectedDev ? `/api/traffic-history?ip=${encodeURIComponent(selectedDev)}` : '/api/traffic-history';
    const res = await fetch(url);
    if (!res.ok) return;
    historyCache = await res.json();
    renderChart();
    renderTable();
  } catch { /* ignore */ }
}

// ── Link selection ───────────────────────────────────────────────────────────

export function trafficSelectLink(key) {
  selectedLink = key;
  renderTable();
  renderChart();
}

// ── Device / range selectors ─────────────────────────────────────────────────

export function trafficDevChanged() {
  selectedDev = q('traffic-dev-select')?.value || '';
  selectedLink = '';
  if (selectedRange !== 'live') fetchHistory();
  else if (polling) fetchLive();
}

export function trafficRangeChanged() {
  selectedRange = q('traffic-range-select')?.value || 'live';
  if (selectedRange === 'live') {
    if (!polling) { renderChart(); renderTable(); }
  } else {
    fetchHistory();
  }
}

export function trafficClearHistory() {
  if (!confirm('Traffic-History wirklich löschen?')) return;
  fetch('/api/traffic-history', { method: 'DELETE' }).then(() => {
    historyCache = {};
    localHistory = {};
    setStatus('✓ History gelöscht');
    renderChart();
    renderTable();
  });
}

// ── Tab activation ───────────────────────────────────────────────────────────

export function initTrafficTab() {
  populateDevSelect();
  if (S.appSettings?.trafficAutoStart && !polling) startPoll();
  if (selectedRange !== 'live') {
    fetchHistory();
  } else if (polling) {
    renderTable();
    renderChart();
  }
}

export function stopTrafficPoll() {
  if (polling) stopPoll();
}

function populateDevSelect() {
  const sel = q('traffic-dev-select');
  if (!sel) return;
  const devs = Object.values(S.deviceStore)
    .filter(d => d.lldpData?.length)
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  sel.innerHTML = '<option value="">Alle Geräte</option>' +
    devs.map(d => `<option value="${h(d.ip)}"${d.ip === selectedDev ? ' selected' : ''}>${h(d.name || d.ip)}</option>`).join('');
}

function setStatus(msg) {
  const el = q('traffic-status');
  if (el) el.innerHTML = msg;
}

// ── Table rendering ──────────────────────────────────────────────────────────

function renderTable() {
  const tbody = q('tbl-traffic')?.querySelector('tbody');
  if (!tbody) return;

  const edges = getLldpEdges();
  const rows = [];
  const warnPct = S.appSettings?.trafficWarnThreshold || 80;

  for (const e of edges) {
    if (selectedDev && e.srcIp !== selectedDev && e.tgtIp !== selectedDev) continue;
    const ifMap = liveData[e.srcIp];
    const iface = ifMap ? findIface(ifMap, e.srcPort) : null;
    const hist = localHistory[e.key] || [];

    const fiveMinSamples = hist.slice(-5);
    const avg5in = fiveMinSamples.length ? Math.round(fiveMinSamples.reduce((a, s) => a + s.in, 0) / fiveMinSamples.length) : 0;
    const avg5out = fiveMinSamples.length ? Math.round(fiveMinSamples.reduce((a, s) => a + s.out, 0) / fiveMinSamples.length) : 0;

    const hEntry = historyCache[e.srcIp]?.[e.srcPort];
    const hourly = hEntry?.hourly || [];
    const lastHourly = hourly[hourly.length - 1];
    const avg1hIn = lastHourly?.inAvg || 0;
    const avg1hOut = lastHourly?.outAvg || 0;

    rows.push({
      srcName: e.srcName, srcPort: e.srcPort, tgtName: e.tgtName,
      inBps: iface?.inBps || 0, outBps: iface?.outBps || 0,
      util: iface?.utilPct || 0, speedBps: iface?.speedBps || 0,
      avg5in, avg5out, avg1hIn, avg1hOut,
      key: e.key, hist, warnPct,
    });
  }

  rows.sort((a, b) => {
    let va, vb;
    switch (trafficSort.col) {
      case 'dev': va = a.srcName; vb = b.srcName; break;
      case 'iface': va = a.srcPort; vb = b.srcPort; break;
      case 'neighbor': va = a.tgtName; vb = b.tgtName; break;
      case 'tx': va = a.outBps; vb = b.outBps; break;
      case 'rx': va = a.inBps; vb = b.inBps; break;
      case 'util': va = a.util; vb = b.util; break;
      default: va = a.util; vb = b.util;
    }
    if (typeof va === 'string') return trafficSort.dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    return trafficSort.dir === 'asc' ? va - vb : vb - va;
  });

  const cnt = q('cnt-traffic');
  if (cnt) cnt.textContent = rows.length ? `(${rows.length})` : '';

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty">Keine LLDP-Uplinks mit Traffic-Daten</td></tr>';
    return;
  }

  // Auto-select first link if nothing selected
  if (!selectedLink && rows.length) selectedLink = rows[0].key;

  tbody.innerHTML = rows.map(r => {
    const utilColor = r.util >= r.warnPct ? (r.util >= 90 ? 'var(--red)' : 'var(--yellow)') : 'var(--green)';
    const sparkSvg = buildSparklineSvg(r.hist, 110, 24);
    const sel = r.key === selectedLink;
    const rowStyle = sel
      ? 'background:var(--accent-bg, rgba(59,130,246,.08));cursor:pointer'
      : 'cursor:pointer';
    return `<tr onclick="trafficSelectLink('${h(r.key)}')" style="${rowStyle}">
      <td style="font-weight:600;font-size:12px">${sel ? '▸ ' : ''}${h(r.srcName)}</td>
      <td class="mono" style="font-size:11px">${h(r.srcPort)}</td>
      <td style="font-size:12px;color:var(--text2)">${h(r.tgtName)}</td>
      <td style="text-align:right;font-size:12px;color:#f97316;font-weight:600">${formatBps(r.outBps)}</td>
      <td style="text-align:right;font-size:12px;color:#22c55e;font-weight:600">${formatBps(r.inBps)}</td>
      <td style="text-align:right;font-size:12px"><span style="color:${utilColor};font-weight:700">${r.util.toFixed(1)}%</span>${r.speedBps ? `<span style="color:var(--text3);font-size:10px;margin-left:4px">(${formatBpsShort(r.speedBps)})</span>` : ''}</td>
      <td style="text-align:right;font-size:11px;color:var(--text2)" title="Ø TX: ${formatBps(r.avg5out)} / Ø RX: ${formatBps(r.avg5in)}">↑${formatBpsShort(r.avg5out)} ↓${formatBpsShort(r.avg5in)}</td>
      <td style="text-align:right;font-size:11px;color:var(--text3)" title="Ø TX: ${formatBps(r.avg1hOut)} / Ø RX: ${formatBps(r.avg1hIn)}">↑${formatBpsShort(r.avg1hOut)} ↓${formatBpsShort(r.avg1hIn)}</td>
      <td>${sparkSvg}</td>
    </tr>`;
  }).join('');
}

function buildSparklineSvg(hist, w, ht) {
  if (!hist || hist.length < 2) return '<span style="color:var(--text3);font-size:10px">—</span>';
  const max = Math.max(...hist.map(p => Math.max(p.in, p.out)), 1);
  const step = w / (hist.length - 1);
  const pts = key => hist.map((p, i) => `${(i * step).toFixed(1)},${(ht - p[key] / max * ht).toFixed(1)}`).join(' ');
  return `<svg width="${w}" height="${ht}" style="display:block;overflow:visible">
    <polyline points="${pts('out')}" fill="none" stroke="#f97316" stroke-width="1.2" stroke-linejoin="round" opacity="0.8"/>
    <polyline points="${pts('in')}" fill="none" stroke="#22c55e" stroke-width="1.2" stroke-linejoin="round" opacity="0.8"/>
  </svg>`;
}

// ── Canvas chart rendering (per-link) ────────────────────────────────────────

function renderChart() {
  const canvas = q('traffic-canvas');
  const emptyEl = q('traffic-chart-empty');
  const labelEl = q('traffic-chart-label');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();
  const W = Math.floor(rect.width - 24);
  const H = 260;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  if (!selectedLink) {
    ctx.clearRect(0, 0, W, H);
    if (emptyEl) emptyEl.style.display = '';
    if (emptyEl) emptyEl.textContent = 'Klicke auf eine Verbindung in der Tabelle';
    if (labelEl) labelEl.innerHTML = '';
    renderStats([]);
    return;
  }

  const edge = edgeByKey(selectedLink);
  const [linkIp, linkPort] = selectedLink.split('|');

  // Update chart label
  if (labelEl) {
    const devName = edge?.srcName || linkIp;
    const neighbor = edge?.tgtName || '?';
    labelEl.innerHTML = `<span style="font-weight:700;color:var(--text1)">${h(devName)}</span>` +
      `<span style="color:var(--text3);margin:0 6px">→</span>` +
      `<span style="color:var(--text2)">${h(neighbor)}</span>` +
      `<span style="color:var(--text3);margin-left:8px;font-size:11px;font-family:monospace">${h(linkPort)}</span>`;
  }

  let dataPoints = [];

  if (selectedRange === 'live') {
    const hist = localHistory[selectedLink];
    if (!hist?.length) {
      ctx.clearRect(0, 0, W, H);
      if (emptyEl) { emptyEl.style.display = ''; emptyEl.textContent = 'Noch keine Live-Daten für diesen Link'; }
      renderStats([]);
      return;
    }
    dataPoints = hist.map(s => ({ ts: Math.floor(s.ts / 1000), in: s.in, out: s.out }));
  } else {
    const minutes = parseInt(selectedRange, 10) || 60;
    const cutoff = Math.floor(Date.now() / 1000) - minutes * 60;
    const entry = historyCache[linkIp]?.[linkPort];
    if (entry?.samples?.length) {
      dataPoints = entry.samples.filter(s => s.ts >= cutoff);
    }
  }

  if (dataPoints.length < 2) {
    ctx.clearRect(0, 0, W, H);
    if (emptyEl) {
      emptyEl.style.display = '';
      emptyEl.textContent = selectedRange === 'live'
        ? 'Noch keine Live-Daten für diesen Link'
        : 'Keine History-Daten im gewählten Zeitraum';
    }
    renderStats([]);
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  drawChart(ctx, W, H, dataPoints);
  renderStats(dataPoints);
}

function drawChart(ctx, W, H, pts) {
  const dark = document.documentElement.classList.contains('dark');
  const PAD = { top: 28, right: 16, bottom: 32, left: 62 };
  const cw = W - PAD.left - PAD.right;
  const ch = H - PAD.top - PAD.bottom;

  ctx.clearRect(0, 0, W, H);

  const maxVal = Math.max(...pts.map(p => Math.max(p.in, p.out)), 1);
  const niceMax = niceScale(maxVal);
  const minTs = pts[0].ts;
  const maxTs = pts[pts.length - 1].ts;
  const tsRange = Math.max(maxTs - minTs, 1);

  const xOf = p => PAD.left + (p.ts - minTs) / tsRange * cw;
  const yOf = v => PAD.top + ch - v / niceMax * ch;

  // Grid
  ctx.strokeStyle = dark ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.06)';
  ctx.lineWidth = 1;
  const gridSteps = 5;
  for (let i = 0; i <= gridSteps; i++) {
    const y = PAD.top + ch * i / gridSteps;
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(W - PAD.right, y); ctx.stroke();
  }

  // Y-axis
  ctx.fillStyle = dark ? 'rgba(255,255,255,.4)' : 'rgba(0,0,0,.35)';
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'right';
  for (let i = 0; i <= gridSteps; i++) {
    const val = niceMax * (gridSteps - i) / gridSteps;
    ctx.fillText(formatBpsShort(val), PAD.left - 6, PAD.top + ch * i / gridSteps + 3);
  }

  // X-axis
  ctx.textAlign = 'center';
  const xLabels = selectedRange === 'live' ? 6 : 8;
  for (let i = 0; i <= xLabels; i++) {
    const ts = minTs + tsRange * i / xLabels;
    const x = PAD.left + cw * i / xLabels;
    const d = new Date(ts * 1000);
    const label = d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
    ctx.fillText(label, x, H - PAD.bottom + 16);
  }

  // Area: TX
  ctx.beginPath();
  ctx.moveTo(xOf(pts[0]), yOf(0));
  for (const p of pts) ctx.lineTo(xOf(p), yOf(p.out));
  ctx.lineTo(xOf(pts[pts.length - 1]), yOf(0));
  ctx.closePath();
  ctx.fillStyle = 'rgba(249,115,22,.12)';
  ctx.fill();

  // Area: RX
  ctx.beginPath();
  ctx.moveTo(xOf(pts[0]), yOf(0));
  for (const p of pts) ctx.lineTo(xOf(p), yOf(p.in));
  ctx.lineTo(xOf(pts[pts.length - 1]), yOf(0));
  ctx.closePath();
  ctx.fillStyle = 'rgba(34,197,94,.10)';
  ctx.fill();

  // Line: TX
  ctx.beginPath();
  ctx.strokeStyle = '#f97316';
  ctx.lineWidth = 1.8;
  ctx.lineJoin = 'round';
  for (let i = 0; i < pts.length; i++) {
    const x = xOf(pts[i]), y = yOf(pts[i].out);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Line: RX
  ctx.beginPath();
  ctx.strokeStyle = '#22c55e';
  ctx.lineWidth = 1.8;
  for (let i = 0; i < pts.length; i++) {
    const x = xOf(pts[i]), y = yOf(pts[i].in);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Current value labels (rightmost point)
  const last = pts[pts.length - 1];
  if (last) {
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    const rx = xOf(last) + 4;
    ctx.fillStyle = '#f97316';
    ctx.fillText(formatBps(last.out), Math.min(rx, W - PAD.right - 60), yOf(last.out) - 4);
    ctx.fillStyle = '#22c55e';
    ctx.fillText(formatBps(last.in), Math.min(rx, W - PAD.right - 60), yOf(last.in) + 12);
  }

  // Legend
  ctx.font = '11px system-ui, sans-serif';
  const lx = PAD.left + 8;
  ctx.fillStyle = '#f97316'; ctx.fillRect(lx, PAD.top - 18, 12, 3);
  ctx.fillStyle = dark ? '#e2e8f0' : '#334155'; ctx.textAlign = 'left';
  ctx.fillText('TX (Out)', lx + 16, PAD.top - 14);
  ctx.fillStyle = '#22c55e'; ctx.fillRect(lx + 90, PAD.top - 18, 12, 3);
  ctx.fillStyle = dark ? '#e2e8f0' : '#334155';
  ctx.fillText('RX (In)', lx + 106, PAD.top - 14);
}

function niceScale(max) {
  if (max <= 0) return 1e6;
  const mag = Math.pow(10, Math.floor(Math.log10(max)));
  const norm = max / mag;
  if (norm <= 1) return mag;
  if (norm <= 2) return 2 * mag;
  if (norm <= 5) return 5 * mag;
  return 10 * mag;
}

// ── Stats cards (for selected link) ──────────────────────────────────────────

function renderStats(pts) {
  const el = q('traffic-stats');
  if (!el) return;
  if (!pts.length) { el.innerHTML = ''; return; }

  const avgIn = Math.round(pts.reduce((a, p) => a + p.in, 0) / pts.length);
  const avgOut = Math.round(pts.reduce((a, p) => a + p.out, 0) / pts.length);
  const maxIn = Math.max(...pts.map(p => p.in));
  const maxOut = Math.max(...pts.map(p => p.out));
  const last = pts[pts.length - 1];

  const card = (label, value, color) => `
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:10px 14px">
      <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">${label}</div>
      <div style="font-size:16px;font-weight:700;color:${color}">${value}</div>
    </div>`;

  el.innerHTML =
    card('Aktuell TX', formatBps(last?.out || 0), '#f97316') +
    card('Aktuell RX', formatBps(last?.in || 0), '#22c55e') +
    card('Ø TX', formatBps(avgOut), '#fb923c') +
    card('Ø RX', formatBps(avgIn), '#4ade80') +
    card('Max TX', formatBps(maxOut), '#ea580c') +
    card('Max RX', formatBps(maxIn), '#16a34a') +
    card('Zeitraum', formatDuration(pts), 'var(--text2)');
}

function formatDuration(pts) {
  if (pts.length < 2) return '—';
  const sec = pts[pts.length - 1].ts - pts[0].ts;
  if (sec < 120) return sec + 's';
  if (sec < 7200) return Math.round(sec / 60) + ' Min';
  return (sec / 3600).toFixed(1) + ' Std';
}

export function trafficSortClick(col) {
  if (trafficSort.col === col) {
    trafficSort.dir = trafficSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    trafficSort.col = col;
    trafficSort.dir = col === 'dev' || col === 'iface' || col === 'neighbor' ? 'asc' : 'desc';
  }
  renderTable();
}
