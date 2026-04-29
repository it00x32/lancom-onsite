import S from '../lib/state.js';
import { q, h } from '../lib/helpers.js';

const _devCredentials = (...a) => window.devCredentials?.(...a);

// ═══════════════════════════════════════════════════════════════════════════════
// VLAN-PFAD-TRACER
// ═══════════════════════════════════════════════════════════════════════════════

let vtAbort = null;

export function vtInit() {
  // Pre-fill VLAN dropdown from deviceStore VLAN data if available
  const seen = {};
  Object.values(S.deviceStore).forEach(d => {
    (d.vlanData?.entries || []).forEach(v => { seen[v.vlanId] = v.name || ''; });
  });
  const sel = q('vt-vlan-select');
  const ids = Object.keys(seen).map(Number).sort((a,b)=>a-b);
  if (ids.length > 0) {
    sel.innerHTML = '<option value="">— VLAN wählen —</option>' +
      ids.map(id => `<option value="${id}">${id}${seen[id]?' – '+h(seen[id]):''}</option>`).join('');
    sel.style.display = '';
  } else {
    sel.style.display = 'none';
  }
}

export async function vtRun() {
  const vid = parseInt(q('vt-vlan-id').value);
  if (!vid || vid < 1 || vid > 4094) {
    q('vt-status').textContent = 'Bitte eine VLAN-ID eingeben (1–4094).';
    return;
  }
  if (vtAbort) { vtAbort.abort(); }
  vtAbort = new AbortController();
  const sig = vtAbort.signal;

  const devices = Object.values(S.deviceStore).filter(d => d.ip && d.online !== false);
  if (!devices.length) {
    q('vt-status').textContent = 'Keine Geräte vorhanden. Zuerst Status prüfen.';
    return;
  }

  q('vt-result').style.display = 'none';
  q('vt-empty').style.display  = 'none';
  q('btn-vt-run').disabled = true;
  q('vt-progress').style.display = '';
  q('vt-bar').style.width = '0%';
  q('vt-status').textContent = '';

  const results = [];
  let done = 0;

  for (const dev of devices) {
    if (sig.aborted) break;
    q('vt-progress-lbl').textContent = `${done + 1} / ${devices.length} – ${h(dev.name || dev.ip)}`;
    q('vt-bar').style.width = Math.round((done / devices.length) * 100) + '%';
    try {
      const creds = _devCredentials(dev.ip);
      const r = await fetch('/snmp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: dev.ip, type: 'vlan-trace', vlanId: vid, ...creds }),
        signal: sig,
      });
      const data = await r.json();
      if (!data.error && data.found) {
        results.push({ dev, data });
        // populate dropdown if not yet done
        if (data.allVlans?.length && q('vt-vlan-select').options.length <= 1) {
          const sel = q('vt-vlan-select');
          sel.innerHTML = '<option value="">— VLAN wählen —</option>' +
            data.allVlans.map(v => `<option value="${v.id}">${v.id}${v.name?' – '+h(v.name):''}</option>`).join('');
          sel.style.display = '';
        }
      }
    } catch(e) { if (sig.aborted) break; }
    done++;
  }

  q('vt-progress').style.display = 'none';
  q('btn-vt-run').disabled = false;
  q('vt-bar').style.width = '0%';

  if (!results.length) {
    q('vt-empty').style.display = '';
    q('vt-status').textContent = `VLAN ${vid} auf keinem Gerät gefunden.`;
    return;
  }

  // Render results
  const vlanName = results[0]?.data?.vlanName || '';
  q('vt-title').innerHTML = `VLAN <b>${vid}</b>${vlanName ? ' – ' + h(vlanName) : ''} &nbsp;<span style="font-size:12px;color:var(--text2)">(${results.length} Gerät${results.length!==1?'e':''})</span>`;
  q('vt-status').textContent = `${results.length} Gerät${results.length!==1?'e':''} mit VLAN ${vid} gefunden.`;

  q('vt-tbody').innerHTML = results.map(({ dev, data }) => {
    const tagged   = data.ports.filter(p => p.mode === 'tagged');
    const untagged = data.ports.filter(p => p.mode === 'untagged');
    const taggedStr   = tagged.map(p => `<span class="badge" style="background:rgba(45,95,255,.15);color:var(--accent);border:1px solid rgba(45,95,255,.3);font-size:10px;padding:1px 5px">${h(p.ifName)}</span>`).join(' ') || '–';
    const untaggedStr = untagged.map(p => `<span class="badge" style="background:rgba(74,222,128,.12);color:var(--green);border:1px solid rgba(74,222,128,.3);font-size:10px;padding:1px 5px">${h(p.ifName)}</span>`).join(' ') || '–';
    return `<tr>
      <td style="font-weight:600">${h(dev.name || dev.ip)}</td>
      <td style="color:var(--text2);font-size:12px">${h(dev.ip)}</td>
      <td style="font-size:12px;color:var(--text2)">${h(dev.location || '–')}</td>
      <td style="line-height:2">${taggedStr}</td>
      <td style="line-height:2">${untaggedStr}</td>
      <td style="text-align:center;color:var(--text2);font-size:12px">${data.ports.length}</td>
    </tr>`;
  }).join('');

  q('vt-result').style.display = '';
}

