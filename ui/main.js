import S from './lib/state.js';
import { q, h, fmtBytes, fmtSpeed, fmtDate, statusBadge, setBadge, TYPE_LABELS, TYPE_BADGE, OS_BADGE, FILTER_OS_OPTS, FILTER_TYPE_OPTS, parseModelStr, extractModel, shortModel, mkTh, noSortTh, applySort, clickSort, logActivity, getLocations, refreshLocationSelects, matchesLocFilter } from './lib/helpers.js';
import { initTheme, toggleTheme, applyTheme } from './theme.js';
import { detectOsFromCriteria, detectDeviceType, DEFAULT_CRITERIA_CLIENT, loadCriteria, saveCriteria, resetCriteria, renderCriteriaTables, collectCriteria } from './criteria.js';
import { showSdnTab, renderVlans, addVlan, deleteVlan, setManagementVlan, validateVlans, saveVlans, loadVlans } from './tabs/sdn.js';
import { showCfgTab, renderLicenseStatus, loadLicense, licenseDragOver, licenseDragLeave, licenseDrop, licenseFileSelected, readLicenseFile, activateLicense, removeLicense, onSnmpVersionChange, onV3LevelChange, loadSettings, saveSettings, setAutoSync, registerAutoSyncHandlers, requestNotifyPermission, testAlertEmail, testAlertWebhook, testAlertTelegram, loadAlertLog, clearAlertLog, onAiProviderChange, runSchedulerNow, toggleCfgDevicePasswordVisible, toggleCfgSnmpSecretsVisible } from './tabs/settings.js';
import { aiSend, aiQuick, aiClear, aiStop, aiInputKey } from './tabs/ai-chat.js';
import { loadDevices, renderDevices, saveDevice, saveDevices, deleteDevice, clearAllDevices, exportDevices, checkAllDeviceStatus, devSortClick, setDevFilter, setDevLocFilter, snmpQ, setDeviceOnline, syncDeviceMacs, syncDeviceLldp, rebuildCachedData, devCredentials, lldpSyncCore } from './tabs/devices.js';
import { trapToggle, loadTraps, clearTraps, renderTraps, setTrapsAutoRefresh, applyTrapsAutoRefresh, stopTrapsAutoRefresh, initTrapsAutoRefreshUi } from './tabs/traps.js';
import { adminBadge, renderDashboard, renderActivityLog, toggleDashWarns, toggleDashSection, fetchDashboardUptimes, fetchDashboardTraffic, fetchUptimeStats, checkTopoChanges, loadTopoChanges } from './tabs/dashboard.js';
import { syncPoeAll, renderPoeTab } from './tabs/poe.js';
import { syncStpAll, renderStpSvg, syncSensorsAll, renderSensorsTab, inferStpRolesFromLldp, renderStpTab } from './tabs/stp.js';
import { runPortDiag, populatePortTestSelect } from './tabs/porttest.js';
import { wifiRefresh, syncWlanClients, renderWifiDashboard, wifiHistSnapshot, loadWifiHistory } from './tabs/wifi-dash.js';
import { renderWifiSettings, loadLxWlanNetworks, applyLxWlanSsid } from './tabs/wifi-settings.js';
import { meshSortClick, setMeshFilter, setMeshLocFilter, renderMesh, clearMeshData, mergeMeshResult, syncMeshDevice } from './tabs/mesh.js';
import { l2tpSortClick, setL2tpFilter, setL2tpLocFilter, renderL2tp, clearL2tpData, mergeL2tpResult, syncL2tpDevice } from './tabs/l2tp.js';
import { startScan, stopScan, saveScanResults, updateScanDetails, saveScanDevice, updateScanDevice, setScanStatus } from './tabs/scanner.js';
import { lmcTest, lmcDisconnect, lmcSync, saveLmcResults, showLmcTab, startRolloutScan, stopRolloutScan, rolloutAll, rolloutSetPassword, rolloutMergeScanOsFromRow, saveLmcDevice, lmcCall, lmcToggleSave, setRolloutStatus, setLmcStatus, matchesImportFilter } from './tabs/rollout.js';
import { activationCreate, loadActivationTokens, setActivationStatus, activationDelete } from './tabs/lmc.js';
import { loadAddins, createAddin, uploadAllAddins, openAddinEditor, closeAddinEditor, saveAddin, saveAndUploadAddin, renderAddinVars, insertVarAtCursor, fetchGlobalVars, renderGlobalVarsList, addGlobalVar, syncVarsToCloud, setAddinSearch, setAddinFilterOs } from './tabs/addins.js';
import { openDeviceDetail, showStab, queryDetail, toggleIfaceAdmin, renderScriptOutputHtml, stopSparkPoll } from './tabs/detail.js';
import { buildTopoFromStore, renderTopoSvg, topoChangeRoot, setTopoMaxDepth, topoZoom, topoFit, toggleTraffic, searchTopoMac, clearTopoMacSearch, topoBgDragStart, topoMouseMove, topoMouseUp, topoWheel, topoSetRootFromDetail, topoCloseDetail, syncTopologyAll, syncWdsAll, syncL2tpAll, setClientsFilter, clearClientsData, renderClients, clientsAddMacToNac, clientsRemoveMacFromNac, geraeteSync, resolveTopoNeighbor, topoNodeDragStart, topoNodeClick, openTopoWithMac, trafficEdgeHover, trafficEdgeLeave, exportTopoPdf, exportClientsPdf } from './tabs/topology.js';
import { showTab, toggleGroup, initMenuGroups } from './tabs/nav.js';
import { wifiPlanZoom, wifiPlanFit, wpResetLayout, wpSetBandFilter, wpBgDragStart, wpMouseMove, wpMouseUp, wpWheel, renderWifiPlan } from './tabs/wifi-plan.js';
import { loadScriptList, renderScriptList, renderScriptDevices, scriptNew, scriptSelectAll, scriptSelectDevicesByLocation, scriptAddCustomIp, scriptSave, scriptDelete, scriptRun } from './tabs/scripting.js';
import { initTrafficTab, stopTrafficPoll, trafficTogglePoll, trafficDevChanged, trafficRangeChanged, trafficClearHistory, trafficSortClick, trafficSelectLink } from './tabs/traffic.js';
import './tabs/sni-tool.js';
import { vtRun, ldRun } from './tabs/vlan-tracer.js';
import { loadSyslog, clearSyslog, filterSyslogLocal, setSyslogAutoRefresh, applySyslogAutoRefresh, stopSyslogAutoRefresh, initSyslogAutoRefreshUi } from './tabs/syslog.js';
import {
  loadRoamingSyslog,
  setRoamingSyslogAutoRefresh,
  applyRoamingSyslogAutoRefresh,
  stopRoamingSyslogAutoRefresh,
  initRoamingSyslogAutoRefreshUi,
  filterRoamTable,
  roamSortClick,
  roamingDeleteSyslogRow,
  clearRoamingSyslogAll,
  deleteRoamingTrackerMac,
  openRoamDetailView,
  closeRoamDetailView,
  roamDetailEventFilterChange,
} from './tabs/roaming-syslog.js';
import { runBackup, runBackupAll, loadBackupList, showBackupContent, loadBackupDiff, deleteBackupFile, initBackup } from './tabs/backup.js';
import { mibWalk, mibGet, mibSet, mibWalkFrom, mibPreset, mibCopyOid, mibDevChanged, initMibBrowser, renderMibResults } from './tabs/mib-browser.js';
import {
  renderNac,
  saveNacConfig,
  nacAddMacRow,
  nacRemoveMacRow,
  nacOnModeChange,
  nacAddPapRow,
  nacRemovePapRow,
  nacClearEmbeddedSecret,
  nacUploadCert,
  nacDeleteCert,
  loadNacRadiusLog,
  clearNacRadiusLog,
  nacEmbeddedRadiusRefresh,
  nacEmbeddedRadiusStart,
  nacEmbeddedRadiusStop,
} from './tabs/nac.js';
import {
  renderFreeRadius,
  saveFreeRadiusConfig,
  refreshFreeRadiusDockerStatus,
  freeRadiusDockerStart,
  freeRadiusDockerStop,
  frAddClientRow,
  frRemoveClientRow,
} from './tabs/freeradius.js';

