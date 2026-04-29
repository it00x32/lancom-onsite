import S from '../lib/state.js';
import { q, setBadge } from '../lib/helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TAB NAVIGATION
// ═══════════════════════════════════════════════════════════════════════════════

export function toggleScriptOsGroup(id) {
  const wrap   = document.getElementById(id);
  const chevron = document.getElementById(id + '-chev');
  if (!wrap) return;
  const open = wrap.classList.toggle('open');
  if (chevron) chevron.style.transform = open ? '' : 'rotate(-90deg)';
}

export function toggleScriptOs() {
  const wrap    = document.getElementById('script-os-checks-wrap');
  const chevron = document.getElementById('script-os-chevron');
  if (!wrap) return;
  const collapsed = wrap.style.maxHeight === '0px' || wrap.style.opacity === '0';
  wrap.style.maxHeight = collapsed ? '200px' : '0';
  wrap.style.opacity   = collapsed ? '1' : '0';
  if (chevron) chevron.style.transform = collapsed ? '' : 'rotate(-90deg)';
}

export function toggleGroup(name) {
  const grp = document.getElementById('tgroup-' + name);
  if (!grp) return;
  grp.classList.toggle('collapsed');
}

export function initMenuGroups() {
  document.querySelectorAll('.tab-group').forEach(grp => grp.classList.add('collapsed'));
}

export function showTab(name) {
  if (name !== 'syslog') window.stopSyslogAutoRefresh?.();
  if (name !== 'traps') window.stopTrapsAutoRefresh?.();
  if (name !== 'roaming') window.stopRoamingSyslogAutoRefresh?.();
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
  const tab=q('tab-'+name); if(tab) tab.classList.add('active');
  const panel=q('panel-'+name); if(panel) panel.classList.add('active');
  // Auto-expand group if its tab is hidden (collapsed)
  if (tab) {
    const grp = tab.closest('.tab-group');
    if (grp?.classList.contains('collapsed')) {
      const gname = grp.id.replace('tgroup-', '');
      grp.classList.remove('collapsed');
    }
  }
  if(name !== 'detail') { q('detail-badge').style.display='none'; window.stopSparkPoll?.(); }
  if(name==='dashboard') window.renderDashboard?.();
  if(name==='wifidash')  window.renderWifiDashboard?.();
  if(name==='wifi-settings') window.renderWifiSettings?.();
  if(name==='nac')       window.renderNac?.();
  if(name==='freeradius') window.renderFreeRadius?.();
  if(name==='wifiplan')  window.renderWifiPlan?.();
  if (name === 'roaming') {
    window.loadRoamingSyslog?.();
    window.applyRoamingSyslogAutoRefresh?.();
  }
  if(name==='sensors')   window.renderSensorsTab?.();
  if(name==='stp')       window.renderStpTab?.();
  if(name==='poe')       window.renderPoeTab?.();
  if(name==='porttest')  window.populatePortTestSelect?.();
  if(name==='devices')   window.renderDevices?.();
  if(name==='topology')  window.buildTopoFromStore?.();
  if(name==='traffic')    window.initTrafficTab?.();
  if(name!=='traffic')    window.stopTrafficPoll?.();
  if(name==='vlantracer') window.vtInit?.();
  if(name==='loopdetect') window.ldInit?.();
  if(name==='sdn')       window.showSdnTab?.('vlan');
  if(name==='mib')       window.initMibBrowser?.();
  if(name==='backup')    window.initBackup?.();
  if(name==='scripting') window.loadScriptList?.();
  if (name === 'sni') window.sniTabActivated?.();
  if (name === 'traps') {
    window.loadTraps?.();
    window.applyTrapsAutoRefresh?.();
  }
  if (name === 'syslog') {
    window.loadSyslog?.();
    window.applySyslogAutoRefresh?.();
  }
  if(name==='rollout') {
    q('tbl-rollout').querySelector('tbody').innerHTML = '<tr><td colspan="6" class="empty">Noch kein Scan gestartet</td></tr>';
    q('cnt-rollout').textContent = '';
    q('rollout-progress-wrap').style.display = 'none';
    window.setRolloutStatus?.('', '');
    S.rolloutFoundCnt = 0;
  }
  if(name==='scanner') {
    q('tbl-scan').querySelector('tbody').innerHTML = '';
    q('cnt-scan').textContent = '';
    q('scan-progress-wrap').style.display = 'none';
    q('btn-save-all').style.display = 'none';
    q('btn-update-details').style.display = 'none';
    q('sep-save-all').style.display = 'none';
    window.setScanStatus?.('', '');
    S.scanResults = []; S.scanFoundCnt = 0;
  }
}

// ── Expose functions needed by inline HTML event handlers ─────────────────────
window.toggleScriptOsGroup = toggleScriptOsGroup;
window.toggleScriptOs = toggleScriptOs;
window.toggleGroup = toggleGroup;
window.initMenuGroups = initMenuGroups;
window.showTab = showTab;