/* ══════════════════════════════════════════════════════════════════════════════
   Loop-Erkennung
══════════════════════════════════════════════════════════════════════════════ */

export function ldInit() {
  q('ld-result').style.display = 'none';
  q('ld-empty').style.display  = 'none';
  q('ld-status').textContent   = '';
}

export async function ldRun() {
  const devices = Object.values(S.deviceStore).filter(d => d.ip && d.online !== false && (d.os||'').startsWith('LCOS SX'));
  if (!devices.length) {
    q('ld-status').textContent = 'Keine Switches vorhanden. Zuerst Status prüfen.';
    return;
  }

  q('ld-result').style.display  = 'none';
  q('ld-empty').style.display   = 'none';
  q('btn-ld-run').disabled      = true;
  q('ld-progress').style.display = '';
  q('ld-bar').style.width       = '0%';
  q('ld-status').textContent    = '';

  const results = [];
  let done = 0;

  for (const dev of devices) {
    q('ld-progress-lbl').textContent = `${done + 1} / ${devices.length} – ${h(dev.name || dev.ip)}`;
    q('ld-bar').style.width = Math.round((done / devices.length) * 100) + '%';
    try {
      const creds = _devCredentials(dev.ip);
      const r = await fetch('/snmp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: dev.ip, type: 'loop-detect', ...creds }),
      });
      const data = await r.json();
      if (!data.error) results.push({ dev, data });
    } catch(e) { /* offline */ }
    done++;
  }

  q('ld-progress').style.display = 'none';
  q('btn-ld-run').disabled = false;
  q('ld-bar').style.width = '0%';

  if (!results.length) {
    q('ld-empty').style.display = '';
    q('ld-status').textContent = 'Keine SNMP-Antworten erhalten.';
    return;
  }

  S.ldLastResults = results;

  const dangerCount  = results.filter(r => r.data.risk === 'danger').length;
  const warningCount = results.filter(r => r.data.risk === 'warning').length;
  q('ld-status').textContent = `${results.length} Gerät${results.length !== 1 ? 'e' : ''} geprüft` +
    (dangerCount  ? ` · ${dangerCount} kritisch`  : '') +
    (warningCount ? ` · ${warningCount} Warnung${warningCount !== 1 ? 'en' : ''}` : '');

  const riskBadge = (risk) => {
    const map = {
      ok:      ['🟢', 'rgba(74,222,128,.15)', 'var(--green)',  '1px solid rgba(74,222,128,.4)', 'OK'],
      warning: ['🟡', 'rgba(250,200,60,.15)',  '#e6b800',      '1px solid rgba(250,200,60,.4)', 'Warnung'],
      danger:  ['🔴', 'rgba(239,68,68,.15)',   'var(--red)',   '1px solid rgba(239,68,68,.4)',  'Kritisch'],
    };
    const [icon, bg, color, border, label] = map[risk] || map.ok;
    return `<span class="badge" style="background:${bg};color:${color};border:${border};font-size:11px;padding:2px 8px">${icon} ${label}</span>`;
  };

  // Sort: danger first, then warning, then ok
  const riskOrder = { danger: 0, warning: 1, ok: 2 };
  results.sort((a, b) => (riskOrder[a.data.risk] ?? 3) - (riskOrder[b.data.risk] ?? 3));

  q('ld-tbody').innerHTML = results.map(({ dev, data }) => {
    const blockStr = data.blockingPorts?.length
      ? data.blockingPorts.map(p => `<span class="badge" style="background:rgba(250,200,60,.15);color:#e6b800;border:1px solid rgba(250,200,60,.4);font-size:10px;padding:1px 5px">${h(p)}</span>`).join(' ')
      : '–';
    const brokenStr = data.brokenPorts?.length
      ? data.brokenPorts.map(p => `<span class="badge" style="background:rgba(239,68,68,.15);color:var(--red);border:1px solid rgba(239,68,68,.4);font-size:10px;padding:1px 5px">${h(p)}</span>`).join(' ')
      : '';
    const portCell = [blockStr, brokenStr].filter(s => s && s !== '–').join(' ') || '–';
    const lpCount = data.lpProtectedPorts?.length ?? 0;
    const lpCell = lpCount
      ? `<span style="color:var(--green);font-size:12px">✔ ${lpCount} Port${lpCount !== 1 ? 's' : ''}</span>`
      : '<span style="color:var(--text2);font-size:12px">–</span>';
    const ldPorts = data.lpDetectedPorts || [];
    const ldCell = ldPorts.length
      ? ldPorts.map(p => `<span class="badge" style="background:rgba(239,68,68,.15);color:var(--red);border:1px solid rgba(239,68,68,.4);font-size:10px;padding:1px 5px">${h(p)}</span>`).join(' ')
      : '<span style="color:var(--text2);font-size:12px">–</span>';
    const conflictCount = data.stpLpConflictCount ?? 0;
    const conflictCell = conflictCount > 0
      ? `<span class="badge" style="background:rgba(251,191,36,.15);color:var(--amber);border:1px solid rgba(251,191,36,.4);font-size:11px;padding:2px 7px" title="Ports mit Loop Protection und STP gleichzeitig aktiv">⚠ ${conflictCount}</span>`
      : '<span style="color:var(--text2);font-size:12px">–</span>';
    return `<tr>
      <td style="font-weight:600">${h(dev.name || dev.ip)}</td>
      <td style="color:var(--text2);font-size:12px">${h(dev.ip)}</td>
      <td style="font-size:12px;color:var(--text2)">${h(dev.location || '–')}</td>
      <td style="text-align:center">${data.stpActive ? '<span style="color:var(--green)">✔</span>' : '<span style="color:var(--text2)">–</span>'}</td>
      <td style="text-align:center;font-size:13px">${data.topoChanges ?? '–'}</td>
      <td style="font-size:12px;color:var(--text2)">${h(data.topoTimeStr || '–')}</td>
      <td>${lpCell}</td>
      <td style="line-height:2">${ldCell}</td>
      <td style="text-align:center">${conflictCell}</td>
      <td style="line-height:2">${portCell}</td>
      <td>${riskBadge(data.risk || 'ok')}</td>
    </tr>`;
  }).join('');

  q('ld-result').style.display = '';
}

// ── Expose functions needed by inline HTML event handlers ─────────────────────
window.vtInit = vtInit;
window.vtRun = vtRun;
window.ldInit = ldInit;
window.ldRun = ldRun;