function setTopoLocFilter(v) { S.topoLocFilter = v; buildTopoFromStore(); }
function setTopoHideAccessPoints(on) {
  S.topoHideAccessPoints = !!on;
  try { localStorage.setItem('onsite_topo_hide_ap', on ? '1' : '0'); } catch (e) {}
  buildTopoFromStore();
}
function setTopoHideUnmanaged(on) {
  S.topoHideUnmanaged = !!on;
  try { localStorage.setItem('onsite_topo_hide_unmanaged', on ? '1' : '0'); } catch (e) {}
  buildTopoFromStore();
}

// Expose state object for inline handlers that reference vlans[i] etc.
window.S = S;

// Expose ALL functions needed by inline HTML onclick/onchange/oninput handlers
window.toggleTheme = toggleTheme;
window.showTab = showTab;
window.toggleGroup = toggleGroup;
window.showSdnTab = showSdnTab;
window.addVlan = addVlan;
window.deleteVlan = deleteVlan;
window.setManagementVlan = setManagementVlan;
window.saveVlans = saveVlans;
window.showCfgTab = showCfgTab;
window.licenseDragOver = licenseDragOver;
window.licenseDragLeave = licenseDragLeave;
window.licenseDrop = licenseDrop;
window.licenseFileSelected = licenseFileSelected;
window.activateLicense = activateLicense;
window.removeLicense = removeLicense;
window.onSnmpVersionChange = onSnmpVersionChange;
window.onV3LevelChange = onV3LevelChange;
window.saveSettings = saveSettings;
window.toggleCfgDevicePasswordVisible = toggleCfgDevicePasswordVisible;
window.toggleCfgSnmpSecretsVisible = toggleCfgSnmpSecretsVisible;
window.requestNotifyPermission = requestNotifyPermission;
window.testAlertEmail = testAlertEmail;
window.testAlertWebhook = testAlertWebhook;
window.testAlertTelegram = testAlertTelegram;
window.loadAlertLog = loadAlertLog;
window.clearAlertLog = clearAlertLog;
window.onAiProviderChange = onAiProviderChange;
window.runSchedulerNow = runSchedulerNow;
window.aiSend = aiSend;
window.aiQuick = aiQuick;
window.aiClear = aiClear;
window.aiStop = aiStop;
window.aiInputKey = aiInputKey;
window.setDevFilter = setDevFilter;
window.setDevLocFilter = setDevLocFilter;
window.renderDevices = renderDevices;
window.exportDevices = exportDevices;
window.checkAllDeviceStatus = checkAllDeviceStatus;
window.clearAllDevices = clearAllDevices;
window.syncDeviceLldp = syncDeviceLldp;
window.syncDeviceMacs = syncDeviceMacs;
window.geraeteSync = geraeteSync;
window.syncTopologyAll = syncTopologyAll;
window.syncWdsAll = syncWdsAll;
window.syncL2tpAll = syncL2tpAll;
window.syncWlanClients = syncWlanClients;
window.trapToggle = trapToggle;
window.loadTraps = loadTraps;
window.clearTraps = clearTraps;
window.setTrapsAutoRefresh = setTrapsAutoRefresh;
window.applyTrapsAutoRefresh = applyTrapsAutoRefresh;
window.stopTrapsAutoRefresh = stopTrapsAutoRefresh;
window.syncPoeAll = syncPoeAll;
window.syncStpAll = syncStpAll;
window.syncSensorsAll = syncSensorsAll;
window.runPortDiag = runPortDiag;
window.wifiRefresh = wifiRefresh;
window.renderWifiSettings = renderWifiSettings;
window.loadLxWlanNetworks = loadLxWlanNetworks;
window.applyLxWlanSsid = applyLxWlanSsid;
window.setMeshFilter = setMeshFilter;
window.setMeshLocFilter = setMeshLocFilter;
window.renderMesh = renderMesh;
window.clearMeshData = clearMeshData;
window.setL2tpFilter = setL2tpFilter;
window.setL2tpLocFilter = setL2tpLocFilter;
window.renderL2tp = renderL2tp;
window.clearL2tpData = clearL2tpData;
window.setClientsFilter = setClientsFilter;
window.clearClientsData = clearClientsData;
window.renderClients = renderClients;
window.clientsAddMacToNac = clientsAddMacToNac;
window.clientsRemoveMacFromNac = clientsRemoveMacFromNac;
window.startScan = startScan;
window.stopScan = stopScan;
window.saveScanResults = saveScanResults;
window.updateScanDetails = updateScanDetails;
window.saveScanDevice = saveScanDevice;
window.updateScanDevice = updateScanDevice;
window.startRolloutScan = startRolloutScan;
window.stopRolloutScan = stopRolloutScan;
window.rolloutAll = rolloutAll;
window.rolloutSetPassword = rolloutSetPassword;
window.rolloutMergeScanOsFromRow = rolloutMergeScanOsFromRow;
window.lmcTest = lmcTest;
window.lmcDisconnect = lmcDisconnect;
window.lmcSync = lmcSync;
window.saveLmcResults = saveLmcResults;
window.saveLmcDevice = saveLmcDevice;
window.showLmcTab = showLmcTab;
window.lmcToggleSave = lmcToggleSave;
window.activationCreate = activationCreate;
window.loadAddins = loadAddins;
window.createAddin = createAddin;
window.uploadAllAddins = uploadAllAddins;
window.setAddinSearch = setAddinSearch;
window.setAddinFilterOs = setAddinFilterOs;
window.openAddinEditor = openAddinEditor;
window.closeAddinEditor = closeAddinEditor;
window.saveAddin = saveAddin;
window.saveAndUploadAddin = saveAndUploadAddin;
window.renderAddinVars = renderAddinVars;
window.insertVarAtCursor = insertVarAtCursor;
window.addGlobalVar = addGlobalVar;
window.syncVarsToCloud = syncVarsToCloud;
window.openDeviceDetail = openDeviceDetail;
window.showStab = showStab;
window.queryDetail = queryDetail;
window.toggleIfaceAdmin = toggleIfaceAdmin;
window.stopSparkPoll = stopSparkPoll;
window.buildTopoFromStore = buildTopoFromStore;
window.renderTopoSvg = renderTopoSvg;
window.topoChangeRoot = topoChangeRoot;
window.setTopoMaxDepth = setTopoMaxDepth;
window.topoZoom = topoZoom;
window.topoFit = topoFit;
// topoResetLayout is set directly in topology.js via window
window.toggleTraffic = toggleTraffic;
window.setTopoLocFilter = setTopoLocFilter;
window.setTopoHideAccessPoints = setTopoHideAccessPoints;
window.setTopoHideUnmanaged = setTopoHideUnmanaged;
window.searchTopoMac = searchTopoMac;
window.clearTopoMacSearch = clearTopoMacSearch;
window.topoBgDragStart = topoBgDragStart;
window.topoMouseMove = topoMouseMove;
window.topoMouseUp = topoMouseUp;
window.topoWheel = topoWheel;
window.topoSetRootFromDetail = topoSetRootFromDetail;
window.topoCloseDetail = topoCloseDetail;
window.exportTopoPdf = exportTopoPdf;
window.exportClientsPdf = exportClientsPdf;
window.wifiPlanZoom = wifiPlanZoom;
window.wifiPlanFit = wifiPlanFit;
window.wpResetLayout = wpResetLayout;
window.wpSetBandFilter = wpSetBandFilter;
window.wpBgDragStart = wpBgDragStart;
window.wpMouseMove = wpMouseMove;
window.wpMouseUp = wpMouseUp;
window.wpWheel = wpWheel;
window.scriptNew = scriptNew;
window.scriptSelectAll = scriptSelectAll;
window.scriptSelectDevicesByLocation = scriptSelectDevicesByLocation;
window.scriptAddCustomIp = scriptAddCustomIp;
window.scriptSave = scriptSave;
window.scriptDelete = scriptDelete;
window.scriptRun = scriptRun;
window.vtRun = vtRun;
window.ldRun = ldRun;
window.loadSyslog = loadSyslog;
window.clearSyslog = clearSyslog;
window.setSyslogAutoRefresh = setSyslogAutoRefresh;
window.applySyslogAutoRefresh = applySyslogAutoRefresh;
window.stopSyslogAutoRefresh = stopSyslogAutoRefresh;
window.loadRoamingSyslog = loadRoamingSyslog;
window.setRoamingSyslogAutoRefresh = setRoamingSyslogAutoRefresh;
window.applyRoamingSyslogAutoRefresh = applyRoamingSyslogAutoRefresh;
window.stopRoamingSyslogAutoRefresh = stopRoamingSyslogAutoRefresh;
window.filterRoamTable = filterRoamTable;
window.roamSortClick = roamSortClick;
window.roamingDeleteSyslogRow = roamingDeleteSyslogRow;
window.clearRoamingSyslogAll = clearRoamingSyslogAll;
window.deleteRoamingTrackerMac = deleteRoamingTrackerMac;
window.openRoamDetailView = openRoamDetailView;
window.closeRoamDetailView = closeRoamDetailView;
window.roamDetailEventFilterChange = roamDetailEventFilterChange;
window.filterSyslogLocal = filterSyslogLocal;
window.runBackup = runBackup;
window.runBackupAll = runBackupAll;
window.loadBackupList = loadBackupList;
window.showBackupContent = showBackupContent;
window.loadBackupDiff = loadBackupDiff;
window.deleteBackupFile = deleteBackupFile;
window.initBackup = initBackup;
window.mibWalk = mibWalk;
window.mibGet = mibGet;
window.mibSet = mibSet;
window.mibWalkFrom = mibWalkFrom;
window.mibPreset = mibPreset;
window.mibCopyOid = mibCopyOid;
window.mibDevChanged = mibDevChanged;
window.initMibBrowser = initMibBrowser;
window.renderNac = renderNac;
window.saveNacConfig = saveNacConfig;
window.nacAddMacRow = nacAddMacRow;
window.nacRemoveMacRow = nacRemoveMacRow;
window.nacOnModeChange = nacOnModeChange;
window.nacAddPapRow = nacAddPapRow;
window.nacRemovePapRow = nacRemovePapRow;
window.nacClearEmbeddedSecret = nacClearEmbeddedSecret;
window.nacUploadCert = nacUploadCert;
window.nacDeleteCert = nacDeleteCert;
window.loadNacRadiusLog = loadNacRadiusLog;
window.clearNacRadiusLog = clearNacRadiusLog;
window.nacEmbeddedRadiusRefresh = nacEmbeddedRadiusRefresh;
window.nacEmbeddedRadiusStart = nacEmbeddedRadiusStart;
window.nacEmbeddedRadiusStop = nacEmbeddedRadiusStop;
window.renderFreeRadius = renderFreeRadius;
window.saveFreeRadiusConfig = saveFreeRadiusConfig;
window.refreshFreeRadiusDockerStatus = refreshFreeRadiusDockerStatus;
window.freeRadiusDockerStart = freeRadiusDockerStart;
window.freeRadiusDockerStop = freeRadiusDockerStop;
window.frAddClientRow = frAddClientRow;
window.frRemoveClientRow = frRemoveClientRow;
window.saveCriteria = saveCriteria;
window.resetCriteria = resetCriteria;

