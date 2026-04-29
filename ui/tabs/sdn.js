import S from '../lib/state.js';
import { q, h } from '../lib/helpers.js';

export function showSdnTab(name) {
  ['vlan'].forEach(t => {
    q('sdntab-'+t).classList.toggle('active', t===name);
    q('sdnpanel-'+t).classList.toggle('active', t===name);
  });
}

export function renderVlans() {
  const tbody = q('vlan-tbody');
  if (!S.vlans.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty">Keine VLANs konfiguriert</td></tr>';
    return;
  }
  tbody.innerHTML = S.vlans.map((v, i) => `
    <tr>
      <td><input class="settings-input" style="min-width:140px" value="${h(v.name)}" oninput="S.vlans[${i}].name=this.value"></td>
      <td><input class="settings-input" type="number" min="1" max="4095" style="width:90px" value="${v.vlanId}" oninput="S.vlans[${i}].vlanId=parseInt(this.value)||''"></td>
      <td style="text-align:center;padding:6px 14px"><input type="radio" name="mgmt-vlan" ${v.isManagement?'checked':''} onchange="setManagementVlan(${i})" style="accent-color:var(--cyan);cursor:pointer;display:block;margin:auto"></td>
      <td><button class="btn btn-sm btn-ghost" onclick="deleteVlan(${i})" ${S.vlans.length===1?'disabled':''}>Löschen</button></td>
    </tr>`).join('');
}

export function addVlan() {
  S.vlans.push({ name: '', vlanId: '', isManagement: false });
  renderVlans();
}

export function deleteVlan(i) {
  const wasMgmt = S.vlans[i].isManagement;
  S.vlans.splice(i, 1);
  if (wasMgmt && S.vlans.length) S.vlans[0].isManagement = true;
  renderVlans();
}

export function setManagementVlan(i) {
  S.vlans.forEach((v, idx) => v.isManagement = idx === i);
}

export function validateVlans() {
  // Reset highlights
  document.querySelectorAll('#tbl-vlan input[type=text], #tbl-vlan input[type=number]')
    .forEach(el => el.style.borderColor = '');

  const rows = [...(q('vlan-tbody')?.rows || [])];

  for (let i = 0; i < S.vlans.length; i++) {
    const v = S.vlans[i];
    if (!String(v.name).trim()) {
      rows[i]?.cells[0].querySelector('input')?.style.setProperty('border-color', 'var(--red)');
      return 'Name darf nicht leer sein.';
    }
    const id = parseInt(v.vlanId);
    if (isNaN(id) || id < 1 || id > 4095) {
      rows[i]?.cells[1].querySelector('input')?.style.setProperty('border-color', 'var(--red)');
      return 'VLAN ID muss eine Zahl zwischen 1 und 4095 sein.';
    }
  }

  const ids = S.vlans.map(v => parseInt(v.vlanId));
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) {
    rows.forEach((row, i) => {
      if (dupes.includes(parseInt(S.vlans[i].vlanId)))
        row.cells[1].querySelector('input')?.style.setProperty('border-color', 'var(--red)');
    });
    return `VLAN ID ${dupes[0]} ist mehrfach vergeben.`;
  }

  if (!S.vlans.some(v => v.isManagement)) return 'Ein VLAN muss als Management VLAN festgelegt sein.';
  return null;
}

export async function saveVlans() {
  const err = validateVlans();
  if (err) { showVlanStatus(err, 'error'); return; }
  try {
    await fetch('/api/sdn', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ vlans: S.vlans }) });
    showVlanStatus('Gespeichert.', 'ok');
  } catch { showVlanStatus('Fehler beim Speichern.', 'error'); }
}

function showVlanStatus(msg, cls) {
  const s = q('vlan-status');
  s.textContent = msg; s.className = 'status-bar ' + cls; s.style.display = '';
  if (cls === 'ok') setTimeout(() => { s.style.display = 'none'; }, 3000);
}

export async function loadVlans() {
  try {
    const r = await fetch('/api/sdn');
    const data = await r.json();
    S.vlans = data.vlans || [];
  } catch {
    S.vlans = [{ name: 'Management', vlanId: 1, isManagement: true }];
  }
  renderVlans();
}
