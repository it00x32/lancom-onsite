import S from '../lib/state.js';
import { q, h } from '../lib/helpers.js';

let backupFiles = [];
let currentIp = '';
let currentFile = '';

function escHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#39;').replace(/"/g, '&quot;'); }

function backupStatus(msg, err) {
  const el = q('backup-status');
  if (!el) return;
  el.textContent = msg;
  el.style.color = err ? 'var(--red)' : 'var(--text3)';
  if (msg) setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 8000);
}

export function populateBackupDevSelect() {
  const sel = q('backup-dev-select');
  if (!sel) return;
  const devs = Object.values(S.deviceStore || {}).sort((a, b) => (a.name || a.sysName || a.ip || '').localeCompare(b.name || b.sysName || b.ip || ''));
  sel.innerHTML = '<option value="">— Gerät wählen —</option>' +
    devs.map(d => `<option value="${d.ip}" data-os="${d.os || ''}">${d.name || d.sysName || d.ip} (${d.ip})</option>`).join('');
}

export async function loadBackupList() {
  const sel = q('backup-dev-select');
  const ip = sel?.value;
  if (!ip) { q('backup-list').innerHTML = '<div style="padding:20px;text-align:center;color:var(--text3);font-size:12px">Gerät wählen</div>'; return; }
  currentIp = ip;
  try {
    const r = await fetch(`/api/backup/list?ip=${ip}`);
    backupFiles = await r.json();
    renderBackupList();
  } catch { backupStatus('Fehler beim Laden', true); }
}

function renderBackupList() {
  const el = q('backup-list');
  if (!el) return;
  if (!backupFiles.length) {
    el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text3);font-size:12px">Keine Backups vorhanden</div>';
    return;
  }
  el.innerHTML = backupFiles.map((f, i) => {
    const ts = new Date(f.ts).toLocaleString('de-DE');
    const kb = (f.size / 1024).toFixed(1);
    const active = f.filename === currentFile ? 'background:rgba(37,99,235,.15);' : '';
    const bin = /\.(lcfsx|cfg|xml)$/i.test(f.filename);
    const dl = bin
      ? `<a class="btn-micro" href="/api/backup/download?ip=${encodeURIComponent(currentIp)}&file=${encodeURIComponent(f.filename)}" download title="Binärdatei herunterladen" onclick="event.stopPropagation()" style="text-decoration:none;color:var(--accent)">⬇</a>`
      : '';
    return `<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;${active}border-top:${i ? '1px solid var(--border)' : 'none'};cursor:pointer" onclick="showBackupContent('${escHtml(f.filename)}')">
      <span style="flex:1;font-size:12px;font-weight:500">${ts}</span>
      <span style="font-size:10px;color:var(--text3)">${kb} KB</span>
      ${dl}
      <button class="btn-micro" onclick="event.stopPropagation();deleteBackupFile('${escHtml(f.filename)}')" title="Löschen">✕</button>
    </div>`;
  }).join('');

  const diffSel = q('backup-diff-select');
  if (diffSel) {
    diffSel.innerHTML = '<option value="">— Diff mit… —</option>' +
      backupFiles.map(f => `<option value="${f.filename}">${new Date(f.ts).toLocaleString('de-DE')}</option>`).join('');
  }
}

export async function showBackupContent(filename) {
  currentFile = filename;
  renderBackupList();
  const el = q('backup-content');
  const diffSel = q('backup-diff-select');
  if (diffSel) diffSel.style.display = '';
  try {
    const r = await fetch(`/api/backup/content?ip=${currentIp}&file=${filename}`);
    const text = await r.text();
    el.innerHTML = escHtml(text);
  } catch { el.innerHTML = '<span style="color:var(--red)">Fehler beim Laden</span>'; }
}

export async function loadBackupDiff() {
  const diffSel = q('backup-diff-select');
  const fileB = diffSel?.value;
  if (!fileB || !currentFile || fileB === currentFile) return;

  const el = q('backup-content');
  try {
    const r = await fetch('/api/backup/diff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip: currentIp, fileA: currentFile, fileB }),
    });
    const diff = await r.json();
    if (diff.error) throw new Error(diff.error);
    let html = `<div style="margin-bottom:8px;font-weight:600;color:var(--text2)">Diff: ${currentFile} vs ${fileB}</div>`;
    html += `<div style="margin-bottom:6px;font-size:11px;color:var(--text3)">${diff.same} gleiche Zeilen · ${diff.removed.length} entfernt · ${diff.added.length} hinzugefügt</div>`;
    if (diff.removed.length) html += diff.removed.map(l => `<div style="background:rgba(239,68,68,.12);color:#ef4444;padding:1px 6px;border-radius:2px">- ${escHtml(l)}</div>`).join('');
    if (diff.added.length) html += diff.added.map(l => `<div style="background:rgba(34,197,94,.12);color:#22c55e;padding:1px 6px;border-radius:2px">+ ${escHtml(l)}</div>`).join('');
    if (!diff.removed.length && !diff.added.length) html += '<div style="color:var(--text3)">Keine Unterschiede</div>';
    el.innerHTML = html;
  } catch (e) { el.innerHTML = `<span style="color:var(--red)">${escHtml(e.message)}</span>`; }
}

export async function runBackup() {
  const sel = q('backup-dev-select');
  const ip = sel?.value;
  if (!ip) return backupStatus('Gerät wählen', true);
  const opt = sel.selectedOptions[0];
  const os = opt?.dataset?.os || '';

  backupStatus('Backup wird erstellt…');
  try {
    const r = await fetch('/api/backup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip, os }),
    });
    const data = await r.json();
    if (data.error) throw new Error(data.error);
    let msg = `✓ Backup gespeichert (${(data.size / 1024).toFixed(1)} KB)`;
    if (data.warn) msg += ' — ' + data.warn;
    backupStatus(msg);
    await loadBackupList();
  } catch (e) { backupStatus(e.message, true); }
}

export async function runBackupAll() {
  backupStatus('Alle Backups werden erstellt…');
  try {
    const r = await fetch('/api/backup/all', { method: 'POST' });
    const results = await r.json();
    if (results.error) throw new Error(results.error);
    const ok = results.filter(r => !r.error).length;
    const fail = results.filter(r => r.error).length;
    backupStatus(`${ok} gesichert, ${fail} fehlgeschlagen`);
    if (currentIp) await loadBackupList();
  } catch (e) { backupStatus(e.message, true); }
}

export async function deleteBackupFile(filename) {
  if (!confirm(`Backup ${filename} löschen?`)) return;
  try {
    await fetch(`/api/backup?ip=${currentIp}&file=${filename}`, { method: 'DELETE' });
    await loadBackupList();
    if (currentFile === filename) {
      currentFile = '';
      q('backup-content').innerHTML = '<div style="color:var(--text3);text-align:center;padding:20px;font-family:system-ui">Backup auswählen</div>';
    }
  } catch {}
}

export function initBackup() {
  populateBackupDevSelect();
}