// Cross-module references needed by modules that call via window.xxx
window.snmpQ = snmpQ;
window.setDeviceOnline = setDeviceOnline;
window.saveDevice = saveDevice;
window.saveDevices = saveDevices;
window.deleteDevice = deleteDevice;
window.loadDevices = loadDevices;
window.renderDashboard = renderDashboard;
window.renderScriptOutputHtml = renderScriptOutputHtml;
window.renderScriptDevices = renderScriptDevices;
window.renderPoeTab = renderPoeTab;
window.renderStpTab = renderStpTab;
window.renderStpSvg = renderStpSvg;
window.renderSensorsTab = renderSensorsTab;
window.renderWifiDashboard = renderWifiDashboard;
window.renderWifiPlan = renderWifiPlan;
window.populatePortTestSelect = populatePortTestSelect;
window.renderActivityLog = renderActivityLog;
window.fetchUptimeStats = fetchUptimeStats;
window.inferStpRolesFromLldp = inferStpRolesFromLldp;
window.adminBadge = adminBadge;
window.lmcCall = lmcCall;
window.resolveTopoNeighbor = resolveTopoNeighbor;
window.topoNodeDragStart = topoNodeDragStart;
window.topoNodeClick = topoNodeClick;
window.openTopoWithMac = openTopoWithMac;
window.trafficEdgeHover = trafficEdgeHover;
window.trafficEdgeLeave = trafficEdgeLeave;
window.initTrafficTab = initTrafficTab;
window.stopTrafficPoll = stopTrafficPoll;
window.trafficTogglePoll = trafficTogglePoll;
window.trafficDevChanged = trafficDevChanged;
window.trafficRangeChanged = trafficRangeChanged;
window.trafficClearHistory = trafficClearHistory;
window.trafficSortClick = trafficSortClick;
window.trafficSelectLink = trafficSelectLink;
window.syncMeshDevice = syncMeshDevice;
window.syncL2tpDevice = syncL2tpDevice;
window.setActivationStatus = setActivationStatus;
window.activationDelete = activationDelete;
window.devSortClick = devSortClick;
window.meshSortClick = meshSortClick;
window.l2tpSortClick = l2tpSortClick;
window.rebuildCachedData = rebuildCachedData;
window.devCredentials = devCredentials;
window.lldpSyncCore = lldpSyncCore;
window.renderTraps = renderTraps;
window.mergeMeshResult = mergeMeshResult;
window.mergeL2tpResult = mergeL2tpResult;
window.setScanStatus = setScanStatus;
window.setRolloutStatus = setRolloutStatus;
window.setLmcStatus = setLmcStatus;
window.matchesImportFilter = matchesImportFilter;
window.detectOsFromCriteria = detectOsFromCriteria;
window.detectDeviceType = detectDeviceType;
window.fetchGlobalVars = fetchGlobalVars;
window.renderGlobalVarsList = renderGlobalVarsList;
window.loadActivationTokens = loadActivationTokens;
window.renderLicenseStatus = renderLicenseStatus;
window.h = h;
window.q = q;

// Init
(async function init() {
  initTheme();
  initMenuGroups();
  initSyslogAutoRefreshUi();
  initTrapsAutoRefreshUi();
  initRoamingSyslogAutoRefreshUi();
  fetch('/api/version').then(r=>r.json()).then(d=>{ const el=q('version-tag'); if(el) el.textContent=d.version; }).catch(()=>{});
  fetch('/api/license').then(r=>r.json()).then(renderLicenseStatus).catch(()=>{});
  await loadSettings();
  registerAutoSyncHandlers(checkAllDeviceStatus);
  await loadCriteria();
  await loadVlans();
  await loadDevices();
  await fetchGlobalVars();
  fetchUptimeStats();
  showTab('dashboard');
  const savedToken = localStorage.getItem('lmc_token');
  if (savedToken) { const el = q('lmc-token'); if (el) { el.value = savedToken; } const cb = q('lmc-save-token'); if (cb) cb.checked = true; }
  const p = new URLSearchParams(location.search);
  if (p.get('host')) openDeviceDetail(p.get('host'));
})();
