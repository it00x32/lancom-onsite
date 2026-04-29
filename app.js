(() => {
  // ui/lib/state.js
  var S = {
    appSettings: {},
    appCriteria: null,
    deviceStore: {},
    meshData: [],
    l2tpData: [],
    clientsData: [],
    /** @type {null | Array<{ mac: string, label?: string, vlan?: number }>} null = noch nicht von /api/nac geladen */
    nacMacAllowlistCache: null,
    meshFilter: "all",
    clientsFilter: "all",
    l2tpFilter: "all",
    devFilter: "all",
    devLocFilter: "all",
    meshLocFilter: "all",
    l2tpLocFilter: "all",
    topoLocFilter: "all",
    meshSort: { col: null, dir: 1 },
    l2tpSort: { col: null, dir: 1 },
    roamSort: { col: null, dir: 1 },
    devSort: { col: "ip", dir: 1 },
    scanResults: [],
    scanAbort: null,
    scanFoundCnt: 0,
    dashLastStatusCheck: null,
    dashLastDataSync: null,
    dashUptimeCache: {},
    stpStore: {},
    stpNodePos: (() => {
      try {
        return JSON.parse(localStorage.getItem("onsite_stp_pos") || "{}");
      } catch (e) {
        return {};
      }
    })(),
    stpEntries: [],
    stpEdgeData: [],
    stpScale: 1,
    stpTx: 0,
    stpTy: 0,
    stpDragNode: null,
    stpPan: null,
    stpWasDrag: false,
    STP_NW: 190,
    STP_NH: 96,
    ldLastResults: [],
    activityLog: [],
    ACTIVITY_LOG_MAX: 50,
    // SDN
    vlans: [],
    // Scanner
    rolloutScanAbort: null,
    // Topology
    topoNodes: {},
    topoEdges: [],
    topoLldpMap: {},
    topoRoot: "",
    topoDetailId: null,
    topoScale: 1,
    topoTx: 0,
    topoTy: 0,
    topoDragNode: null,
    topoPan: null,
    topoWasDrag: false,
    topoMode: "default",
    topoTrafficEnabled: false,
    topoTrafficData: {},
    topoTrafficHistory: {},
    topoTrafficTimer: null,
    topoMacSearch: "",
    topoMacSearchResults: [],
    NODE_W: 190,
    NODE_H: 84,
    // WiFi Plan
    wpNodes: [],
    wpEdges: [],
    wpScale: 1,
    wpTx: 0,
    wpTy: 0,
    wpDragNode: null,
    wpPan: null,
    wpWasDrag: false,
    wpBandFilter: "all",
    WP_NW: 170,
    WP_NH: 90,
    // Uptime tracking
    uptimeStats: {},
    // Auto-sync
    autoSyncTimer: null,
    autoSyncMinutes: 0
  };
  var state_default = S;

  // ui/lib/helpers.js
  function q(id) {
    return document.getElementById(id);
  }
  function h(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function fmtBytes(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
    if (n < 1073741824) return (n / 1048576).toFixed(1) + " MB";
    return (n / 1073741824).toFixed(2) + " GB";
  }
  function fmtSpeed(mbps, bps) {
    if (mbps > 0) return mbps >= 1e3 ? mbps / 1e3 + "Gbit/s" : mbps + "Mbit/s";
    const b = Number(bps) || 0;
    if (!b) return "\u2014";
    return b >= 1e9 ? b / 1e9 + "Gbit/s" : b >= 1e6 ? b / 1e6 + "Mbit/s" : b / 1e3 + "kbit/s";
  }
  function fmtDate(iso) {
    if (!iso) return "\u2014";
    return new Date(iso).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
  }
  function statusBadge(val) {
    const up = val === "1" || String(val).startsWith("up");
    return up ? `<span class="dot dot-green"></span><span class="badge badge-green">UP</span>` : `<span class="dot dot-red"></span><span class="badge badge-red">DOWN</span>`;
  }
  function setBadge(id, n) {
    const el = q("badge-" + id);
    if (el) el.textContent = n > 0 ? n : "";
  }
  var TYPE_LABELS = {
    "lx-ap": "Access Point",
    "lcos-ap": "Access Point",
    "switch": "Switch",
    "router": "Router",
    "firewall": "Firewall",
    "unknown": "Unbekannt"
  };
  var TYPE_BADGE = {
    "lx-ap": "badge-green",
    "lcos-ap": "badge-blue",
    "switch": "badge-yellow",
    "router": "badge-gray",
    "firewall": "badge-orange",
    "unknown": "badge-gray"
  };
  var OS_BADGE = {
    "LCOS LX": "badge-green",
    "LCOS FX": "badge-orange",
    "LCOS SX 3": "badge-yellow",
    "LCOS SX 4": "badge-yellow",
    "LCOS SX 5": "badge-yellow",
    "LCOS": "badge-blue",
    "LANCOM": "badge-gray"
  };
  var FILTER_OS_OPTS = ["LCOS", "LCOS LX", "LCOS SX 3", "LCOS SX 4", "LCOS SX 5", "LCOS FX"];
  var FILTER_TYPE_OPTS = ["Router", "Access Point", "Switch", "Firewall"];
  function parseModelStr(s) {
    if (s == null || s === "") return "";
    let m;
    m = s.match(/^LANCOM\s+(\S+)/);
    if (m) return m[1];
    m = s.match(/^Linux\s+(\S+)/);
    if (m && !/^\d/.test(m[1])) return m[1];
    if (/^Linux\b/.test(s)) return "";
    return s.split(/\s+/)[0].substring(0, 30);
  }
  function extractModel(sysDescr) {
    if (!sysDescr) return "";
    return parseModelStr(sysDescr.split(/[\r\n]/)[0].trim());
  }
  function shortModel(model) {
    return parseModelStr(model || "") || "\u2014";
  }
  function mkTh(label, col, sort, clickFn) {
    const active = sort.col === col;
    const cls = active ? sort.dir === 1 ? "sortable sort-asc" : "sortable sort-desc" : "sortable";
    return `<th class="${cls}" onclick="${clickFn}('${col}')">${label}</th>`;
  }
  function noSortTh(label) {
    return `<th>${label}</th>`;
  }
  function applySort(arr, sort, keyFn) {
    if (!sort.col) return arr;
    return [...arr].sort((a, b) => {
      const va = keyFn(a, sort.col), vb = keyFn(b, sort.col);
      if (va === vb) return 0;
      return (va < vb ? -1 : 1) * sort.dir;
    });
  }
  function clickSort(sort, col, renderFn) {
    if (sort.col === col) sort.dir *= -1;
    else {
      sort.col = col;
      sort.dir = 1;
    }
    renderFn();
  }
  function logActivity(text, type = "info") {
    state_default.activityLog.unshift({ ts: (/* @__PURE__ */ new Date()).toISOString(), text, type });
    if (state_default.activityLog.length > state_default.ACTIVITY_LOG_MAX) state_default.activityLog.length = state_default.ACTIVITY_LOG_MAX;
  }
  function getLocations() {
    const locs = /* @__PURE__ */ new Set();
    Object.values(state_default.deviceStore).forEach((d) => {
      if (d.location) locs.add(d.location);
    });
    return [...locs].sort();
  }
  function refreshLocationSelects() {
    const locs = getLocations();
    const filterOpts = `<option value="all">Alle Standorte</option>` + locs.map((l) => `<option value="${h(l)}">${h(l)}</option>`).join("");
    const scanOpts = `<option value="">Kein Standort</option>` + locs.map((l) => `<option value="${h(l)}">${h(l)}</option>`).join("");
    [
      ["dev-loc-filter", filterOpts],
      ["mesh-loc-filter", filterOpts],
      ["l2tp-loc-filter", filterOpts],
      ["topo-loc-filter", filterOpts],
      ["scan-loc-select", scanOpts]
    ].forEach(([id, opts]) => {
      const el = q(id);
      if (!el) return;
      const cur = el.value;
      el.innerHTML = opts;
      if (cur) el.value = cur;
    });
  }
  function matchesLocFilter(d) {
    return state_default.devLocFilter === "all" || (d.location || "") === state_default.devLocFilter;
  }
  async function parseFetchJson(r) {
    const text = await r.text();
    const t = String(text || "").trim();
    if (!t) {
      if (!r.ok) {
        throw new Error(`Leere Antwort vom Server (HTTP ${r.status}). L\xE4uft OnSite und ist die URL korrekt?`);
      }
      return {};
    }
    try {
      return JSON.parse(t);
    } catch {
      const preview = t.length > 160 ? `${t.slice(0, 160)}\u2026` : t;
      throw new Error(`Antwort ist kein g\xFCltiges JSON (HTTP ${r.status}): ${preview.replace(/\s+/g, " ")}`);
    }
  }
  async function parseFetchJsonLenient(r) {
    try {
      const text = await r.text();
      const t = String(text || "").trim();
      if (!t) return {};
      return JSON.parse(t);
    } catch {
      return {};
    }
  }

  // ui/theme.js
  function initTheme() {
    const saved = localStorage.getItem("onsite_theme") || "light";
    applyTheme(saved);
  }
  function toggleTheme() {
    const current = document.documentElement.dataset.theme || "light";
    applyTheme(current === "dark" ? "light" : "dark");
  }
  function applyTheme(theme) {
    if (theme === "dark") {
      document.documentElement.dataset.theme = "dark";
      document.getElementById("theme-toggle-btn").textContent = "\u{1F319}";
    } else {
      delete document.documentElement.dataset.theme;
      document.getElementById("theme-toggle-btn").textContent = "\u2600\uFE0F";
    }
    localStorage.setItem("onsite_theme", theme);
    if (document.getElementById("panel-topology")?.classList.contains("active")) {
      if (typeof window.renderTopoSvg === "function") window.renderTopoSvg();
    }
  }

  // ui/criteria.js
  var DEFAULT_CRITERIA_CLIENT = {
    osCriteria: [
      { os: "LCOS LX", match: ["LCOS LX", "LCOS-LX", "LX-", "LW-", "OW-", "OX-"] },
      { os: "LCOS FX", match: ["LCOS FX", "LCOS-FX"] },
      { os: "LCOS SX 3", match: ["LCOS SX 3.", "LCOS-SX 3.", "GS-2"] },
      { os: "LCOS SX 4", match: ["LCOS SX 4.", "LCOS-SX 4.", "GS-3"] },
      { os: "LCOS SX 5", match: ["LCOS SX 5.", "LCOS-SX 5.", "GS-4", "XS-4", "XS-5", "XS-6", "YS-7", "CS-"] },
      { os: "LCOS", match: ["LCOS", "LN-"] }
    ],
    typeCriteria: [
      { type: "Access Point", keywords: ["OAP", "IAP", "LN"] },
      { type: "Router", keywords: [] }
    ]
  };
  function detectOsFromCriteria(text) {
    const c = state_default.appCriteria || { osCriteria: [] };
    const upper = (text || "").toUpperCase();
    for (const rule of c.osCriteria) {
      if ((rule.match || []).some((kw) => upper.includes(kw.toUpperCase()))) return rule.os;
    }
    return null;
  }
  function detectOsFromCriteriaForLmc(text) {
    const c = state_default.appCriteria || { osCriteria: [] };
    const upper = (text || "").toUpperCase();
    for (const rule of c.osCriteria || []) {
      for (const kw of rule.match || []) {
        const k = String(kw).trim();
        if (k.length < 3) continue;
        if (/^\d+$/.test(k)) continue;
        if (upper.includes(k.toUpperCase())) return rule.os;
      }
    }
    return null;
  }
  function inferLmcDeviceType(os, model, lmcTypeRaw) {
    const osStr = os || "";
    if (osStr.startsWith("LCOS SX")) return "switch";
    if (osStr.startsWith("LCOS LX")) return "lx-ap";
    if (osStr.startsWith("LCOS FX")) return "firewall";
    const lt = (lmcTypeRaw || "").toUpperCase();
    if (lt.includes("SWITCH")) return "switch";
    if (lt === "FIREWALL" || lt === "UTM") return "firewall";
    if (lt.includes("ROUTER") || lt.includes("GATEWAY")) return "router";
    if (lt.includes("ACCESS_POINT") || lt === "AP" || lt.includes("WLAN") || lt.includes("WIFI")) {
      return detectDeviceType(osStr || "LCOS", model);
    }
    return detectDeviceType(osStr, model);
  }
  function detectDeviceType(os, sysDescr) {
    if ((os || "").startsWith("LCOS LX")) return "lx-ap";
    if ((os || "").startsWith("LCOS SX")) return "switch";
    if ((os || "").startsWith("LCOS FX")) return "firewall";
    if ((os || "").startsWith("LCOS")) {
      const c = state_default.appCriteria || { typeCriteria: [] };
      const desc = (sysDescr || "").toUpperCase();
      for (const rule of c.typeCriteria) {
        const kw = rule.keywords || [];
        if (!kw.length || kw.some((k) => desc.includes(k.toUpperCase()))) {
          if (rule.type === "Access Point") return "lcos-ap";
          if (rule.type === "Router") return "router";
        }
      }
    }
    return "unknown";
  }
  async function loadCriteria() {
    try {
      const r = await fetch("/api/criteria");
      state_default.appCriteria = await r.json();
    } catch {
      state_default.appCriteria = JSON.parse(JSON.stringify(DEFAULT_CRITERIA_CLIENT));
    }
    renderCriteriaTables(state_default.appCriteria);
  }
  async function saveCriteria() {
    state_default.appCriteria = collectCriteria();
    await fetch("/api/criteria", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(state_default.appCriteria) });
    const lbl = q("crit-save-lbl");
    lbl.style.display = "";
    setTimeout(() => {
      lbl.style.display = "none";
    }, 2500);
  }
  async function resetCriteria() {
    state_default.appCriteria = JSON.parse(JSON.stringify(DEFAULT_CRITERIA_CLIENT));
    renderCriteriaTables(state_default.appCriteria);
    await fetch("/api/criteria", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(state_default.appCriteria) });
    const lbl = q("crit-save-lbl");
    lbl.style.display = "";
    setTimeout(() => {
      lbl.style.display = "none";
    }, 2500);
  }
  function renderCriteriaTables(c) {
    const osBody = q("os-crit-body");
    const typeBody = q("type-crit-body");
    if (!osBody || !typeBody) return;
    osBody.innerHTML = (c.osCriteria || []).map((r) => `
    <tr>
      <td><span class="crit-label" data-val="${h(r.os || "")}">${h(r.os || "")}</span></td>
      <td><input class="crit-input" value="${h((r.match || []).join(", "))}" placeholder="keyword1, keyword2"></td>
    </tr>`).join("");
    typeBody.innerHTML = (c.typeCriteria || []).map((r) => `
    <tr>
      <td><span class="crit-label" data-val="${h(r.type || "")}">${h(r.type || "")}</span></td>
      <td><input class="crit-input" value="${h((r.keywords || []).join(", "))}" placeholder="OAP, IAP"></td>
    </tr>`).join("");
  }
  function collectCriteria() {
    const osCriteria = [...q("os-crit-body").rows].map((tr) => {
      const os = tr.querySelector("[data-val]").dataset.val;
      const kw = tr.querySelector("input").value;
      return { os, match: kw.split(",").map((s) => s.trim()).filter((s) => s) };
    });
    const typeCriteria = [...q("type-crit-body").rows].map((tr) => {
      const type = tr.querySelector("[data-val]").dataset.val;
      const kw = tr.querySelector("input").value;
      return { type, keywords: kw.split(",").map((s) => s.trim()).filter((s) => s) };
    });
    return { osCriteria, typeCriteria };
  }

  // ui/tabs/sdn.js
  function showSdnTab(name) {
    ["vlan"].forEach((t) => {
      q("sdntab-" + t).classList.toggle("active", t === name);
      q("sdnpanel-" + t).classList.toggle("active", t === name);
    });
  }
  function renderVlans() {
    const tbody = q("vlan-tbody");
    if (!state_default.vlans.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty">Keine VLANs konfiguriert</td></tr>';
      return;
    }
    tbody.innerHTML = state_default.vlans.map((v, i) => `
    <tr>
      <td><input class="settings-input" style="min-width:140px" value="${h(v.name)}" oninput="S.vlans[${i}].name=this.value"></td>
      <td><input class="settings-input" type="number" min="1" max="4095" style="width:90px" value="${v.vlanId}" oninput="S.vlans[${i}].vlanId=parseInt(this.value)||''"></td>
      <td style="text-align:center;padding:6px 14px"><input type="radio" name="mgmt-vlan" ${v.isManagement ? "checked" : ""} onchange="setManagementVlan(${i})" style="accent-color:var(--cyan);cursor:pointer;display:block;margin:auto"></td>
      <td><button class="btn btn-sm btn-ghost" onclick="deleteVlan(${i})" ${state_default.vlans.length === 1 ? "disabled" : ""}>L\xF6schen</button></td>
    </tr>`).join("");
  }
  function addVlan() {
    state_default.vlans.push({ name: "", vlanId: "", isManagement: false });
    renderVlans();
  }
  function deleteVlan(i) {
    const wasMgmt = state_default.vlans[i].isManagement;
    state_default.vlans.splice(i, 1);
    if (wasMgmt && state_default.vlans.length) state_default.vlans[0].isManagement = true;
    renderVlans();
  }
  function setManagementVlan(i) {
    state_default.vlans.forEach((v, idx) => v.isManagement = idx === i);
  }
  function validateVlans() {
    document.querySelectorAll("#tbl-vlan input[type=text], #tbl-vlan input[type=number]").forEach((el) => el.style.borderColor = "");
    const rows = [...q("vlan-tbody")?.rows || []];
    for (let i = 0; i < state_default.vlans.length; i++) {
      const v = state_default.vlans[i];
      if (!String(v.name).trim()) {
        rows[i]?.cells[0].querySelector("input")?.style.setProperty("border-color", "var(--red)");
        return "Name darf nicht leer sein.";
      }
      const id = parseInt(v.vlanId);
      if (isNaN(id) || id < 1 || id > 4095) {
        rows[i]?.cells[1].querySelector("input")?.style.setProperty("border-color", "var(--red)");
        return "VLAN ID muss eine Zahl zwischen 1 und 4095 sein.";
      }
    }
    const ids = state_default.vlans.map((v) => parseInt(v.vlanId));
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dupes.length) {
      rows.forEach((row, i) => {
        if (dupes.includes(parseInt(state_default.vlans[i].vlanId)))
          row.cells[1].querySelector("input")?.style.setProperty("border-color", "var(--red)");
      });
      return `VLAN ID ${dupes[0]} ist mehrfach vergeben.`;
    }
    if (!state_default.vlans.some((v) => v.isManagement)) return "Ein VLAN muss als Management VLAN festgelegt sein.";
    return null;
  }
  async function saveVlans() {
    const err = validateVlans();
    if (err) {
      showVlanStatus(err, "error");
      return;
    }
    try {
      await fetch("/api/sdn", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vlans: state_default.vlans }) });
      showVlanStatus("Gespeichert.", "ok");
    } catch {
      showVlanStatus("Fehler beim Speichern.", "error");
    }
  }
  function showVlanStatus(msg, cls) {
    const s = q("vlan-status");
    s.textContent = msg;
    s.className = "status-bar " + cls;
    s.style.display = "";
    if (cls === "ok") setTimeout(() => {
      s.style.display = "none";
    }, 3e3);
  }
  async function loadVlans() {
    try {
      const r = await fetch("/api/sdn");
      const data = await r.json();
      state_default.vlans = data.vlans || [];
    } catch {
      state_default.vlans = [{ name: "Management", vlanId: 1, isManagement: true }];
    }
    renderVlans();
  }

  // ui/tabs/settings.js
  function toggleCfgDevicePasswordVisible() {
    const inp = q("cfg-device-password");
    const btn = q("cfg-device-password-toggle");
    if (!inp || !btn) return;
    const show = inp.type === "password";
    inp.type = show ? "text" : "password";
    btn.textContent = show ? "Verbergen" : "Anzeigen";
  }
  function showCfgTab(name) {
    ["snmp", "import", "rssi", "license", "devpw", "monitoring", "alerts", "scheduler", "ai", "grundwerte", "traffic"].forEach((t) => {
      const tab = q("cfgtab-" + t);
      if (tab) tab.classList.toggle("active", t === name);
      const panel = q("cfgpanel-" + t);
      if (panel) {
        panel.classList.toggle("active", t === name);
        panel.style.display = t === name ? "" : "none";
      }
    });
    if (name === "license") loadLicense();
  }
  function renderLicenseStatus(lic) {
    const badge = q("license-badge");
    const cust = q("license-customer");
    const details = q("license-details");
    const box = q("license-status-box");
    const cfg = {
      active: { label: "Aktiv", bg: "var(--green)", text: "#fff" },
      trial: { label: "Trial", bg: "var(--yellow)", text: "#1a1a00" },
      trial_expired: { label: "Trial abgelaufen", bg: "var(--red)", text: "#fff" },
      expired: { label: "Abgelaufen", bg: "var(--red)", text: "#fff" },
      invalid: { label: "Ung\xFCltig", bg: "var(--red)", text: "#fff" },
      none: { label: "Keine Lizenz", bg: "var(--border)", text: "var(--text2)" }
    }[lic.status] || { label: lic.status, bg: "var(--border)", text: "var(--text1)" };
    const htag = q("license-header-tag");
    if (htag) {
      htag.dataset.status = lic.status;
      const headerLabel = {
        active: `Lizenz \xB7 ${lic.daysLeft}d`,
        trial: `Trial \xB7 ${lic.minutesLeft}min`,
        trial_expired: "Trial abgelaufen",
        expired: "Lizenz abgelaufen",
        invalid: "Lizenz ung\xFCltig",
        none: "Keine Lizenz"
      }[lic.status] || cfg.label;
      htag.textContent = headerLabel;
      htag.title = lic.status === "active" ? `Lizenziert: ${lic.customer} \xB7 g\xFCltig bis ${lic.expiresAt}` : lic.message || "";
    }
    if (!badge) return;
    badge.textContent = cfg.label;
    badge.style.background = cfg.bg;
    badge.style.color = cfg.text;
    box.style.borderColor = cfg.bg;
    if (lic.status === "active") {
      cust.textContent = lic.customer;
      details.innerHTML = `
      <span>E-Mail: ${lic.email}</span>
      <span>Ausgestellt: ${lic.issuedAt}</span>
      <span>G\xFCltig bis: <strong>${lic.expiresAt}</strong> (noch ${lic.daysLeft} Tag${lic.daysLeft !== 1 ? "e" : ""})</span>`;
    } else if (lic.status === "trial") {
      cust.textContent = "Testversion";
      details.innerHTML = `<span>${lic.message}</span><span>Trial-Start: ${new Date(lic.trialStart).toLocaleString("de-DE")}</span>`;
    } else {
      cust.textContent = "";
      details.innerHTML = `<span>${lic.message || ""}</span>`;
    }
    const wall = q("license-wall");
    const locked = lic.status !== "active" && lic.status !== "trial";
    if (wall) {
      wall.style.display = locked ? "flex" : "none";
      if (locked) {
        const lwStatus = q("lw-status");
        if (lwStatus) {
          lwStatus.textContent = cfg.label;
          lwStatus.style.background = cfg.bg;
          lwStatus.style.color = cfg.text;
        }
      }
    }
  }
  async function loadLicense() {
    try {
      const r = await fetch("/api/license");
      renderLicenseStatus(await r.json());
    } catch {
    }
  }
  function licenseDragOver(e, wall = false) {
    e.preventDefault();
    q(wall ? "lw-drop" : "license-drop").classList.add("drag-over");
  }
  function licenseDragLeave(wall = false) {
    q(wall ? "lw-drop" : "license-drop").classList.remove("drag-over");
  }
  function licenseDrop(e, wall = false) {
    e.preventDefault();
    q(wall ? "lw-drop" : "license-drop").classList.remove("drag-over");
    const file = e.dataTransfer.files[0];
    if (file) readLicenseFile(file, wall);
  }
  function licenseFileSelected(e, wall = false) {
    const file = e.target.files[0];
    if (file) readLicenseFile(file, wall);
  }
  function readLicenseFile(file, wall = false) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      q(wall ? "lw-input" : "license-input").value = ev.target.result;
      q(wall ? "lw-drop-text" : "license-drop-text").textContent = `\u{1F4C4} ${file.name}`;
    };
    reader.readAsText(file);
  }
  async function activateLicense(wall = false) {
    const input = q(wall ? "lw-input" : "license-input").value.trim();
    const msg = q(wall ? "lw-msg" : "license-msg");
    if (!input) return;
    try {
      const lic = JSON.parse(input);
      const r = await fetch("/api/license", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(lic) });
      const data = await r.json();
      renderLicenseStatus(data);
      msg.style.color = data.status === "active" ? "var(--green)" : "var(--red)";
      msg.textContent = data.status === "active" ? "\u2713 Lizenz erfolgreich aktiviert" : "Fehler: " + (data.message || "Unbekannt");
      msg.style.display = "";
      if (data.status === "active") q(wall ? "lw-input" : "license-input").value = "";
    } catch {
      msg.style.color = "var(--red)";
      msg.textContent = "Fehler: Ung\xFCltiges JSON-Format";
      msg.style.display = "";
    }
    setTimeout(() => {
      msg.style.display = "none";
    }, 4e3);
  }
  async function removeLicense() {
    await fetch("/api/license", { method: "DELETE" });
    await loadLicense();
  }
  function onSnmpVersionChange() {
    const v = q("cfg-snmp-version").value;
    const v3 = v === "3";
    const v12 = v === "2c";
    const elV2 = q("cfg-snmpv2-section");
    const elV3 = q("cfg-v3-section");
    if (elV3) elV3.style.display = v3 ? "" : "none";
    if (elV2) elV2.style.display = v12 ? "" : "none";
    if (v3) onV3LevelChange();
  }
  function onV3LevelChange() {
    const lvl = q("cfg-v3-seclevel").value;
    q("cfg-v3-auth-block").style.display = lvl === "authNoPriv" || lvl === "authPriv" ? "" : "none";
    q("cfg-v3-priv-block").style.display = lvl === "authPriv" ? "" : "none";
  }
  async function loadSettings() {
    try {
      const r = await fetch("/api/settings");
      state_default.appSettings = await r.json();
    } catch {
      state_default.appSettings = { snmpReadCommunity: "public", snmpWriteCommunity: "private", snmpVersion: "2c", rssiGreen: 80, rssiYellow: 50, rssiOrange: 0 };
    }
    q("cfg-snmp-read").value = state_default.appSettings.snmpReadCommunity || "public";
    q("cfg-snmp-write").value = state_default.appSettings.snmpWriteCommunity || "private";
    {
      let sv = state_default.appSettings.snmpVersion || "2c";
      if (sv === "1") sv = "2c";
      q("cfg-snmp-version").value = sv;
    }
    q("cfg-rssi-green").value = state_default.appSettings.rssiGreen ?? 80;
    q("cfg-rssi-yellow").value = state_default.appSettings.rssiYellow ?? 50;
    q("cfg-rssi-orange").value = state_default.appSettings.rssiOrange ?? 0;
    q("cfg-v3-secname").value = state_default.appSettings.snmpV3SecurityName || "";
    q("cfg-v3-seclevel").value = state_default.appSettings.snmpV3SecurityLevel || "authPriv";
    q("cfg-v3-authproto").value = state_default.appSettings.snmpV3AuthProtocol || "SHA";
    q("cfg-v3-authpass").value = state_default.appSettings.snmpV3AuthPassword || "";
    q("cfg-v3-privproto").value = state_default.appSettings.snmpV3PrivProtocol || "AES";
    q("cfg-v3-privpass").value = state_default.appSettings.snmpV3PrivPassword || "";
    const _fOS = state_default.appSettings.filterOS || [];
    const _fType = state_default.appSettings.filterType || [];
    FILTER_OS_OPTS.forEach((v, i) => {
      const el = q(`cfg-os-${i}`);
      if (el) el.checked = _fOS.includes(v);
    });
    FILTER_TYPE_OPTS.forEach((v, i) => {
      const el = q(`cfg-type-${i}`);
      if (el) el.checked = _fType.includes(v);
    });
    onSnmpVersionChange();
    if (q("lmc-host")) q("lmc-host").value = state_default.appSettings.lmcHost || "cloud.lancom.de";
    if (state_default.appSettings.lastScanSubnet) q("scan-subnet").value = state_default.appSettings.lastScanSubnet;
    if (state_default.appSettings.lastRolloutSubnet) q("rollout-subnet").value = state_default.appSettings.lastRolloutSubnet;
    {
      const dp = q("cfg-device-password");
      if (dp) {
        dp.type = "password";
        const tgl = q("cfg-device-password-toggle");
        if (tgl) tgl.textContent = "Anzeigen";
      }
    }
    if (state_default.appSettings.devicePassword) {
      q("cfg-device-password").value = state_default.appSettings.devicePassword;
      const rp = q("script-run-pass");
      if (rp) rp.value = state_default.appSettings.devicePassword;
    }
    const autoSync = q("cfg-auto-sync");
    if (autoSync) autoSync.value = state_default.appSettings.autoSyncMinutes || 0;
    const priceEl = q("cfg-power-price");
    if (priceEl) priceEl.value = state_default.appSettings.powerPricePerKwh ?? 0.3;
    const notifyEl = q("cfg-notify-offline");
    if (notifyEl) notifyEl.checked = !!state_default.appSettings.notifyOffline;
    setAutoSync(parseInt(state_default.appSettings.autoSyncMinutes) || 0);
    const permEl = q("notify-perm-status");
    if (permEl) {
      if (!("Notification" in window) || location.protocol !== "https:" && location.hostname !== "localhost") {
        permEl.textContent = "\u26A0 Nur \xFCber HTTPS verf\xFCgbar";
        permEl.style.color = "var(--text3)";
        const btn = permEl.previousElementSibling;
        if (btn) btn.style.display = "none";
      } else {
        permEl.textContent = Notification.permission === "granted" ? "\u2713 Erlaubt" : "";
      }
    }
    const a = state_default.appSettings;
    const ae = a.alertEmail || {}, aw = a.alertWebhook || {}, at = a.alertTelegram || {}, ar = a.alertRules || {};
    const aEl = (id) => q(id);
    if (aEl("cfg-alerts-enabled")) aEl("cfg-alerts-enabled").checked = !!a.alertsEnabled;
    if (aEl("cfg-alert-interval")) aEl("cfg-alert-interval").value = a.alertMonitorIntervalMin || 5;
    if (aEl("cfg-alert-cooldown")) aEl("cfg-alert-cooldown").value = a.alertCooldownSec || 300;
    if (aEl("cfg-alert-email-on")) aEl("cfg-alert-email-on").checked = !!ae.enabled;
    if (aEl("cfg-alert-email-host")) aEl("cfg-alert-email-host").value = ae.host || "";
    if (aEl("cfg-alert-email-port")) aEl("cfg-alert-email-port").value = ae.port || 587;
    if (aEl("cfg-alert-email-secure")) aEl("cfg-alert-email-secure").checked = !!ae.secure;
    if (aEl("cfg-alert-email-user")) aEl("cfg-alert-email-user").value = ae.user || "";
    if (aEl("cfg-alert-email-pass")) aEl("cfg-alert-email-pass").value = ae.pass || "";
    if (aEl("cfg-alert-email-from")) aEl("cfg-alert-email-from").value = ae.from || "";
    if (aEl("cfg-alert-email-to")) aEl("cfg-alert-email-to").value = ae.to || "";
    if (aEl("cfg-alert-wh-on")) aEl("cfg-alert-wh-on").checked = !!aw.enabled;
    if (aEl("cfg-alert-wh-url")) aEl("cfg-alert-wh-url").value = aw.url || "";
    if (aEl("cfg-alert-wh-type")) aEl("cfg-alert-wh-type").value = aw.type || "generic";
    if (aEl("cfg-alert-tg-on")) aEl("cfg-alert-tg-on").checked = !!at.enabled;
    if (aEl("cfg-alert-tg-token")) aEl("cfg-alert-tg-token").value = at.botToken || "";
    if (aEl("cfg-alert-tg-chatid")) aEl("cfg-alert-tg-chatid").value = at.chatId || "";
    if (aEl("cfg-alert-tg-silent")) aEl("cfg-alert-tg-silent").checked = !!at.silent;
    if (aEl("cfg-alert-r-offline")) aEl("cfg-alert-r-offline").checked = ar.offline !== false;
    if (aEl("cfg-alert-r-online")) aEl("cfg-alert-r-online").checked = ar.online !== false;
    if (aEl("cfg-alert-r-trap")) aEl("cfg-alert-r-trap").checked = !!ar.trap;
    if (aEl("cfg-alert-r-trapfilter")) aEl("cfg-alert-r-trapfilter").value = ar.trapFilter || "";
    if (aEl("cfg-alert-r-loop")) aEl("cfg-alert-r-loop").checked = ar.loop !== false;
    if (aEl("cfg-alert-r-temp")) aEl("cfg-alert-r-temp").checked = !!ar.tempThreshold;
    if (aEl("cfg-alert-r-tempval")) aEl("cfg-alert-r-tempval").value = ar.tempThreshold || 65;
    if (aEl("cfg-ai-provider")) aEl("cfg-ai-provider").value = a.aiProvider || "openai";
    if (aEl("cfg-ai-endpoint")) aEl("cfg-ai-endpoint").value = a.aiEndpoint || "";
    if (aEl("cfg-ai-key")) aEl("cfg-ai-key").value = a.aiApiKey || "";
    if (aEl("cfg-ai-model")) aEl("cfg-ai-model").value = a.aiModel || "";
    onAiProviderChange();
    if (aEl("cfg-sched-hours")) aEl("cfg-sched-hours").value = a.scheduledScanHours || 0;
    if (aEl("cfg-sched-subnet")) aEl("cfg-sched-subnet").value = a.scheduledScanSubnet || a.lastScanSubnet || "";
    if (aEl("cfg-sched-autosave")) aEl("cfg-sched-autosave").checked = !!a.scheduledAutoSave;
    if (aEl("cfg-traffic-interval")) aEl("cfg-traffic-interval").value = a.trafficPollInterval || 60;
    if (aEl("cfg-traffic-history-enabled")) aEl("cfg-traffic-history-enabled").checked = a.trafficHistoryEnabled !== false;
    if (aEl("cfg-traffic-retention")) aEl("cfg-traffic-retention").value = a.trafficRetentionHours || 24;
    if (aEl("cfg-traffic-autostart")) aEl("cfg-traffic-autostart").checked = !!a.trafficAutoStart;
    if (aEl("cfg-traffic-warn")) aEl("cfg-traffic-warn").value = a.trafficWarnThreshold || 80;
  }
  async function saveSettings() {
    state_default.appSettings = {
      ...state_default.appSettings,
      snmpReadCommunity: q("cfg-snmp-read").value.trim(),
      snmpWriteCommunity: q("cfg-snmp-write").value.trim(),
      snmpVersion: q("cfg-snmp-version").value,
      rssiGreen: parseInt(q("cfg-rssi-green").value) || 80,
      rssiYellow: parseInt(q("cfg-rssi-yellow").value) || 50,
      rssiOrange: parseInt(q("cfg-rssi-orange").value) || 0,
      snmpV3SecurityName: q("cfg-v3-secname").value.trim(),
      snmpV3SecurityLevel: q("cfg-v3-seclevel").value,
      snmpV3AuthProtocol: q("cfg-v3-authproto").value,
      snmpV3AuthPassword: q("cfg-v3-authpass").value,
      snmpV3PrivProtocol: q("cfg-v3-privproto").value,
      snmpV3PrivPassword: q("cfg-v3-privpass").value,
      filterOS: FILTER_OS_OPTS.filter((_, i) => q(`cfg-os-${i}`)?.checked),
      filterType: FILTER_TYPE_OPTS.filter((_, i) => q(`cfg-type-${i}`)?.checked),
      devicePassword: q("cfg-device-password").value,
      autoSyncMinutes: parseInt(q("cfg-auto-sync")?.value) || 0,
      notifyOffline: q("cfg-notify-offline")?.checked || false,
      powerPricePerKwh: parseFloat(q("cfg-power-price")?.value) || 0.3,
      alertsEnabled: q("cfg-alerts-enabled")?.checked || false,
      alertMonitorIntervalMin: parseInt(q("cfg-alert-interval")?.value) || 5,
      alertCooldownSec: parseInt(q("cfg-alert-cooldown")?.value) || 300,
      alertEmail: {
        enabled: q("cfg-alert-email-on")?.checked || false,
        host: q("cfg-alert-email-host")?.value?.trim() || "",
        port: parseInt(q("cfg-alert-email-port")?.value) || 587,
        secure: q("cfg-alert-email-secure")?.checked || false,
        user: q("cfg-alert-email-user")?.value?.trim() || "",
        pass: q("cfg-alert-email-pass")?.value || "",
        from: q("cfg-alert-email-from")?.value?.trim() || "",
        to: q("cfg-alert-email-to")?.value?.trim() || ""
      },
      alertWebhook: {
        enabled: q("cfg-alert-wh-on")?.checked || false,
        url: q("cfg-alert-wh-url")?.value?.trim() || "",
        type: q("cfg-alert-wh-type")?.value || "generic"
      },
      alertTelegram: {
        enabled: q("cfg-alert-tg-on")?.checked || false,
        botToken: q("cfg-alert-tg-token")?.value?.trim() || "",
        chatId: q("cfg-alert-tg-chatid")?.value?.trim() || "",
        silent: q("cfg-alert-tg-silent")?.checked || false
      },
      alertRules: {
        offline: q("cfg-alert-r-offline")?.checked || false,
        online: q("cfg-alert-r-online")?.checked || false,
        trap: q("cfg-alert-r-trap")?.checked || false,
        trapFilter: q("cfg-alert-r-trapfilter")?.value?.trim() || "",
        loop: q("cfg-alert-r-loop")?.checked || false,
        tempThreshold: q("cfg-alert-r-temp")?.checked ? parseInt(q("cfg-alert-r-tempval")?.value) || 65 : 0
      },
      scheduledScanHours: parseInt(q("cfg-sched-hours")?.value) || 0,
      scheduledScanSubnet: q("cfg-sched-subnet")?.value?.trim() || "",
      scheduledAutoSave: q("cfg-sched-autosave")?.checked || false,
      aiProvider: q("cfg-ai-provider")?.value || "openai",
      aiEndpoint: q("cfg-ai-endpoint")?.value?.trim() || "",
      aiApiKey: q("cfg-ai-key")?.value || "",
      aiModel: q("cfg-ai-model")?.value?.trim() || "",
      trafficPollInterval: parseInt(q("cfg-traffic-interval")?.value) || 60,
      trafficHistoryEnabled: q("cfg-traffic-history-enabled")?.checked !== false,
      trafficRetentionHours: parseInt(q("cfg-traffic-retention")?.value) || 24,
      trafficAutoStart: q("cfg-traffic-autostart")?.checked || false,
      trafficWarnThreshold: parseInt(q("cfg-traffic-warn")?.value) || 80
    };
    setAutoSync(state_default.appSettings.autoSyncMinutes || 0);
    await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(state_default.appSettings) });
    const lbl = q("settings-save-lbl");
    lbl.style.display = "";
    setTimeout(() => {
      lbl.style.display = "none";
    }, 2500);
    window.renderMesh?.();
    window.renderL2tp?.();
  }
  var _autoSyncTimer = null;
  var _checkAllDeviceStatus = async () => {
  };
  function registerAutoSyncHandlers(check) {
    _checkAllDeviceStatus = check || _checkAllDeviceStatus;
  }
  function setAutoSync(minutes) {
    if (_autoSyncTimer) {
      clearInterval(_autoSyncTimer);
      _autoSyncTimer = null;
    }
    if (minutes > 0) _autoSyncTimer = setInterval(autoSyncRun, minutes * 6e4);
  }
  async function autoSyncRun() {
    const prevStates = Object.fromEntries(Object.entries(state_default.deviceStore).map(([ip, d]) => [ip, d.online]));
    await _checkAllDeviceStatus();
    for (const [ip, d] of Object.entries(state_default.deviceStore)) {
      if (prevStates[ip] !== false && d.online === false) notifyOffline(d);
    }
  }
  function notifyOffline(dev) {
    if (!state_default.appSettings.notifyOffline) return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    new Notification(`OnSite: ${dev.name || dev.ip} offline`, { body: `IP: ${dev.ip}${dev.os ? " \xB7 " + dev.os : ""}`, tag: `offline-${dev.ip}` });
  }
  async function _testChannel(channel, msgId) {
    const msg = q(msgId);
    if (!msg) return;
    msg.textContent = "Sende\u2026";
    msg.style.color = "var(--text2)";
    msg.style.display = "";
    try {
      const r = await fetch("/api/alert-test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel }) });
      const d = await r.json();
      msg.textContent = d.ok ? "\u2713 Gesendet" : `\u2717 ${d.error || "Fehler"}`;
      msg.style.color = d.ok ? "var(--green)" : "var(--red)";
    } catch (e) {
      msg.textContent = `\u2717 ${e.message}`;
      msg.style.color = "var(--red)";
    }
    setTimeout(() => {
      msg.style.display = "none";
    }, 5e3);
  }
  function testAlertEmail() {
    _testChannel("email", "alert-email-msg");
  }
  function testAlertWebhook() {
    _testChannel("webhook", "alert-wh-msg");
  }
  function testAlertTelegram() {
    _testChannel("telegram", "alert-tg-msg");
  }
  async function loadAlertLog() {
    const box = q("alert-log-box");
    if (!box) return;
    try {
      const r = await fetch("/api/alert-log");
      const log = await r.json();
      const cnt = q("alert-log-count");
      if (cnt) cnt.textContent = `${log.length} Eintr\xE4ge`;
      if (!log.length) {
        box.innerHTML = '<div style="color:var(--text3);padding:8px 0">Keine Alerts vorhanden</div>';
        return;
      }
      const sevStyle = { critical: "color:#e74c3c", warning: "color:#f39c12", ok: "color:#27ae60", info: "color:#3498db" };
      box.innerHTML = log.slice(0, 100).map((e) => {
        const ts = new Date(e.ts).toLocaleString("de-DE");
        const ch = e.channels?.length ? e.channels.join(", ") : "\u2013";
        const sev = sevStyle[e.severity] || "";
        return `<div style="padding:4px 0;border-bottom:1px solid var(--border);display:flex;gap:10px;align-items:baseline"><span style="color:var(--text3);min-width:130px">${ts}</span><span style="font-weight:600;min-width:60px;${sev}">${e.type}</span><span style="flex:1">${e.title || ""}</span><span style="color:var(--text3)">${ch}</span></div>`;
      }).join("");
    } catch {
      box.innerHTML = '<div style="color:var(--red)">Fehler beim Laden</div>';
    }
  }
  async function clearAlertLog() {
    await fetch("/api/alert-log", { method: "DELETE" });
    const box = q("alert-log-box");
    if (box) box.innerHTML = '<div style="color:var(--text3);padding:8px 0">Keine Alerts vorhanden</div>';
    const cnt = q("alert-log-count");
    if (cnt) cnt.textContent = "0 Eintr\xE4ge";
  }
  var AI_PRESETS = {
    gemini: { endpoint: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.0-flash" },
    groq: { endpoint: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" },
    ollama: { endpoint: "http://localhost:11434/v1", model: "llama3.2" },
    openai: { endpoint: "https://api.openai.com/v1", model: "gpt-4o-mini" },
    anthropic: { endpoint: "", model: "claude-sonnet-4-20250514" }
  };
  function onAiProviderChange() {
    const prov = q("cfg-ai-provider")?.value || "gemini";
    const preset = AI_PRESETS[prov] || AI_PRESETS.gemini;
    const ep = q("cfg-ai-endpoint"), md = q("cfg-ai-model"), ky = q("cfg-ai-key");
    if (ep) ep.placeholder = preset.endpoint || "";
    if (md) md.placeholder = preset.model;
    if (ky) ky.placeholder = prov === "ollama" ? "(nicht n\xF6tig)" : "API-Key eingeben";
  }
  async function runSchedulerNow() {
    const st = q("sched-status");
    if (st) {
      st.textContent = "Scan l\xE4uft\u2026";
      st.style.color = "var(--accent)";
    }
    try {
      const r = await fetch("/api/scheduler/run", { method: "POST" });
      const data = await r.json();
      if (data.error) throw new Error(data.error);
      const wrap = q("sched-last-result"), info = q("sched-last-info");
      if (wrap) wrap.style.display = "";
      if (info) {
        const ts = data.ts ? new Date(data.ts).toLocaleString("de-DE") : "\u2014";
        info.innerHTML = `${ts} \xB7 ${data.scanned} gepr\xFCft \xB7 <b style="color:${data.newDevices?.length ? "var(--green)" : "var(--text3)"}">${data.newDevices?.length || 0} neue Ger\xE4te</b>` + (data.newDevices?.length ? "<br>" + data.newDevices.map((d) => `${d.ip} \u2013 ${d.sysName || d.model || "?"}`).join("<br>") : "");
      }
      if (st) {
        st.textContent = `Fertig: ${data.newDevices?.length || 0} neu`;
        st.style.color = "var(--green)";
      }
    } catch (e) {
      if (st) {
        st.textContent = e.message;
        st.style.color = "var(--red)";
      }
    }
  }
  async function requestNotifyPermission() {
    if (!("Notification" in window)) {
      alert("Ihr Browser unterst\xFCtzt keine Desktop-Benachrichtigungen.");
      return;
    }
    const result = await Notification.requestPermission();
    const el = q("notify-perm-status");
    if (el) el.textContent = result === "granted" ? "\u2713 Erlaubt" : "\u2717 Verweigert";
  }

  // ui/tabs/ai-chat.js
  var _history = [];
  var _abort = null;
  var _streaming = false;
  var QUICK = {
    status: "Fasse den aktuellen Netzwerk-Status zusammen. Welche Ger\xE4te sind online/offline? Gibt es Auff\xE4lligkeiten?",
    problems: "Analysiere das Netzwerk auf Probleme. Pr\xFCfe offline-Ger\xE4te, aktuelle Traps, Loops und andere Auff\xE4lligkeiten. Gib konkrete Handlungsempfehlungen.",
    traps: "Werte die letzten SNMP-Traps aus. Was bedeuten sie? Gibt es Muster oder H\xE4ufungen?",
    recommend: "Gib Empfehlungen zur Verbesserung des Netzwerks. Ber\xFCcksichtige Sicherheit, Redundanz, Performance und Best Practices f\xFCr LANCOM-Ger\xE4te."
  };
  function aiSend(text) {
    if (_streaming) return;
    const input = q("ai-input");
    const msg = text || input?.value?.trim();
    if (!msg) return;
    if (input) input.value = "";
    _history.push({ role: "user", content: msg });
    render();
    streamResponse();
  }
  function aiQuick(type) {
    aiSend(QUICK[type] || type);
  }
  function aiClear() {
    if (_abort) {
      _abort.abort();
      _abort = null;
    }
    _history = [];
    _streaming = false;
    render();
  }
  function aiStop() {
    if (_abort) {
      _abort.abort();
      _abort = null;
    }
    _streaming = false;
    updateSendBtn();
  }
  async function streamResponse() {
    _abort = new AbortController();
    _streaming = true;
    updateSendBtn();
    _history.push({ role: "assistant", content: "" });
    const idx = _history.length - 1;
    render();
    try {
      const resp = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: _history.filter((m) => m.content && !m.error).map((m) => ({ role: m.role, content: m.content })) }),
        signal: _abort.signal
      });
      if (resp.headers.get("content-type")?.includes("application/json")) {
        const err = await resp.json();
        _history[idx].content = err.error || "Unbekannter Fehler";
        _history[idx].error = true;
        render();
        _streaming = false;
        updateSendBtn();
        return;
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop();
        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith("data: ")) continue;
          const data = t.slice(6);
          if (data === "[DONE]") break;
          try {
            const j = JSON.parse(data);
            if (j.content) _history[idx].content += j.content;
            if (j.error) {
              _history[idx].content += j.error;
              _history[idx].error = true;
            }
          } catch {
          }
        }
        renderLastMsg(idx);
      }
    } catch (e) {
      if (e.name !== "AbortError") {
        _history[idx].content += `

Fehler: ${e.message}`;
        _history[idx].error = true;
      }
    }
    _streaming = false;
    _abort = null;
    updateSendBtn();
    render();
  }
  function updateSendBtn() {
    const btn = q("ai-send-btn");
    if (!btn) return;
    btn.textContent = _streaming ? "Stopp" : "Senden";
    btn.onclick = _streaming ? aiStop : () => aiSend();
  }
  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function fmtMd(raw) {
    if (!raw) return '<span class="ai-dots">\u25CF\u25CF\u25CF</span>';
    let html = esc(raw);
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, "<pre><code>$2</code></pre>");
    html = html.replace(/```([\s\S]*?)```/g, "<pre><code>$1</code></pre>");
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
    html = html.replace(/^### (.+)$/gm, '<strong style="font-size:14px">$1</strong>');
    html = html.replace(/^## (.+)$/gm, '<strong style="font-size:15px">$1</strong>');
    html = html.replace(/^[-*] (.+)$/gm, '<span style="display:block;padding-left:12px">\u2022 $1</span>');
    html = html.replace(/^(\d+)\. (.+)$/gm, '<span style="display:block;padding-left:12px">$1. $2</span>');
    html = html.replace(/\n/g, "<br>");
    html = html.replace(
      /<pre><code>([\s\S]*?)<\/code><\/pre>/g,
      (_, code) => `<pre><code>${code.replace(/<br>/g, "\n")}</code></pre>`
    );
    return html;
  }
  function renderLastMsg(idx) {
    const box = q("ai-messages");
    if (!box) return;
    const el = box.querySelector(`[data-idx="${idx}"] .ai-content`);
    if (el) {
      el.innerHTML = fmtMd(_history[idx].content);
      box.scrollTop = box.scrollHeight;
    }
  }
  function render() {
    const box = q("ai-messages");
    if (!box) return;
    if (!_history.length) {
      box.innerHTML = `
      <div class="ai-welcome">
        <div style="font-size:28px;margin-bottom:8px">\u{1F50D}</div>
        <div style="font-size:15px;font-weight:600;margin-bottom:6px">KI-Netzwerk-Assistent</div>
        <div style="font-size:12px;color:var(--text3);max-width:400px;line-height:1.5">
          Ich kenne dein Netzwerk \u2013 Ger\xE4te, Status, Traps und Alerts.
          Stelle mir eine Frage oder nutze die Schnellaktionen oben.
        </div>
      </div>`;
      return;
    }
    box.innerHTML = _history.map((m, i) => {
      if (m.role === "user") {
        return `<div class="ai-row ai-row-user"><div class="ai-bubble ai-bubble-user">${esc(m.content)}</div></div>`;
      }
      const cls = m.error ? " ai-error" : "";
      return `<div class="ai-row ai-row-ai" data-idx="${i}"><div class="ai-bubble ai-bubble-ai${cls}"><div class="ai-content">${fmtMd(m.content)}</div></div></div>`;
    }).join("");
    box.scrollTop = box.scrollHeight;
  }
  function aiInputKey(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (_streaming) return;
      aiSend();
    }
  }

  // ui/tabs/devices.js
  var _renderMesh = () => {
    if (typeof window !== "undefined" && window.renderMesh) window.renderMesh();
  };
  var _renderL2tp = () => {
    if (typeof window !== "undefined" && window.renderL2tp) window.renderL2tp();
  };
  var _renderClients = () => {
    if (typeof window !== "undefined" && window.renderClients) window.renderClients();
  };
  var _renderScriptDevices = () => {
    if (typeof window !== "undefined" && window.renderScriptDevices) window.renderScriptDevices();
  };
  function rebuildCachedData() {
    state_default.meshData.length = 0;
    state_default.l2tpData.length = 0;
    state_default.clientsData.length = 0;
    Object.values(state_default.deviceStore).forEach((d) => {
      if (d.wdsLinks?.length) state_default.meshData.push(...d.wdsLinks);
      if (d.l2tpEndpoints?.length) state_default.l2tpData.push(...d.l2tpEndpoints);
      const onlineOk = d.online !== false;
      if (onlineOk && d.wlanClients?.length) state_default.clientsData.push(...d.wlanClients);
      if (onlineOk && d.fdbEntries?.length) state_default.clientsData.push(...d.fdbEntries);
    });
  }
  async function loadDevices() {
    try {
      const r = await fetch("/api/devices");
      state_default.deviceStore = await r.json();
    } catch {
      state_default.deviceStore = {};
    }
    rebuildCachedData();
    refreshLocationSelects();
    renderDevices();
    _renderMesh();
    _renderL2tp();
    _renderClients();
    setBadge("devices", Object.keys(state_default.deviceStore).length || 0);
  }
  async function saveDevice(dev) {
    state_default.deviceStore[dev.ip] = dev;
    await fetch("/api/devices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [dev.ip]: dev }) });
    refreshLocationSelects();
    renderDevices();
    setBadge("devices", Object.keys(state_default.deviceStore).length);
  }
  async function saveDevices(devMap) {
    Object.assign(state_default.deviceStore, devMap);
    await fetch("/api/devices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(devMap) });
    refreshLocationSelects();
    renderDevices();
    setBadge("devices", Object.keys(state_default.deviceStore).length);
  }
  async function deleteDevice(ip) {
    delete state_default.deviceStore[ip];
    await fetch("/api/devices", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ip }) });
    rebuildCachedData();
    renderDevices();
    _renderMesh();
    _renderL2tp();
    _renderClients();
    setBadge("devices", Object.keys(state_default.deviceStore).length);
  }
  async function clearAllDevices() {
    if (!confirm("Alle Ger\xE4te l\xF6schen?")) return;
    state_default.deviceStore = {};
    state_default.meshData.length = 0;
    state_default.l2tpData.length = 0;
    state_default.clientsData.length = 0;
    await fetch("/api/devices", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: "{}" });
    renderDevices();
    _renderMesh();
    _renderL2tp();
    _renderClients();
    setBadge("devices", 0);
  }
  function exportDevices(format) {
    const devs = Object.values(state_default.deviceStore);
    if (!devs.length) {
      alert("Keine Ger\xE4te vorhanden.");
      return;
    }
    let content, mime, ext;
    if (format === "json") {
      content = JSON.stringify(devs, null, 2);
      mime = "application/json";
      ext = "json";
    } else {
      const cols = ["ip", "name", "mac", "model", "serial", "os", "type", "source", "location", "lastSeen"];
      const esc4 = (v) => `"${String(v || "").replace(/"/g, '""')}"`;
      content = "\uFEFF" + [cols.join(";"), ...devs.map((d) => cols.map((c) => esc4(d[c])).join(";"))].join("\r\n");
      mime = "text/csv;charset=utf-8";
      ext = "csv";
    }
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(new Blob([content], { type: mime })),
      download: `lancom-geraete-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.${ext}`
    });
    a.click();
    URL.revokeObjectURL(a.href);
  }
  function notifyOffline2(dev) {
    if (!state_default.appSettings.notifyOffline) return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    new Notification(`OnSite: ${dev.name || dev.ip} offline`, { body: `IP: ${dev.ip}${dev.os ? " \xB7 " + dev.os : ""}`, tag: `offline-${dev.ip}` });
  }
  function devSortClick(col) {
    clickSort(state_default.devSort, col, renderDevices);
  }
  function setDevFilter(f) {
    state_default.devFilter = f;
    ["all", "online", "offline"].forEach((k) => {
      const el = q("df-" + k);
      if (el) el.classList.toggle("active", k === f);
    });
    renderDevices();
  }
  function setDevLocFilter(v) {
    state_default.devLocFilter = v;
    renderDevices();
  }
  function renderDevices() {
    const srch = (q("dev-search")?.value || "").toLowerCase();
    const ipNum = (ip) => ip.split(".").reduce((s, o) => s * 256 + parseInt(o), 0);
    let devs = Object.values(state_default.deviceStore).filter((d) => {
      if (srch && !(d.name || d.ip || "").toLowerCase().includes(srch) && !d.ip.includes(srch)) return false;
      if (state_default.devFilter === "online" && d.online !== true) return false;
      if (state_default.devFilter === "offline" && d.online !== false) return false;
      if (state_default.devLocFilter !== "all" && (d.location || "") !== state_default.devLocFilter) return false;
      return true;
    });
    const keyFn = (d, col) => {
      switch (col) {
        case "name":
          return (d.name || "").toLowerCase();
        case "ip":
          return ipNum(d.ip || "0.0.0.0");
        case "mac":
          return (d.mac || "").toLowerCase();
        case "macs":
          return d.macs?.length ?? -1;
        case "lldp":
          return d.lldpCount ?? -1;
        case "wds":
          return d.wdsLinks?.length ?? -1;
        case "l2tp":
          return d.l2tpEndpoints?.length ?? -1;
        case "wlan":
          return d.wlanClients?.length ?? -1;
        case "model":
          return (d.model || "").toLowerCase();
        case "serial":
          return (d.serial || "").toLowerCase();
        case "os":
          return (d.os || "").toLowerCase();
        case "type":
          return (d.type || "").toLowerCase();
        case "source":
          return (d.source || "").toLowerCase();
        case "location":
          return (d.location || "").toLowerCase();
        case "lastSeen":
          return d.lastSeen || "";
        default:
          return "";
      }
    };
    devs = state_default.devSort.col ? applySort(devs, state_default.devSort, keyFn) : devs.sort((a, b) => ipNum(a.ip) - ipNum(b.ip));
    const total = Object.keys(state_default.deviceStore).length;
    setBadge("devices", total);
    q("cnt-devices").textContent = total ? total + " Ger\xE4t" + (total !== 1 ? "e" : "") : "";
    q("thead-devices").innerHTML = `<tr>
    ${noSortTh("")}
    ${mkTh("Ger\xE4tename", "name", state_default.devSort, "devSortClick")}
    ${mkTh("IP-Adresse", "ip", state_default.devSort, "devSortClick")}
    ${mkTh("MAC-Adresse", "mac", state_default.devSort, "devSortClick")}
    ${mkTh("MACs", "macs", state_default.devSort, "devSortClick")}
    ${mkTh("LLDP", "lldp", state_default.devSort, "devSortClick")}
    ${mkTh("WDS", "wds", state_default.devSort, "devSortClick")}
    ${mkTh("L2TPv3", "l2tp", state_default.devSort, "devSortClick")}
    ${mkTh("WLAN", "wlan", state_default.devSort, "devSortClick")}
    ${mkTh("Modell", "model", state_default.devSort, "devSortClick")}
    ${mkTh("Seriennummer", "serial", state_default.devSort, "devSortClick")}
    ${mkTh("Betriebssystem", "os", state_default.devSort, "devSortClick")}
    ${mkTh("Typ", "type", state_default.devSort, "devSortClick")}
    ${mkTh("Quelle", "source", state_default.devSort, "devSortClick")}
    ${mkTh("Standort", "location", state_default.devSort, "devSortClick")}
    ${mkTh("Zuletzt gesehen", "lastSeen", state_default.devSort, "devSortClick")}
  </tr>`;
    const tbody = q("tbl-devices").querySelector("tbody");
    if (!devs.length) {
      tbody.innerHTML = `<tr><td colspan="16" class="empty">Keine Ger\xE4te ${srch || state_default.devFilter !== "all" || state_default.devLocFilter !== "all" ? "gefunden" : "\u2013 Scanner oder LMC Import verwenden"}</td></tr>`;
      return;
    }
    tbody.innerHTML = devs.map((dev) => {
      const typLbl = TYPE_LABELS[dev.type] || "Unbekannt";
      const typCls = TYPE_BADGE[dev.type] || "badge-gray";
      const srcLbl = dev.source === "lmc" ? '<span class="badge badge-blue">LMC</span>' : '<span class="badge badge-gray">Scanner</span>';
      return `<tr>
      <td><div style="display:flex;gap:6px">
        <button class="btn btn-sm" onclick="openDeviceDetail('${h(dev.ip)}')">Details</button>
        <button class="btn btn-sm btn-danger" onclick="deleteDevice('${h(dev.ip)}')">&#x2715;</button>
      </div></td>
      <td style="font-weight:600"><span class="dot ${dev.online === true ? "dot-green" : dev.online === false ? "dot-red" : "dot-gray"}" title="${dev.online === true ? "Online" : dev.online === false ? "Offline" : "Unbekannt"}"></span>${h(dev.name || "\u2014")}</td>
      <td class="mono"><a href="https://${h(dev.ip)}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">${h(dev.ip)}</a></td>
      <td class="mono" style="font-size:12px;color:var(--text2)">${h(dev.mac || "\u2014")}</td>
      <td style="font-size:12px;text-align:center;color:${dev.macs?.length ? "var(--accent)" : "var(--text3)"}" title="${h(dev.macs?.length ? dev.macs.join("\n") : "Noch kein MAC-Sync")}">${dev.macs?.length ?? "\u2014"}</td>
      <td style="font-size:12px;text-align:center;color:${dev.lldpCount ? "var(--accent)" : "var(--text3)"}" title="${h(dev.lldpNeighbors?.length ? dev.lldpNeighbors.join("\n") : "Noch kein LLDP Sync")}">${dev.lldpCount ?? "\u2014"}</td>
      <td style="font-size:12px;text-align:center;color:${dev.wdsLinks?.length ? "var(--orange)" : "var(--text3)"}" title="${h(dev.wdsLinks?.length ? dev.wdsLinks.map((l) => l.linkName || l.mac || "?").join("\n") : "Keine WDS-Daten")}">${dev.wdsLinks?.length ?? "\u2014"}</td>
      <td style="font-size:12px;text-align:center;color:${dev.l2tpEndpoints?.length ? "var(--green)" : "var(--text3)"}" title="${h(dev.l2tpEndpoints?.length ? dev.l2tpEndpoints.map((e) => e.endpointName || e.remoteIp || "?").join("\n") : "Keine L2TP-Daten")}">${dev.l2tpEndpoints?.length ?? "\u2014"}</td>
      <td style="font-size:12px;text-align:center;color:${dev.wlanClients?.length ? "var(--cyan)" : "var(--text3)"}" title="${h(dev.wlanClients?.length ? dev.wlanClients.map((c) => c.mac + (c.ssid ? " (" + c.ssid + ")" : "")).join("\n") : "Noch kein WLAN-Scan")}">${dev.wlanClients?.length ?? "\u2014"}</td>
      <td style="color:var(--text2);font-size:12px" title="${h(dev.model || "")}">${h(shortModel(dev.model))}</td>
      <td class="mono" style="font-size:12px;color:var(--text3)">${h(dev.serial || "\u2014")}</td>
      <td><span class="badge ${OS_BADGE[dev.os] || "badge-gray"}">${h(dev.os || "\u2014")}</span></td>
      <td><span class="badge ${typCls}">${typLbl}</span></td>
      <td>${srcLbl}</td>
      <td style="font-size:12px;color:var(--text2)">${h(dev.location || "\u2014")}</td>
      <td style="color:var(--text3);font-size:11px">${fmtDate(dev.lastSeen)}</td>
    </tr>`;
    }).join("");
    _renderScriptDevices();
  }
  async function snmpQ(host, type, extra = {}) {
    const creds = devCredentials(host);
    const r = await fetch("/snmp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ host, type, ...creds, ...extra }) });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    return d;
  }
  function devCredentials(ip) {
    const d = state_default.deviceStore[ip];
    let version = d?.version || state_default.appSettings.snmpVersion || "2c";
    if (version === "1") version = "2c";
    return {
      community: d?.community || state_default.appSettings.snmpReadCommunity || "public",
      version
    };
  }
  function setDeviceOnline(ip, online) {
    if (!state_default.deviceStore[ip]) return;
    const prev = state_default.deviceStore[ip].online;
    state_default.deviceStore[ip].online = online;
    if (prev !== online && prev !== void 0) {
      const name = state_default.deviceStore[ip].name || ip;
      logActivity(online ? `${name} ist online` : `${name} ist offline`, online ? "ok" : "warn");
    }
    renderDevices();
  }
  async function checkAllDeviceStatus() {
    const btn = q("btn-check-status");
    const st = q("dev-sync-status");
    const wrap = q("dev-progress-wrap");
    const bar = q("dev-progress-bar");
    const txt = q("dev-progress-text");
    const devList = Object.values(state_default.deviceStore).filter(matchesLocFilter);
    if (!devList.length) {
      st.className = "status-bar error";
      st.textContent = state_default.devLocFilter !== "all" ? `Keine Ger\xE4te im Standort \u201E${state_default.devLocFilter}".` : "Keine Ger\xE4te vorhanden.";
      return;
    }
    btn.disabled = true;
    btn.textContent = "\u2026";
    st.className = "";
    st.textContent = "";
    wrap.style.display = "block";
    bar.style.width = "0%";
    txt.textContent = `0 / ${devList.length}`;
    let done = 0, online = 0;
    const total = devList.length;
    const prevStates = Object.fromEntries(devList.map((d) => [d.ip, d.online]));
    try {
      const CONCURRENCY = 5;
      async function checkOne(dev) {
        try {
          await snmpQ(dev.ip, "ping");
          if (state_default.deviceStore[dev.ip]) {
            state_default.deviceStore[dev.ip].online = true;
            online++;
          }
        } catch {
          if (state_default.deviceStore[dev.ip]) state_default.deviceStore[dev.ip].online = false;
        }
        if (prevStates[dev.ip] !== false && state_default.deviceStore[dev.ip]?.online === false) notifyOffline2(dev);
        done++;
        bar.style.width = Math.round(done / total * 100) + "%";
        txt.textContent = `${done} / ${total}`;
      }
      for (let i = 0; i < devList.length; i += CONCURRENCY) {
        await Promise.all(devList.slice(i, i + CONCURRENCY).map(checkOne));
        renderDevices();
      }
      await fetch("/api/devices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(state_default.deviceStore) });
      state_default.dashLastStatusCheck = (/* @__PURE__ */ new Date()).toISOString();
      logActivity(`Statuspr\xFCfung: ${online}/${total} online`);
      st.className = "status-bar ok";
      st.textContent = `Status aktualisiert \u2013 ${online} online, ${total - online} offline.`;
    } catch (e) {
      st.className = "status-bar error";
      st.textContent = `Fehler: ${e.message}`;
    } finally {
      btn.disabled = false;
      btn.textContent = "Status";
      bar.style.width = "100%";
      setTimeout(() => {
        wrap.style.display = "none";
        bar.style.width = "0%";
      }, 1500);
    }
  }
  async function syncDeviceMacs() {
    const btn = q("btn-mac-sync");
    const st = q("dev-sync-status");
    const wrap = q("dev-progress-wrap");
    const bar = q("dev-progress-bar");
    const txt = q("dev-progress-text");
    const devList = Object.values(state_default.deviceStore).filter((d) => d.online !== false && matchesLocFilter(d));
    if (!devList.length) {
      st.className = "status-bar error";
      st.textContent = state_default.devLocFilter !== "all" ? `Keine Online-Ger\xE4te im Standort \u201E${state_default.devLocFilter}".` : 'Keine Online-Ger\xE4te \u2013 bitte zuerst "Status" ausf\xFChren.';
      return;
    }
    btn.disabled = true;
    btn.textContent = "\u2026";
    st.className = "";
    st.textContent = "";
    wrap.style.display = "block";
    bar.style.width = "0%";
    txt.textContent = `0 / ${devList.length}`;
    let done = 0;
    const total = devList.length;
    try {
      const CONCURRENCY = 3;
      const queue = [...devList];
      async function worker() {
        while (queue.length) {
          const dev = queue.shift();
          try {
            const isSwitch = dev.type === "switch";
            const [ifResult, fdbResult] = await Promise.all([
              snmpQ(dev.ip, "ifmacs"),
              isSwitch ? snmpQ(dev.ip, "mac") : Promise.resolve(null)
            ]);
            if (state_default.deviceStore[dev.ip] && ifResult.macs?.length) state_default.deviceStore[dev.ip].macs = ifResult.macs;
            if (state_default.deviceStore[dev.ip] && isSwitch && fdbResult?.entries?.length)
              state_default.deviceStore[dev.ip].fdbEntries = fdbResult.entries.map((e) => ({
                ...e,
                type: "fdb",
                sourceIp: dev.ip,
                sourceName: dev.name || dev.ip
              }));
          } catch {
          }
          done++;
          bar.style.width = Math.round(done / total * 100) + "%";
          txt.textContent = `${done} / ${total}`;
        }
      }
      await Promise.all(Array(Math.min(CONCURRENCY, devList.length)).fill(null).map(worker));
      rebuildCachedData();
      await fetch("/api/devices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(state_default.deviceStore) });
      _renderMesh();
      renderDevices();
      _renderClients();
      st.className = "status-bar ok";
      st.textContent = `MAC-Adressen aktualisiert \u2013 ${devList.length} Ger\xE4te abgefragt.`;
    } catch (e) {
      st.className = "status-bar error";
      st.textContent = `Fehler: ${e.message}`;
    } finally {
      btn.disabled = false;
      btn.textContent = "MAC";
      bar.style.width = "100%";
      setTimeout(() => {
        wrap.style.display = "none";
        bar.style.width = "0%";
      }, 1500);
    }
  }
  async function lldpSyncCore(devList, onProgress) {
    const CONCURRENCY = 3;
    const queue = [...devList];
    let done = 0;
    async function worker() {
      while (queue.length) {
        const dev = queue.shift();
        try {
          const result = await snmpQ(dev.ip, "lldp");
          if (state_default.deviceStore[dev.ip]) {
            state_default.deviceStore[dev.ip].lldpCount = result.entries?.length ?? 0;
            state_default.deviceStore[dev.ip].lldpNeighbors = (result.entries || []).map((e) => e.remSysName || e.remPortId || "?").filter(Boolean);
            state_default.deviceStore[dev.ip].lldpData = (result.entries || []).map((e) => ({
              localPortName: e.localPortName || "",
              remSysName: e.remSysName || "",
              remPortId: e.remPortId || "",
              remPortDesc: e.remPortDesc || "",
              remMac: e.remMac || "",
              remPortMac: e.remPortMac || "",
              remChassisIp: e.remChassisIp || ""
            }));
          }
        } catch {
        }
        done++;
        if (onProgress) onProgress(done, devList.length, dev);
      }
    }
    await Promise.all(Array(Math.min(CONCURRENCY, devList.length || 1)).fill(null).map(worker));
  }
  async function syncDeviceLldp() {
    const btn = q("btn-lldp-sync");
    const st = q("dev-sync-status");
    const wrap = q("dev-progress-wrap");
    const bar = q("dev-progress-bar");
    const txt = q("dev-progress-text");
    const devList = Object.values(state_default.deviceStore).filter((d) => d.online !== false && matchesLocFilter(d));
    if (!devList.length) {
      st.className = "status-bar error";
      st.textContent = state_default.devLocFilter !== "all" ? `Keine Online-Ger\xE4te im Standort \u201E${state_default.devLocFilter}".` : 'Keine Online-Ger\xE4te \u2013 bitte zuerst "Status" ausf\xFChren.';
      return;
    }
    btn.disabled = true;
    btn.textContent = "\u2026";
    st.className = "";
    st.textContent = "";
    wrap.style.display = "block";
    bar.style.width = "0%";
    txt.textContent = `0 / ${devList.length}`;
    try {
      await lldpSyncCore(devList, (done, total) => {
        bar.style.width = Math.round(done / total * 100) + "%";
        txt.textContent = `${done} / ${total}`;
      });
      await fetch("/api/devices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(state_default.deviceStore) });
      renderDevices();
      window.checkTopoChanges?.();
      st.className = "status-bar ok";
      st.textContent = `LLDP aktualisiert \u2013 ${devList.length} Ger\xE4te abgefragt.`;
    } catch (e) {
      st.className = "status-bar error";
      st.textContent = `Fehler: ${e.message}`;
    } finally {
      btn.disabled = false;
      btn.textContent = "LLDP";
      bar.style.width = "100%";
      setTimeout(() => {
        wrap.style.display = "none";
        bar.style.width = "0%";
      }, 1500);
    }
  }

  // ui/tabs/traps.js
  var trapsPollTimer = null;
  var TRAPS_AUTOREFRESH_LS = "onsite-traps-autorefresh";
  var TRAPS_AUTOREFRESH_MS = 5e3;
  function isTrapsPanelActive() {
    return q("panel-traps")?.classList.contains("active");
  }
  function stopTrapsAutoRefreshTimer() {
    if (trapsPollTimer) {
      clearInterval(trapsPollTimer);
      trapsPollTimer = null;
    }
  }
  function setTrapsAutoRefresh(enabled) {
    localStorage.setItem(TRAPS_AUTOREFRESH_LS, enabled ? "1" : "0");
    const cb = q("traps-autorefresh");
    if (cb) cb.checked = enabled;
    stopTrapsAutoRefreshTimer();
    if (enabled && isTrapsPanelActive()) {
      trapsPollTimer = setInterval(() => {
        loadTraps();
      }, TRAPS_AUTOREFRESH_MS);
    }
  }
  function applyTrapsAutoRefresh() {
    stopTrapsAutoRefreshTimer();
    if (localStorage.getItem(TRAPS_AUTOREFRESH_LS) === "1" && isTrapsPanelActive()) {
      trapsPollTimer = setInterval(() => {
        loadTraps();
      }, TRAPS_AUTOREFRESH_MS);
    }
  }
  function stopTrapsAutoRefresh() {
    stopTrapsAutoRefreshTimer();
  }
  function initTrapsAutoRefreshUi() {
    const cb = q("traps-autorefresh");
    if (!cb) return;
    cb.checked = localStorage.getItem(TRAPS_AUTOREFRESH_LS) === "1";
  }
  function trapToggle(rowId) {
    const el = q(rowId);
    if (el) el.style.display = el.style.display === "none" ? "" : "none";
  }
  async function loadTraps() {
    try {
      renderTraps(await (await fetch("/api/traps")).json());
    } catch {
    }
  }
  function renderTraps(traps) {
    window._trapLog = traps;
    setBadge("traps", traps.length);
    const cnt = q("cnt-traps");
    if (cnt) cnt.textContent = traps.length ? traps.length + " Eintr\xE4ge" : "";
    const tbody = q("tbody-traps");
    if (!tbody) return;
    if (!traps.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty">Keine Traps empfangen</td></tr>';
      return;
    }
    function fmtTicks(ticks) {
      if (ticks == null) return "\u2014";
      let s = Math.floor(Number(ticks) / 100);
      const d = Math.floor(s / 86400);
      s %= 86400;
      const hh = Math.floor(s / 3600);
      s %= 3600;
      const mm = Math.floor(s / 60);
      s %= 60;
      return (d ? d + "d " : "") + String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0") + ":" + String(s).padStart(2, "0");
    }
    const trapColor = (name) => {
      if (!name) return "badge-gray";
      if (/linkDown|offline|fail|error/i.test(name)) return "badge-red";
      if (/linkUp|online|start/i.test(name)) return "badge-green";
      if (/warm|auth/i.test(name)) return "badge-orange";
      return "badge-blue";
    };
    tbody.innerHTML = traps.map((t, idx) => {
      const devName = Object.values(state_default.deviceStore).find((d) => d.ip === t.from)?.name || "";
      const trapLabel = t.trapName || t.pduType || "\u2014";
      const vbCount = t.varbinds?.length || 0;
      const hasDetail = vbCount > 0 || t.enterprise || t.agentAddr || t.parseError;
      const rowId = "trap-detail-" + idx;
      const detailRow = !hasDetail ? "" : (() => {
        let inner = "";
        if (t.enterprise || t.agentAddr) {
          inner += `<div style="padding:6px 16px;font-size:12px;border-bottom:1px solid var(--border)">`;
          if (t.enterprise) inner += `<span style="color:var(--text3)">Enterprise:</span> <span class="mono">${h(t.enterprise)}</span>&nbsp;&nbsp;`;
          if (t.agentAddr) inner += `<span style="color:var(--text3)">Agent:</span> <span class="mono">${h(t.agentAddr)}</span>`;
          inner += `</div>`;
        }
        if (t.parseError) inner += `<div style="padding:6px 16px;color:#ef4444;font-size:12px">Parse-Fehler: ${h(t.parseError)}</div>`;
        if (vbCount) {
          inner += `<table style="width:100%;border-collapse:collapse">` + (t.varbinds || []).map((vb) => {
            const label = vb.name ? `<b style="color:var(--accent)">${h(vb.name)}</b> <span style="color:var(--text3);font-size:10px">${h(vb.oid)}</span>` : `<span class="mono" style="font-size:11px">${h(vb.oid)}</span>`;
            const valStr = vb.type === "TimeTicks" ? `${vb.val} (${fmtTicks(Number(vb.val))})` : String(vb.val ?? "\u2014");
            return `<tr style="border-top:1px solid var(--border)">
              <td style="padding:4px 12px;color:var(--text3);font-size:10px;white-space:nowrap;width:80px">${h(vb.type)}</td>
              <td style="padding:4px 8px;width:40%">${label}</td>
              <td style="padding:4px 12px;font-family:monospace;font-size:11px;word-break:break-all">${h(valStr)}</td>
            </tr>`;
          }).join("") + `</table>`;
        }
        return `<tr id="${rowId}" style="display:none"><td colspan="8" style="padding:0;background:var(--bg3)">${inner}</td></tr>`;
      })();
      const mainRow = `<tr style="cursor:${hasDetail ? "pointer" : "default"}" ${hasDetail ? `onclick="trapToggle('${rowId}')"` : ""}>
      <td class="mono" style="font-size:11px;white-space:nowrap">${h(t.ts.replace("T", " ").slice(0, 19))}</td>
      <td class="mono" style="font-size:12px">${h(t.from)}${devName ? `<div style="font-size:10px;color:var(--text3)">${h(devName)}</div>` : ""}</td>
      <td><span class="badge badge-gray">${h(t.version || "?")}</span></td>
      <td class="mono" style="color:var(--text2);font-size:12px">${h(t.community || "\u2014")}</td>
      <td><span class="badge badge-gray" style="font-size:10px">${h(t.pduType || "\u2014")}</span></td>
      <td><span class="badge ${trapColor(trapLabel)}">${h(trapLabel)}</span></td>
      <td class="mono" style="font-size:11px;color:var(--text3)">${fmtTicks(t.uptime)}</td>
      <td style="font-size:11px;color:var(--text3)">${vbCount ? `${vbCount} Varbind${vbCount > 1 ? "s" : ""} \u25BE` : h(t.raw)}</td>
    </tr>`;
      return mainRow + detailRow;
    }).join("");
  }
  async function clearTraps() {
    await fetch("/api/traps", { method: "DELETE" });
    renderTraps([]);
  }
  if (typeof window !== "undefined") {
    window.trapToggle = trapToggle;
  }

  // ui/tabs/dashboard.js
  function adminBadge(val) {
    if (val === "1" || val === "up") return '<span class="badge badge-green">Up</span>';
    if (val === "2" || val === "down") return '<span class="badge badge-red">Down</span>';
    return `<span class="badge badge-gray">${h(val || "\u2014")}</span>`;
  }
  function fmtUptime(ticks) {
    if (ticks == null) return "\u2014";
    if (typeof ticks === "string") {
      const m2 = ticks.match(/\((\d+)\)/);
      ticks = m2 ? parseInt(m2[1]) : parseInt(ticks);
    }
    if (isNaN(ticks)) return "\u2014";
    let s = Math.floor(ticks / 100);
    const d = Math.floor(s / 86400);
    s %= 86400;
    const h2 = Math.floor(s / 3600);
    s %= 3600;
    const m = Math.floor(s / 60);
    s %= 60;
    if (d > 0) return `${d}d ${h2}h ${m}m`;
    if (h2 > 0) return `${h2}h ${m}m ${s}s`;
    return `${m}m ${s}s`;
  }
  function dashWarnings() {
    const warns = [];
    Object.values(state_default.deviceStore).forEach((d) => {
      if (d.online === false) warns.push({ type: "error", text: `${d.name || d.ip} nicht erreichbar`, ip: d.ip });
      if (d.poeMain?.power && d.poeMain.consumption / d.poeMain.power > 0.8)
        warns.push({ type: "warn", text: `PoE ${d.name || d.ip}: ${Math.round(d.poeMain.consumption / d.poeMain.power * 100)}% ausgelastet`, ip: d.ip });
      (d.wlanClients || []).forEach((c) => {
        if (c.signal && parseInt(c.signal) < -75)
          warns.push({ type: "warn", text: `Schwaches WLAN: ${c.mac} @ ${d.name || d.ip} (${c.signal} dBm)` });
      });
    });
    const loopCount = state_default.ldLastResults.reduce((s, r) => s + (r.data.lpDetectedPorts?.length || 0), 0);
    if (loopCount > 0) warns.push({ type: "error", text: `${loopCount} Loop${loopCount !== 1 ? "s" : ""} erkannt`, tab: "loopdetect" });
    const now = Date.now();
    const stpChanges = Object.values(state_default.stpStore).filter((s) => s.ts && now - new Date(s.ts).getTime() < 864e5).reduce((s, d) => s + (parseInt(d.global?.topChanges) || 0), 0);
    if (stpChanges > 0) warns.push({ type: "warn", text: `${stpChanges} STP Topologie-Wechsel in den letzten 24h`, tab: "stp" });
    return warns;
  }
  function dashWlanSsidChart() {
    const ssidMap = {};
    Object.values(state_default.deviceStore).forEach(
      (d) => (d.wlanClients || []).forEach((c) => {
        const s = c.ssid || "(unbekannt)";
        ssidMap[s] = (ssidMap[s] || 0) + 1;
      })
    );
    const entries = Object.entries(ssidMap).sort((a, b) => b[1] - a[1]);
    if (!entries.length) return '<div style="color:var(--text3);font-size:12px;padding:12px 0">Keine WLAN-Daten \u2013 zuerst Sync ausf\xFChren</div>';
    const max = entries[0][1];
    return entries.map(([ssid, cnt]) => {
      const pct = Math.round(cnt / max * 100);
      return `<div style="margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
        <span style="font-weight:600;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${h(ssid)}">${h(ssid)}</span>
        <span style="color:var(--text3)">${cnt}</span>
      </div>
      <div style="height:6px;background:var(--bg3);border-radius:3px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:var(--cyan);border-radius:3px"></div>
      </div>
    </div>`;
    }).join("");
  }
  async function fetchDashboardUptimes() {
    const devs = Object.values(state_default.deviceStore).filter((d) => d.online === true);
    const snmpQ2 = window.snmpQ;
    if (!snmpQ2) return;
    await Promise.all(devs.map(async (dev) => {
      try {
        const r = await snmpQ2(dev.ip, "uptime");
        if (r.ticks !== void 0) {
          state_default.dashUptimeCache[dev.ip] = r.ticks;
          const id = "dash-uptime-" + dev.ip.replace(/\./g, "-");
          const el = q(id);
          if (el) el.textContent = fmtUptime(r.ticks);
        }
      } catch {
      }
    }));
  }
  async function fetchDashboardTraffic() {
    try {
      const data = await (await fetch("/api/iftraffic")).json();
      const list = [];
      Object.entries(data).forEach(([ip, ifaces]) => {
        const dev = state_default.deviceStore[ip];
        Object.entries(ifaces).forEach(([ifname, s]) => {
          const bps = Math.max(s.inBps || 0, s.outBps || 0);
          if (bps > 0) list.push({ ip, name: dev?.name || ip, ifname, inBps: s.inBps || 0, outBps: s.outBps || 0, bps });
        });
      });
      list.sort((a, b) => b.bps - a.bps);
      const el = q("dash-traffic-list");
      if (!el) return;
      if (!list.length) {
        el.innerHTML = '<div style="color:var(--text3);font-size:12px">Kein aktiver Traffic erkannt \u2013 ggf. zweiten Aufruf abwarten</div>';
        return;
      }
      const maxBps = list[0].bps;
      el.innerHTML = list.slice(0, 5).map((e) => {
        const pct = Math.round(e.bps / maxBps * 100);
        return `<div style="margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:2px">
          <span style="font-weight:600">${h(e.name)} <span style="color:var(--text3);font-weight:400">${h(e.ifname)}</span></span>
          <span style="color:var(--text3);font-size:11px">\u2193${fmtBps(e.inBps)} \u2191${fmtBps(e.outBps)}</span>
        </div>
        <div style="height:5px;background:var(--bg3);border-radius:3px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:var(--accent);border-radius:3px"></div>
        </div>
      </div>`;
      }).join("");
    } catch {
    }
  }
  function fmtBps(bps) {
    bps = Number(bps) || 0;
    if (bps < 1e3) return bps + "b/s";
    if (bps < 1e6) return (bps / 1e3).toFixed(0) + "kb/s";
    if (bps < 1e9) return (bps / 1e6).toFixed(1) + "Mb/s";
    return (bps / 1e9).toFixed(2) + "Gb/s";
  }
  function renderActivityLog() {
    const activityLog = state_default.activityLog;
    if (!activityLog.length) return '<div style="padding:16px;text-align:center;color:var(--text3);font-size:12px">Kein Verlauf</div>';
    return activityLog.slice(0, 12).map((a, i) => {
      const col = a.type === "ok" ? "#22c55e" : a.type === "warn" ? "#f97316" : a.type === "error" ? "#ef4444" : "var(--text3)";
      return `<div style="padding:6px 12px;border-top:${i ? "1px solid var(--border)" : "none"};font-size:11px">
      <span style="color:${col};margin-right:6px">\u25CF</span>${h(a.text)}
      <div style="color:var(--text3);font-size:10px;margin-top:1px">${h((a.ts || "").replace("T", " ").slice(0, 16))}</div>
    </div>`;
    }).join("");
  }
  function toggleDashSection(id) {
    const list = document.getElementById("dash-" + id + "-list");
    const chevron = document.getElementById("dash-" + id + "-chevron");
    if (!list) return;
    const collapsed = list.style.maxHeight === "0px" || list.style.opacity === "0";
    list.style.maxHeight = collapsed ? "2000px" : "0";
    list.style.opacity = collapsed ? "1" : "0";
    if (chevron) chevron.style.transform = collapsed ? "" : "rotate(-90deg)";
  }
  function toggleDashWarns() {
    toggleDashSection("warns");
  }
  async function renderDashboard() {
    const el = q("dash-content");
    if (!el) return;
    const devs = Object.values(state_default.deviceStore);
    const online = devs.filter((d) => d.online === true).length;
    const offline = devs.filter((d) => d.online === false).length;
    const unknown = devs.length - online - offline;
    const wlanCnt = devs.reduce((s, d) => s + (d.wlanClients?.length || 0), 0);
    const trapCnt = window._trapLog?.length || 0;
    const kachel = (label, value, sub, color, onclick) => `<div style="flex:1;min-width:130px;max-width:200px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px;cursor:${onclick ? "pointer" : "default"}" ${onclick ? `onclick="${onclick}"` : ""}>
      <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px">${label}</div>
      <div style="font-size:28px;font-weight:800;color:${color};line-height:1">${value}</div>
      ${sub ? `<div style="font-size:11px;color:var(--text3);margin-top:4px">${sub}</div>` : ""}
    </div>`;
    const statusSub = [online && `<span style="color:#22c55e">${online} online</span>`, offline && `<span style="color:#ef4444">${offline} offline</span>`, unknown && `<span style="color:var(--text3)">${unknown} ?</span>`].filter(Boolean).join(" \xB7 ");
    const pricePerKwh = state_default.appSettings.powerPricePerKwh ?? 0.3;
    const totalW = devs.reduce((s, d) => s + (d.poeMain?.consumption || 0), 0);
    const costPerMonth = totalW > 0 ? totalW / 1e3 * 24 * 30 * pricePerKwh : 0;
    const powerSub = totalW > 0 ? `${costPerMonth.toFixed(2)} \u20AC/Monat` : "kein PoE-Sync";
    const loopCount = state_default.ldLastResults.reduce((s, r) => s + (r.data.lpDetectedPorts?.length || 0), 0);
    const now = Date.now();
    const stpChanges = Object.values(state_default.stpStore).filter((s) => s.ts && now - new Date(s.ts).getTime() < 864e5).reduce((s, d) => s + (parseInt(d.global?.topChanges) || 0), 0);
    let html = `<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:10px">
    ${kachel("Ger\xE4te gesamt", devs.length, statusSub, "var(--accent)", "showTab('devices')")}
    ${kachel("Online", online, "SNMP erreichbar", "#22c55e", "setDevFilter('online');showTab('devices')")}
    ${kachel("Offline", offline, offline ? "nicht erreichbar" : "alle erreichbar", offline ? "#ef4444" : "var(--text3)", "setDevFilter('offline');showTab('devices')")}
    ${kachel("WLAN Clients", wlanCnt, wlanCnt ? "aktive Verbindungen" : "kein WLAN-Sync", "var(--cyan)", "showTab('clients')")}
    ${kachel("SNMP Traps", trapCnt, trapCnt ? "empfangen" : "kein Trap", trapCnt ? "#f97316" : "var(--text3)", "showTab('traps')")}
    ${kachel("PoE Verbrauch", totalW ? totalW + " W" : "\u2014", powerSub, totalW ? "#f97316" : "var(--text3)", "showTab('poe')")}
    ${kachel("Loops erkannt", loopCount, loopCount ? "letzte Pr\xFCfung" : "keine Loops", loopCount ? "#ef4444" : "var(--text3)", "showTab('loopdetect')")}
    ${kachel("STP Wechsel", stpChanges, stpChanges ? "letzte 24h" : "keine \xC4nderungen", stpChanges ? "#f97316" : "var(--text3)", "showTab('stp')")}
  </div>`;
    html += `<div style="display:flex;gap:16px;margin-bottom:16px;font-size:11px;color:var(--text3)">
    <span>Status: <b style="color:var(--text)">${state_default.dashLastStatusCheck ? fmtDate(state_default.dashLastStatusCheck) : "\u2014"}</b></span>
    <span>Sync: <b style="color:var(--text)">${state_default.dashLastDataSync ? fmtDate(state_default.dashLastDataSync) : "\u2014"}</b></span>
  </div>`;
    const warns = dashWarnings();
    if (warns.length) {
      const errCnt = warns.filter((w) => w.type === "error").length;
      const warnCnt = warns.filter((w) => w.type === "warn").length;
      const summary = [errCnt && `<span style="color:#ef4444">${errCnt} Fehler</span>`, warnCnt && `<span style="color:#f97316">${warnCnt} Warnung${warnCnt !== 1 ? "en" : ""}</span>`].filter(Boolean).join(" \xB7 ");
      const collapsed = true;
      html += `<div style="margin-bottom:16px" id="dash-warns-wrap">
      <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px;display:flex;align-items:center;gap:10px;cursor:pointer;user-select:none" onclick="toggleDashWarns()">
        <span>Warnungen</span>
        <span style="font-weight:400;text-transform:none;letter-spacing:0;font-size:11px">${summary}</span>
        <span id="dash-warns-chevron" style="margin-left:auto;font-size:11px;transition:transform .2s;display:inline-block;${collapsed ? "transform:rotate(-90deg)" : ""}">\u25BE</span>
      </div>
      <div id="dash-warns-list" style="display:flex;flex-direction:column;gap:4px;overflow:hidden;transition:max-height .25s ease,opacity .2s ease;${collapsed ? "max-height:0;opacity:0" : "max-height:2000px;opacity:1"}">
        ${warns.map((w) => `<div style="display:flex;align-items:center;gap:8px;padding:7px 12px;background:var(--bg2);border:1px solid ${w.type === "error" ? "#ef44441a" : "#f974161a"};border-radius:var(--radius);font-size:12px">
          <span style="color:${w.type === "error" ? "#ef4444" : "#f97316"};font-size:14px">${w.type === "error" ? "\u2715" : "\u26A0"}</span>
          <span style="flex:1">${h(w.text)}</span>
          ${w.ip ? `<button class="btn btn-sm" style="font-size:11px" onclick="openDeviceDetail('${h(w.ip)}')">Details</button>` : ""}
          ${w.tab ? `<button class="btn btn-sm" style="font-size:11px" onclick="showTab('${h(w.tab)}')">Anzeigen</button>` : ""}
        </div>`).join("")}
      </div>
    </div>`;
    }
    if (state_default.uptimeStats && Object.keys(state_default.uptimeStats).length) {
      const uptimeEntries = Object.entries(state_default.uptimeStats).map(([ip, u]) => ({ ip, name: state_default.deviceStore[ip]?.name || ip, ...u })).sort((a, b) => (a.stats?.pct ?? 100) - (b.stats?.pct ?? 100));
      const worstOnes = uptimeEntries.filter((e) => e.stats && e.stats.pct < 100);
      const worstPct = uptimeEntries.length ? Math.min(...uptimeEntries.map((e) => e.stats?.pct ?? 100)) : 100;
      const uptimeSummary = worstPct < 100 ? `<span style="color:#f97316">${uptimeEntries.filter((e) => e.stats && e.stats.pct < 100).length} mit Ausf\xE4llen</span>` : `<span style="color:#22c55e">alle stabil</span>`;
      html += `<div style="margin-bottom:16px">
      <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px;display:flex;align-items:center;gap:10px;cursor:pointer;user-select:none" onclick="toggleDashSection('uptime')">
        <span>Verf\xFCgbarkeit (24h)</span>
        <span style="font-weight:400;text-transform:none;letter-spacing:0;font-size:11px">${uptimeSummary} \xB7 ${uptimeEntries.length} Ger\xE4te</span>
        <button class="btn btn-sm" style="font-size:10px" onclick="event.stopPropagation();fetchUptimeStats()">Aktualisieren</button>
        <span id="dash-uptime-chevron" style="margin-left:auto;font-size:11px;transition:transform .2s;display:inline-block;transform:rotate(-90deg)">\u25BE</span>
      </div>
      <div id="dash-uptime-list" style="display:flex;flex-wrap:wrap;gap:8px;overflow:hidden;transition:max-height .25s ease,opacity .2s ease;max-height:0;opacity:0">
      ${uptimeEntries.slice(0, 12).map((e) => {
        const pct = e.stats?.pct ?? 0;
        const color = pct >= 99.9 ? "#22c55e" : pct >= 99 ? "#f97316" : "#ef4444";
        const sparkSvg = e.sparkline?.length ? renderSparklineSvg(e.sparkline) : "";
        return `<div style="flex:1;min-width:180px;max-width:280px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px;cursor:pointer" onclick="openDeviceDetail('${h(e.ip)}')">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px">
            <span style="font-size:12px;font-weight:600;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h(e.name)}</span>
            <span style="font-size:14px;font-weight:800;color:${color}">${pct}%</span>
          </div>
          ${sparkSvg}
          <div style="font-size:10px;color:var(--text3);margin-top:3px">${e.stats.probes} Probes \xB7 ${e.stats.down} Ausf\xE4lle</div>
        </div>`;
      }).join("")}
      </div>
    </div>`;
    }
    const poeSwitches = devs.filter((d) => d.type === "switch" && d.poeMain?.power);
    if (poeSwitches.length) {
      const totalW2 = poeSwitches.reduce((s, d) => s + (d.poeMain?.consumption || 0), 0);
      const totalMax = poeSwitches.reduce((s, d) => s + (d.poeMain?.power || 0), 0);
      const poePctTotal = totalMax ? Math.round(totalW2 / totalMax * 100) : 0;
      const poeSummaryColor = poePctTotal > 85 ? "#ef4444" : poePctTotal > 65 ? "#f97316" : "#22c55e";
      html += `<div style="margin-bottom:16px">
      <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px;display:flex;align-items:center;gap:10px;cursor:pointer;user-select:none" onclick="toggleDashSection('poe')">
        <span>PoE Verbrauch</span>
        <span style="font-weight:400;text-transform:none;letter-spacing:0;font-size:11px;color:${poeSummaryColor}">${totalW2}W / ${totalMax}W (${poePctTotal}%)</span>
        <span style="font-weight:400;text-transform:none;letter-spacing:0;font-size:11px;color:var(--text3)">${poeSwitches.length} Switch${poeSwitches.length !== 1 ? "es" : ""}</span>
        <span id="dash-poe-chevron" style="margin-left:auto;font-size:11px;transition:transform .2s;display:inline-block;transform:rotate(-90deg)">\u25BE</span>
      </div>
      <div id="dash-poe-list" style="display:flex;flex-wrap:wrap;gap:10px;overflow:hidden;transition:max-height .25s ease,opacity .2s ease;max-height:0;opacity:0">
      ${poeSwitches.map((d) => {
        const { power, consumption } = d.poeMain;
        const pct = Math.round(consumption / power * 100);
        const color = pct > 85 ? "#ef4444" : pct > 65 ? "#f97316" : "#22c55e";
        const devCostMonth = consumption / 1e3 * 24 * 30 * pricePerKwh;
        const devCostYear = devCostMonth * 12;
        return `<div style="flex:1;min-width:180px;max-width:320px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px;cursor:pointer" onclick="openDeviceDetail('${h(d.ip)}');showStab('poe')">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:7px">
            <span style="font-size:13px;font-weight:700">${h(d.name || d.ip)}</span>
            <span style="font-size:13px;font-weight:700;color:${color}">${consumption}W <span style="font-size:11px;font-weight:400;color:var(--text3)">/ ${power}W</span></span>
          </div>
          <div style="height:8px;background:var(--bg3);border-radius:4px;overflow:hidden">
            <div style="height:100%;width:${Math.min(pct, 100)}%;background:${color};border-radius:4px"></div>
          </div>
          <div style="display:flex;justify-content:space-between;margin-top:5px">
            <span style="font-size:10px;color:var(--text3)">${devCostMonth.toFixed(2)} \u20AC/Mon \xB7 ${devCostYear.toFixed(0)} \u20AC/Jahr</span>
            <span style="font-size:10px;color:var(--text3)">${pct}%</span>
          </div>
        </div>`;
      }).join("")}
      </div>
    </div>`;
    }
    html += `<div style="margin-bottom:16px" id="dash-topochanges-wrap">
    <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px;display:flex;align-items:center;gap:10px;cursor:pointer;user-select:none" onclick="toggleDashSection('topochanges')">
      <span>Topologie-\xC4nderungen</span>
      <span id="dash-topochanges-summary" style="font-weight:400;text-transform:none;letter-spacing:0;font-size:11px;color:var(--text3)">Lade\u2026</span>
      <button class="btn btn-sm" style="font-size:10px" onclick="event.stopPropagation();checkTopoChanges()">Pr\xFCfen</button>
      <button class="btn btn-sm btn-ghost" style="font-size:10px" onclick="event.stopPropagation();loadTopoChanges()">Aktualisieren</button>
      <span id="dash-topochanges-chevron" style="margin-left:auto;font-size:11px;transition:transform .2s;display:inline-block;transform:rotate(-90deg)">\u25BE</span>
    </div>
    <div id="dash-topochanges-list" style="overflow:hidden;transition:max-height .25s ease,opacity .2s ease;max-height:0;opacity:0">
      <div id="topo-changes-content"></div>
    </div>
  </div>`;
    html += `<div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start">`;
    html += `<div style="flex:1;min-width:260px;display:flex;flex-direction:column;gap:16px">
    <div>
      <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px">WLAN Clients je SSID</div>
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:12px">
        ${dashWlanSsidChart()}
      </div>
    </div>
    <div>
      <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px">
        Traffic Top-5
        <button class="btn btn-sm" style="margin-left:8px;font-size:10px" onclick="fetchDashboardTraffic()">Aktualisieren</button>
      </div>
      <div id="dash-traffic-list" style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:12px">
        <div style="color:var(--text3);font-size:12px">Klicke "Aktualisieren" zum Laden</div>
      </div>
    </div>
  </div>`;
    html += `<div style="flex:1;min-width:260px;display:flex;flex-direction:column;gap:16px">
    <div>
      <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px">Aktivit\xE4tslog</div>
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden">
      ${renderActivityLog()}
      </div>
    </div>
    <div>
      <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px">
        Letzte Traps <span style="font-weight:400;font-size:10px;cursor:pointer;color:var(--accent)" onclick="showTab('traps')">\u2192 alle</span>
      </div>
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden">
      ${(window._trapLog || []).length ? (window._trapLog || []).slice(0, 6).map((t, i) => `
        <div style="padding:6px 12px;border-top:${i ? "1px solid var(--border)" : "none"}">
          <div style="display:flex;justify-content:space-between;font-size:11px">
            <span style="font-weight:600;color:var(--accent)">${h(t.from)}</span>
            <span style="color:var(--text3)">${h((t.ts || "").slice(11, 19))}</span>
          </div>
          <div style="font-size:10px;color:var(--text3);margin-top:1px">${h(t.community || t.version || "\u2014")} \xB7 ${h(t.raw || "")}</div>
        </div>`).join("") : '<div style="padding:16px;text-align:center;color:var(--text3);font-size:12px">Keine Traps</div>'}
      </div>
    </div>
  </div>`;
    html += `</div>`;
    el.innerHTML = html;
    loadTopoChanges();
  }
  function renderSparklineSvg(data) {
    if (!data?.length) return "";
    const w = 160, ht = 20;
    const bw = w / data.length;
    const bars = data.map((v, i) => {
      if (v === null) return `<rect x="${i * bw}" y="0" width="${bw - 0.5}" height="${ht}" fill="var(--bg3)" rx="1"/>`;
      const color = v >= 100 ? "#22c55e" : v >= 80 ? "#f97316" : "#ef4444";
      return `<rect x="${i * bw}" y="0" width="${bw - 0.5}" height="${ht}" fill="${color}" rx="1"/>`;
    }).join("");
    return `<svg width="${w}" height="${ht}" style="display:block;border-radius:3px;overflow:hidden">${bars}</svg>`;
  }
  async function fetchUptimeStats() {
    try {
      const data = await (await fetch("/api/uptime?hours=24")).json();
      state_default.uptimeStats = data;
      window.renderDashboard?.();
    } catch {
    }
  }
  async function checkTopoChanges() {
    try {
      const r = await (await fetch("/api/topo-changes/check", { method: "POST" })).json();
      if (r.isFirst) {
        const el = document.getElementById("dash-topochanges-summary");
        if (el) el.innerHTML = '<span style="color:var(--text3)">Baseline gespeichert \u2014 n\xE4chste Pr\xFCfung erkennt \xC4nderungen</span>';
      }
      loadTopoChanges();
      if (r.changes > 0) {
        window.pushActivity?.("warn", `${r.changes} Topologie-\xC4nderung${r.changes !== 1 ? "en" : ""} erkannt`);
      }
    } catch {
    }
  }
  async function loadTopoChanges() {
    const el = document.getElementById("topo-changes-content");
    const summary = document.getElementById("dash-topochanges-summary");
    if (!el) return;
    try {
      const data = await (await fetch("/api/topo-changes?hours=24")).json();
      if (!data.length) {
        if (summary) summary.innerHTML = '<span style="color:#22c55e">keine \xC4nderungen (24h)</span>';
        el.innerHTML = '<div style="padding:12px 0;color:var(--text3);font-size:12px">Keine Topologie-\xC4nderungen in den letzten 24h. Klicke <b>Pr\xFCfen</b> nach einem LLDP-Sync.</div>';
        return;
      }
      const added = data.filter((c) => c.type === "added").length;
      const removed = data.filter((c) => c.type === "removed").length;
      const parts = [];
      if (added) parts.push(`<span style="color:#22c55e">${added} neu</span>`);
      if (removed) parts.push(`<span style="color:#ef4444">${removed} entfernt</span>`);
      if (summary) summary.innerHTML = parts.join(" \xB7 ") + ` <span style="color:var(--text3)">(24h)</span>`;
      el.innerHTML = `<div style="display:flex;flex-direction:column;gap:4px">
      ${data.slice(0, 50).map((c) => {
        const icon = c.type === "added" ? '<span style="color:#22c55e;font-weight:700">\uFF0B</span>' : '<span style="color:#ef4444;font-weight:700">\uFF0D</span>';
        const verb = c.type === "added" ? "Neuer Nachbar" : "Nachbar entfernt";
        return `<div style="display:flex;align-items:center;gap:8px;padding:6px 12px;background:var(--bg2);border:1px solid ${c.type === "added" ? "rgba(34,197,94,.15)" : "rgba(239,68,68,.15)"};border-radius:var(--radius);font-size:12px">
          ${icon}
          <span style="font-weight:600;min-width:120px;cursor:pointer;color:var(--accent)" onclick="openDeviceDetail('${h(c.ip)}')">${h(c.deviceName)}</span>
          <span style="color:var(--text2)">${verb}:</span>
          <span style="font-weight:600">${h(c.remoteName || "?")}</span>
          <span style="color:var(--text3)">Port ${h(c.localPort)} \u2194 ${h(c.remotePort)}</span>
          <span style="margin-left:auto;font-size:10px;color:var(--text3)">${c.ts.slice(11, 19)}</span>
        </div>`;
      }).join("")}
    </div>`;
    } catch (e) {
      el.innerHTML = `<div style="color:var(--red);font-size:12px">Fehler: ${e.message}</div>`;
    }
  }
  if (typeof window !== "undefined") {
    window.toggleDashWarns = toggleDashWarns;
    window.toggleDashSection = toggleDashSection;
    window.checkTopoChanges = checkTopoChanges;
    window.loadTopoChanges = loadTopoChanges;
    window.fetchDashboardUptimes = fetchDashboardUptimes;
    window.fetchDashboardTraffic = fetchDashboardTraffic;
  }

  // ui/tabs/poe.js
  var POE_STATUS = { 1: "Disabled", 2: "Searching", 3: "Delivering", 4: "Fault", 5: "Test", 6: "Other Fault", 7: "Requesting Power", 8: "Overcurrent" };
  var POE_BADGE = { 1: "badge-gray", 2: "badge-yellow", 3: "badge-green", 4: "badge-red", 5: "badge-yellow", 6: "badge-red", 7: "badge-yellow", 8: "badge-red" };
  var POE_CLASS = { 0: "0 (\u226415.4W)", 1: "1 (\u22644W)", 2: "2 (\u22647W)", 3: "3 (\u226415.4W)", 4: "4 (\u226430W)", 5: "5 (\u226445W)", 6: "6 (\u226460W)", 7: "7 (\u226475W)", 8: "8 (\u226490W)" };
  var poeStore = {};
  async function syncPoeAll() {
    const btn = q("btn-poe-sync");
    const st = q("poe-sync-status");
    const switches = Object.values(state_default.deviceStore).filter((d) => d.type === "switch" && d.online !== false);
    if (!switches.length) {
      st.className = "status-bar error";
      st.textContent = "Keine Online-Switches vorhanden.";
      return;
    }
    btn.disabled = true;
    st.className = "status-bar loading";
    st.innerHTML = `<span class="spinner"></span> Frage ${switches.length} Switch${switches.length > 1 ? "es" : ""} ab\u2026`;
    let done = 0;
    await Promise.all(switches.map(async (dev) => {
      try {
        const data = await window.snmpQ?.(dev.ip, "poe");
        if (data?.portEntries?.length || data?.main?.power) {
          poeStore[dev.ip] = { ...data, devName: dev.name || dev.ip };
          if (state_default.deviceStore[dev.ip]) state_default.deviceStore[dev.ip].poeMain = data.main;
        }
      } catch {
      }
      done++;
      st.innerHTML = `<span class="spinner"></span> ${done} / ${switches.length} \u2013 ${h(dev.name || dev.ip)}`;
    }));
    btn.disabled = false;
    const found = Object.keys(poeStore).length;
    st.className = found ? "status-bar ok" : "status-bar";
    st.textContent = found ? `Fertig \u2013 ${found} Switch${found !== 1 ? "es" : ""} mit PoE-Daten.` : "Fertig \u2013 keine PoE-Daten gefunden.";
    renderPoeTab();
    if (window.renderDashboard) void window.renderDashboard().catch(() => {
    });
  }
  function renderPoeTab() {
    const el = q("poe-tab-content");
    if (!el) return;
    if (!Object.keys(poeStore).length) {
      el.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text3)">Noch keine Daten \u2013 "Alle Switches abfragen" klicken.</div>`;
      return;
    }
    el.innerHTML = Object.entries(poeStore).map(([ip, data]) => {
      const dev = state_default.deviceStore[ip];
      const m = data.main || {};
      const pct = m.power && m.consumption ? Math.round(m.consumption / m.power * 100) : null;
      const barColor = pct === null ? "var(--accent)" : pct > 85 ? "#ef4444" : pct > 65 ? "#f97316" : "#22c55e";
      const ports = data.portEntries || [];
      const activeCount = ports.filter((e) => parseInt(e.detectionStatus) === 5).length;
      return `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:16px;margin-bottom:16px">
      <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:10px">
        <span style="font-size:14px;font-weight:700;cursor:pointer" onclick="openDeviceDetail('${ip}')">${h(data.devName)}</span>
        <span style="font-size:12px;color:var(--text3)">${activeCount} Port${activeCount !== 1 ? "s" : ""} aktiv</span>
      </div>
      ${m.power ? `<div style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:5px">
          <span style="font-size:11px;color:var(--text3)">Verbrauch</span>
          <span style="font-size:13px;font-weight:700;color:${barColor}">${m.consumption || 0} W / ${m.power} W${pct !== null ? " (" + pct + "%)" : ""}</span>
        </div>
        <div style="height:8px;background:var(--bg3);border-radius:4px;overflow:hidden">
          <div style="height:100%;width:${Math.min(pct || 0, 100)}%;background:${barColor};border-radius:4px;transition:width .4s"></div>
        </div>
      </div>` : ""}
      ${ports.length ? `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="border-bottom:1px solid var(--border)">
          <th style="text-align:left;padding:4px 8px;color:var(--text3);font-weight:600">Port</th>
          <th style="text-align:left;padding:4px 8px;color:var(--text3);font-weight:600">Admin</th>
          <th style="text-align:left;padding:4px 8px;color:var(--text3);font-weight:600">Status</th>
          <th style="text-align:left;padding:4px 8px;color:var(--text3);font-weight:600">Klasse</th>
        </tr></thead>
        <tbody>${ports.map((e) => {
        const stN = parseInt(e.detectionStatus);
        const admin = e.adminEnable === "1" || e.adminEnable === "true";
        return `<tr style="border-bottom:1px solid var(--border)">
            <td style="padding:4px 8px;font-family:var(--mono)">${h(e.group)}.${h(e.port)}</td>
            <td style="padding:4px 8px">${admin ? '<span class="badge badge-green">An</span>' : '<span class="badge badge-gray">Aus</span>'}</td>
            <td style="padding:4px 8px"><span class="badge ${POE_BADGE[stN] || "badge-gray"}">${POE_STATUS[stN] || e.detectionStatus || "\u2014"}</span></td>
            <td style="padding:4px 8px">${POE_CLASS[parseInt(e.powerClass)] || e.powerClass || "\u2014"}</td>
          </tr>`;
      }).join("")}</tbody>
      </table></div>` : `<div style="color:var(--text3);font-size:12px">Keine PoE-Ports.</div>`}
    </div>`;
    }).join("");
  }

  // ui/tabs/stp.js
  var STP_STATE = { 1: "Disabled", 2: "Blocking", 3: "Listening", 4: "Learning", 5: "Forwarding", 6: "Broken" };
  var STP_COLOR = { 1: "var(--text3)", 2: "#ef4444", 3: "#f97316", 4: "#f97316", 5: "#22c55e", 6: "#ef4444" };
  var STP_BADGE = { 1: "badge-gray", 2: "badge-red", 3: "badge-orange", 4: "badge-orange", 5: "badge-green", 6: "badge-red" };
  async function syncStpAll() {
    const btn = q("btn-stp-sync");
    const st = q("stp-sync-status");
    const switches = Object.values(state_default.deviceStore).filter((d) => d.type === "switch" && d.online !== false);
    if (!switches.length) {
      st.className = "status-bar error";
      st.textContent = "Keine Online-Switches vorhanden.";
      return;
    }
    btn.disabled = true;
    st.className = "status-bar loading";
    st.innerHTML = `<span class="spinner"></span> Frage ${switches.length} Switch${switches.length > 1 ? "es" : ""} ab\u2026`;
    let done = 0;
    await Promise.all(switches.map(async (dev) => {
      try {
        const data = await window.snmpQ?.(dev.ip, "stp");
        state_default.stpStore[dev.ip] = { ...data, ts: (/* @__PURE__ */ new Date()).toISOString(), devName: dev.name || dev.ip };
      } catch {
      }
      done++;
      st.innerHTML = `<span class="spinner"></span> ${done} / ${switches.length} \u2013 ${h(dev.name || dev.ip)}`;
    }));
    btn.disabled = false;
    const found = Object.keys(state_default.stpStore).length;
    st.className = "status-bar ok";
    st.textContent = `Fertig \u2013 ${found} Switch${found !== 1 ? "es" : ""} mit STP-Daten.`;
    renderStpTab();
  }
  function applyStpTransform() {
    const g = document.getElementById("stp-map-g");
    if (g) g.setAttribute("transform", `translate(${state_default.stpTx.toFixed(1)},${state_default.stpTy.toFixed(1)}) scale(${state_default.stpScale.toFixed(4)})`);
  }
  function stpSvgPt(e) {
    const wrap = document.getElementById("stp-map-wrap");
    if (!wrap) return { x: 0, y: 0 };
    const r = wrap.getBoundingClientRect();
    return { x: (e.clientX - r.left - state_default.stpTx) / state_default.stpScale, y: (e.clientY - r.top - state_default.stpTy) / state_default.stpScale };
  }
  function stpNodeDragStart(e, ip) {
    e.stopPropagation();
    const pt = stpSvgPt(e), p = state_default.stpNodePos[ip];
    if (!p) return;
    state_default.stpDragNode = { ip, ox: pt.x - p.x, oy: pt.y - p.y };
    state_default.stpWasDrag = false;
  }
  function stpBgDragStart(e) {
    if (state_default.stpDragNode) return;
    state_default.stpPan = { sx: e.clientX, sy: e.clientY, tx: state_default.stpTx, ty: state_default.stpTy };
  }
  function stpMouseMove(e) {
    if (state_default.stpDragNode) {
      const pt = stpSvgPt(e), p = state_default.stpNodePos[state_default.stpDragNode.ip];
      if (!p) return;
      p.x = pt.x - state_default.stpDragNode.ox;
      p.y = pt.y - state_default.stpDragNode.oy;
      state_default.stpWasDrag = true;
      renderStpSvg();
    } else if (state_default.stpPan) {
      state_default.stpTx = state_default.stpPan.tx + (e.clientX - state_default.stpPan.sx);
      state_default.stpTy = state_default.stpPan.ty + (e.clientY - state_default.stpPan.sy);
      applyStpTransform();
    }
  }
  function stpMouseUp() {
    if (state_default.stpDragNode && state_default.stpWasDrag) {
      try {
        localStorage.setItem("onsite_stp_pos", JSON.stringify(state_default.stpNodePos));
      } catch (e) {
      }
    }
    state_default.stpDragNode = null;
    state_default.stpPan = null;
    state_default.stpWasDrag = false;
  }
  window.addEventListener("mouseup", () => {
    if (state_default.stpDragNode && state_default.stpWasDrag) stpMouseUp();
  });
  function stpWheel(e) {
    e.preventDefault();
    const wrap = document.getElementById("stp-map-wrap");
    if (!wrap) return;
    const factor = e.deltaY < 0 ? 1.12 : 0.9;
    const rect = wrap.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    state_default.stpTx = mx - (mx - state_default.stpTx) * factor;
    state_default.stpTy = my - (my - state_default.stpTy) * factor;
    state_default.stpScale *= factor;
    applyStpTransform();
  }
  function stpResetLayout() {
    localStorage.removeItem("onsite_stp_pos");
    Object.keys(state_default.stpNodePos).forEach((k) => delete state_default.stpNodePos[k]);
    renderStpTab();
  }
  function stpMapFit() {
    const wrap = document.getElementById("stp-map-wrap");
    if (!wrap) return;
    const ps = Object.values(state_default.stpNodePos);
    if (!ps.length) return;
    const xs = ps.map((p) => p.x), ys = ps.map((p) => p.y);
    const minX = Math.min(...xs) - state_default.STP_NW / 2 - 20;
    const maxX = Math.max(...xs) + state_default.STP_NW / 2 + 20;
    const minY = Math.min(...ys) - state_default.STP_NH / 2 - 20;
    const maxY = Math.max(...ys) + state_default.STP_NH / 2 + 20;
    const bw = maxX - minX || 1, bh = maxY - minY || 1;
    const cw = wrap.clientWidth, ch = wrap.clientHeight;
    state_default.stpScale = Math.min(cw / bw, ch / bh, 1) * 0.9;
    state_default.stpTx = (cw - bw * state_default.stpScale) / 2 - minX * state_default.stpScale;
    state_default.stpTy = (ch - bh * state_default.stpScale) / 2 - minY * state_default.stpScale;
    applyStpTransform();
  }
  function renderStpSvg() {
    const mapG = document.getElementById("stp-map-g");
    if (!mapG) return;
    const NW2 = state_default.STP_NW, NH2 = state_default.STP_NH;
    function borderPt(cx, cy, tx, ty) {
      const hw = NW2 / 2, hh = NH2 / 2;
      const dx = tx - cx, dy = ty - cy;
      if (!dx && !dy) return { x: cx, y: cy + hh };
      const sX = dx ? hw / Math.abs(dx) : Infinity;
      const sY = dy ? hh / Math.abs(dy) : Infinity;
      const s = Math.min(sX, sY);
      return { x: cx + dx * s, y: cy + dy * s };
    }
    const pairTotalCount = {};
    state_default.stpEdgeData.forEach((edge) => {
      pairTotalCount[edge.pairKey] = (pairTotalCount[edge.pairKey] || 0) + 1;
    });
    let edgeSvg = "";
    const pairIdxCount = {};
    [...state_default.stpEdgeData].sort((a, b) => (b.effState ?? 9) - (a.effState ?? 9)).forEach((edge) => {
      const p1 = state_default.stpNodePos[edge.ip], p2 = state_default.stpNodePos[edge.remIp];
      if (!p1 || !p2) return;
      pairIdxCount[edge.pairKey] = pairIdxCount[edge.pairKey] || 0;
      const pairIdx = pairIdxCount[edge.pairKey]++;
      const totalInPair = pairTotalCount[edge.pairKey] || 1;
      const color = edge.effState !== null ? STP_COLOR[edge.effState] || "#888" : "#888";
      const label = edge.effState !== null ? STP_STATE[edge.effState] || "?" : null;
      const blocking = edge.effState !== null && edge.effState <= 2;
      const dash = blocking ? "8,5" : edge.effState === 4 ? "3,3" : "";
      const f = borderPt(p1.x, p1.y, p2.x, p2.y);
      const t = borderPt(p2.x, p2.y, p1.x, p1.y);
      const OFFSET = 28;
      const dx = t.x - f.x, dy = t.y - f.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const px = -dy / len, py = dx / len;
      const off = totalInPair > 1 ? (pairIdx - (totalInPair - 1) / 2) * OFFSET : 0;
      const cpx = (f.x + t.x) / 2 + px * off * 2;
      const cpy = (f.y + t.y) / 2 + py * off * 2;
      const path = `M${f.x.toFixed(1)},${f.y.toFixed(1)} Q${cpx.toFixed(1)},${cpy.toFixed(1)} ${t.x.toFixed(1)},${t.y.toFixed(1)}`;
      edgeSvg += `<path d="${path}" stroke="${color}" stroke-width="2.5" fill="none" opacity="0.9"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`;
      if (label) {
        const mx = (f.x + t.x) / 2 * 0.5 + cpx * 0.5, my = (f.y + t.y) / 2 * 0.5 + cpy * 0.5;
        const tw = label.length * 6 + 12;
        edgeSvg += `<rect x="${(mx - tw / 2).toFixed(1)}" y="${(my - 9).toFixed(1)}" width="${tw}" height="17" rx="5" fill="var(--bg2)" stroke="${color}" stroke-width="1.5" opacity="0.97"/>
        <text x="${mx.toFixed(1)}" y="${(my + 4).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="700" fill="${color}" font-family="system-ui,sans-serif">${label}</text>`;
      }
      const lldp = edge.lldp;
      if (lldp) {
        const TS = `font-size="10" font-weight="600" font-family="system-ui,sans-serif" paint-order="stroke" stroke="var(--bg)" stroke-width="3"`;
        const LOFF = 13;
        if (lldp.localPortName) {
          const anchor = f.x > p1.x ? "start" : f.x < p1.x ? "end" : "middle";
          const lx = f.x + (f.x > p1.x ? LOFF : f.x < p1.x ? -LOFF : 0);
          const ly = f.y + (f.y > p1.y ? LOFF : f.y < p1.y ? -LOFF / 2 : 0);
          edgeSvg += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${anchor}" fill="${color}" ${TS}>${h(lldp.localPortName)}</text>`;
        }
        if (lldp.remPortLabel || lldp.remPortId) {
          const anchor = t.x > p2.x ? "start" : t.x < p2.x ? "end" : "middle";
          const lx = t.x + (t.x > p2.x ? LOFF : t.x < p2.x ? -LOFF : 0);
          const ly = t.y + (t.y > p2.y ? LOFF : t.y < p2.y ? -LOFF / 2 : 0);
          edgeSvg += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${anchor}" fill="${color}" ${TS}>${h(lldp.remPortLabel || lldp.remPortId)}</text>`;
        }
      }
    });
    if (state_default.stpEdgeData.length === 0) {
      const rootEntry = state_default.stpEntries.find((e) => e.global?.isRootBridge) || state_default.stpEntries.find((e) => String(e.global?.rootCost) === "0") || state_default.stpEntries[0];
      if (rootEntry) {
        state_default.stpEntries.forEach(({ ip, global: g }) => {
          if (ip === rootEntry.ip) return;
          const p1 = state_default.stpNodePos[ip], p2 = state_default.stpNodePos[rootEntry.ip];
          if (!p1 || !p2) return;
          const s1 = (state_default.stpStore[ip]?.portEntries || []).find((pe) => String(pe.port) === String(g?.rootPort));
          const effState = s1 ? parseInt(s1.state) : 5;
          const f = borderPt(p1.x, p1.y, p2.x, p2.y);
          const t = borderPt(p2.x, p2.y, p1.x, p1.y);
          const color = STP_COLOR[effState] || "#888";
          edgeSvg += `<path d="M${f.x.toFixed(1)},${f.y.toFixed(1)} L${t.x.toFixed(1)},${t.y.toFixed(1)}" stroke="${color}" stroke-width="2.5" fill="none" opacity="0.9"/>`;
        });
      }
    }
    let nodeSvg = "";
    state_default.stpEntries.forEach(({ ip, global: g }) => {
      const p = state_default.stpNodePos[ip];
      if (!p) return;
      const dev = state_default.deviceStore[ip];
      const isRoot = g?.isRootBridge || String(g?.rootCost) === "0";
      const hasBlocking = (state_default.stpStore[ip]?.portEntries || []).some((pe) => parseInt(pe.state) === 2);
      const stroke = isRoot ? "#f97316" : hasBlocking ? "#ef4444" : "#22c55e";
      const strokeW = isRoot ? 3 : 2;
      const rx = p.x - NW2 / 2, ry = p.y - NH2 / 2;
      const nameRaw = dev?.name || ip;
      const name = h(nameRaw.length > 22 ? nameRaw.slice(0, 21) + "\u2026" : nameRaw);
      const model = dev?.model && dev.model !== nameRaw ? h(dev.model.length > 22 ? dev.model.slice(0, 21) + "\u2026" : dev.model) : "";
      const sub = isRoot ? "\u2605 Root Bridge" : `Root-Port: ${g?.rootPort ?? "\u2014"}`;
      const sub2 = `${h(g?.modeLabel || "STP")}  \xB7  Pri ${g?.priority ?? "\u2014"}`;
      const subColor = isRoot ? "#f97316" : "var(--text3)";
      if (isRoot) {
        nodeSvg += `<rect x="${rx}" y="${ry}" width="${NW2}" height="16" rx="8" fill="#f97316" opacity="0.85"/>
        <rect x="${rx}" y="${ry + 8}" width="${NW2}" height="8" fill="#f97316" opacity="0.85"/>`;
      }
      nodeSvg += `<g onmousedown="stpNodeDragStart(event,'${ip}')" onclick="!stpWasDrag&&openDeviceDetail('${ip}')" style="cursor:move" title="${h(nameRaw)} (${ip})">
      <rect x="${rx}" y="${ry}" width="${NW2}" height="${NH2}" rx="8" fill="var(--card-bg,var(--bg2))" stroke="${stroke}" stroke-width="${strokeW}"/>
      <text x="${p.x}" y="${ry + (isRoot ? 25 : 18)}" text-anchor="middle" font-size="13" font-weight="700" fill="var(--text)" font-family="system-ui,sans-serif">${name}</text>
      ${model ? `<text x="${p.x}" y="${ry + (isRoot ? 37 : 30)}" text-anchor="middle" font-size="9" fill="var(--text3)" font-family="system-ui,sans-serif">${model}</text>` : ""}
      <text x="${p.x}" y="${ry + (isRoot ? 49 : 44)}" text-anchor="middle" font-size="10" fill="${subColor}" font-family="system-ui,sans-serif">${sub}</text>
      <text x="${p.x}" y="${ry + (isRoot ? 62 : 57)}" text-anchor="middle" font-size="11" font-weight="600" fill="var(--text2)" font-family="system-ui,sans-serif">${h(ip)}</text>
      <text x="${p.x}" y="${ry + (isRoot ? 76 : 72)}" text-anchor="middle" font-size="9" fill="var(--text3)" font-family="system-ui,sans-serif">${sub2}</text>
    </g>`;
    });
    mapG.innerHTML = edgeSvg + nodeSvg;
    applyStpTransform();
  }
  var sensorsStore = {};
  var sensorsEmptyHint = null;
  async function syncSensorsAll() {
    const btn = q("btn-sensors-sync");
    const st = q("sensors-sync-status");
    if (btn) btn.disabled = true;
    if (st) {
      st.className = "status-bar";
      st.innerHTML = '<span class="spinner"></span> Abfrage l\xE4uft\u2026';
    }
    sensorsEmptyHint = null;
    sensorsStore = {};
    const switches = Object.values(state_default.deviceStore).filter(
      (d) => (d.type === "switch" || !d.type) && d.online === true
    );
    if (!switches.length) {
      sensorsEmptyHint = "Kein <b>online</b> erreichbarer Switch \u2013 zuerst Ger\xE4te-Status pr\xFCfen (Dashboard / Ger\xE4te).";
      if (btn) btn.disabled = false;
      if (st) {
        st.className = "status-bar";
        st.textContent = "Kein online erreichbarer Switch \u2013 zuerst Status-Check / SNMP.";
      }
      renderSensorsTab();
      return;
    }
    let done = 0;
    await Promise.all(switches.map(async (dev) => {
      try {
        const data = await window.snmpQ?.(dev.ip, "sensors");
        if (data) {
          sensorsStore[dev.ip] = { ...data, devName: dev.name || dev.ip };
        }
      } catch {
      }
      done++;
      if (st) st.innerHTML = `<span class="spinner"></span> ${done} / ${switches.length} \u2013 ${h(dev.name || dev.ip)}`;
    }));
    if (btn) btn.disabled = false;
    const found = Object.keys(sensorsStore).length;
    if (st) {
      st.className = found ? "status-bar ok" : "status-bar";
      st.textContent = found ? `Fertig \u2013 ${found} Ger\xE4t${found !== 1 ? "e" : ""}.` : "Fertig \u2013 keine Daten.";
    }
    renderSensorsTab();
  }
  function fmtUptime2(ticks) {
    if (ticks == null) return "\u2014";
    if (typeof ticks === "string") {
      const m2 = ticks.match(/\((\d+)\)/);
      ticks = m2 ? parseInt(m2[1]) : parseInt(ticks);
    }
    if (isNaN(ticks)) return "\u2014";
    let s = Math.floor(ticks / 100);
    const d = Math.floor(s / 86400);
    s %= 86400;
    const h2 = Math.floor(s / 3600);
    s %= 3600;
    const m = Math.floor(s / 60);
    s %= 60;
    if (d > 0) return `${d}d ${h2}h ${m}m`;
    if (h2 > 0) return `${h2}h ${m}m ${s}s`;
    return `${m}m ${s}s`;
  }
  function renderSensorsTab() {
    const el = q("sensors-content");
    if (!el) return;
    if (!Object.keys(sensorsStore).length) {
      const msg = sensorsEmptyHint ? `<div style="padding:40px;text-align:center;color:var(--text3);max-width:420px;margin:0 auto;line-height:1.5">${sensorsEmptyHint}</div>` : `<div style="padding:40px;text-align:center;color:var(--text3)">Noch keine Daten \u2013 "Alle Switches abfragen" klicken (nur <b>online</b> Switches).</div>`;
      el.innerHTML = msg;
      return;
    }
    el.innerHTML = Object.entries(sensorsStore).map(([ip, data]) => {
      const dev = state_default.deviceStore[ip] || {};
      const poe = (data.poe || [])[0] || null;
      const sens = data.sensors || {};
      const uptimeHtml = `
      <div class="sensor-item">
        <div class="sensor-label">Uptime</div>
        <div class="sensor-value">${fmtUptime2(data.uptimeTicks)}</div>
      </div>`;
      let tempHtml = "";
      if (sens.temperature != null) {
        const t = sens.temperature;
        const col = t >= 70 ? "#ef4444" : t >= 55 ? "#f97316" : "#22c55e";
        const pct = Math.min(100, Math.round(t / 100 * 100));
        tempHtml = `
        <div class="sensor-item">
          <div class="sensor-label">Temperatur</div>
          <div class="sensor-value" style="color:${col}">${t} \xB0C</div>
          <div class="sensor-bar-wrap">
            <div class="sensor-bar" style="width:${pct}%;background:${col}"></div>
          </div>
        </div>`;
      }
      let fanHtml = "";
      if (sens.fanRpm != null) {
        fanHtml = `
        <div class="sensor-item">
          <div class="sensor-label">L\xFCfter</div>
          <div class="sensor-value">${sens.fanRpm.toLocaleString()} RPM</div>
        </div>`;
      } else if (sens.fanCount != null && sens.fanCount === 0) {
        fanHtml = `
        <div class="sensor-item">
          <div class="sensor-label">L\xFCfter</div>
          <div class="sensor-value" style="color:var(--text3)">lautlos</div>
        </div>`;
      }
      let poeHtml = "";
      if (poe && poe.power) {
        const pct = poe.consumption != null ? Math.round(poe.consumption / poe.power * 100) : 0;
        const col = pct > 85 ? "#ef4444" : pct > 65 ? "#f97316" : "#22c55e";
        const statusLabel = poe.status === 1 ? "" : '<span style="color:#ef4444"> (aus)</span>';
        poeHtml = `
        <div class="sensor-item">
          <div class="sensor-label">PoE${statusLabel}</div>
          <div class="sensor-value">${poe.consumption ?? 0} W <span style="color:var(--text3);font-size:11px">/ ${poe.power} W</span></div>
          <div class="sensor-bar-wrap">
            <div class="sensor-bar" style="width:${pct}%;background:${col}"></div>
          </div>
          <div style="font-size:10px;color:var(--text3);margin-top:2px">${pct}% ausgelastet</div>
        </div>`;
      }
      const hasData = tempHtml || fanHtml || poeHtml;
      return `<div class="sensor-card">
      <div class="sensor-card-header">
        <span style="font-weight:700;cursor:pointer" onclick="openDeviceDetail('${ip}')">${h(data.devName)}</span>
        <span style="font-size:11px;color:var(--text3)">${ip}</span>
      </div>
      <div class="sensor-grid">
        ${uptimeHtml}
        ${tempHtml}
        ${fanHtml}
        ${poeHtml}
        ${!hasData ? '<div style="color:var(--text3);font-size:12px;grid-column:1/-1">Nur Uptime verf\xFCgbar</div>' : ""}
      </div>
    </div>`;
    }).join("");
  }
  function inferStpRolesFromLldp(entries) {
    const normP = (s) => (s || "").trim().toLowerCase();
    const normM = (m) => (m || "").replace(/[:\-\. ]/g, "").toLowerCase();
    const portNum = (s) => {
      const m = (s || "").match(/(\d+)$/);
      return m ? parseInt(m[1]) : null;
    };
    const portMatch = (a, b) => normP(a) === normP(b) || portNum(a) !== null && portNum(a) === portNum(b);
    const switchIps = new Set(entries.map((e) => e.ip));
    const resolveNeighbor = (lldp) => {
      const rMac = normM(lldp.remMac);
      return Object.values(state_default.deviceStore).find((d) => {
        if (lldp.remSysName && normP(d.name || "") === normP(lldp.remSysName)) return true;
        if (rMac && normM(d.mac) === rMac) return true;
        if (rMac && (d.macs || []).some((m) => normM(m) === rMac)) return true;
        if (lldp.remChassisIp && d.ip === lldp.remChassisIp) return true;
        return false;
      })?.ip;
    };
    const adj = {};
    for (const { ip } of entries) {
      adj[ip] = [];
      for (const lldp of state_default.deviceStore[ip]?.lldpData || []) {
        const nIp = resolveNeighbor(lldp);
        if (nIp && switchIps.has(nIp) && !adj[ip].some((l) => l.neighborIp === nIp && l.localPortName === lldp.localPortName))
          adj[ip].push({ neighborIp: nIp, localPortName: lldp.localPortName });
      }
    }
    const rootEntry = entries.find((e) => e.global?.isRootBridge) || entries.find((e) => String(e.global?.rootCost) === "0") || entries[0];
    if (!rootEntry) return;
    const getMac = (ip) => normM(state_default.deviceStore[ip]?.mac || entries.find((x) => x.ip === ip)?.global?.bridgeMac || "");
    const bfsLevel = { [rootEntry.ip]: 0 };
    const bfsParentPort = {};
    const q2 = [rootEntry.ip];
    while (q2.length) {
      const curr = q2.shift();
      for (const { neighborIp } of adj[curr]) {
        if (bfsLevel[neighborIp] !== void 0) continue;
        bfsLevel[neighborIp] = bfsLevel[curr] + 1;
        q2.push(neighborIp);
      }
    }
    for (const { ip } of entries) {
      if (ip === rootEntry.ip) continue;
      const myLevel = bfsLevel[ip];
      if (myLevel === void 0) continue;
      const upstream = (adj[ip] || []).filter((l) => (bfsLevel[l.neighborIp] ?? 99) < myLevel);
      if (!upstream.length) continue;
      const best = upstream.reduce((b, c) => getMac(c.neighborIp) < getMac(b.neighborIp) ? c : b);
      bfsParentPort[ip] = best.localPortName;
    }
    for (const entry of entries) {
      const { ip, portEntries } = entry;
      if (!portEntries?.length) continue;
      if (entry.global?.isRootBridge) continue;
      const myLevel = bfsLevel[ip] ?? 1;
      const parentPortName = bfsParentPort[ip] || null;
      const myMac = getMac(ip);
      for (const port of portEntries) {
        if (parseInt(port.state) === 1) continue;
        const link = (adj[ip] || []).find((l) => portMatch(l.localPortName, port.portName));
        if (!link) continue;
        const nIp = link.neighborIp;
        const nLevel = bfsLevel[nIp] ?? 99;
        const isParent = parentPortName !== null && portMatch(parentPortName, port.portName);
        if (isParent) {
          port.state = 5;
          port.role = "root";
        } else if (nLevel > myLevel) {
          port.state = 5;
          port.role = "designated";
        } else if (nLevel < myLevel) {
          port.state = 2;
          port.role = "alternate";
        } else {
          const nMac = getMac(nIp);
          if (myMac && nMac && myMac > nMac) {
            port.state = 2;
            port.role = "alternate";
          } else {
            port.state = 5;
            port.role = "designated";
          }
        }
      }
    }
  }
  function renderStpTab() {
    const el = q("stp-content");
    if (!el) return;
    if (!Object.keys(state_default.stpStore).length) {
      el.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text3)">Noch keine Daten \u2013 "Alle Switches abfragen" klicken.</div>`;
      return;
    }
    const normPort = (s) => (s || "").trim().toLowerCase();
    const normMac2 = (m) => (m || "").replace(/[:\-\. ]/g, "").toLowerCase();
    state_default.stpEntries = Object.entries(state_default.stpStore).map(([ip, d]) => ({ ip, ...d }));
    inferStpRolesFromLldp(state_default.stpEntries);
    const rootEntry = state_default.stpEntries.find((e) => e.global?.isRootBridge) || state_default.stpEntries.find((e) => String(e.global?.rootCost) === "0") || state_default.stpEntries[0];
    const HPAD = 60, LEVEL_H = 150;
    const levels = { [rootEntry.ip]: 0 };
    const bfsQ = [rootEntry.ip];
    while (bfsQ.length) {
      const ip = bfsQ.shift();
      (state_default.deviceStore[ip]?.lldpData || []).forEach((e) => {
        const remIp = Object.values(state_default.deviceStore).find(
          (d) => (d.mac || "").toLowerCase() === (e.remChassisId || "").toLowerCase() || d.ip === e.remChassisId
        )?.ip;
        if (remIp && state_default.stpStore[remIp] && levels[remIp] === void 0) {
          levels[remIp] = levels[ip] + 1;
          bfsQ.push(remIp);
        }
      });
    }
    state_default.stpEntries.forEach((e) => {
      if (levels[e.ip] === void 0) levels[e.ip] = 1;
    });
    const byLevel = {};
    state_default.stpEntries.forEach((e) => {
      const lv = levels[e.ip] ?? 1;
      (byLevel[lv] = byLevel[lv] || []).push(e.ip);
    });
    const maxPerLevel = Math.max(...Object.values(byLevel).map((a) => a.length));
    const svgW = Math.max(700, maxPerLevel * (state_default.STP_NW + HPAD) + HPAD * 2);
    const currentIps = new Set(state_default.stpEntries.map((e) => e.ip));
    Object.keys(state_default.stpNodePos).forEach((ip) => {
      if (!currentIps.has(ip)) delete state_default.stpNodePos[ip];
    });
    Object.entries(byLevel).forEach(([lv, ips]) => {
      const cy = parseInt(lv) * LEVEL_H + 60;
      const totalW = ips.length * state_default.STP_NW + (ips.length - 1) * HPAD;
      const startX = (svgW - totalW) / 2 + state_default.STP_NW / 2;
      ips.forEach((ip, i) => {
        if (!state_default.stpNodePos[ip]) state_default.stpNodePos[ip] = { x: startX + i * (state_default.STP_NW + HPAD), y: cy };
      });
    });
    state_default.stpEdgeData = [];
    const drawnPortKeys = /* @__PURE__ */ new Set();
    const pairCount = {};
    state_default.stpEntries.forEach(({ ip }) => {
      (state_default.deviceStore[ip]?.lldpData || []).forEach((lldp) => {
        const rMac = normMac2(lldp.remMac);
        const rpMac = normMac2(lldp.remPortMac);
        const remIp = Object.values(state_default.deviceStore).find((d) => {
          if (lldp.remSysName && (d.name || "").toLowerCase() === lldp.remSysName.toLowerCase()) return true;
          if (rMac && normMac2(d.mac) === rMac) return true;
          if (rpMac && normMac2(d.mac) === rpMac) return true;
          if (rMac && (d.macs || []).some((m) => normMac2(m) === rMac)) return true;
          if (rpMac && (d.macs || []).some((m) => normMac2(m) === rpMac)) return true;
          if (lldp.remChassisIp && d.ip === lldp.remChassisIp) return true;
          return false;
        })?.ip;
        if (!remIp || !state_default.stpStore[remIp]) return;
        const portKey = `${ip}||${lldp.localPortName || "?"}`;
        if (drawnPortKeys.has(portKey)) return;
        drawnPortKeys.add(portKey);
        const pairKey = [ip, remIp].sort().join("||");
        pairCount[pairKey] = (pairCount[pairKey] || 0) + 1;
        const pairIdx = pairCount[pairKey] - 1;
        const stpPN = (s) => {
          const m = (s || "").match(/(\d+)$/);
          return m ? parseInt(m[1]) : null;
        };
        const stpPM = (a, b) => normPort(a) === normPort(b) || stpPN(a) !== null && stpPN(a) === stpPN(b);
        const s1 = (() => {
          const entry = state_default.stpStore[ip]?.portEntries?.find((p) => stpPM(p.portName, lldp.localPortName));
          return entry ? parseInt(entry.state) : null;
        })();
        const isMacPortId = /^([0-9a-fA-F]{2}[:\- ]){5}[0-9a-fA-F]{2}$/.test((lldp.remPortId || "").trim());
        let remPortLabel = lldp.remPortId, remPortName = lldp.remPortId;
        if (isMacPortId) {
          remPortLabel = lldp.remPortDesc || lldp.remPortId;
          const srcMacs = new Set([state_default.deviceStore[ip]?.mac || "", ...state_default.deviceStore[ip]?.macs || []].map(normMac2).filter(Boolean));
          const revEntry = (state_default.deviceStore[remIp]?.lldpData || []).find((re) => {
            const rm = normMac2(re.remMac);
            const rpm = normMac2(re.remPortMac);
            return rm && srcMacs.has(rm) || rpm && srcMacs.has(rpm) || re.remChassisIp === ip || window.resolveTopoNeighbor?.(re, remIp) === ip;
          });
          if (revEntry?.localPortName) {
            remPortLabel = revEntry.localPortName;
            remPortName = revEntry.localPortName;
          }
        }
        const s2 = (() => {
          const entry = state_default.stpStore[remIp]?.portEntries?.find((p) => stpPM(p.portName, remPortName));
          return entry ? parseInt(entry.state) : null;
        })();
        const states = [s1, s2].filter((s) => s !== null);
        const effState = states.length ? Math.min(...states) : null;
        state_default.stpEdgeData.push({ ip, remIp, lldp: { ...lldp, remPortLabel }, effState, pairKey, pairIdx });
      });
    });
    const legend = `<div style="display:flex;gap:20px;font-size:11px;color:var(--text3);margin-bottom:10px;align-items:center">
    <span><svg width="20" height="8"><line x1="0" y1="4" x2="20" y2="4" stroke="#f97316" stroke-width="2.5"/></svg> Root Bridge</span>
    <span><svg width="20" height="8"><line x1="0" y1="4" x2="20" y2="4" stroke="#22c55e" stroke-width="2.5"/></svg> Forwarding</span>
    <span><svg width="20" height="8"><line x1="0" y1="4" x2="20" y2="4" stroke="#ef4444" stroke-width="2.5" stroke-dasharray="5,3"/></svg> Blocking</span>
    <span style="margin-left:auto;font-size:10px;color:var(--text3)">Knoten ziehbar \xB7 Hintergrund verschiebbar \xB7 Scrollen zum Zoomen</span>
  </div>`;
    const mapHtml = `<div id="stp-map-wrap" style="position:relative;height:480px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);overflow:hidden;margin-bottom:20px">
    <svg id="stp-map-svg" width="100%" height="100%" style="display:block;cursor:default"
      onmousedown="stpBgDragStart(event)" onmousemove="stpMouseMove(event)" onmouseup="stpMouseUp()" onmouseleave="stpMouseUp()" onwheel="stpWheel(event)">
      <defs>
        <filter id="stp-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="3" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <g id="stp-map-g"></g>
    </svg>
    <div style="position:absolute;bottom:8px;right:10px;display:flex;gap:6px">
      <button onclick="stpMapFit()" style="background:var(--bg3);border:1px solid var(--border);border-radius:6px;padding:3px 10px;font-size:11px;cursor:pointer;color:var(--text2)">Einpassen</button>
      <button onclick="stpResetLayout()" style="background:var(--bg3);border:1px solid var(--border);border-radius:6px;padding:3px 10px;font-size:11px;cursor:pointer;color:var(--text2)" title="Gespeicherte Positionen l\xF6schen und automatisches Layout wiederherstellen">Layout zur\xFCcksetzen</button>
    </div>
  </div>`;
    const cards = [...state_default.stpEntries].sort((a, b) => {
      const ar = a.global?.isRootBridge ? -1 : 0, br = b.global?.isRootBridge ? -1 : 0;
      return ar !== br ? ar - br : (a.global?.rootCost || 999) - (b.global?.rootCost || 999);
    }).map(({ ip, global: g, portEntries }) => {
      const dev = state_default.deviceStore[ip];
      const isRoot = g?.isRootBridge || String(g?.rootCost) === "0";
      const blockingPorts = (portEntries || []).filter((p) => parseInt(p.state) === 2);
      const fwdPorts = (portEntries || []).filter((p) => parseInt(p.state) === 5);
      const ROLE_BADGE = { root: "badge-blue", designated: "badge-green", alternate: "badge-red", backup: "badge-orange" };
      const ROLE_LABEL = { root: "Root", designated: "Desig.", alternate: "Alternate", backup: "Backup" };
      const portRows = (portEntries || []).map((p) => {
        const stN = parseInt(p.state);
        const roleBadge = p.role ? `<span class="badge ${ROLE_BADGE[p.role] || "badge-gray"}">${ROLE_LABEL[p.role] || p.role}</span>` : "\u2014";
        return `<tr>
        <td class="mono" style="font-size:12px">${h(p.portName)}</td>
        <td><span class="badge ${STP_BADGE[stN] || "badge-gray"}">${STP_STATE[stN] || "\u2014"}</span></td>
        <td>${roleBadge}</td>
        <td class="mono" style="font-size:11px;color:var(--text3)">${p.priority || "\u2014"}</td>
        <td class="mono" style="font-size:11px;color:var(--text3)">${p.pathCost || "\u2014"}</td>
      </tr>`;
      }).join("");
      return `<div style="background:var(--bg2);border:1px solid ${isRoot ? "#f97316" : blockingPorts.length ? "#ef4444" : "var(--border)"};border-radius:var(--radius);margin-bottom:12px;overflow:hidden">
      <div style="padding:10px 14px;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--border);cursor:pointer" onclick="openDeviceDetail('${ip}')">
        <span style="font-weight:700;font-size:14px">${h(dev?.name || ip)}</span>
        ${isRoot ? `<span class="badge badge-orange">\u2605 Root Bridge</span>` : ""}
        ${blockingPorts.length ? `<span class="badge badge-red">\u26A0 ${blockingPorts.length} Blocking</span>` : ""}
        <span style="font-size:11px;color:var(--text3);flex:1;text-align:right">${h(g?.modeLabel || "STP")} \xB7 Pri ${g?.priority ?? "\u2014"} \xB7 ${fwdPorts.length} Forwarding</span>
        ${g?.topChanges > 0 ? `<span class="badge badge-yellow">${g.topChanges} Topo-Wechsel</span>` : ""}
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="color:var(--text3)">
          <th style="padding:4px 10px;text-align:left">Port</th>
          <th style="padding:4px 10px;text-align:left">Status</th>
          <th style="padding:4px 10px;text-align:left">Rolle</th>
          <th style="padding:4px 10px;text-align:left">Priorit\xE4t</th>
          <th style="padding:4px 10px;text-align:left">Pfadkosten</th>
        </tr></thead>
        <tbody>${portRows}</tbody>
      </table>
    </div>`;
    }).join("");
    el.innerHTML = legend + mapHtml + cards;
    renderStpSvg();
    setTimeout(stpMapFit, 60);
  }
  window.stpNodeDragStart = stpNodeDragStart;
  window.stpBgDragStart = stpBgDragStart;
  window.stpMouseMove = stpMouseMove;
  window.stpMouseUp = stpMouseUp;
  window.stpWheel = stpWheel;
  window.stpResetLayout = stpResetLayout;
  window.stpMapFit = stpMapFit;
  Object.defineProperty(window, "stpWasDrag", { get() {
    return state_default.stpWasDrag;
  }, configurable: true });

  // ui/tabs/porttest.js
  function populatePortTestSelect() {
    const sel = q("porttest-dev-select");
    if (!sel) return;
    const prev = sel.value;
    const switches = Object.values(state_default.deviceStore).filter((d) => d.type === "switch" && d.online !== false).sort((a, b) => (a.name || a.ip).localeCompare(b.name || b.ip));
    sel.innerHTML = `<option value="">-- Ger\xE4t w\xE4hlen --</option>` + switches.map((d) => `<option value="${h(d.ip)}"${d.ip === prev ? " selected" : ""}>${h(d.name || d.ip)} (${h(d.ip)})</option>`).join("");
  }
  async function runPortDiag() {
    const sel = q("porttest-dev-select");
    const ip = sel?.value;
    const st = q("porttest-status");
    const el = q("porttest-content");
    if (!ip) {
      st.className = "status-bar error";
      st.textContent = "Kein Ger\xE4t gew\xE4hlt.";
      return;
    }
    const dev = state_default.deviceStore[ip];
    st.className = "status-bar loading";
    st.innerHTML = `<span class="spinner"></span> Lese Port-Daten von ${h(dev?.name || ip)}\u2026`;
    el.innerHTML = "";
    try {
      const data = await window.snmpQ?.(ip, "portdiag");
      renderPortDiag(data, ip);
      st.className = "status-bar ok";
      st.textContent = `${data.entries.length} Ports gelesen.`;
    } catch (e) {
      st.className = "status-bar error";
      st.textContent = `Fehler: ${e.message}`;
    }
  }
  function renderPortDiag(data, ip) {
    const el = q("porttest-content");
    if (!el) return;
    const dev = state_default.deviceStore[ip];
    const entries = data.entries || [];
    if (!entries.length) {
      el.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text3)">Keine Port-Daten empfangen.</div>`;
      return;
    }
    const totalErrors = entries.reduce((s, p) => s + p.inErrors + p.outErrors + p.fcsErrors, 0);
    const downPorts = entries.filter((p) => p.operStatus === 2).length;
    const errPorts = entries.filter((p) => p.inErrors + p.outErrors + p.fcsErrors > 0).length;
    const upPorts = entries.filter((p) => p.operStatus === 1).length;
    let html = `<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:16px">
    ${[
      ["UP", upPorts, "#22c55e"],
      ["DOWN", downPorts, downPorts ? "#ef4444" : "var(--text3)"],
      ["Mit Fehlern", errPorts, errPorts ? "#f97316" : "var(--text3)"],
      ["Fehler gesamt", totalErrors, totalErrors ? "#ef4444" : "var(--text3)"]
    ].map(([label, val, color]) => `<div style="flex:1;min-width:110px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px">
      <div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;margin-bottom:4px">${label}</div>
      <div style="font-size:26px;font-weight:800;color:${color}">${val}</div>
    </div>`).join("")}
  </div>`;
    html += `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">
    <thead><tr style="color:var(--text3);border-bottom:2px solid var(--border)">
      <th style="padding:6px 10px;text-align:left">Port</th>
      <th style="padding:6px 10px;text-align:left">Status</th>
      <th style="padding:6px 10px;text-align:right">Speed</th>
      <th style="padding:6px 10px;text-align:right">In-Errors</th>
      <th style="padding:6px 10px;text-align:right">Out-Errors</th>
      <th style="padding:6px 10px;text-align:right">FCS-Errors</th>
      <th style="padding:6px 10px;text-align:right">Align-Errors</th>
      <th style="padding:6px 10px;text-align:right">Discards</th>
      <th style="padding:6px 10px;text-align:left">Bewertung</th>
    </tr></thead>
    <tbody>
    ${entries.map((p, i) => {
      const up = p.operStatus === 1;
      const errs = p.inErrors + p.outErrors + p.fcsErrors + p.alignErrors + p.symbolErrors;
      const disc = p.inDiscards + p.outDiscards;
      const badge = !up ? `<span class="badge badge-gray">DOWN</span>` : errs > 100 ? `<span class="badge badge-red">Kritisch</span>` : errs > 0 ? `<span class="badge badge-orange">Warnung</span>` : disc > 1e3 ? `<span class="badge badge-yellow">Discards</span>` : `<span class="badge badge-green">OK</span>`;
      const rowBg = !up ? "" : errs > 100 ? "background:#ef44440a" : errs > 0 ? "background:#f974160a" : "";
      const speed = p.speedMbps >= 1e3 ? p.speedMbps / 1e3 + "G" : p.speedMbps ? p.speedMbps + "M" : up ? "?" : "\u2014";
      const err = (n) => n > 0 ? `<span style="color:${n > 100 ? "#ef4444" : "#f97316"};font-weight:700">${n}</span>` : `<span style="color:var(--text3)">0</span>`;
      return `<tr style="border-top:1px solid var(--border);${rowBg}">
        <td style="padding:6px 10px;font-family:monospace;font-weight:600">${h(p.name)}</td>
        <td style="padding:6px 10px"><span class="badge ${up ? "badge-green" : "badge-gray"}">${up ? "UP" : "DOWN"}</span></td>
        <td style="padding:6px 10px;text-align:right;color:var(--text2)">${speed}</td>
        <td style="padding:6px 10px;text-align:right">${err(p.inErrors)}</td>
        <td style="padding:6px 10px;text-align:right">${err(p.outErrors)}</td>
        <td style="padding:6px 10px;text-align:right">${err(p.fcsErrors)}</td>
        <td style="padding:6px 10px;text-align:right">${err(p.alignErrors)}</td>
        <td style="padding:6px 10px;text-align:right">${disc > 0 ? `<span style="color:var(--text2)">${disc}</span>` : `<span style="color:var(--text3)">0</span>`}</td>
        <td style="padding:6px 10px">${badge}</td>
      </tr>`;
    }).join("")}
    </tbody>
  </table></div>`;
    el.innerHTML = html;
  }
  if (typeof window !== "undefined") {
    window.populatePortTestSelect = populatePortTestSelect;
    window.runPortDiag = runPortDiag;
  }

  // ui/tabs/wifi-dash.js
  async function wifiRefresh(btn) {
    if (btn) btn.disabled = true;
    try {
      await syncWlanClients();
    } finally {
      if (btn) btn.disabled = false;
    }
    renderWifiDashboard();
  }
  async function syncWlanClients() {
    const btn = q("btn-wlan-clients-sync");
    const st = q("wifi-sync-status") || q("dev-sync-status");
    Object.values(state_default.deviceStore).forEach((d) => {
      if (!matchesLocFilter(d)) return;
      if (d.type === "lx-ap" || d.type === "lcos-ap") d.wlanClients = [];
      if (d.type === "lx-ap") {
        d.neighborAps = [];
        d.radioChannels = [];
      }
    });
    const apDevs = Object.values(state_default.deviceStore).filter((d) => (d.type === "lx-ap" || d.type === "lcos-ap") && d.online !== false && matchesLocFilter(d));
    if (!apDevs.length) {
      try {
        await fetch("/api/devices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(state_default.deviceStore) });
        window.rebuildCachedData?.();
        window.renderClients?.();
        window.renderDevices?.();
      } catch (_) {
      }
      if (st) {
        st.className = "status-bar error";
        st.textContent = state_default.devLocFilter !== "all" ? `Keine erreichbaren Access Points im Standort \u201E${state_default.devLocFilter}" \u2014 gespeicherte WLAN-Listen wurden verworfen.` : "Keine erreichbaren Access Points (Status pr\xFCfen) \u2014 gespeicherte WLAN-Listen wurden verworfen.";
      }
      return;
    }
    if (btn) btn.disabled = true;
    if (st) {
      st.className = "status-bar loading";
      st.innerHTML = '<span class="spinner"></span> WLAN Clients werden abgefragt\u2026';
    }
    let done = 0;
    const total = apDevs.length;
    try {
      for (let i = 0; i < apDevs.length; i += 4) {
        await Promise.all(apDevs.slice(i, i + 4).map(async (dev) => {
          try {
            const result = await window.snmpQ?.(dev.ip, "wlan", { os: dev.os || "", devType: dev.type });
            if (state_default.deviceStore[dev.ip]) {
              state_default.deviceStore[dev.ip].wlanClients = result.entries.map((e) => ({
                ...e,
                sourceIp: dev.ip,
                sourceName: dev.name || dev.ip,
                type: "wlan"
              }));
              if (result.radioChannels) state_default.deviceStore[dev.ip].radioChannels = result.radioChannels;
            }
          } catch {
            if (state_default.deviceStore[dev.ip]) state_default.deviceStore[dev.ip].wlanClients = [];
          }
          done++;
          if (st) st.innerHTML = `<span class="spinner"></span> WLAN Clients \u2013 ${done} / ${total} \u2013 ${h(dev.name || dev.ip)}`;
        }));
      }
      const lxDevs = apDevs.filter((d) => d.type === "lx-ap");
      let ndone = 0;
      for (let i = 0; i < lxDevs.length; i += 4) {
        await Promise.all(lxDevs.slice(i, i + 4).map(async (dev) => {
          try {
            const result = await window.snmpQ?.(dev.ip, "neighbor-aps", {});
            if (state_default.deviceStore[dev.ip]) state_default.deviceStore[dev.ip].neighborAps = result.entries;
          } catch {
            if (state_default.deviceStore[dev.ip]) state_default.deviceStore[dev.ip].neighborAps = [];
          }
          ndone++;
          if (st) st.innerHTML = `<span class="spinner"></span> Nachbar-APs \u2013 ${ndone} / ${lxDevs.length} \u2013 ${h(dev.name || dev.ip)}`;
        }));
      }
      await fetch("/api/devices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(state_default.deviceStore) });
      window.rebuildCachedData?.();
      window._wpCoChanFromAnalysis = false;
      window.renderClients?.();
      window.renderDevices?.();
      fetch("/api/wifi-history/snapshot", { method: "POST" }).catch(() => {
      });
      const wlanCnt = state_default.clientsData.filter((c) => c.type === "wlan").length;
      if (st) {
        st.className = "status-bar ok";
        st.textContent = `Abgeschlossen \u2013 ${wlanCnt} WLAN-Client${wlanCnt !== 1 ? "s" : ""} von ${total} Access Point${total !== 1 ? "s" : ""}.`;
      }
    } catch (e) {
      if (st) {
        st.className = "status-bar error";
        st.textContent = `Fehler: ${e.message}`;
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  }
  function renderWifiDashboard() {
    const el = q("wifi-dash-content");
    if (!el) return;
    const aps = Object.values(state_default.deviceStore).filter((d) => d.type === "lx-ap" || d.type === "lcos-ap");
    const allClients = aps.flatMap((ap) => (ap.wlanClients || []).map((c) => ({ ...c, apIp: ap.ip, apName: ap.name || ap.ip })));
    const lxAps = aps.filter((a) => a.type === "lx-ap");
    const hasRadioData = lxAps.some((a) => (a.radioChannels || []).length > 0);
    const hasNeighborData = lxAps.some((a) => (a.neighborAps || []).length > 0);
    if (!allClients.length && !hasRadioData && !hasNeighborData && !lxAps.length) {
      el.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text3)">Keine WLAN-Daten vorhanden \u2013 zuerst <b>Aktualisieren</b> dr\xFCcken.</div>`;
      return;
    }
    const sig = (c) => parseInt(c.signal) || null;
    const section = (title, body) => `<div style="margin-bottom:20px">
      <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.07em;margin-bottom:10px">${title}</div>
      ${body}
    </div>`;
    const card = (inner, onclick = "", extra = "") => `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px;${onclick ? "cursor:pointer;" : ""}${extra}" ${onclick ? `onclick="${onclick}"` : ""}>${inner}</div>`;
    const kachel = (label, value, sub, color) => `<div style="flex:1;min-width:110px;max-width:180px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px">
      <div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.07em;margin-bottom:4px">${label}</div>
      <div style="font-size:26px;font-weight:800;color:${color};line-height:1">${value}</div>
      ${sub ? `<div style="font-size:10px;color:var(--text3);margin-top:3px">${sub}</div>` : ""}
    </div>`;
    const miniBar = (pct, color) => `<div style="height:6px;background:var(--bg3);border-radius:3px;overflow:hidden;margin-top:3px">
      <div style="height:100%;width:${Math.min(pct, 100)}%;background:${color};border-radius:3px"></div>
    </div>`;
    const total = allClients.length;
    const band24 = allClients.filter((c) => c.band === "2.4 GHz").length;
    const band5 = allClients.filter((c) => c.band === "5 GHz").length;
    const band6 = allClients.filter((c) => c.band === "6 GHz").length;
    const noIp = allClients.filter((c) => !c.ip).length;
    const sigVals = allClients.map(sig).filter((s) => s !== null);
    const avgSig = sigVals.length ? Math.round(sigVals.reduce((a, b) => a + b, 0) / sigVals.length) : null;
    let html = section(
      "\xDCbersicht",
      `<div style="display:flex;flex-wrap:wrap;gap:10px">
      ${kachel("Clients gesamt", total, `${aps.length} APs aktiv`, "var(--accent)")}
      ${kachel("2.4 GHz", band24, `${total ? Math.round(band24 / total * 100) : 0}% der Clients`, "#f97316")}
      ${kachel("5 GHz", band5, `${total ? Math.round(band5 / total * 100) : 0}% der Clients`, "#22c55e")}
      ${band6 ? kachel("6 GHz", band6, `${Math.round(band6 / total * 100)}% der Clients`, "var(--cyan)") : ""}
      ${kachel("\xD8 Signal", avgSig !== null ? avgSig + " dBm" : "\u2014", avgSig >= -60 ? "Ausgezeichnet" : avgSig >= -70 ? "Gut" : avgSig >= -80 ? "M\xE4\xDFig" : "Schwach", avgSig >= -60 ? "#22c55e" : avgSig >= -70 ? "#84cc16" : avgSig >= -80 ? "#f97316" : "#ef4444")}
      ${noIp ? kachel("Ohne IP", noIp, "DHCP-Problem?", "#ef4444") : ""}
    </div>`
    );
    if (total) {
      const p24 = Math.round(band24 / total * 100), p5 = Math.round(band5 / total * 100), p6 = Math.round(band6 / total * 100);
      html += section(
        "Band-Verteilung",
        card(`<div style="display:flex;height:24px;border-radius:4px;overflow:hidden;gap:1px">
        ${band24 ? `<div style="flex:${band24};background:#f97316;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff">${p24}%</div>` : ""}
        ${band5 ? `<div style="flex:${band5};background:#22c55e;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff">${p5}%</div>` : ""}
        ${band6 ? `<div style="flex:${band6};background:var(--cyan);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff">${p6}%</div>` : ""}
      </div>
      <div style="display:flex;gap:16px;margin-top:6px;font-size:11px;color:var(--text3)">
        <span><span style="color:#f97316">\u25A0</span> 2.4 GHz (${band24})</span>
        <span><span style="color:#22c55e">\u25A0</span> 5 GHz (${band5})</span>
        ${band6 ? `<span><span style="color:var(--cyan)">\u25A0</span> 6 GHz (${band6})</span>` : ""}
      </div>`)
      );
    }
    const apStats = aps.filter((ap) => ap.online === true).map((ap) => {
      const clients = ap.wlanClients || [];
      const ssids = [...new Set(clients.map((c) => c.ssid).filter(Boolean))];
      const sigs = clients.map(sig).filter((s) => s !== null);
      const avgS = sigs.length ? Math.round(sigs.reduce((a, b) => a + b, 0) / sigs.length) : null;
      return { ap, clients, ssids, avgS };
    }).sort((a, b) => b.clients.length - a.clients.length);
    const maxClients = apStats[0]?.clients.length || 1;
    html += section(
      "Clients pro AP",
      apStats.length ? `<div style="display:flex;flex-direction:column;gap:6px">` + apStats.map(({ ap, clients, ssids, avgS }) => {
        const cnt = clients.length;
        const pct = Math.round(cnt / maxClients * 100);
        const color = cnt > 20 ? "#ef4444" : cnt > 12 ? "#f97316" : "#22c55e";
        const sigColor = avgS == null ? "var(--text3)" : avgS >= -60 ? "#22c55e" : avgS >= -70 ? "#84cc16" : avgS >= -80 ? "#f97316" : "#ef4444";
        const ssidWarn = ssids.length > 4 ? `<span class="badge badge-orange" title="Mehr als 4 SSIDs reduzieren die WLAN-Performance">${ssids.length} SSIDs \u26A0</span>` : `<span style="font-size:10px;color:var(--text3)">${ssids.length} SSID${ssids.length !== 1 ? "s" : ""}</span>`;
        return card(
          `<div style="display:flex;align-items:center;gap:10px">
          <span style="font-weight:600;font-size:13px;min-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h(ap.name || ap.ip)}</span>
          <div style="flex:1">
            <div style="display:flex;align-items:center;gap:6px">
              <div style="flex:1;height:8px;background:var(--bg3);border-radius:4px;overflow:hidden">
                <div style="height:100%;width:${pct}%;background:${color};border-radius:4px"></div>
              </div>
              <span style="font-size:13px;font-weight:700;color:${color};min-width:28px;text-align:right">${cnt}</span>
            </div>
          </div>
          <span style="font-size:11px;color:${sigColor};min-width:55px;text-align:right">${avgS !== null ? avgS + " dBm" : "\u2014"}</span>
          ${ssidWarn}
        </div>`,
          `openDeviceDetail('${h(ap.ip)}')`
        );
      }).join("") + `</div>` : `<div style="font-size:12px;color:var(--text3);line-height:1.45">Kein Access Point mit Status <b>Online</b> \u2014 im Tab <b>Ger\xE4te</b> Ping/Scan ausf\xFChren oder Filter pr\xFCfen. Offline/Unbekannt werden hier nicht aufgef\xFChrt.</div>`
    );
    if (hasRadioData) {
      const bandColor = (b) => b === "2.4 GHz" ? "#f97316" : b === "5 GHz" ? "#22c55e" : "#818cf8";
      html += section(
        "AP Radio-Kan\xE4le (LCOS LX)",
        card(`<table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr>
          <th style="text-align:left;padding:4px 8px;color:var(--text3);font-weight:600">Access Point</th>
          <th style="padding:4px 8px;color:var(--text3);font-weight:600">Radios</th>
          <th style="padding:4px 8px;color:var(--text3);font-weight:600;text-align:right">Clients</th>
        </tr></thead>
        <tbody>
        ${lxAps.filter((ap) => (ap.radioChannels || []).length > 0).map((ap) => {
          const radios = (ap.radioChannels || []).sort((a, b) => a.channel - b.channel);
          const cntStr = (ap.wlanClients || []).length;
          return `<tr style="border-top:1px solid var(--border)">
            <td style="padding:5px 8px;font-weight:600;cursor:pointer" onclick="openDeviceDetail('${h(ap.ip)}')">${h(ap.name || ap.ip)}</td>
            <td style="padding:5px 8px">
              ${radios.map((r) => `<span style="display:inline-block;margin:1px 3px 1px 0;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;background:${bandColor(r.band)}22;color:${bandColor(r.band)}">CH ${r.channel} <span style="opacity:.7;font-weight:400">${r.band}</span></span>`).join("")}
            </td>
            <td style="padding:5px 8px;text-align:right;color:var(--cyan)">${cntStr}</td>
          </tr>`;
        }).join("")}
        </tbody>
      </table>`)
      );
    }
    if (hasNeighborData) {
      const allNeighbors = {};
      lxAps.forEach((ap) => {
        (ap.neighborAps || []).forEach((n) => {
          if (!allNeighbors[n.bssid]) allNeighbors[n.bssid] = { ...n, seenBy: [] };
          if (!allNeighbors[n.bssid].channel && n.channel) allNeighbors[n.bssid].channel = n.channel;
          if (!allNeighbors[n.bssid].ssid && n.ssid) allNeighbors[n.bssid].ssid = n.ssid;
          if (!allNeighbors[n.bssid].band && n.band) allNeighbors[n.bssid].band = n.band;
          if (!allNeighbors[n.bssid].seenBy.includes(ap.name || ap.ip))
            allNeighbors[n.bssid].seenBy.push(ap.name || ap.ip);
          if (!allNeighbors[n.bssid].nbrIp && n.ip) allNeighbors[n.bssid].nbrIp = n.ip;
        });
      });
      const ownIps = new Set(Object.values(state_default.deviceStore).map((d) => d.ip));
      const neighborList = Object.values(allNeighbors).sort((a, b) => {
        const aOwn = ownIps.has(a.nbrIp) ? 0 : 1;
        const bOwn = ownIps.has(b.nbrIp) ? 0 : 1;
        return aOwn - bOwn || (a.channel || 999) - (b.channel || 999);
      });
      const bandColor = (b) => b === "2.4 GHz" ? "#f97316" : b === "5 GHz" ? "#22c55e" : "#818cf8";
      html += section(
        "Nachbar-APs in Reichweite (LCOS LX Scan)",
        card(`<div style="margin-bottom:8px;font-size:11px;color:var(--text3)">${neighborList.length} BSSIDs erkannt \xB7 <span style="color:#22c55e">gr\xFCn = eigene APs</span></div>
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr>
          <th style="text-align:left;padding:4px 8px;color:var(--text3);font-weight:600">BSSID</th>
          <th style="text-align:left;padding:4px 8px;color:var(--text3);font-weight:600">SSID</th>
          <th style="padding:4px 8px;color:var(--text3);font-weight:600">Kanal</th>
          <th style="padding:4px 8px;color:var(--text3);font-weight:600">Sichtbar von</th>
        </tr></thead>
        <tbody>
        ${neighborList.map((n) => {
          const isOwn = ownIps.has(n.nbrIp);
          const ownDev = isOwn ? Object.values(state_default.deviceStore).find((d) => d.ip === n.nbrIp) : null;
          const devLabel = ownDev ? `<span style="color:#22c55e;font-weight:600">${h(ownDev.name || n.nbrIp)}</span>` : `<span style="color:var(--text3)">${h(n.nbrIp || "\u2014")}</span>`;
          const ch = n.channel || "\u2014";
          const bc = bandColor(n.band || "");
          return `<tr style="border-top:1px solid var(--border)">
            <td style="padding:5px 8px;font-family:monospace;font-size:11px">${h(n.bssid)}</td>
            <td style="padding:5px 8px;font-weight:600">${h(n.ssid || "\u2014")}</td>
            <td style="padding:5px 8px;text-align:center">
              ${n.channel ? `<span style="padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;background:${bc}22;color:${bc}">CH ${ch}</span>` : "\u2014"}
            </td>
            <td style="padding:5px 8px;font-size:11px">${devLabel} \xB7 ${n.seenBy.map(h).join(", ")}</td>
          </tr>`;
        }).join("")}
        </tbody>
      </table></div>`)
      );
    }
    const sigBuckets = [
      { label: "Exzellent", range: "> \u221260 dBm", color: "#22c55e", fn: (s) => s > -60 },
      { label: "Gut", range: "\u221260\u2026\u221270", color: "#84cc16", fn: (s) => s <= -60 && s > -70 },
      { label: "M\xE4\xDFig", range: "\u221270\u2026\u221280", color: "#f97316", fn: (s) => s <= -70 && s > -80 },
      { label: "Schwach", range: "< \u221280 dBm", color: "#ef4444", fn: (s) => s <= -80 }
    ];
    html += section(
      "Signalst\xE4rke-Heatmap",
      `<div style="overflow-x:auto">${card(`
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr>
          <th style="text-align:left;padding:4px 8px;color:var(--text3);font-weight:600">AP</th>
          ${sigBuckets.map((b) => `<th style="padding:4px 8px;color:${b.color};font-weight:600;text-align:center">${b.label}<div style="font-size:10px;font-weight:400;color:var(--text3)">${b.range}</div></th>`).join("")}
          <th style="padding:4px 8px;color:var(--text3);font-weight:600;text-align:center">\xD8 dBm</th>
        </tr></thead>
        <tbody>
        ${apStats.filter((a) => a.clients.length > 0).map(({ ap, clients, avgS }, i) => {
        const sigs = clients.map(sig).filter((s) => s !== null);
        return `<tr style="border-top:1px solid var(--border)">
            <td style="padding:5px 8px;font-weight:600;cursor:pointer" onclick="openDeviceDetail('${h(ap.ip)}')">${h(ap.name || ap.ip)}</td>
            ${sigBuckets.map((b) => {
          const cnt = sigs.filter(b.fn).length;
          const pct = sigs.length ? Math.round(cnt / sigs.length * 100) : 0;
          return `<td style="padding:5px 8px;text-align:center">
                ${cnt > 0 ? `<span style="font-weight:700;color:${b.color}">${cnt}</span><div style="font-size:10px;color:var(--text3)">${pct}%</div>` : `<span style="color:var(--border)">\u2014</span>`}
              </td>`;
        }).join("")}
            <td style="padding:5px 8px;text-align:center;font-family:monospace;color:${avgS >= -60 ? "#22c55e" : avgS >= -70 ? "#84cc16" : avgS >= -80 ? "#f97316" : "#ef4444"}">${avgS ?? "\u2014"}</td>
          </tr>`;
      }).join("")}
        </tbody>
      </table>
    `)}</div>`
    );
    const blocks5 = [[36, 40, 44, 48], [52, 56, 60, 64], [100, 104, 108, 112], [116, 120, 124, 128], [132, 136, 140, 144], [149, 153, 157, 161], [165, 169, 173, 177]];
    const blocks6 = [[1, 5, 9, 13], [17, 21, 25, 29], [33, 37, 41, 45], [49, 53, 57, 61], [65, 69, 73, 77], [81, 85, 89, 93], [97, 101, 105, 109], [113, 117, 121, 125], [129, 133, 137, 141], [145, 149, 153, 157], [161, 165, 169, 173], [177, 181, 185, 189], [193, 197, 201, 205], [209, 213, 217, 221], [225, 229, 233, 237]];
    function chanSection(bandLabel, bandFilter, nonOverlapChans, blocks, clients = allClients) {
      const bClients = clients.filter((c) => c.band === bandFilter && c.channel);
      if (!bClients.length) return "";
      const chanData = {};
      bClients.forEach((c) => {
        const ch = String(c.channel);
        if (!chanData[ch]) chanData[ch] = { clients: 0, aps: {} };
        if (!c._virtual) chanData[ch].clients++;
        if (!chanData[ch].aps[c.apIp]) chanData[ch].aps[c.apIp] = { name: c.apName, ip: c.apIp, count: 0 };
        if (!c._virtual) chanData[ch].aps[c.apIp].count++;
      });
      const chanInBand = (ch) => {
        const n = parseInt(ch);
        if (bandFilter === "2.4 GHz") return n >= 1 && n <= 14;
        return true;
      };
      const badStdChans = nonOverlapChans ? Object.keys(chanData).filter((ch) => chanInBand(ch) && !nonOverlapChans.has(ch)) : [];
      const coChanProblems = Object.entries(chanData).filter(([, d]) => Object.keys(d.aps).length > 1).map(([ch, d]) => ({ ch, aps: Object.values(d.aps) }));
      const blockProblems = [];
      if (blocks) {
        blocks.forEach((block) => {
          const apsInBlock = {};
          block.forEach((ch) => {
            const d = chanData[String(ch)];
            if (!d) return;
            Object.values(d.aps).forEach((ap) => {
              if (!apsInBlock[ap.ip]) apsInBlock[ap.ip] = { ...ap, channels: [] };
              apsInBlock[ap.ip].channels.push(ch);
            });
          });
          const apList = Object.values(apsInBlock);
          const usedChans = [...new Set(apList.flatMap((a) => a.channels))];
          if (apList.length > 1 && usedChans.length > 1) {
            blockProblems.push({ block, aps: apList });
          }
        });
      }
      const hasProblems = badStdChans.length || coChanProblems.length || blockProblems.length;
      const maxClients2 = Math.max(1, ...Object.values(chanData).map((d) => d.clients));
      const problemChans = /* @__PURE__ */ new Set([
        ...badStdChans,
        ...coChanProblems.map((p) => p.ch),
        ...blockProblems.flatMap((p) => p.aps.flatMap((a) => a.channels.map(String)))
      ]);
      let inner = `<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;margin-bottom:${hasProblems ? "12px" : "0"}">
      ${Object.entries(chanData).sort((a, b) => Number(a[0]) - Number(b[0])).map(([ch, d]) => {
        const isProblem = problemChans.has(ch);
        const color = isProblem ? "#ef4444" : "#22c55e";
        const pct = Math.round(d.clients / maxClients2 * 100);
        const apNames = Object.values(d.aps).map((a) => h(a.name)).join(", ");
        return `<div style="text-align:center;min-width:38px" title="APs: ${apNames}">
          <div style="font-size:10px;font-weight:700;color:${color};margin-bottom:2px">${d.clients}</div>
          <div style="height:${Math.max(pct * 0.6, 4)}px;background:${color};border-radius:2px 2px 0 0;opacity:0.85"></div>
          <div style="font-size:11px;font-weight:600;color:${isProblem ? "#ef4444" : "var(--text)"};margin-top:2px">CH${ch}</div>
          <div style="font-size:9px;color:var(--text3)">${Object.keys(d.aps).length} AP${Object.keys(d.aps).length > 1 ? "s" : ""}</div>
          ${isProblem ? `<div style="font-size:10px;color:#ef4444">\u26A0</div>` : ""}
        </div>`;
      }).join("")}
    </div>`;
      if (badStdChans.length) {
        inner += `<div style="margin-top:8px;padding:8px 10px;background:#ef44441a;border:1px solid #ef444440;border-radius:6px;font-size:12px">
        <b style="color:#ef4444">\u26A0 Nicht-Standard-Kan\xE4le:</b> CH${badStdChans.join(", CH")} \u2014 empfohlen: nur Kanal 1, 6, 11<br>
        <span style="color:var(--text3)">Betroffene APs: ${[...new Set(badStdChans.flatMap((ch) => Object.values(chanData[ch].aps).map((a) => a.name)))].join(", ")}</span>
      </div>`;
      }
      if (coChanProblems.length) {
        inner += coChanProblems.map(
          (p) => `<div style="margin-top:6px;padding:8px 10px;background:#ef44441a;border:1px solid #ef444440;border-radius:6px;font-size:12px">
          <b style="color:#ef4444">\u26A0 Co-Channel-Interferenz CH${p.ch}:</b> ${p.aps.length} APs auf demselben Prim\xE4rkanal<br>
          <span style="color:var(--text3)">${p.aps.map((a) => `<span style="cursor:pointer;color:var(--accent)" onclick="openDeviceDetail('${h(a.ip)}')">${h(a.name)}</span>`).join(" \xB7 ")}</span>
        </div>`
        ).join("");
      }
      if (blockProblems.length) {
        inner += blockProblems.map(
          (p) => `<div style="margin-top:6px;padding:8px 10px;background:#f974161a;border:1px solid #f9741640;border-radius:6px;font-size:12px">
          <b style="color:#f97316">\u26A0 80-MHz-\xDCberschneidung Block CH${p.block[0]}\u2013CH${p.block[p.block.length - 1]}:</b> APs auf verschiedenen Prim\xE4rkan\xE4len im selben 80-MHz-Block<br>
          <span style="color:var(--text3)">${p.aps.map((a) => `<span style="cursor:pointer;color:var(--accent)" onclick="openDeviceDetail('${h(a.ip)}')">${h(a.name)}</span> (CH${a.channels.join("/")})`).join(" \xB7 ")}</span>
        </div>`
        ).join("");
      }
      return section(`Kanalverteilung ${bandLabel}${hasProblems ? ' <span style="color:#ef4444;font-size:11px;font-weight:400">\u25CF Probleme erkannt</span>' : ""}`, card(inner));
    }
    const lxApIps = new Set(lxAps.map((a) => a.ip));
    const lxClients = allClients.filter((c) => lxApIps.has(c.apIp));
    const lxAnalysis = [];
    lxAps.forEach((ap) => {
      (ap.radioChannels || []).forEach((r) => {
        const radioChannel = String(r.channel);
        const clientsOnBand = lxClients.filter((c) => c.apIp === ap.ip && c.band === r.band);
        if (clientsOnBand.length > 0) {
          clientsOnBand.forEach((c) => lxAnalysis.push({ ...c, channel: radioChannel }));
        } else {
          lxAnalysis.push({ apIp: ap.ip, apName: ap.name || ap.ip, band: r.band, channel: radioChannel, _virtual: true });
        }
      });
    });
    window._wpCoChanPairs = {};
    window._wpCoChanFromAnalysis = true;
    [
      { band: "2.4 GHz", blocks: null },
      { band: "5 GHz", blocks: blocks5 },
      { band: "6 GHz", blocks: blocks6 }
    ].forEach(({ band, blocks }) => {
      const bClients = lxAnalysis.filter((c) => c.band === band && c.channel);
      const chanData = {};
      bClients.forEach((c) => {
        if (!chanData[c.channel]) chanData[c.channel] = {};
        chanData[c.channel][c.apIp] = true;
      });
      Object.entries(chanData).forEach(([ch, apsObj]) => {
        const aps2 = Object.keys(apsObj);
        if (aps2.length < 2) return;
        for (let i = 0; i < aps2.length; i++) for (let j = i + 1; j < aps2.length; j++) {
          const k = [aps2[i], aps2[j]].sort().join("||");
          if (!window._wpCoChanPairs[k]) window._wpCoChanPairs[k] = [];
          window._wpCoChanPairs[k].push({ band, label: `CH${ch}`, color: "#ef4444" });
        }
      });
      if (blocks) blocks.forEach((block) => {
        const blockAps = {};
        bClients.filter((c) => block.includes(parseInt(c.channel))).forEach((c) => {
          blockAps[c.apIp] = c.channel;
        });
        const aps2 = Object.keys(blockAps);
        if (aps2.length < 2) return;
        for (let i = 0; i < aps2.length; i++) for (let j = i + 1; j < aps2.length; j++) {
          if (blockAps[aps2[i]] === blockAps[aps2[j]]) continue;
          const k = [aps2[i], aps2[j]].sort().join("||");
          if (!window._wpCoChanPairs[k]) window._wpCoChanPairs[k] = [];
          if (!window._wpCoChanPairs[k].some((p) => p.band === band)) {
            window._wpCoChanPairs[k].push({ band, label: `CH${blockAps[aps2[i]]}\u2194${blockAps[aps2[j]]}`, color: "#f97316" });
          }
        }
      });
    });
    html += chanSection("2.4 GHz (LCOS LX)", "2.4 GHz", /* @__PURE__ */ new Set(["1", "6", "11"]), null, lxAnalysis);
    html += chanSection("5 GHz (LCOS LX)", "5 GHz", null, blocks5, lxAnalysis);
    html += chanSection("6 GHz (LCOS LX)", "6 GHz", null, blocks6, lxAnalysis);
    const stickyClients = allClients.filter((c) => sig(c) !== null && sig(c) <= -70).sort((a, b) => sig(a) - sig(b));
    if (stickyClients.length) {
      html += section(
        `Schwache / Sticky Clients <span style="font-weight:400;font-size:10px;color:var(--text3)">(Signal \u2264 \u221270 dBm, kein Roaming)</span>`,
        card(`<table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="color:var(--text3)">
          <th style="text-align:left;padding:4px 8px">MAC</th>
          <th style="text-align:left;padding:4px 8px">IP / Hostname</th>
          <th style="text-align:left;padding:4px 8px">AP</th>
          <th style="text-align:left;padding:4px 8px">SSID</th>
          <th style="text-align:left;padding:4px 8px">Band</th>
          <th style="text-align:right;padding:4px 8px">Signal</th>
        </tr></thead>
        <tbody>
        ${stickyClients.map((c, i) => {
          const s = sig(c);
          const color = s <= -80 ? "#ef4444" : "#f97316";
          return `<tr style="border-top:1px solid var(--border)">
            <td style="padding:5px 8px;font-family:monospace;font-size:11px;cursor:pointer;color:var(--accent)" onclick="openTopoWithMac('${h(c.mac)}')">${h(c.mac)}</td>
            <td style="padding:5px 8px;color:var(--text2)">${c.ip ? h(c.ip) : "\u2014"}${c.hostname ? `<div style="font-size:10px;color:var(--text3)">${h(c.hostname)}</div>` : ""}</td>
            <td style="padding:5px 8px;cursor:pointer;color:var(--accent)" onclick="openDeviceDetail('${h(c.apIp)}')">${h(c.apName)}</td>
            <td style="padding:5px 8px">${c.ssid ? `<span class="badge badge-blue">${h(c.ssid)}</span>` : "\u2014"}</td>
            <td style="padding:5px 8px;color:var(--text2)">${h(c.band || "\u2014")}</td>
            <td style="padding:5px 8px;text-align:right;font-weight:700;color:${color}">${s} dBm</td>
          </tr>`;
        }).join("")}
        </tbody>
      </table>`)
      );
    }
    const macToAps = {};
    allClients.forEach((c) => {
      if (!macToAps[c.mac]) macToAps[c.mac] = [];
      macToAps[c.mac].push(c);
    });
    const roamingAnomalies = Object.entries(macToAps).filter(([, list]) => list.length > 1);
    if (roamingAnomalies.length) {
      html += section(
        `Roaming-Anomalien <span style="font-weight:400;font-size:10px;color:var(--text3)">(gleiche MAC auf mehreren APs)</span>`,
        card(`<table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="color:var(--text3)">
          <th style="text-align:left;padding:4px 8px">MAC</th>
          <th style="text-align:left;padding:4px 8px">APs</th>
        </tr></thead>
        <tbody>
        ${roamingAnomalies.map(
          ([mac, list]) => `<tr style="border-top:1px solid var(--border)">
            <td style="padding:5px 8px;font-family:monospace;font-size:11px;cursor:pointer;color:var(--accent)" onclick="openTopoWithMac('${h(mac)}')">${h(mac)}</td>
            <td style="padding:5px 8px">${list.map((c) => `<span style="margin-right:8px">${h(c.apName)} <span style="color:var(--text3)">(${sig(c) ?? "?"} dBm)</span></span>`).join("")}</td>
          </tr>`
        ).join("")}
        </tbody>
      </table>`)
      );
    }
    html += `<div style="margin-top:4px" id="wifi-history-section">
    <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px;display:flex;align-items:center;gap:10px;cursor:pointer;user-select:none" onclick="toggleDashSection('wifihist')">
      <span>WiFi History (24h)</span>
      <button class="btn btn-sm" style="font-size:10px" onclick="event.stopPropagation();wifiHistSnapshot()">Snapshot speichern</button>
      <button class="btn btn-sm btn-ghost" style="font-size:10px" onclick="event.stopPropagation();loadWifiHistory()">Aktualisieren</button>
      <span id="dash-wifihist-chevron" style="margin-left:auto;font-size:11px;transition:transform .2s;display:inline-block">\u25BE</span>
    </div>
    <div id="dash-wifihist-list" style="overflow:hidden;transition:max-height .25s ease,opacity .2s ease;max-height:2000px;opacity:1">
      <div id="wifi-history-content" style="color:var(--text3);font-size:12px;padding:12px 0">Lade History\u2026</div>
    </div>
  </div>`;
    el.innerHTML = html;
    loadWifiHistory();
  }
  function svgLineChart(data, width, height, color, label) {
    if (!data.length) return "";
    const max = Math.max(1, ...data.map((d) => d.v));
    const min = Math.min(0, ...data.map((d) => d.v));
    const range = max - min || 1;
    const step = width / Math.max(1, data.length - 1);
    const points = data.map((d, i) => {
      const x = i * step;
      const y = height - (d.v - min) / range * (height - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const polyline = points.join(" ");
    const areaPoints = `0,${height} ${polyline} ${((data.length - 1) * step).toFixed(1)},${height}`;
    const lastVal = data[data.length - 1]?.v ?? 0;
    const firstTs = data[0]?.t || "";
    const lastTs = data[data.length - 1]?.t || "";
    return `<div style="margin-bottom:12px">
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px">
      <span style="font-size:12px;font-weight:600">${label}</span>
      <span style="font-size:12px;font-weight:700;color:${color}">${lastVal}</span>
    </div>
    <svg width="${width}" height="${height}" style="display:block;background:var(--bg3);border-radius:4px;overflow:hidden">
      <polygon points="${areaPoints}" fill="${color}" opacity="0.1"/>
      <polyline points="${polyline}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/>
    </svg>
    <div style="display:flex;justify-content:space-between;font-size:9px;color:var(--text3);margin-top:2px">
      <span>${firstTs.slice(11, 16)}</span><span>${lastTs.slice(11, 16)}</span>
    </div>
  </div>`;
  }
  async function wifiHistSnapshot() {
    try {
      const r = await (await fetch("/api/wifi-history/snapshot", { method: "POST" })).json();
      if (r.ok) loadWifiHistory();
    } catch {
    }
  }
  async function loadWifiHistory() {
    const el = document.getElementById("wifi-history-content");
    if (!el) return;
    try {
      const data = await (await fetch("/api/wifi-history?hours=24")).json();
      if (!data.length) {
        el.innerHTML = '<div style="padding:12px 0;color:var(--text3);font-size:12px">Noch keine History-Daten. Klicke <b>Snapshot speichern</b> nach jedem WLAN-Sync, oder aktiviere Auto-Snapshots in den Einstellungen.</div>';
        return;
      }
      const firstTs = data[0]?.ts || "";
      const lastTs = data[data.length - 1]?.ts || "";
      const allIps = /* @__PURE__ */ new Set();
      data.forEach((s) => Object.keys(s.aps).forEach((ip) => allIps.add(ip)));
      const chartWidth = 320;
      const chartHeight = 48;
      const totalData = data.map((s) => ({
        t: s.ts,
        v: Object.values(s.aps).reduce((sum, a) => sum + a.clients, 0)
      }));
      const band24Data = data.map((s) => ({ t: s.ts, v: Object.values(s.aps).reduce((sum, a) => sum + (a.bands?.["2.4"] || 0), 0) }));
      const band5Data = data.map((s) => ({ t: s.ts, v: Object.values(s.aps).reduce((sum, a) => sum + (a.bands?.["5"] || 0), 0) }));
      const band6Data = data.map((s) => ({ t: s.ts, v: Object.values(s.aps).reduce((sum, a) => sum + (a.bands?.["6"] || 0), 0) }));
      const apCharts = [...allIps].map((ip) => {
        const apData = data.map((s) => ({ t: s.ts, v: s.aps[ip]?.clients || 0 }));
        const name = data[data.length - 1]?.aps[ip]?.name || ip;
        return { ip, name, data: apData };
      }).sort((a, b) => {
        const aLast = a.data[a.data.length - 1]?.v || 0;
        const bLast = b.data[b.data.length - 1]?.v || 0;
        return bLast - aLast;
      });
      const sigCharts = [...allIps].map((ip) => {
        const sigData = data.map((s) => ({ t: s.ts, v: s.aps[ip]?.avgSignal ?? 0 })).filter((d) => d.v !== 0);
        const name = data[data.length - 1]?.aps[ip]?.name || ip;
        return { ip, name, data: sigData };
      }).filter((c) => c.data.length > 1);
      let out = `<div style="display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start">`;
      out += `<div style="flex:1;min-width:340px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px">
      ${svgLineChart(totalData, chartWidth, chartHeight, "var(--cyan)", "Clients gesamt")}
      ${svgLineChart(band24Data, chartWidth, 36, "#f97316", "2.4 GHz")}
      ${svgLineChart(band5Data, chartWidth, 36, "#22c55e", "5 GHz")}
      ${band6Data.some((d) => d.v > 0) ? svgLineChart(band6Data, chartWidth, 36, "#818cf8", "6 GHz") : ""}
    </div>`;
      out += `<div style="flex:2;min-width:340px;display:flex;flex-wrap:wrap;gap:10px">`;
      apCharts.slice(0, 12).forEach((c) => {
        out += `<div style="flex:1;min-width:200px;max-width:360px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px;cursor:pointer" onclick="openDeviceDetail('${h(c.ip)}')">
        ${svgLineChart(c.data, 200, 40, "var(--accent)", h(c.name))}
      </div>`;
      });
      out += `</div></div>`;
      if (sigCharts.length) {
        out += `<div style="margin-top:12px"><div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px">\xD8 Signal pro AP</div>
        <div style="display:flex;flex-wrap:wrap;gap:10px">`;
        sigCharts.slice(0, 12).forEach((c) => {
          const lastSig = c.data[c.data.length - 1]?.v || 0;
          const sigColor = lastSig >= -60 ? "#22c55e" : lastSig >= -70 ? "#84cc16" : lastSig >= -80 ? "#f97316" : "#ef4444";
          out += `<div style="flex:1;min-width:200px;max-width:360px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px">
          ${svgLineChart(c.data, 200, 40, sigColor, h(c.name) + " (dBm)")}
        </div>`;
        });
        out += `</div></div>`;
      }
      out += `<div style="margin-top:8px;font-size:10px;color:var(--text3)">${data.length} Snapshots \xB7 ${firstTs.slice(0, 16).replace("T", " ")} bis ${lastTs.slice(0, 16).replace("T", " ")}</div>`;
      el.innerHTML = out;
    } catch (e) {
      el.innerHTML = `<div style="color:var(--red);font-size:12px">Fehler beim Laden: ${e.message}</div>`;
    }
  }
  if (typeof window !== "undefined") {
    window.wifiRefresh = wifiRefresh;
    window.renderWifiDashboard = renderWifiDashboard;
    window.syncWlanClients = syncWlanClients;
    window.wifiHistSnapshot = wifiHistSnapshot;
    window.loadWifiHistory = loadWifiHistory;
  }

  // ui/tabs/wifi-settings.js
  async function loadLxWlanNetworksData(ip) {
    try {
      const d2 = await window.snmpQ?.(ip, "lx-wlan-networks", { os: "LCOS LX" });
      if (d2) return d2;
    } catch (e) {
      const msg = e.message || "";
      if (!msg.includes("Unbekannter Typ")) throw e;
    }
    const creds = devCredentials(ip);
    const r = await fetch("/api/lx-wlan-networks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: ip, ...creds })
    });
    const text = await r.text();
    if (text.trim().startsWith("<")) {
      throw new Error(
        "Server liefert HTML statt JSON. Node neu starten (aktuelle api.js) oder Proxy pr\xFCfen. Hinweis: case \u201Elx-wlan-networks\u201C fehlt im laufenden Prozess."
      );
    }
    let d;
    try {
      d = JSON.parse(text);
    } catch {
      throw new Error("Ung\xFCltige API-Antwort");
    }
    if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`);
    return d;
  }
  async function applyLxWlanSsidRequest(ip, networkName, ssid) {
    const creds = devCredentials(ip);
    const writeCommunity = (state_default.appSettings.snmpWriteCommunity || "").trim() || creds.community;
    const extra = { networkName, ssid, writeCommunity, community: creds.community, version: creds.version };
    try {
      await window.snmpQ?.(ip, "lx-wlan-set-ssid", extra);
      return;
    } catch (e) {
      const msg = e.message || "";
      if (!msg.includes("Unbekannter Typ")) throw e;
    }
    const r = await fetch("/api/lx-wlan-ssid", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: ip, networkName, ssid, writeCommunity, community: creds.community, version: creds.version })
    });
    const text = await r.text();
    if (text.trim().startsWith("<")) {
      throw new Error("Server liefert HTML statt JSON \u2013 Node neu starten oder Proxy pr\xFCfen.");
    }
    let d;
    try {
      d = JSON.parse(text);
    } catch {
      throw new Error("Ung\xFCltige API-Antwort");
    }
    if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`);
  }
  function renderWifiSettings() {
    const el = q("wifi-settings-content");
    if (!el) return;
    const lxAll = Object.values(state_default.deviceStore || {}).filter((d) => d.type === "lx-ap");
    const lxAps = lxAll.filter((d) => d.online === true);
    if (!lxAll.length) {
      el.innerHTML = `<div style="padding:24px;color:var(--text3);text-align:center;max-width:520px;margin:0 auto">Keine LCOS-LX-Access-Points in der Ger\xE4teliste. Bitte unter <b>Ger\xE4te</b> ein Ger\xE4t mit Typ <b>lx-ap</b> anlegen.</div>`;
      return;
    }
    if (!lxAps.length) {
      el.innerHTML = `<div style="padding:24px;color:var(--text3);text-align:center;max-width:520px;margin:0 auto">Kein LCOS-LX-AP mit Status <b>Online</b>. Im Tab <b>Ger\xE4te</b> Ping oder Status-Check ausf\xFChren \u2014 in der Auswahl erscheinen nur erreichbare Access Points.</div>`;
      return;
    }
    el.innerHTML = `
    <p style="font-size:11px;color:var(--text3);margin:0 0 12px">SNMP-Tabelle <code style="font-size:10px">1.3.6.1.4.1.2356.13.2.20.1</code> \u2014 Lesen per SNMP. Zum Setzen: Schreib-Community unter Einstellungen hinterlegen (oder dieselbe Zeichenkette wie in der Ger\xE4teliste, wenn ein gemeinsames Passwort genutzt wird). \u201ENotWritable\u201C bedeutet oft, dass die Firmware diese OID schreibgesch\xFCtzt ausliefert \u2014 dann SSID per Web-UI, CLI oder LMC.</p>
    <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px">
      <label style="font-size:12px;color:var(--text2)">Access Point</label>
      <select id="lx-wlan-ap-sel" class="search-input" style="min-width:220px">
        ${lxAps.map((a) => `<option value="${h(a.ip)}">${h(a.name || a.ip)}</option>`).join("")}
      </select>
      <button type="button" class="btn btn-sm" onclick="loadLxWlanNetworks()">Netze laden</button>
      <span id="lx-wlan-net-status" style="font-size:12px;color:var(--text3)"></span>
    </div>
    <div id="lx-wlan-net-table-wrap"></div>`;
  }
  async function loadLxWlanNetworks() {
    const sel = q("lx-wlan-ap-sel");
    const st = q("lx-wlan-net-status");
    const wrap = q("lx-wlan-net-table-wrap");
    if (!sel || !wrap) return;
    const ip = sel.value;
    if (st) {
      st.textContent = "Lade\u2026";
      st.style.color = "var(--text3)";
    }
    try {
      const d = await loadLxWlanNetworksData(ip);
      const nets = d?.networks || [];
      if (!nets.length) {
        wrap.innerHTML = '<div style="font-size:12px;color:var(--text3)">Keine Eintr\xE4ge \u2014 Walk liefert keine passenden OIDs oder noch keine WLAN-Netze.</div>';
        if (st) st.textContent = "";
        return;
      }
      wrap.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr style="color:var(--text3)"><th style="text-align:left;padding:4px 8px">Profil (Index)</th><th style="text-align:left;padding:4px 8px">SSID (SNMP)</th><th style="text-align:left;padding:4px 8px">Neue SSID</th><th></th></tr></thead>
      <tbody>
      ${nets.map((row) => {
        const name = row.networkName;
        const cur = row.ssid != null && row.ssid !== "" ? row.ssid : "\u2014";
        const enc = encodeURIComponent(name);
        return `<tr style="border-top:1px solid var(--border)">
          <td style="padding:6px 8px;font-family:var(--mono);font-size:11px">${h(name)}</td>
          <td style="padding:6px 8px">${h(String(cur))}</td>
          <td style="padding:6px 8px"><input class="search-input lx-wlan-ssid-input" style="width:min(220px,100%)" maxlength="32" placeholder="max. 32 Zeichen"></td>
          <td style="padding:6px 8px"><button type="button" class="btn btn-sm" data-net="${enc}" onclick="applyLxWlanSsid(this)">Setzen</button></td>
        </tr>`;
      }).join("")}
      </tbody></table>`;
      if (st) {
        st.textContent = `${nets.length} Netz(e)`;
        st.style.color = "var(--text3)";
      }
    } catch (e) {
      if (st) {
        st.textContent = e.message || "Fehler";
        st.style.color = "var(--red)";
      }
      wrap.innerHTML = "";
    }
  }
  async function applyLxWlanSsid(btn) {
    const sel = q("lx-wlan-ap-sel");
    const ip = sel?.value;
    const networkName = decodeURIComponent(btn.getAttribute("data-net") || "");
    const tr = btn.closest("tr");
    const inp = tr?.querySelector("input.lx-wlan-ssid-input");
    const ssid = inp?.value?.trim() || "";
    if (!ip || !networkName) return;
    if (!ssid.length) {
      window.alert?.("Neue SSID eingeben");
      return;
    }
    try {
      await applyLxWlanSsidRequest(ip, networkName, ssid);
      await loadLxWlanNetworks();
    } catch (e) {
      window.alert?.(e.message || "SNMP SET fehlgeschlagen");
    }
  }

  // ui/tabs/mesh.js
  var _snmpQ = (...a) => window.snmpQ?.(...a);
  var _setDeviceOnline = (...a) => window.setDeviceOnline?.(...a);
  var _renderDevices = () => window.renderDevices?.();
  function rssiStatus(signal, connected) {
    if (!connected) return "red";
    if (signal == null) return "orange";
    const pct = Number(signal);
    if (pct >= (state_default.appSettings.rssiGreen ?? 80)) return "green";
    if (pct >= (state_default.appSettings.rssiYellow ?? 50)) return "yellow";
    if (pct >= (state_default.appSettings.rssiOrange ?? 0)) return "orange";
    return "red";
  }
  var RS = {
    green: { cls: "dot-green", bcls: "badge-green", lbl: "Gut" },
    yellow: { cls: "dot-yellow", bcls: "badge-yellow", lbl: "Mittel" },
    orange: { cls: "dot-orange", bcls: "badge-orange", lbl: "Schwach" },
    red: { cls: "dot-red", bcls: "badge-red", lbl: "Offline" }
  };
  function meshSortClick(col) {
    clickSort(state_default.meshSort, col, renderMesh);
  }
  function setMeshFilter(f) {
    state_default.meshFilter = f;
    ["all", "green", "yellow", "orange", "red"].forEach((k) => {
      const el = q("mf-" + k);
      if (el) el.classList.toggle("active", k === f);
    });
    renderMesh();
  }
  function setMeshLocFilter(v) {
    state_default.meshLocFilter = v;
    renderMesh();
  }
  function resolvePeerDev(mac) {
    const low = (mac || "").toLowerCase();
    if (!low) return null;
    return Object.values(state_default.deviceStore).find((d) => {
      if ((d.mac || "").toLowerCase() === low) return true;
      if (d.macs?.some((m) => m.toLowerCase() === low)) return true;
      return false;
    }) || null;
  }
  function clearMeshData() {
    if (!confirm("WDS-Verbindungsdaten f\xFCr alle Ger\xE4te l\xF6schen?")) return;
    state_default.meshData.length = 0;
    Object.values(state_default.deviceStore).forEach((d) => {
      delete d.wdsLinks;
    });
    fetch("/api/devices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(state_default.deviceStore) });
    renderMesh();
    _renderDevices();
  }
  function renderMesh() {
    const srch = (q("mesh-search")?.value || "").toLowerCase();
    const entries = state_default.meshData.map((r) => ({ ...r, peerDev: resolvePeerDev(r.mac) }));
    const processedKeys = /* @__PURE__ */ new Set();
    const mergedRows = [];
    for (const r of entries.filter((e) => e.peerDev)) {
      const key = [r.deviceIp, r.peerDev.ip].sort().join("|");
      if (processedKeys.has(key)) continue;
      processedKeys.add(key);
      const other = entries.find((o) => o !== r && o.deviceIp === r.peerDev.ip && o.peerDev?.ip === r.deviceIp);
      if (other) {
        const primary = !r.isRemote ? r : !other.isRemote ? other : r;
        const secondary = primary === r ? other : r;
        mergedRows.push({ ...primary, peerSignal: secondary.signal, peerConnected: secondary.connected, merged: true });
      } else {
        mergedRows.push({ ...r, merged: false });
      }
    }
    const unknownPeerEntries = entries.filter((e) => !e.peerDev);
    const nonRemoteMacs = new Set(unknownPeerEntries.filter((r) => !r.isRemote && r.mac).map((r) => r.mac));
    const singleRows = unknownPeerEntries.filter((r) => !r.isRemote || !nonRemoteMacs.has(r.mac)).map((r) => ({ ...r, merged: false }));
    const allRows = [...mergedRows, ...singleRows];
    const rows = allRows.filter((r) => {
      const st = rssiStatus(r.signal, r.connected);
      if (state_default.meshFilter !== "all" && st !== state_default.meshFilter) return false;
      if (state_default.meshLocFilter !== "all" && (state_default.deviceStore[r.deviceIp]?.location || "") !== state_default.meshLocFilter) return false;
      if (srch) {
        const peer = r.peerDev?.name || r.peerDev?.ip || "";
        if (!r.deviceName.toLowerCase().includes(srch) && !r.deviceIp.includes(srch) && !(r.mac || "").toLowerCase().includes(srch) && !peer.toLowerCase().includes(srch)) return false;
      }
      return true;
    });
    const meshKeyFn = (r, col) => {
      switch (col) {
        case "deviceName":
          return r.deviceName.toLowerCase();
        case "deviceIp":
          return r.deviceIp.split(".").reduce((s, o) => s * 256 + parseInt(o), 0);
        case "linkName":
          return r.linkName.toLowerCase();
        case "peer":
          return (r.peerDev?.name || r.peerDev?.ip || r.mac || "").toLowerCase();
        case "band":
          return r.band || "";
        case "signal":
          return r.signal ?? -1;
        case "txRate":
          return r.txRate ?? -1;
        case "rxRate":
          return r.rxRate ?? -1;
        case "status":
          return rssiStatus(r.signal, r.connected);
        case "loc":
          return (state_default.deviceStore[r.deviceIp]?.location || "").toLowerCase();
        default:
          return "";
      }
    };
    const sortedRows = applySort(rows, state_default.meshSort, meshKeyFn);
    setBadge("mesh", allRows.length);
    q("cnt-mesh").textContent = allRows.length ? allRows.length + " Link" + (allRows.length !== 1 ? "s" : "") : "";
    q("thead-mesh").innerHTML = `<tr>
    ${mkTh("Access Point", "deviceName", state_default.meshSort, "meshSortClick")}
    ${mkTh("Ger\xE4t-IP", "deviceIp", state_default.meshSort, "meshSortClick")}
    ${mkTh("WDS-Link", "linkName", state_default.meshSort, "meshSortClick")}
    ${mkTh("Client", "peer", state_default.meshSort, "meshSortClick")}
    ${mkTh("Band", "band", state_default.meshSort, "meshSortClick")}
    ${mkTh("RSSI", "signal", state_default.meshSort, "meshSortClick")}
    ${mkTh("Eff.-Tx-Rate", "txRate", state_default.meshSort, "meshSortClick")}
    ${mkTh("Eff.-Rx-Rate", "rxRate", state_default.meshSort, "meshSortClick")}
    ${mkTh("Status", "status", state_default.meshSort, "meshSortClick")}
    ${mkTh("Standort", "loc", state_default.meshSort, "meshSortClick")}
    ${noSortTh("")}
  </tr>`;
    const tbody = q("tbl-mesh").querySelector("tbody");
    if (!sortedRows.length) {
      tbody.innerHTML = `<tr><td colspan="11" class="empty">${state_default.meshData.length ? "Kein Treffer f\xFCr aktiven Filter" : "Sync starten \u2013 nur LX Access Points werden abgefragt"}</td></tr>`;
      return;
    }
    tbody.innerHTML = sortedRows.map((r) => {
      const st = rssiStatus(r.signal, r.connected);
      const s = RS[st];
      const peerLabel = r.peerDev ? `<span title="${h(r.mac)}" style="font-weight:600">${h(r.peerDev.name || r.peerDev.ip)}</span><br><span class="mono" style="font-size:11px;color:var(--text3)">${h(r.mac)}</span>` : `<span class="mono">${h(r.mac || "\u2014")}</span>`;
      const rssiColor = (st2) => `var(--${st2})`;
      const localSt = rssiStatus(r.signal, r.connected);
      const localRssi = r.connected && r.signal != null ? r.signal + "%" : "\u2014";
      let rssiCell;
      if (r.merged) {
        const peerSt = rssiStatus(r.peerSignal, r.peerConnected);
        const peerVal = r.peerConnected && r.peerSignal != null ? r.peerSignal + "%" : "\u2014";
        rssiCell = `<span style="font-weight:700;color:${rssiColor(localSt)}">${localRssi}</span><span style="color:var(--text3);font-size:11px"> / </span><span style="font-weight:700;color:${rssiColor(peerSt)}">${peerVal}</span>`;
      } else {
        rssiCell = `<span style="font-weight:700;color:${rssiColor(localSt)}">${localRssi}</span>`;
      }
      const syncBtns = r.merged && r.peerDev ? `<button class="btn btn-sm btn-ghost" onclick="syncMeshDevice('${h(r.deviceIp)}')" title="Sync ${h(r.deviceName)}">&#x21BB;</button><button class="btn btn-sm btn-ghost" onclick="syncMeshDevice('${h(r.peerDev.ip)}')" title="Sync ${h(r.peerDev.name || r.peerDev.ip)}">&#x21BB;</button>` : `<button class="btn btn-sm btn-ghost" onclick="syncMeshDevice('${h(r.deviceIp)}')">&#x21BB;</button>`;
      return `<tr>
      <td style="font-weight:600">${h(r.deviceName)}</td>
      <td class="mono">${h(r.deviceIp)}</td>
      <td style="font-weight:500">${h(r.linkName)}</td>
      <td>${peerLabel}</td>
      <td style="color:var(--text2)">${r.band || "\u2014"}</td>
      <td>${rssiCell}</td>
      <td style="color:var(--text2)">${r.txRate != null ? r.txRate + " Mbps" : "\u2014"}</td>
      <td style="color:var(--text2)">${r.rxRate != null ? r.rxRate + " Mbps" : "\u2014"}</td>
      <td><span class="dot ${s.cls}"></span><span class="badge ${s.bcls}">${s.lbl}</span></td>
      <td style="font-size:12px;color:var(--text2)">${h(state_default.deviceStore[r.deviceIp]?.location || "\u2014")}</td>
      <td><div style="display:flex;gap:4px">${syncBtns}</div></td>
    </tr>`;
    }).join("");
  }
  async function syncMeshDevice(ip) {
    const dev = state_default.deviceStore[ip];
    if (!dev) return;
    const name = dev.name || dev.sysName || ip;
    const st = q("dev-sync-status");
    st.className = "status-bar loading";
    st.innerHTML = `<span class="spinner"></span> Sync ${h(name)}\u2026`;
    try {
      const result = await _snmpQ(ip, "wds");
      _setDeviceOnline(ip, true);
      state_default.meshData.splice(0, state_default.meshData.length, ...state_default.meshData.filter((r) => r.deviceIp !== ip));
      if (result.configured) mergeMeshResult(ip, name, result);
      await fetch("/api/devices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(state_default.deviceStore) });
      renderMesh();
      const cnt = state_default.meshData.filter((r) => r.deviceIp === ip).length;
      st.className = "status-bar ok";
      st.textContent = `${name}: ${cnt} WDS-Link${cnt !== 1 ? "s" : ""} aktualisiert`;
    } catch {
      _setDeviceOnline(ip, false);
      st.className = "status-bar error";
      st.textContent = `${name}: SNMP nicht erreichbar`;
    }
  }
  function mergeMeshResult(ip, name, result) {
    const linkMap = {};
    (result.configLinks || []).forEach((cl) => {
      linkMap[cl.linkName] = { ...cl };
    });
    (result.statusEntries || []).forEach((se) => {
      if (!linkMap[se.linkName]) linkMap[se.linkName] = {};
      Object.assign(linkMap[se.linkName], se);
    });
    const stored = [];
    Object.values(linkMap).forEach((l) => {
      const entry = {
        deviceName: name,
        deviceIp: ip,
        linkName: l.linkName || "\u2014",
        band: l.radio === 1 ? "2.4 GHz" : l.radio === 2 ? "5 GHz" : "\u2014",
        signal: l.signal ?? null,
        connected: !!l.connected,
        mac: l.mac || "",
        txRate: l.txRate ?? null,
        rxRate: l.rxRate ?? null,
        wpaVersion: l.wpaVersion,
        isRemote: !!l.remote
      };
      state_default.meshData.push(entry);
      stored.push(entry);
    });
    if (state_default.deviceStore[ip]) state_default.deviceStore[ip].wdsLinks = stored;
  }

  // ui/tabs/l2tp.js
  var _snmpQ2 = (...a) => window.snmpQ?.(...a);
  var _setDeviceOnline2 = (...a) => window.setDeviceOnline?.(...a);
  var _renderDevices2 = () => window.renderDevices?.();
  function l2tpSortClick(col) {
    clickSort(state_default.l2tpSort, col, renderL2tp);
  }
  function setL2tpFilter(f) {
    state_default.l2tpFilter = f;
    ["all", "up", "down"].forEach((k) => {
      const el = q("lf-" + k);
      if (el) el.classList.toggle("active", k === f);
    });
    renderL2tp();
  }
  function setL2tpLocFilter(v) {
    state_default.l2tpLocFilter = v;
    renderL2tp();
  }
  function clearL2tpData() {
    if (!confirm("L2TPv3-Endpunktdaten f\xFCr alle Ger\xE4te l\xF6schen?")) return;
    state_default.l2tpData.length = 0;
    Object.values(state_default.deviceStore).forEach((d) => {
      delete d.l2tpEndpoints;
    });
    fetch("/api/devices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(state_default.deviceStore) });
    renderL2tp();
    _renderDevices2();
  }
  function renderL2tp() {
    const srch = (q("l2tp-search")?.value || "").toLowerCase();
    const filtered = state_default.l2tpData.filter((r) => {
      const up = r.state === "UP";
      if (state_default.l2tpFilter === "up" && !up) return false;
      if (state_default.l2tpFilter === "down" && up) return false;
      if (state_default.l2tpLocFilter !== "all" && (state_default.deviceStore[r.deviceIp]?.location || "") !== state_default.l2tpLocFilter) return false;
      if (srch && !r.deviceName.toLowerCase().includes(srch) && !r.deviceIp.includes(srch)) return false;
      return true;
    });
    const l2tpKeyFn = (r, col) => {
      switch (col) {
        case "deviceName":
          return r.deviceName.toLowerCase();
        case "deviceIp":
          return r.deviceIp.split(".").reduce((s, o) => s * 256 + parseInt(o), 0);
        case "endpointName":
          return (r.endpointName || "").toLowerCase();
        case "remoteEnd":
          return (r.remoteEnd || "").toLowerCase();
        case "remoteIp":
          return (r.remoteIp || "").split(".").reduce((s, o) => s * 256 + parseInt(o || "0"), 0);
        case "state":
          return r.state || "";
        case "loc":
          return (state_default.deviceStore[r.deviceIp]?.location || "").toLowerCase();
        default:
          return "";
      }
    };
    const rows = applySort(filtered, state_default.l2tpSort, l2tpKeyFn);
    setBadge("l2tp", state_default.l2tpData.length);
    q("cnt-l2tp").textContent = state_default.l2tpData.length ? state_default.l2tpData.length + " Endpunkt" + (state_default.l2tpData.length !== 1 ? "e" : "") : "";
    q("thead-l2tp").innerHTML = `<tr>
    ${mkTh("Ger\xE4tename", "deviceName", state_default.l2tpSort, "l2tpSortClick")}
    ${mkTh("Ger\xE4t-IP", "deviceIp", state_default.l2tpSort, "l2tpSortClick")}
    ${mkTh("Endpoint", "endpointName", state_default.l2tpSort, "l2tpSortClick")}
    ${mkTh("Gegenstelle", "remoteEnd", state_default.l2tpSort, "l2tpSortClick")}
    ${mkTh("Remote-IP", "remoteIp", state_default.l2tpSort, "l2tpSortClick")}
    ${mkTh("Status", "state", state_default.l2tpSort, "l2tpSortClick")}
    ${mkTh("Standort", "loc", state_default.l2tpSort, "l2tpSortClick")}
    ${noSortTh("")}
  </tr>`;
    const tbody = q("tbl-l2tp").querySelector("tbody");
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="8" class="empty">${state_default.l2tpData.length ? "Kein Treffer f\xFCr aktiven Filter" : "Sync starten \u2013 nur LX Access Points werden abgefragt"}</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map((r) => {
      const up = r.state === "UP";
      return `<tr>
      <td style="font-weight:600">${h(r.deviceName)}</td>
      <td class="mono">${h(r.deviceIp)}</td>
      <td style="font-weight:500">${h(r.endpointName || "\u2014")}</td>
      <td>${h(r.remoteEnd || "\u2014")}</td>
      <td class="mono" style="color:var(--text2)">${h(r.remoteIp || "\u2014")}</td>
      <td><span class="dot ${up ? "dot-green" : "dot-red"}"></span><span class="badge ${up ? "badge-green" : "badge-red"}">${h(r.state || "\u2014")}</span></td>
      <td style="font-size:12px;color:var(--text2)">${h(state_default.deviceStore[r.deviceIp]?.location || "\u2014")}</td>
      <td><button class="btn btn-sm btn-ghost" onclick="syncL2tpDevice('${h(r.deviceIp)}')">&#x21BB;</button></td>
    </tr>`;
    }).join("");
  }
  async function syncL2tpDevice(ip) {
    const dev = state_default.deviceStore[ip];
    if (!dev) return;
    const name = dev.name || dev.ip;
    const st = q("dev-sync-status");
    st.className = "status-bar loading";
    st.innerHTML = `<span class="spinner"></span> Sync ${h(name)}\u2026`;
    try {
      const result = await _snmpQ2(ip, "l2tp");
      _setDeviceOnline2(ip, true);
      state_default.l2tpData.splice(0, state_default.l2tpData.length, ...state_default.l2tpData.filter((r) => r.deviceIp !== ip));
      if (result.configured) mergeL2tpResult(ip, name, result);
      await fetch("/api/devices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(state_default.deviceStore) });
      renderL2tp();
      const cnt = state_default.l2tpData.filter((r) => r.deviceIp === ip).length;
      st.className = "status-bar ok";
      st.textContent = `${name}: ${cnt} Endpunkt${cnt !== 1 ? "e" : ""} aktualisiert`;
    } catch {
      _setDeviceOnline2(ip, false);
      st.className = "status-bar error";
      st.textContent = `${name}: SNMP nicht erreichbar`;
    }
  }
  function mergeL2tpResult(ip, name, result) {
    const epMap = {};
    (result.configEndpoints || []).forEach((ep) => {
      epMap[ep.name] = { ...ep };
    });
    (result.statusEntries || []).forEach((se) => {
      const k = se.endpointName || se.remoteEnd;
      if (!epMap[k]) epMap[k] = {};
      Object.assign(epMap[k], se);
    });
    const stored = [];
    Object.values(epMap).forEach((ep) => {
      const entry = {
        deviceName: name,
        deviceIp: ip,
        endpointName: ep.name || ep.endpointName || "\u2014",
        remoteEnd: ep.remoteEnd || "\u2014",
        remoteIp: ep.remoteIp || "\u2014",
        port: ep.port,
        state: ep.state || "\u2014",
        iface: ep.iface || "\u2014",
        connStartTime: ep.connStartTime || ""
      };
      state_default.l2tpData.push(entry);
      stored.push(entry);
    });
    if (state_default.deviceStore[ip]) state_default.deviceStore[ip].l2tpEndpoints = stored;
  }

  // ui/tabs/scanner.js
  var _saveDevice = (...a) => window.saveDevice?.(...a);
  var _saveDevices = (...a) => window.saveDevices?.(...a);
  var _deleteDevice = (...a) => window.deleteDevice?.(...a);
  function setScanStatus(msg, type = "") {
    const el = q("scan-status");
    el.className = "status-bar" + (type ? " " + type : "");
    el.innerHTML = type === "loading" ? `<span class="spinner"></span> ${msg}` : msg;
  }
  function runWsScan(type, subnet, onEvent, onError, signal) {
    return new Promise((resolve) => {
      const wsProto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${wsProto}://${location.host}/ws`);
      ws.onopen = () => ws.send(JSON.stringify({ type, subnet }));
      ws.onmessage = ({ data }) => {
        try {
          onEvent(JSON.parse(data));
        } catch {
        }
      };
      ws.onerror = () => onError("WebSocket-Fehler", "error");
      ws.onclose = () => resolve();
      signal.addEventListener("abort", () => {
        ws.close();
        onError("Scan abgebrochen.", "");
        resolve();
      }, { once: true });
    });
  }
  async function startScan() {
    const subnet = q("scan-subnet").value.trim();
    if (!subnet) {
      setScanStatus("Bitte Subnetz eingeben.", "error");
      return;
    }
    state_default.appSettings.lastScanSubnet = subnet;
    fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...state_default.appSettings }) }).catch(() => {
    });
    if (state_default.scanAbort) {
      state_default.scanAbort.abort();
    }
    const myAbort = new AbortController();
    state_default.scanAbort = myAbort;
    state_default.scanFoundCnt = 0;
    state_default.scanResults.length = 0;
    q("btn-scan").disabled = true;
    q("btn-scan-stop").style.display = "";
    q("btn-save-all").style.display = "none";
    q("btn-update-details").style.display = "none";
    q("sep-save-all").style.display = "none";
    q("scan-progress-wrap").style.display = "";
    q("scan-bar").style.width = "0%";
    q("scan-scanned").textContent = "0";
    q("scan-total").textContent = "?";
    q("scan-found-lbl").textContent = "";
    q("tbl-scan").querySelector("tbody").innerHTML = "";
    q("cnt-scan").textContent = "";
    setScanStatus("Scan l\xE4uft\u2026", "loading");
    await runWsScan("scan", subnet, handleScanEvent, setScanStatus, myAbort.signal);
    if (state_default.scanAbort === myAbort) {
      state_default.scanAbort = null;
    }
    q("btn-scan").disabled = false;
    q("btn-scan-stop").style.display = "none";
  }
  function stopScan() {
    if (state_default.scanAbort) {
      state_default.scanAbort.abort();
      state_default.scanAbort = null;
    }
  }
  function handleScanEvent(ev) {
    if (ev.type === "start") {
      q("scan-total").textContent = ev.total;
    } else if (ev.type === "progress" || ev.type === "found") {
      const pct = ev.total > 0 ? Math.round(ev.scanned / ev.total * 100) : 0;
      q("scan-bar").style.width = pct + "%";
      q("scan-scanned").textContent = ev.scanned;
      q("scan-total").textContent = ev.total;
      if (ev.found > 0) q("scan-found-lbl").textContent = `${ev.found} Ger\xE4t${ev.found !== 1 ? "e" : ""} gefunden`;
      if (ev.type === "found") appendScanRow(ev.device);
      setScanStatus(`Scanne ${ev.scanned} / ${ev.total}\u2026`, "loading");
    } else if (ev.type === "done") {
      q("scan-bar").style.width = "100%";
      setScanStatus(ev.found > 0 ? `Scan abgeschlossen \u2014 ${ev.found} Ger\xE4t${ev.found !== 1 ? "e" : ""} gefunden` : `Scan abgeschlossen \u2014 keine Ger\xE4te gefunden`, ev.found > 0 ? "ok" : "");
      if (ev.found === 0) q("tbl-scan").querySelector("tbody").innerHTML = `<tr><td colspan="8" class="empty">Keine Ger\xE4te gefunden</td></tr>`;
      setBadge("scanner", ev.found || 0);
      if (ev.found > 0) {
        q("btn-save-all").style.display = "";
        q("btn-update-details").style.display = "";
        q("sep-save-all").style.display = "";
        q("btn-save-all").textContent = `Alle ${ev.found} speichern`;
      }
    }
  }
  function matchesImportFilter(dev) {
    const filterOS = state_default.appSettings.filterOS || [];
    const filterType = state_default.appSettings.filterType || [];
    if (!filterOS.length && !filterType.length) return true;
    const devOs = dev.os || "";
    const osOk = !filterOS.length || filterOS.some(
      (f) => f === devOs || devOs === "LCOS SX" && f.startsWith("LCOS SX")
    );
    const devTypeLabel = TYPE_LABELS[dev.type || ""] || dev.type || "";
    const typeOk = !filterType.length || filterType.includes(devTypeLabel);
    return osOk && typeOk;
  }
  function appendScanRow(dev) {
    state_default.scanResults.push(dev);
    const tbody = q("tbl-scan").querySelector("tbody");
    const ph = tbody.querySelector("td[colspan]");
    if (ph) ph.closest("tr").remove();
    state_default.scanFoundCnt++;
    q("cnt-scan").textContent = state_default.scanFoundCnt + " Ger\xE4t" + (state_default.scanFoundCnt !== 1 ? "e" : "");
    const devType = detectDeviceType(dev.os, dev.sysDescr);
    const scanDev = { os: dev.os, type: devType };
    const filtered = !matchesImportFilter(scanDev);
    const tr = document.createElement("tr");
    if (filtered) tr.style.opacity = "0.4";
    tr.title = filtered ? 'Kein Treffer im Import-Filter \u2013 wird bei \u201EAlle speichern" \xFCbersprungen' : "";
    tr.innerHTML = `
    <td class="mono">${h(dev.ip)}</td>
    <td style="font-weight:600">${h(dev.sysName || dev.lcosLxName || extractModel(dev.sysDescr) || "\u2014")}</td>
    <td><span class="badge ${OS_BADGE[dev.os] || "badge-gray"}">${h(dev.os)}</span></td>
    <td><span class="badge ${TYPE_BADGE[devType] || "badge-gray"}">${h(TYPE_LABELS[devType] || devType)}</span></td>
    <td style="color:var(--text2)">${h(dev.sysLocation || "\u2014")}</td>
    <td class="mono" style="color:var(--text3);font-size:12px">${h(dev.serial || "\u2014")}</td>
    <td class="mono" style="color:var(--text3);font-size:11px">${h((dev.sysDescr || "").split(/[\r\n]/)[0].substring(0, 55))}</td>
    <td><div style="display:flex;gap:6px">
      <button class="btn btn-sm" onclick="openDeviceDetail('${h(dev.ip)}')">Details</button>
      <button class="btn btn-sm btn-ghost" onclick="saveScanDevice('${h(dev.ip)}')">Speichern</button>
      <button class="btn btn-sm btn-ghost" onclick="updateScanDevice('${h(dev.ip)}')">Update</button>
    </div></td>`;
    tbody.appendChild(tr);
  }
  async function saveScanDevice(ip) {
    const dev = state_default.scanResults.find((d) => d.ip === ip);
    if (!dev) return;
    if (state_default.deviceStore[ip]) {
      setScanStatus(`${ip} ist bereits unter Ger\xE4te gespeichert \u2013 nicht \xFCbernommen.`, "error");
      return;
    }
    await _saveDevice(buildScanDeviceEntry(dev));
    setScanStatus(`${dev.sysName || ip} gespeichert.`, "ok");
  }
  async function updateScanDevice(ip) {
    const dev = state_default.scanResults.find((d) => d.ip === ip);
    if (!dev || !dev.serial) {
      setScanStatus(`Kein Update m\xF6glich \u2013 keine Seriennummer f\xFCr ${ip}`, "error");
      return;
    }
    const existing = Object.values(state_default.deviceStore).find((d) => d.serial && d.serial === dev.serial);
    if (!existing) {
      setScanStatus(`Kein bestehendes Ger\xE4t mit Seriennummer ${dev.serial} gefunden`, "error");
      return;
    }
    const newEntry = buildScanDeviceEntry(dev);
    newEntry.location = existing.location || newEntry.location;
    if (existing.ip !== dev.ip) await _deleteDevice(existing.ip);
    await _saveDevice({ ...existing, ...newEntry });
    setScanStatus(`${dev.sysName || ip} aktualisiert.`, "ok");
  }
  async function saveScanResults() {
    if (!state_default.scanResults.length) return;
    const patch = {};
    const skipped = [];
    const filtered = [];
    state_default.scanResults.forEach((dev) => {
      if (state_default.deviceStore[dev.ip]) {
        skipped.push(dev.ip);
        return;
      }
      const devType = detectDeviceType(dev.os, dev.sysDescr);
      if (!matchesImportFilter({ os: dev.os, type: devType })) {
        filtered.push(dev.ip);
        return;
      }
      patch[dev.ip] = buildScanDeviceEntry(dev);
    });
    const n = Object.keys(patch).length;
    if (n) await _saveDevices(patch);
    let msg = n ? `${n} Ger\xE4t${n !== 1 ? "e" : ""} gespeichert` : "Keine neuen Ger\xE4te";
    if (skipped.length) msg += ` \u2013 ${skipped.length} bereits vorhanden`;
    if (filtered.length) msg += ` \u2013 ${filtered.length} durch Import-Filter \xFCbersprungen`;
    setScanStatus(msg, !n ? "error" : "ok");
  }
  async function updateScanDetails() {
    if (!state_default.scanResults.length) return;
    const patch = {};
    const toDelete = [];
    let updated = 0;
    state_default.scanResults.forEach((dev) => {
      if (!dev.serial) return;
      const existing = Object.values(state_default.deviceStore).find((d) => d.serial && d.serial === dev.serial);
      if (!existing) return;
      const newEntry = buildScanDeviceEntry(dev);
      newEntry.location = existing.location || newEntry.location;
      if (existing.ip !== dev.ip) toDelete.push(existing.ip);
      patch[dev.ip] = { ...existing, ...newEntry };
      updated++;
    });
    if (!updated) {
      setScanStatus("Keine \xFCbereinstimmenden Ger\xE4te gefunden (kein Abgleich \xFCber Seriennummer m\xF6glich)", "error");
      return;
    }
    for (const ip of toDelete) {
      if (!patch[ip]) await _deleteDevice(ip);
    }
    await _saveDevices(patch);
    setScanStatus(`${updated} Ger\xE4t${updated !== 1 ? "e" : ""} aktualisiert`, "ok");
  }
  function getScanLocation() {
    const newLoc = (q("scan-loc-new")?.value || "").trim();
    if (newLoc) return newLoc;
    return q("scan-loc-select")?.value || "";
  }
  function buildScanDeviceEntry(dev) {
    const type = detectDeviceType(dev.os, dev.sysDescr);
    return {
      ip: dev.ip,
      name: dev.sysName || dev.lcosLxName || extractModel(dev.sysDescr) || dev.ip,
      model: extractModel(dev.sysDescr) || dev.lcosLxName || "",
      os: dev.os,
      type,
      mac: dev.mac || "",
      serial: dev.serial || "",
      sysDescr: dev.sysDescr,
      sysLocation: dev.sysLocation,
      location: getScanLocation(),
      source: "scanner",
      online: true,
      lastSeen: (/* @__PURE__ */ new Date()).toISOString()
    };
  }

  // ui/tabs/rollout.js
  var rolloutFoundCnt = 0;
  function runWsScan2(type, subnet, onEvent, onError, signal) {
    return new Promise((resolve) => {
      const wsProto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${wsProto}://${location.host}/ws`);
      ws.onopen = () => ws.send(JSON.stringify({ type, subnet }));
      ws.onmessage = ({ data }) => {
        try {
          onEvent(JSON.parse(data));
        } catch {
        }
      };
      ws.onerror = () => onError("WebSocket-Fehler", "error");
      ws.onclose = () => resolve();
      signal.addEventListener("abort", () => {
        ws.close();
        onError("Scan abgebrochen.", "");
        resolve();
      }, { once: true });
    });
  }
  function matchesImportFilter2(dev) {
    const filterOS = state_default.appSettings.filterOS || [];
    const filterType = state_default.appSettings.filterType || [];
    if (!filterOS.length && !filterType.length) return true;
    const devOs = dev.os || "";
    const osOk = !filterOS.length || filterOS.some(
      (f) => f === devOs || devOs === "LCOS SX" && f.startsWith("LCOS SX")
    );
    const devTypeLabel = TYPE_LABELS[dev.type || ""] || dev.type || "";
    const typeOk = !filterType.length || filterType.includes(devTypeLabel);
    return osOk && typeOk;
  }
  function getScanLocation2() {
    const newLoc = (q("scan-loc-new")?.value || "").trim();
    if (newLoc) return newLoc;
    return q("scan-loc-select")?.value || "";
  }
  function buildScanDeviceEntry2(dev) {
    const type = detectDeviceType(dev.os, dev.sysDescr);
    return {
      ip: dev.ip,
      name: dev.sysName || dev.lcosLxName || extractModel(dev.sysDescr) || dev.ip,
      model: extractModel(dev.sysDescr) || dev.lcosLxName || "",
      os: dev.os,
      type,
      mac: dev.mac || "",
      serial: dev.serial || "",
      sysDescr: dev.sysDescr,
      sysLocation: dev.sysLocation,
      location: getScanLocation2(),
      source: "scanner",
      online: true,
      lastSeen: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  function setRolloutStatus(msg, type = "") {
    const el = q("rollout-status");
    el.className = "status-bar" + (type ? " " + type : "");
    el.innerHTML = type === "loading" ? `<span class="spinner"></span> ${msg}` : msg;
  }
  async function startRolloutScan() {
    const subnet = q("rollout-subnet").value.trim();
    if (!subnet) {
      setRolloutStatus("Bitte Subnetz eingeben.", "error");
      return;
    }
    state_default.appSettings.lastRolloutSubnet = subnet;
    fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...state_default.appSettings }) }).catch(() => {
    });
    if (state_default.rolloutScanAbort) {
      state_default.rolloutScanAbort.abort();
      state_default.rolloutScanAbort = null;
    }
    state_default.rolloutScanAbort = new AbortController();
    rolloutFoundCnt = 0;
    q("btn-rollout").disabled = true;
    q("btn-rollout-stop").style.display = "";
    q("tbl-rollout").querySelector("tbody").innerHTML = "";
    q("cnt-rollout").textContent = "";
    q("rollout-found-lbl").textContent = "";
    q("btn-rollout-all").style.display = "none";
    q("rollout-progress-wrap").style.display = "";
    q("rollout-bar").style.width = "0%";
    q("rollout-progress-lbl").textContent = "Suche l\xE4uft\u2026";
    setRolloutStatus("Scan l\xE4uft\u2026", "loading");
    const myAbort = state_default.rolloutScanAbort;
    await runWsScan2("rollout-scan", subnet, handleRolloutEvent, setRolloutStatus, myAbort.signal);
    q("btn-rollout").disabled = false;
    q("btn-rollout-stop").style.display = "none";
    state_default.rolloutScanAbort = null;
  }
  function stopRolloutScan() {
    if (state_default.rolloutScanAbort) {
      state_default.rolloutScanAbort.abort();
      state_default.rolloutScanAbort = null;
    }
  }
  async function rolloutAll() {
    const rows = [...q("tbl-rollout").querySelectorAll("tbody tr[data-ip]")].filter((tr) => tr.querySelector("button.btn"));
    if (!rows.length) return;
    const btn = q("btn-rollout-all");
    btn.disabled = true;
    btn.textContent = `\u23F3 0/${rows.length} fertig`;
    let done = 0;
    await Promise.all(rows.map(async (tr) => {
      const ip = tr.dataset.ip;
      const os = tr.dataset.os;
      const mac = tr.dataset.mac;
      const rowBtn = tr.querySelector("button.btn");
      if (!rowBtn) return;
      await rolloutSetPassword(ip, os, mac, rowBtn);
      done++;
      btn.textContent = `\u23F3 ${done}/${rows.length} fertig`;
    }));
    btn.disabled = false;
    btn.textContent = "\u25B6 Alle";
  }
  function handleRolloutEvent(ev) {
    if (ev.type === "found") {
      appendRolloutRow(ev.device);
      q("rollout-found-lbl").textContent = rolloutFoundCnt + " gefunden";
    } else if (ev.type === "progress") {
      q("rollout-progress-lbl").textContent = `Suche l\xE4uft\u2026 ${ev.scanned} / ${ev.total} IPs gepr\xFCft`;
      q("rollout-bar").style.width = Math.round(ev.scanned / ev.total * 100) + "%";
    } else if (ev.type === "done") {
      q("rollout-bar").style.width = "100%";
      q("rollout-progress-lbl").textContent = "Scan abgeschlossen";
      setRolloutStatus(
        rolloutFoundCnt > 0 ? `Scan abgeschlossen \u2014 ${rolloutFoundCnt} LANCOM-Ger\xE4t${rolloutFoundCnt !== 1 ? "e" : ""} gefunden` : "Scan abgeschlossen \u2014 keine LANCOM-Ger\xE4te gefunden",
        rolloutFoundCnt > 0 ? "ok" : ""
      );
      if (rolloutFoundCnt === 0) {
        q("tbl-rollout").querySelector("tbody").innerHTML = `<tr><td colspan="6" class="empty">Keine LANCOM-Ger\xE4te gefunden</td></tr>`;
      }
    }
  }
  function appendRolloutRow(dev) {
    const tbody = q("tbl-rollout").querySelector("tbody");
    const ph = tbody.querySelector("td[colspan]");
    if (ph) ph.closest("tr").remove();
    rolloutFoundCnt++;
    q("cnt-rollout").textContent = rolloutFoundCnt + " Ger\xE4t" + (rolloutFoundCnt !== 1 ? "e" : "");
    const normMac2 = (m) => (m || "").replace(/[:\-\. ]/g, "").toLowerCase();
    const mac = normMac2(dev.mac);
    const knownDev = Object.values(state_default.deviceStore).find(
      (d) => d.ip === dev.ip || mac && normMac2(d.mac) === mac
    );
    const known = !!knownDev;
    const rowId = "rrow-" + dev.ip.replace(/\./g, "-");
    const tr = document.createElement("tr");
    tr.id = rowId;
    tr.dataset.ip = dev.ip;
    tr.dataset.os = dev.os || "";
    tr.dataset.mac = dev.mac || "";
    if (known) tr.style.cssText = "background:rgba(34,197,94,.07)";
    if (!known) q("btn-rollout-all").style.display = "";
    tr.innerHTML = `
    <td style="font-family:var(--mono);font-size:12px">
      ${h(dev.ip)}
      ${known ? `<span style="font-size:9px;background:rgba(34,197,94,.15);color:#22c55e;border-radius:3px;padding:1px 5px;margin-left:5px" title="${h(knownDev.name || dev.ip)}">\u2713 bekannt</span>` : ""}
    </td>
    <td style="font-family:var(--mono);font-size:12px;color:var(--accent)">${h(dev.mac)}</td>
    <td style="font-size:12px;color:var(--text2)">${h(dev.vendor || "LANCOM Systems")}</td>
    <td style="font-size:12px;color:var(--text3)">${h(dev.hostname || "\u2013")}</td>
    <td>${dev.os ? `<span class="badge ${OS_BADGE[dev.os] || "badge-gray"}">${h(dev.os)}</span>` : '<span style="font-size:11px;color:var(--text3)">\u2013</span>'}</td>
    <td>
      ${!known ? `<button class="btn btn-sm" onclick="rolloutSetPassword('${dev.ip}', '${h(dev.os || "")}', '${h(dev.mac || "")}', this)" style="white-space:nowrap">Rollout</button>` : ""}
    </td>`;
    tbody.appendChild(tr);
  }
  async function rolloutSetPassword(ip, os, mac, btn) {
    if (!state_default.appSettings.devicePassword) {
      alert("Kein Ger\xE4tepasswort in den Einstellungen gespeichert.");
      return;
    }
    const statusEl = btn.parentElement;
    btn.disabled = true;
    btn.textContent = "\u23F3";
    try {
      const r = await fetch("/api/rollout/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip, os, mac })
      });
      const d = await r.json();
      const logHtml = d.log ? `<details style="margin-top:4px"><summary style="font-size:10px;color:var(--text3);cursor:pointer">Log</summary><pre style="font-size:10px;font-family:var(--mono);color:var(--text2);white-space:pre-wrap;margin:4px 0 0;padding:6px;background:var(--bg2);border-radius:4px">${h(d.log)}</pre></details>` : "";
      let scriptHtml = "";
      if (d.scriptResults && d.scriptResults.length) {
        const r0 = d.scriptResults[0];
        const cmdCount = r0?.combined ? r0.commands.length : d.scriptResults.length;
        if (cmdCount > 0) {
          const raw = window.renderScriptOutputHtml?.(d.scriptResults, ip);
          const body = raw ? raw.replace(/^<pre[^>]*>/, "").replace(/<\/pre>$/, "") : "";
          scriptHtml = `<details open style="margin-top:4px"><summary style="font-size:10px;color:var(--accent);cursor:pointer;font-weight:600">ROLLOUT-Script Ausgabe</summary><pre style="font-size:10px;font-family:var(--mono);color:var(--text1);white-space:pre-wrap;margin:4px 0 0;padding:6px;background:var(--bg2);border-radius:4px">${body}</pre></details>`;
        }
      }
      if (d.ok) {
        let savedOk = false;
        if (d.snmpDevice) {
          const entry = buildScanDeviceEntry2(d.snmpDevice);
          await window.saveDevice?.(entry);
          await window.loadDevices?.();
          window.renderDevices?.();
          savedOk = true;
        }
        const savedBadge = savedOk ? ` <span style="font-size:10px;background:rgba(34,197,94,.15);color:#22c55e;border-radius:3px;padding:1px 5px">\u2713 in Ger\xE4teliste</span>` : "";
        statusEl.innerHTML = (d.alreadySet ? `<span style="color:var(--green);font-size:11px">\u2713 Passwort bereits gesetzt (${h(d.user)})</span>` : `<span style="color:var(--green);font-size:11px">\u2713 Passwort gesetzt (${h(d.user)})</span>`) + savedBadge + scriptHtml + logHtml;
      } else {
        statusEl.innerHTML = `<span style="color:var(--red);font-size:11px">\u2717 ${h(d.error || "Fehlgeschlagen")}</span>` + logHtml;
      }
    } catch (e) {
      statusEl.innerHTML = `<span style="color:var(--red);font-size:11px">\u2717 ${h(e.message)}</span>`;
    }
  }
  function setLmcStatus(msg, type = "") {
    const connectCard = q("lmc-connect-card");
    const elId = connectCard && connectCard.style.display !== "none" ? "lmc-connect-status" : "lmc-status";
    const el = q(elId) || q("lmc-status");
    if (!el) return;
    el.className = "status-bar" + (type ? " " + type : "");
    el.innerHTML = type === "loading" ? `<span class="spinner"></span> ${msg}` : msg;
  }
  function lmcGetToken() {
    return q("lmc-token").value.trim();
  }
  function lmcGetHost() {
    const el = q("lmc-host");
    return (el ? el.value.trim() : "") || "cloud.lancom.de";
  }
  function lmcToggleSave() {
    if (q("lmc-save-token").checked) localStorage.setItem("lmc_token", lmcGetToken());
    else localStorage.removeItem("lmc_token");
  }
  async function lmcCall(service, apiPath, method = "GET", body = null) {
    const token = lmcGetToken();
    if (!token) throw new Error("Kein API Token eingegeben");
    const host = lmcGetHost();
    const r = await fetch("/api/lmc", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ service, path: apiPath, method, token, body, host }) });
    if (r.status === 204) return {};
    let d;
    try {
      const t = await r.text();
      d = t ? JSON.parse(t) : {};
    } catch {
      throw new Error(`Server-Antwort ist kein g\xFCltiges JSON (HTTP ${r.status}) \u2013 pr\xFCfe API Token`);
    }
    if (!r.ok || d.error) {
      const detail = d.fieldErrors?.length ? " \u2192 " + d.fieldErrors.map((e) => `${e.field}: ${e.message} (Wert: "${e.rejectedValue}")`).join(", ") : "";
      throw new Error((d.message || d.error || `HTTP ${r.status}`) + detail);
    }
    return d;
  }
  async function lmcTest() {
    if (!lmcGetToken()) {
      setLmcStatus("Bitte API Token eingeben.", "error");
      return;
    }
    setLmcStatus("Verbindung wird getestet\u2026", "loading");
    try {
      state_default.appSettings.lmcHost = lmcGetHost();
      fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(state_default.appSettings) }).catch(() => {
      });
    } catch (_) {
    }
    try {
      const accounts = await lmcCall("auth", "/accounts");
      const list = Array.isArray(accounts) ? accounts : accounts?.accounts || accounts?.content || [];
      if (!list.length) throw new Error("Keine Accounts gefunden");
      const sel = q("lmc-account-select");
      sel.innerHTML = '<option value="">\u2013 bitte w\xE4hlen \u2013</option>';
      list.forEach((a) => {
        const name = a.name || a.identifier || a.id;
        const opt = document.createElement("option");
        opt.value = a.id || a.identifier;
        opt.textContent = name;
        sel.appendChild(opt);
      });
      if (list.length === 1) {
        sel.value = list[0].id || list[0].identifier;
        lmcActivate(list[0].name || list[0].identifier || list[0].id);
      }
      q("lmc-project-card").style.display = "";
      setLmcStatus(`Verbindung erfolgreich \u2013 ${list.length} Account${list.length !== 1 ? "s" : ""} gefunden`, "ok");
      if (q("lmc-save-token").checked) localStorage.setItem("lmc_token", lmcGetToken());
    } catch (err) {
      setLmcStatus("Fehler: " + err.message, "error");
    }
  }
  q("lmc-account-select")?.addEventListener("change", (e) => {
    if (e.target.value) {
      const sel = q("lmc-account-select");
      lmcActivate(sel.options[sel.selectedIndex].textContent);
    } else {
      q("lmc-tabs-wrap").style.display = "none";
    }
  });
  function lmcActivate(projectName) {
    q("lmc-conn-text").textContent = `Verbunden \xB7 Projekt: ${projectName}`;
    q("lmc-conn-bar").style.display = "flex";
    q("lmc-connect-card").style.display = "none";
    q("lmc-project-card").style.display = "none";
    q("lmc-tabs-wrap").style.display = "";
  }
  function lmcDisconnect() {
    q("lmc-conn-bar").style.display = "none";
    q("lmc-connect-card").style.display = "";
    q("lmc-project-card").style.display = "none";
    q("lmc-tabs-wrap").style.display = "none";
    q("lmc-account-select").innerHTML = '<option value="">\u2013 bitte w\xE4hlen \u2013</option>';
    q("lmc-result-wrap").style.display = "none";
    setLmcStatus("", "");
  }
  function showLmcTab(name) {
    ["sync", "addins", "vars", "activation"].forEach((t) => {
      q("lmctab-" + t)?.classList.toggle("active", t === name);
      q("lmcpanel-" + t)?.classList.toggle("active", t === name);
    });
    if (name === "addins") window.loadAddins?.();
    if (name === "vars") {
      window.renderGlobalVarsList?.();
      window.fetchGlobalVars?.().then(() => window.renderGlobalVarsList?.());
    }
    if (name === "activation") window.loadActivationTokens?.();
  }
  var lmcResults = [];
  var lmcOnline = {};
  async function lmcSync() {
    const accountId = q("lmc-account-select").value;
    if (!accountId) {
      setLmcStatus("Bitte Projekt ausw\xE4hlen.", "error");
      return;
    }
    setLmcStatus("Ger\xE4te werden abgerufen\u2026", "loading");
    try {
      const resp = await lmcCall("devices", `/accounts/${accountId}/devices`);
      const devs = Array.isArray(resp) ? resp : resp?.devices || resp?.content || [];
      lmcResults = [];
      lmcOnline = {};
      devs.forEach((d) => {
        const ip = d.status?.ip || d.status?.ipAddress || d.ipAddress || "";
        if (!ip) return;
        const name = d.name || d.label || d.status?.deviceLabel || d.status?.name || ip;
        const model = d.status?.model || d.model || "";
        const fwLabel = (d.status?.fwLabel || d.fwLabel || "").toUpperCase();
        const devType = (d.status?.type || d.type || "").toUpperCase();
        const modelUp = model.toUpperCase();
        const nameUp = (name || "").toUpperCase();
        const blob = [fwLabel, modelUp, nameUp].filter(Boolean).join(" \xB7 ");
        let os = detectOsFromCriteriaForLmc(blob) || detectOsFromCriteriaForLmc(modelUp);
        if (!os) {
          if (devType === "SWITCH" || devType.includes("SWITCH")) {
            const v = fwLabel.match(/\b([3-9])\.\d{2}/)?.[1];
            os = v ? `LCOS SX ${v}` : "LCOS SX 4";
          } else if (devType === "FIREWALL" || devType === "UTM") os = "LCOS FX";
          else if (devType.includes("ACCESS") || devType === "AP" || devType.includes("WLAN") || devType.includes("WIFI")) {
            os = modelUp.includes("LINUX") || fwLabel.includes("LCOS LX") ? "LCOS LX" : "LCOS";
          } else os = "LCOS";
        }
        const type = inferLmcDeviceType(os, model, devType);
        const mac = (d.status?.mac || d.status?.ethMac || d.mac || "").toLowerCase();
        const serial = d.status?.serial || d.status?.serialNumber || d.status?.serialNum || d.serial || d.serialNumber || "";
        const location2 = d.siteName || d.location?.name || d.locationName || d.site?.name || d.status?.location?.name || d.status?.locationName || d.status?.location || "";
        const isOn = d.heartbeatState?.toUpperCase() === "ACTIVE" || d.status?.heartbeatState?.toUpperCase() === "ACTIVE";
        lmcOnline[ip] = isOn;
        lmcResults.push({ ip, name, model, os, type, mac, serial, location: location2, source: "lmc", lmcId: d.id || "", lastSeen: (/* @__PURE__ */ new Date()).toISOString() });
      });
      renderLmcTable();
    } catch (err) {
      setLmcStatus("Fehler: " + err.message, "error");
    }
  }
  function renderLmcTable() {
    const newDevs = lmcResults.filter((d) => !state_default.deviceStore[d.ip] && matchesImportFilter2(d));
    const total = lmcResults.length;
    let msg = `${total} Ger\xE4t${total !== 1 ? "e" : ""} gefunden`;
    const skippedN = lmcResults.filter((d) => state_default.deviceStore[d.ip]).length;
    const filteredN = lmcResults.filter((d) => !state_default.deviceStore[d.ip] && !matchesImportFilter2(d)).length;
    if (skippedN) msg += ` \u2013 ${skippedN} bereits vorhanden`;
    if (filteredN) msg += ` \u2013 ${filteredN} durch Import-Filter \xFCbersprungen`;
    setLmcStatus(msg, total ? "ok" : "");
    q("lmc-result-wrap").style.display = "";
    q("cnt-lmc").textContent = total + " Ger\xE4t" + (total !== 1 ? "e" : "");
    const hasNew = newDevs.length > 0;
    q("btn-lmc-save-all").style.display = hasNew ? "" : "none";
    q("sep-lmc-save").style.display = hasNew ? "" : "none";
    if (hasNew) q("btn-lmc-save-all").textContent = `Alle ${newDevs.length} speichern`;
    const tbody = q("tbl-lmc").querySelector("tbody");
    tbody.innerHTML = lmcResults.map((dev) => {
      const isSkipped = !!state_default.deviceStore[dev.ip];
      const isFiltered = !isSkipped && !matchesImportFilter2(dev);
      const isNew = !isSkipped && !isFiltered;
      const rowStyle = isFiltered ? ' style="opacity:0.4"' : "";
      const rowTitle = isFiltered ? ' title="Kein Treffer im Import-Filter"' : "";
      const typCls = TYPE_BADGE[dev.type] || "badge-gray";
      const typLbl = TYPE_LABELS[dev.type] || "\u2014";
      const isOn = lmcOnline[dev.ip];
      const action = isSkipped ? '<span class="badge badge-yellow">Vorhanden</span>' : isFiltered ? '<span class="badge badge-gray">Gefiltert</span>' : `<button class="btn btn-sm btn-ghost" id="lmc-save-${h(dev.ip)}" onclick="saveLmcDevice('${h(dev.ip)}')">Speichern</button>`;
      return `<tr${rowStyle}${rowTitle}>
      <td style="font-weight:600">${h(dev.name)}</td>
      <td class="mono">${h(dev.ip)}</td>
      <td style="font-size:12px;color:var(--text2)">${h(dev.model || "\u2014")}</td>
      <td class="mono" style="font-size:12px;color:var(--text3)">${h(dev.serial || "\u2014")}</td>
      <td><span class="badge ${OS_BADGE[dev.os] || "badge-gray"}">${h(dev.os || "\u2014")}</span></td>
      <td><span class="badge ${typCls}">${typLbl}</span></td>
      <td style="font-size:12px;color:var(--text2)">${h(dev.location || "\u2014")}</td>
      <td><span class="dot ${isOn ? "dot-green" : "dot-red"}"></span>${isOn ? "Online" : "Offline"}</td>
      <td>${action}</td>
    </tr>`;
    }).join("");
  }
  async function saveLmcDevice(ip) {
    const dev = lmcResults.find((d) => d.ip === ip);
    if (!dev) return;
    if (state_default.deviceStore[ip]) {
      setLmcStatus(`${ip} bereits vorhanden.`, "error");
      return;
    }
    await window.saveDevice?.(dev);
    setLmcStatus(`${dev.name || ip} gespeichert.`, "ok");
    renderLmcTable();
  }
  async function saveLmcResults() {
    const patch = {};
    lmcResults.forEach((dev) => {
      if (!state_default.deviceStore[dev.ip] && matchesImportFilter2(dev)) patch[dev.ip] = dev;
    });
    const n = Object.keys(patch).length;
    if (!n) return;
    await window.saveDevices?.(patch);
    const msg = `${n} Ger\xE4t${n !== 1 ? "e" : ""} gespeichert.`;
    setLmcStatus(msg, "ok");
    renderLmcTable();
  }

  // ui/tabs/lmc.js
  function setActivationStatus(msg, ok) {
    const el = q("activation-status");
    el.style.color = ok ? "var(--green)" : "var(--red)";
    el.textContent = msg;
    if (msg) setTimeout(() => {
      if (el.textContent === msg) el.textContent = "";
    }, 4e3);
  }
  async function loadActivationTokens() {
    const accountId = q("lmc-account-select").value;
    if (!accountId) return;
    q("activation-list").innerHTML = '<span style="font-size:12px;color:var(--text3)">L\xE4dt\u2026</span>';
    try {
      const list = await lmcCall("devices", `/accounts/${accountId}/pairings`);
      renderActivationTokens(Array.isArray(list) ? list : []);
    } catch (e) {
      q("activation-list").innerHTML = `<span style="font-size:12px;color:var(--red)">Fehler: ${h(e.message)}</span>`;
    }
  }
  function renderActivationTokens(tokens) {
    const el = q("activation-list");
    if (!tokens.length) {
      el.innerHTML = '<span style="font-size:12px;color:var(--text3)">Keine aktiven Activation Keys vorhanden.</span>';
      return;
    }
    el.innerHTML = "";
    tokens.forEach((t) => {
      const exp = t.expiration ? new Date(t.expiration) : null;
      const expStr = exp ? exp.toLocaleString("de-DE") : "\u2013";
      const expired = exp && exp < /* @__PURE__ */ new Date();
      const card = document.createElement("div");
      card.style.cssText = "display:flex;align-items:center;gap:12px;padding:12px 14px;background:var(--card);border:1px solid var(--border);border-radius:6px;flex-wrap:wrap";
      card.innerHTML = `
      <div style="flex:1;min-width:0">
        <div style="font-family:var(--mono);font-size:13px;color:var(--accent);word-break:break-all;margin-bottom:4px">${h(t.token)}</div>
        <div style="font-size:11px;color:${expired ? "var(--red)" : "var(--text3)"}">
          G\xFCltig bis: ${expStr}${expired ? " (abgelaufen)" : ""}
        </div>
      </div>
      <button class="btn btn-sm btn-ghost" onclick="navigator.clipboard.writeText('${h(t.token)}').then(()=>setActivationStatus('\u2713 Kopiert','ok'))" title="Kopieren">\u{1F4CB}</button>
      <button class="btn btn-sm btn-ghost" style="color:var(--red)" onclick="activationDelete('${h(t.token)}')">L\xF6schen</button>`;
      el.appendChild(card);
    });
  }
  async function activationCreate() {
    const accountId = q("lmc-account-select").value;
    if (!accountId) {
      setActivationStatus("Kein Projekt ausgew\xE4hlt", false);
      return;
    }
    const validity = parseInt(q("activation-validity").value);
    try {
      setActivationStatus("Wird erstellt\u2026", true);
      await lmcCall("devices", `/accounts/${accountId}/pairings`, "POST", { validity });
      setActivationStatus("\u2713 Erstellt", true);
      await loadActivationTokens();
    } catch (e) {
      setActivationStatus("Fehler: " + e.message, false);
    }
  }
  async function activationDelete(token) {
    const accountId = q("lmc-account-select").value;
    if (!accountId) return;
    if (!confirm("Activation Key l\xF6schen?")) return;
    try {
      await lmcCall("devices", `/accounts/${accountId}/pairings/${encodeURIComponent(token)}`, "DELETE");
      setActivationStatus("\u2713 Gel\xF6scht", true);
      await loadActivationTokens();
    } catch (e) {
      setActivationStatus("Fehler: " + e.message, false);
    }
  }

  // ui/tabs/addins.js
  var addinList = [];
  var addinStatus = {};
  var addinSortCol = "name";
  var addinSortDir = 1;
  var addinFilterOs = "";
  var addinSearch = "";
  function setAddinFilterOs(os) {
    addinFilterOs = os;
    const btnToOs = { "Alle": "", "LCOS LX": "LCOS LX", "SX 3": "LCOS SX 3", "SX 4": "LCOS SX 4", "SX 5": "LCOS SX 5", "FX": "LCOS FX" };
    document.querySelectorAll(".addin-os-btn").forEach((b) => {
      const val = b.textContent in btnToOs ? btnToOs[b.textContent] : b.textContent;
      b.classList.toggle("active", val === os);
    });
    renderAddinList();
  }
  function setAddinSearch(val) {
    addinSearch = val.toLowerCase();
    renderAddinList();
  }
  function setAddinSortCol(col) {
    if (addinSortCol === col) addinSortDir *= -1;
    else {
      addinSortCol = col;
      addinSortDir = 1;
    }
    renderAddinList();
  }
  var OS_BADGE_LMC = {
    "LCOS": "badge-blue",
    "LCOS LX": "badge-green",
    "LCOS SX 3": "badge-yellow",
    "LCOS SX 4": "badge-yellow",
    "LCOS SX 5": "badge-yellow",
    "LCOS FX": "badge-orange"
  };
  async function loadAddins() {
    const wrap = q("addins-list");
    if (!wrap) return;
    wrap.innerHTML = '<div class="empty"><span class="spinner"></span> Add-ins werden geladen\u2026</div>';
    try {
      const list = await fetch("/api/addins").then((r) => r.json());
      addinList = list;
      renderAddinList();
    } catch (e) {
      wrap.innerHTML = `<div class="empty" style="color:var(--red)">Fehler: ${h(e.message)}</div>`;
    }
  }
  function renderAddinList() {
    const wrap = q("addins-list");
    if (!addinList.length) {
      wrap.innerHTML = '<div class="empty">Keine Add-ins gefunden \u2013 lege JSON-Dateien im Ordner <code>addins/&lt;OS&gt;/</code> an</div>';
      return;
    }
    let rows = addinList.map((a, i) => ({ a, i }));
    if (addinFilterOs) rows = rows.filter((r) => r.a.os === addinFilterOs);
    if (addinSearch) rows = rows.filter(
      (r) => (r.a.name || "").toLowerCase().includes(addinSearch) || (r.a.description || "").toLowerCase().includes(addinSearch) || (r.a.os || "").toLowerCase().includes(addinSearch)
    );
    const keyFn = (r) => {
      if (addinSortCol === "os") return r.a.os || "";
      if (addinSortCol === "desc") return r.a.description || "";
      return r.a.name || "";
    };
    rows.sort((a, b) => addinSortDir * keyFn(a).localeCompare(keyFn(b)));
    const arw = (col) => addinSortCol === col ? addinSortDir === 1 ? " \u25B2" : " \u25BC" : " \u21C5";
    const th = (col, label) => `<th style="cursor:pointer;user-select:none;white-space:nowrap" onclick="setAddinSortCol('${col}')">${label}<span style="opacity:.5;font-size:10px">${arw(col)}</span></th>`;
    wrap.innerHTML = `
    <table>
      <thead><tr>
        ${th("os", "Betriebssystem")}
        ${th("name", "Name")}
        ${th("desc", "Beschreibung")}
        <th>Status</th><th></th>
      </tr></thead>
      <tbody>
        ${rows.length ? rows.map(({ a, i }) => {
      const key = `${a.os}/${a.filename}`;
      const st = addinStatus[key] || "idle";
      const stCell = st === "uploading" ? '<span class="spinner"></span>' : st === "ok" ? '<span style="color:var(--green)">\u2713 Hochgeladen</span>' : st.startsWith("err") ? `<span style="color:var(--red);font-size:11px" title="${h(st.slice(4))}">\u2717 ${h(st.slice(4)).slice(0, 40)}</span>` : "";
      return `<tr>
            <td><span class="badge ${OS_BADGE_LMC[a.os] || "badge-gray"}">${h(a.os)}</span></td>
            <td style="font-weight:600">${h(a.name)}</td>
            <td style="font-size:12px;color:var(--text2)">${h(a.description || "\u2014")}</td>
            <td id="addin-st-${i}" style="font-size:12px;min-width:100px">${stCell}</td>
            <td><div style="display:flex;gap:6px">
              <button class="btn btn-sm btn-ghost" onclick="openAddinEditor(${i})">Bearbeiten</button>
              <button class="btn btn-sm btn-ghost" onclick="uploadAddin(${i})">Hochladen</button>
              <button class="btn btn-sm btn-ghost" style="color:var(--red)" onclick="deleteAddin(${i})">L\xF6schen</button>
            </div></td>
          </tr>`;
    }).join("") : `<tr><td colspan="5" style="text-align:center;color:var(--text3);padding:24px">Keine Treffer</td></tr>`}
      </tbody>
    </table>`;
  }
  function setAddinStatus(index, status) {
    const a = addinList[index];
    if (!a) return;
    const key = `${a.os}/${a.filename}`;
    addinStatus[key] = status;
    const cell = q(`addin-st-${index}`);
    if (!cell) return;
    cell.innerHTML = status === "uploading" ? '<span class="spinner"></span>' : status === "ok" ? '<span style="color:var(--green)">\u2713 Hochgeladen</span>' : status.startsWith("err") ? `<span style="color:var(--red);font-size:11px" title="${h(status.slice(4))}">\u2717 ${h(status.slice(4)).slice(0, 40)}</span>` : "";
  }
  async function uploadAddin(index) {
    const a = addinList[index];
    if (!a) return;
    const accountId = q("lmc-account-select").value;
    if (!accountId) {
      alert("Kein Projekt ausgew\xE4hlt.");
      return;
    }
    setAddinStatus(index, "uploading");
    try {
      const safeName = (a.name || "addin").replace(/[^a-zA-Z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "addin";
      let appId;
      try {
        const list = await window.lmcCall?.("configapplication", `/configapplication/accounts/${accountId}/applications`);
        const apps = list.content || list.data || (Array.isArray(list) ? list : []);
        const found = apps.find((x) => x.name === safeName);
        if (found) appId = found.id || found.applicationId || found.identifier;
      } catch {
      }
      if (!appId) {
        const created = await window.lmcCall?.(
          "configapplication",
          `/configapplication/accounts/${accountId}/applications`,
          "POST",
          { name: safeName, comment: a.description || "" }
        );
        appId = created.id || created.applicationId || created.identifier;
        if (!appId) throw new Error("Keine App-ID in der Antwort: " + JSON.stringify(created).slice(0, 120));
      }
      await window.lmcCall?.(
        "configapplication",
        `/configapplication/accounts/${accountId}/applications/${appId}/script`,
        "POST",
        {
          content: a.script || "",
          lcos: !!a.lcos,
          lcosLx: !!a.lcosLx,
          swos: !!a.swos,
          lcosSxSdk4: !!a.lcosSxSdk4,
          lcosSxXs: !!a.lcosSxXs,
          lcosFx: !!a.lcosFx
        }
      );
      const usedVars = extractAddinVars(a.script || "");
      if (usedVars.size > 0) {
        const globals = varsAsDict();
        let cloudByName = {};
        try {
          const existing = await window.lmcCall?.("configvariable", `/configvariable/accounts/${accountId}/variables`);
          const cloudList = existing.content || existing.data || (Array.isArray(existing) ? existing : []);
          cloudList.forEach((v) => {
            cloudByName[v.name] = v;
          });
        } catch {
        }
        for (const [key, scriptDefault] of usedVars) {
          const val = key in globals ? globals[key] : scriptDefault;
          if (val === "" && !(key in globals)) continue;
          try {
            if (cloudByName[key]) {
              await window.lmcCall?.("configvariable", `/configvariable/accounts/${accountId}/variables/${cloudByName[key].id}`, "PUT", { value: String(val) });
            } else {
              await window.lmcCall?.("configvariable", `/configvariable/accounts/${accountId}/variables`, "POST", { name: key, value: String(val) });
            }
          } catch {
          }
        }
      }
      setAddinStatus(index, "ok");
    } catch (e) {
      setAddinStatus(index, "err:" + e.message);
      throw e;
    }
  }
  var addinEditorIndex = null;
  var addinIsNew = false;
  function createAddin() {
    addinEditorIndex = null;
    addinIsNew = true;
    q("addin-modal-title").textContent = "Neues Add-in erstellen";
    q("edit-filepath").textContent = "\u2014 wird beim Speichern angelegt \u2014";
    q("edit-name").value = "";
    q("edit-desc").value = "";
    document.querySelectorAll('input[name="ef-os"]').forEach((r, i) => {
      r.checked = i === 0;
    });
    q("edit-script").value = "exports.main = function (config, context) {\n    // Dein Code hier\n};";
    q("addin-editor-status").textContent = "";
    renderAddinVars("");
    renderVarsPicker();
    q("addin-modal").style.display = "flex";
    setTimeout(() => q("edit-name").focus(), 50);
  }
  function openAddinEditor(index) {
    const a = addinList[index];
    if (!a) return;
    addinEditorIndex = index;
    addinIsNew = false;
    q("addin-modal-title").textContent = `Add-in bearbeiten: ${a.name}`;
    q("edit-filepath").textContent = `addins/${a.os}/${a.filename}`;
    q("edit-name").value = a.name || "";
    q("edit-desc").value = a.description || "";
    document.querySelectorAll('input[name="ef-os"]').forEach((r) => {
      r.checked = r.value === a.os;
    });
    q("edit-script").value = a.script || "";
    q("addin-editor-status").textContent = "";
    renderAddinVars(a.script || "");
    renderVarsPicker();
    q("addin-modal").style.display = "flex";
    setTimeout(() => q("edit-script").focus(), 50);
  }
  function closeAddinEditor() {
    q("addin-modal").style.display = "none";
    addinEditorIndex = null;
    addinIsNew = false;
  }
  function extractAddinVars(script) {
    const found = /* @__PURE__ */ new Map();
    const re = /context\.vars\.([A-Za-z_][A-Za-z0-9_]*)/g;
    let m;
    while ((m = re.exec(script)) !== null) {
      const key = m[1];
      if (found.has(key)) continue;
      const after = script.slice(m.index + m[0].length);
      const defMatch = after.match(/^\s*\|\|\s*['"]([^'"]*)['"]/);
      found.set(key, defMatch ? defMatch[1] : "");
    }
    return found;
  }
  function renderAddinVars(script) {
    const vars = extractAddinVars(script);
    const globals = varsAsDict();
    const section = q("edit-vars-section");
    const list = q("edit-vars-list");
    if (vars.size === 0) {
      section.style.display = "none";
      return;
    }
    section.style.display = "";
    list.innerHTML = "";
    vars.forEach((scriptDefault, key) => {
      const isGlobal = key in globals;
      const val = isGlobal ? globals[key] : scriptDefault;
      const row = document.createElement("div");
      row.style.cssText = "display:flex;flex-direction:column;gap:3px";
      const badge = isGlobal ? `<span style="font-size:9px;background:rgba(34,197,94,.15);color:#22c55e;border-radius:3px;padding:0 4px;margin-left:4px">global</span>` : "";
      row.innerHTML = `
      <span style="font-family:var(--mono);font-size:10px;color:var(--accent);word-break:break-all">${h(key)}${badge}</span>
      <span style="font-family:var(--mono);font-size:11px;color:var(--text2);padding:3px 0">${val !== "" ? h(val) : '<span style="color:var(--text3);font-style:italic">\u2013</span>'}</span>`;
      list.appendChild(row);
    });
  }
  var _globalVarsCache = null;
  async function fetchGlobalVars() {
    try {
      const r = await fetch("/api/vars");
      _globalVarsCache = await r.json();
    } catch {
      _globalVarsCache = [];
    }
  }
  function _migrateVars(raw) {
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === "object") {
      return Object.entries(raw).map(([name, value]) => ({ name, label: "", type: "STRING", restricted: false, value: String(value) }));
    }
    return [];
  }
  function loadGlobalVars() {
    return _migrateVars(_globalVarsCache);
  }
  function varsAsDict() {
    return Object.fromEntries(loadGlobalVars().map((v) => [v.name, v.value ?? ""]));
  }
  function saveGlobalVars(arr) {
    _globalVarsCache = arr;
    fetch("/api/vars", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(arr) });
  }
  function saveGlobalVarsManual() {
    saveGlobalVars(_collectGlobalVars());
    const lbl = q("vars-save-lbl");
    if (!lbl) return;
    lbl.style.display = "inline";
    setTimeout(() => {
      lbl.style.display = "none";
    }, 2e3);
  }
  async function syncVarsToCloud() {
    const accountId = q("lmc-account-select").value;
    if (!accountId) {
      alert("Kein Cloud-Projekt ausgew\xE4hlt. Bitte zuerst mit der LMC verbinden.");
      return;
    }
    const local = loadGlobalVars();
    const btn = q("btn-vars-sync");
    btn.textContent = "Sync l\xE4uft\u2026";
    btn.disabled = true;
    try {
      const existing = await window.lmcCall?.("configvariable", `/configvariable/accounts/${accountId}/variables`);
      const cloudList = existing.content || existing.data || (Array.isArray(existing) ? existing : []);
      const cloudByName = {};
      cloudList.forEach((v) => {
        cloudByName[v.name] = v;
      });
      const localNames = new Set(local.map((v) => v.name));
      let created = 0, updated = 0, deleted = 0, errors = 0;
      for (const v of local) {
        const payload = {
          name: v.name,
          label: v.label || void 0,
          type: v.type || "STRING",
          restricted: !!v.restricted,
          value: String(v.value ?? "")
        };
        try {
          if (cloudByName[v.name]) {
            await window.lmcCall?.("configvariable", `/configvariable/accounts/${accountId}/variables/${cloudByName[v.name].id}`, "PUT", payload);
            updated++;
          } else {
            await window.lmcCall?.("configvariable", `/configvariable/accounts/${accountId}/variables`, "POST", payload);
            created++;
          }
        } catch {
          errors++;
        }
      }
      for (const cv of cloudList) {
        if (cv.system) continue;
        if (!localNames.has(cv.name)) {
          try {
            await window.lmcCall?.("configvariable", `/configvariable/accounts/${accountId}/variables/${cv.id}`, "DELETE");
            deleted++;
          } catch {
            errors++;
          }
        }
      }
      const parts = [];
      if (created) parts.push(`${created} erstellt`);
      if (updated) parts.push(`${updated} aktualisiert`);
      if (deleted) parts.push(`${deleted} gel\xF6scht`);
      if (errors) parts.push(`${errors} Fehler`);
      btn.textContent = `\u2713 ${parts.join(", ") || "keine \xC4nderungen"}`;
      btn.style.background = errors ? "var(--orange)" : "var(--green)";
      setTimeout(() => {
        btn.textContent = "Sync to Cloud";
        btn.style.background = "";
        btn.disabled = false;
      }, 3e3);
    } catch (err) {
      btn.textContent = "Fehler: " + err.message.slice(0, 40);
      btn.style.background = "var(--red)";
      setTimeout(() => {
        btn.textContent = "Sync to Cloud";
        btn.style.background = "";
        btn.disabled = false;
      }, 4e3);
    }
  }
  async function loadVarsFromCloud() {
    const accountId = q("lmc-account-select").value;
    if (!accountId) {
      alert("Kein Cloud-Projekt ausgew\xE4hlt. Bitte zuerst mit der LMC verbinden.");
      return;
    }
    try {
      const existing = await window.lmcCall?.("configvariable", `/configvariable/accounts/${accountId}/variables`);
      const cloudList = existing.content || existing.data || (Array.isArray(existing) ? existing : []);
      if (!cloudList.length) {
        alert("Keine Variablen im Cloud-Projekt gefunden.");
        return;
      }
      const merged = [...loadGlobalVars()];
      const byName = Object.fromEntries(merged.map((v, i) => [v.name, i]));
      cloudList.filter((v) => !v.system).forEach((cv) => {
        const entry = {
          name: cv.name,
          label: cv.label || "",
          type: cv.type || "STRING",
          restricted: !!cv.restricted,
          value: String(cv.value ?? "")
        };
        if (cv.name in byName) merged[byName[cv.name]] = entry;
        else merged.push(entry);
      });
      saveGlobalVars(merged);
      renderGlobalVarsList();
    } catch (err) {
      alert("Fehler beim Laden: " + err.message);
    }
  }
  function renderGlobalVarsList() {
    const vars = loadGlobalVars();
    const list = q("global-vars-list");
    list.innerHTML = "";
    vars.forEach((v) => list.appendChild(makeGlobalVarRow(v)));
    if (!vars.length) {
      list.innerHTML = '<span style="font-size:12px;color:var(--text3)">Noch keine globalen Variablen definiert.</span>';
    }
  }
  function makeGlobalVarRow(v = {}) {
    const row = document.createElement("div");
    row.style.cssText = "display:grid;grid-template-columns:1fr 1fr auto auto 1.4fr auto auto;align-items:center;gap:6px;padding:5px 0;border-bottom:1px solid var(--border2)";
    const is = "padding:4px 7px;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text1);font-size:11px;font-family:var(--mono);outline:none;width:100%;box-sizing:border-box";
    const pwVal = v.restricted ? v.value ?? "" : "";
    const txVal = !v.restricted ? v.value ?? "" : "";
    row.innerHTML = `
    <input type="text"  placeholder="variablen_name" value="${h(v.name || "")}" data-role="gv-name"       style="${is}">
    <input type="text"  placeholder="Anzeigename"     value="${h(v.label || "")}" data-role="gv-label"      style="${is}">
    <select data-role="gv-type" style="${is};padding-right:4px">
      <option value="STRING"    ${(v.type || "STRING") === "STRING" ? "selected" : ""}>STRING</option>
      <option value="JSON"      ${(v.type || "") === "JSON" ? "selected" : ""}>JSON</option>
      <option value="USER_TYPE" ${(v.type || "") === "USER_TYPE" ? "selected" : ""}>USER_TYPE</option>
    </select>
    <label title="Als Passwort" style="display:flex;align-items:center;gap:3px;font-size:11px;color:var(--text2);cursor:pointer;white-space:nowrap">
      <input type="checkbox" data-role="gv-restricted" ${v.restricted ? "checked" : ""} onchange="gvTogglePassword(this)"> \u{1F512}
    </label>
    <input type="${v.restricted ? "password" : "text"}" placeholder="Wert" value="${h(v.restricted ? pwVal : txVal)}" data-role="gv-value" style="${is}">
    <button class="btn btn-sm" onclick="saveGlobalVarsManual()" title="Speichern" style="padding:3px 8px;flex-shrink:0">\u{1F4BE}</button>
    <button class="btn btn-sm btn-ghost" onclick="removeGlobalVarRow(this)" style="padding:3px 7px;flex-shrink:0;color:var(--red)">\u2715</button>`;
    return row;
  }
  function gvTogglePassword(cb) {
    const row = cb.closest("div");
    const inp = row.querySelector("[data-role=gv-value]");
    inp.type = cb.checked ? "password" : "text";
  }
  function addGlobalVar() {
    const list = q("global-vars-list");
    if (list.querySelector("span")) list.innerHTML = "";
    list.appendChild(makeGlobalVarRow({ name: "", label: "", type: "STRING", restricted: false, value: "" }));
    list.lastElementChild.querySelector("input").focus();
  }
  function _collectGlobalVars() {
    const vars = [];
    q("global-vars-list").querySelectorAll("div[style]").forEach((row) => {
      const name = row.querySelector("[data-role=gv-name]")?.value.trim();
      if (!name) return;
      vars.push({
        name,
        label: row.querySelector("[data-role=gv-label]")?.value.trim() || "",
        type: row.querySelector("[data-role=gv-type]")?.value || "STRING",
        restricted: !!row.querySelector("[data-role=gv-restricted]")?.checked,
        value: row.querySelector("[data-role=gv-value]")?.value ?? ""
      });
    });
    return vars;
  }
  function removeGlobalVarRow(btn) {
    btn.closest("div").remove();
    const list = q("global-vars-list");
    if (!list.children.length) {
      list.innerHTML = '<span style="font-size:12px;color:var(--text3)">Noch keine globalen Variablen definiert.</span>';
    }
    saveGlobalVars(_collectGlobalVars());
  }
  function applyVarsToScript(script) {
    return script;
  }
  var OS_FLAGS_MAP = {
    "LCOS": { lcos: true, lcosLx: false, swos: false, lcosSxSdk4: false, lcosSxXs: false, lcosFx: false },
    "LCOS LX": { lcos: false, lcosLx: true, swos: false, lcosSxSdk4: false, lcosSxXs: false, lcosFx: false },
    "LCOS SX 3": { lcos: false, lcosLx: false, swos: true, lcosSxSdk4: false, lcosSxXs: false, lcosFx: false },
    "LCOS SX 4": { lcos: false, lcosLx: false, swos: false, lcosSxSdk4: true, lcosSxXs: false, lcosFx: false },
    "LCOS SX 5": { lcos: false, lcosLx: false, swos: false, lcosSxSdk4: false, lcosSxXs: true, lcosFx: false },
    "LCOS FX": { lcos: false, lcosLx: false, swos: false, lcosSxSdk4: false, lcosSxXs: false, lcosFx: true }
  };
  function collectEditorData() {
    const os = document.querySelector('input[name="ef-os"]:checked')?.value || "LCOS";
    const script = applyVarsToScript(q("edit-script").value);
    q("edit-script").value = script;
    return {
      name: q("edit-name").value.trim(),
      description: q("edit-desc").value.trim(),
      os,
      ...OS_FLAGS_MAP[os] || {},
      script
    };
  }
  function setEditorStatus(msg, ok) {
    const el = q("addin-editor-status");
    el.style.color = ok ? "var(--green)" : "var(--red)";
    el.textContent = msg;
  }
  function renderVarsPicker() {
    const sel = q("vars-picker-select");
    if (!sel) return;
    const vars = loadGlobalVars();
    sel.innerHTML = '<option value="">\u2014 Variable einf\xFCgen \u2014</option>';
    vars.forEach((v) => {
      const opt = document.createElement("option");
      opt.value = v.name;
      opt.textContent = v.name + (v.label ? ` (${v.label})` : "");
      sel.appendChild(opt);
    });
  }
  function insertVarAtCursor() {
    const sel = q("vars-picker-select");
    const ta = q("edit-script");
    if (!sel?.value || !ta) return;
    const text = `context.vars.${sel.value}`;
    const s = ta.selectionStart, e = ta.selectionEnd;
    ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
    ta.selectionStart = ta.selectionEnd = s + text.length;
    ta.focus();
    sel.value = "";
    renderAddinVars(ta.value);
  }
  function autoAddMissingVars(script) {
    const used = extractAddinVars(script);
    const existing = loadGlobalVars();
    const existingNames = new Set(existing.map((v) => v.name));
    const added = [];
    used.forEach((scriptDefault, key) => {
      if (existingNames.has(key)) return;
      existing.push({ name: key, label: "", type: "STRING", restricted: false, value: scriptDefault || "" });
      added.push(key);
    });
    if (added.length) {
      saveGlobalVars(existing);
      setEditorStatus(`\u2713 Neue Variable${added.length > 1 ? "n" : ""} angelegt: ${added.join(", ")}`, true);
    }
  }
  async function saveAddin() {
    const data = collectEditorData();
    if (!data.name) {
      setEditorStatus("Name darf nicht leer sein.", false);
      return;
    }
    autoAddMissingVars(data.script || "");
    if (addinIsNew) {
      const filename = data.name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") + ".json";
      try {
        const r = await fetch("/api/addin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename, ...data })
        });
        const d = await r.json();
        if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`);
        const newEntry = { ...data, filename };
        addinList.push(newEntry);
        addinEditorIndex = addinList.length - 1;
        addinIsNew = false;
        q("addin-modal-title").textContent = `Add-in bearbeiten: ${data.name}`;
        q("edit-filepath").textContent = `addins/${data.os}/${filename}`;
        renderAddinList();
        setEditorStatus("\u2713 Gespeichert", true);
      } catch (e) {
        setEditorStatus("Fehler: " + e.message, false);
      }
      return;
    }
    if (addinEditorIndex === null) return;
    const a = addinList[addinEditorIndex];
    try {
      const r = await fetch("/api/addin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ originalOs: a.os, filename: a.filename, ...data })
      });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`);
      addinList[addinEditorIndex] = { ...a, ...data };
      q("edit-filepath").textContent = `addins/${data.os}/${a.filename}`;
      renderAddinList();
      setEditorStatus("\u2713 Gespeichert", true);
    } catch (e) {
      setEditorStatus("Fehler: " + e.message, false);
    }
  }
  async function saveAndUploadAddin() {
    await saveAddin();
    const el = q("addin-editor-status");
    if (!el.textContent.startsWith("\u2713")) return;
    setEditorStatus("Wird hochgeladen\u2026", true);
    try {
      await uploadAddin(addinEditorIndex);
      setEditorStatus("\u2713 Gespeichert & hochgeladen", true);
    } catch (e) {
      setEditorStatus("Gespeichert, Upload fehlgeschlagen: " + e.message, false);
    }
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Tab" && document.activeElement?.id === "edit-script") {
      e.preventDefault();
      const ta = document.activeElement;
      const s = ta.selectionStart, end = ta.selectionEnd;
      ta.value = ta.value.slice(0, s) + "    " + ta.value.slice(end);
      ta.selectionStart = ta.selectionEnd = s + 4;
    }
    if (e.key === "Escape" && q("addin-modal")?.style.display !== "none") closeAddinEditor();
  });
  async function deleteAddin(index) {
    const a = addinList[index];
    if (!a) return;
    if (!confirm(`Add-in "${a.name}" wirklich l\xF6schen?`)) return;
    try {
      const r = await fetch("/api/addin?os=" + encodeURIComponent(a.os) + "&file=" + encodeURIComponent(a.filename), { method: "DELETE" });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`);
      addinList.splice(index, 1);
      renderAddinList();
    } catch (e) {
      alert("Fehler beim L\xF6schen: " + e.message);
    }
  }
  async function uploadAllAddins() {
    const btn = q("btn-upload-all-addins");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Wird hochgeladen\u2026";
    }
    for (let i = 0; i < addinList.length; i++) {
      await uploadAddin(i);
    }
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Alle hochladen";
    }
  }
  if (typeof window !== "undefined") {
    Object.assign(window, {
      loadAddins,
      createAddin,
      setAddinFilterOs,
      setAddinSearch,
      setAddinSortCol,
      openAddinEditor,
      closeAddinEditor,
      uploadAddin,
      deleteAddin,
      uploadAllAddins,
      saveGlobalVarsManual,
      gvTogglePassword,
      removeGlobalVarRow,
      addGlobalVar,
      loadVarsFromCloud,
      syncVarsToCloud,
      renderGlobalVarsList,
      fetchGlobalVars,
      insertVarAtCursor,
      saveAddin,
      saveAndUploadAddin
    });
  }

  // ui/tabs/detail.js
  var selectedDevice = null;
  function fmtUptime3(ticks) {
    if (ticks == null) return "\u2014";
    if (typeof ticks === "string") {
      const m2 = ticks.match(/\((\d+)\)/);
      ticks = m2 ? parseInt(m2[1]) : parseInt(ticks);
    }
    if (isNaN(ticks)) return "\u2014";
    let s = Math.floor(ticks / 100);
    const d = Math.floor(s / 86400);
    s %= 86400;
    const hh = Math.floor(s / 3600);
    s %= 3600;
    const m = Math.floor(s / 60);
    s %= 60;
    if (d > 0) return `${d}d ${hh}h ${m}m`;
    if (hh > 0) return `${hh}h ${m}m ${s}s`;
    return `${m}m ${s}s`;
  }
  function esc2(s) {
    return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function openDeviceDetail(ip) {
    const dev = state_default.deviceStore[ip] || { ip, community: state_default.appSettings.snmpReadCommunity || "public", version: state_default.appSettings.snmpVersion || "2c" };
    selectedDevice = dev;
    q("detail-ip").textContent = ip;
    q("detail-community").value = dev.community || state_default.appSettings.snmpReadCommunity || "public";
    {
      let v = dev.version || state_default.appSettings.snmpVersion || "2c";
      if (v === "1") v = "2c";
      q("detail-version").value = v;
    }
    q("detail-badge").textContent = "\u21A9 " + (dev.name || ip);
    q("detail-badge").style.display = "";
    const isSwitch = dev.type === "switch";
    const isLxAp = dev.type === "lx-ap";
    q("stab-wlan").style.display = isSwitch ? "none" : "";
    q("stab-vlan-detail").style.display = isSwitch ? "" : "none";
    q("stab-ports").style.display = isSwitch ? "" : "none";
    q("stab-stp").style.display = isSwitch ? "" : "none";
    q("stab-poe").style.display = isSwitch ? "" : "none";
    q("stab-loop").style.display = isSwitch ? "" : "none";
    q("sys-cards").innerHTML = '<div class="empty"><span class="spinner"></span></div>';
    ["tbl-ifaces", "tbl-mac", "tbl-wlan", "tbl-vlan-detail", "tbl-ports", "tbl-stp", "tbl-poe", "tbl-loop", "tbl-lldp"].forEach((id) => {
      const tb = q(id)?.querySelector("tbody");
      if (tb) tb.innerHTML = '<tr><td colspan="20" class="empty"><span class="spinner"></span></td></tr>';
    });
    q("stp-global").innerHTML = "";
    q("stp-controls").innerHTML = "";
    q("poe-global").innerHTML = "";
    q("poe-controls").innerHTML = "";
    q("loop-controls").innerHTML = "";
    lastStpData = null;
    lastPoeData = null;
    lastLoopData = null;
    showStab("system");
    window.showTab?.("detail");
    startSparkPoll(ip);
    queryDetail();
  }
  function showStab(name) {
    document.querySelectorAll("#panel-detail .sub-panel").forEach((p) => p.classList.remove("active"));
    document.querySelectorAll("#panel-detail .stab").forEach((t) => t.classList.remove("active"));
    q("sub-" + name).classList.add("active");
    q("stab-" + name).classList.add("active");
  }
  async function queryDetail() {
    const ip = q("detail-ip").textContent.trim();
    const community = q("detail-community").value.trim() || "public";
    const version = q("detail-version").value;
    if (!ip) return;
    if (state_default.deviceStore[ip]) {
      state_default.deviceStore[ip].community = community;
      state_default.deviceStore[ip].version = version;
      fetch("/api/devices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(state_default.deviceStore) }).catch(() => {
      });
    }
    q("detail-main-status").className = "status-bar loading";
    q("detail-main-status").innerHTML = '<span class="spinner"></span> Abfrage l\xE4uft\u2026';
    const t0 = Date.now();
    const devType = selectedDevice?.type || "";
    const devOs = selectedDevice?.os || "";
    const needsVlan = devType === "switch";
    const isSwitch = devType === "switch";
    const isLxAp = devType === "lx-ap";
    const snmpQ2 = window.snmpQ;
    const qq = (t, o) => snmpQ2?.(ip, t, o) ?? Promise.resolve(null);
    const [sys, ifaces, mac, wlan, lldp, vlan, ports, stp, poe, loop] = await Promise.allSettled([
      qq("system"),
      qq("interfaces"),
      qq("mac"),
      needsVlan && !isLxAp ? Promise.resolve({ entries: [] }) : qq("wlan", { os: devOs, devType }),
      qq("lldp"),
      needsVlan ? qq("vlan", { os: devOs, devType }) : Promise.resolve(null),
      isSwitch ? qq("ports") : Promise.resolve(null),
      isSwitch ? qq("stp") : Promise.resolve(null),
      isSwitch ? qq("poe") : Promise.resolve(null),
      isSwitch ? qq("loop") : Promise.resolve(null)
    ]);
    if (sys.status === "fulfilled") renderDetailSystem(sys.value);
    if (ifaces.status === "fulfilled") renderDetailIfaces(ifaces.value);
    if (mac.status === "fulfilled") renderDetailMac(mac.value);
    if ((!needsVlan || isLxAp) && wlan.status === "fulfilled") renderDetailWlan(wlan.value);
    if (lldp.status === "fulfilled") renderDetailLldp(lldp.value);
    if (needsVlan && vlan.status === "fulfilled" && vlan.value) renderDetailVlan(vlan.value);
    if (isSwitch && ports.status === "fulfilled" && ports.value) renderDetailPorts(ports.value);
    if (isSwitch && stp.status === "fulfilled" && stp.value) renderDetailStp(stp.value);
    if (isSwitch && poe.status === "fulfilled" && poe.value) renderDetailPoe(poe.value);
    if (isSwitch && loop.status === "fulfilled" && loop.value) renderDetailLoop(loop.value);
    q("detail-main-status").className = "status-bar ok";
    q("detail-main-status").textContent = `Abfrage erfolgreich (${((Date.now() - t0) / 1e3).toFixed(1)}s)`;
  }
  function renderDetailSystem(d) {
    q("sys-cards").innerHTML = [
      { label: "Ger\xE4tename", value: d.sysName || "\u2014" },
      { label: "Beschreibung", value: d.sysDescr || "\u2014", mono: true },
      { label: "Standort", value: d.sysLocation || "\u2014" },
      { label: "Kontakt", value: d.sysContact || "\u2014" },
      { label: "Uptime", value: fmtUptime3(d.sysUpTime) }
    ].map((c) => `<div class="info-card"><div class="label">${c.label}</div><div class="value${c.mono ? " mono" : ""}">${h(c.value)}</div></div>`).join("");
  }
  function renderDetailIfaces(data) {
    const tbody = q("tbl-ifaces").querySelector("tbody");
    if (!data.length) {
      tbody.innerHTML = `<tr><td colspan="8" class="empty">Keine Interfaces</td></tr>`;
      return;
    }
    const ip = q("detail-ip")?.textContent.trim() || "";
    tbody.innerHTML = data.map((i) => {
      const name = i.name || i.descr || "If" + i.idx;
      const canvasId = `spark-${CSS.escape(ip + ":" + name)}`;
      const adminUp = i.adminStatus !== "2" && i.adminStatus !== "down";
      return `<tr>
      <td style="font-weight:600">${h(name)}</td>
      <td class="mono" style="color:var(--text2)">${i.name && i.descr !== i.name ? h(i.descr) : ""}</td>
      <td>${statusBadge(i.operStatus)}</td>
      <td style="color:var(--text2)">${fmtSpeed(i.highSpeed, i.speed)}</td>
      <td class="mono">${fmtBytes(i.inOctets)}</td>
      <td class="mono">${fmtBytes(i.outOctets)}</td>
      <td><canvas id="${canvasId}" width="80" height="24" style="display:block;vertical-align:middle"></canvas></td>
      <td>${adminUp ? `<button class="btn btn-sm btn-ghost" style="opacity:.6;font-size:11px" onclick="toggleIfaceAdmin('${h(String(i.idx))}',false)">Disable</button>` : `<button class="btn btn-sm" style="font-size:11px" onclick="toggleIfaceAdmin('${h(String(i.idx))}',true)">Enable</button>`}</td>
    </tr>`;
    }).join("");
  }
  async function toggleIfaceAdmin(idx, enable) {
    const detailIp = q("detail-ip");
    if (!detailIp) return;
    const ip = detailIp.textContent.trim();
    const safeIdx = String(idx).replace(/[^0-9]/g, "");
    if (!safeIdx) return;
    try {
      await snmpSet(ip, `1.3.6.1.2.1.2.2.1.7.${safeIdx}`, "i", enable ? 1 : 2);
      renderDetailIfaces(await (window.snmpQ?.(ip, "interfaces") ?? []));
    } catch (e) {
      alert("Fehler: " + e.message);
    }
  }
  var _sparkHistory = {};
  var _sparkPollTimer = null;
  function startSparkPoll(ip) {
    stopSparkPoll();
    for (const key of Object.keys(_sparkHistory)) {
      if (!key.startsWith(`${ip}:`)) delete _sparkHistory[key];
    }
    _sparkPollTimer = setInterval(() => pollSparklines(ip), 15e3);
    pollSparklines(ip);
  }
  function stopSparkPoll() {
    if (_sparkPollTimer) {
      clearInterval(_sparkPollTimer);
      _sparkPollTimer = null;
    }
  }
  async function pollSparklines(ip) {
    try {
      const all = await (await fetch(`/api/iftraffic?ip=${encodeURIComponent(ip)}`)).json();
      const ifaces = all[ip];
      if (!ifaces) return;
      for (const [name, d] of Object.entries(ifaces)) {
        const key = `${ip}:${name}`;
        if (!_sparkHistory[key]) _sparkHistory[key] = [];
        _sparkHistory[key].push(Math.max(d.inBps, d.outBps));
        if (_sparkHistory[key].length > 30) _sparkHistory[key].shift();
        drawSparkline(document.getElementById(`spark-${CSS.escape(key)}`), _sparkHistory[key]);
      }
    } catch {
    }
  }
  function drawSparkline(canvas, data) {
    if (!canvas || data.length < 2) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h2 = canvas.height;
    ctx.clearRect(0, 0, w, h2);
    const max = Math.max(...data, 1);
    const isDark = document.documentElement.dataset.theme === "dark";
    ctx.strokeStyle = isDark ? "#22d3ee" : "#0891b2";
    ctx.lineWidth = 1.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    data.forEach((v, i) => {
      const x = i / (data.length - 1) * w;
      const y = h2 - v / max * (h2 - 2) - 1;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
  function renderDetailMac(data) {
    const tbody = q("tbl-mac").querySelector("tbody");
    if (!data.entries.length) {
      tbody.innerHTML = `<tr><td colspan="3" class="empty">Keine Eintr\xE4ge</td></tr>`;
      return;
    }
    tbody.innerHTML = data.entries.map((e) => `<tr>
    <td class="mono">${h(e.mac)}</td>
    <td class="mono" style="color:var(--text2)">${e.ip ? h(e.ip) : '<span style="color:var(--text3)">\u2014</span>'}</td>
    <td>${h(e.port)}</td>
  </tr>`).join("");
  }
  function renderDetailWlan(data) {
    const tbody = q("tbl-wlan").querySelector("tbody");
    if (!data.entries.length) {
      tbody.innerHTML = `<tr><td colspan="8" class="empty">Keine WLAN-Clients</td></tr>`;
      return;
    }
    tbody.innerHTML = data.entries.map((e) => {
      const sig = e.signal !== "" ? parseInt(e.signal) : null;
      const sigBadge = sig !== null && !isNaN(sig) ? `<span class="badge ${sig >= -60 ? "badge-green" : sig >= -75 ? "badge-yellow" : "badge-red"}">${sig} dBm</span>` : "\u2014";
      const snr = e.snr !== "" ? parseInt(e.snr) : null;
      const snrBadge = snr !== null && !isNaN(snr) ? `<span class="badge ${snr >= 40 ? "badge-green" : snr >= 25 ? "badge-yellow" : "badge-red"}">${snr} dB</span>` : "\u2014";
      const chanStr = e.channel ? e.chanWidth ? `CH ${e.channel} <span style="color:var(--text3);font-size:11px">${h(e.chanWidth)}</span>` : `CH ${e.channel}` : "\u2014";
      return `<tr>
      <td class="mono">${h(e.mac)}</td>
      <td class="mono" style="color:var(--text2)">${e.ip ? h(e.ip) : "\u2014"}</td>
      <td style="color:var(--text2)">${e.hostname ? h(e.hostname) : "\u2014"}</td>
      <td>${e.ssid ? `<span class="badge badge-blue">${h(e.ssid)}</span>` : "\u2014"}</td>
      <td>${e.band ? `<span class="badge badge-gray">${h(e.band)}</span>` : "\u2014"}</td>
      <td style="color:var(--text2);font-size:12px">${chanStr}</td>
      <td>${sigBadge}</td>
      <td>${snrBadge}</td>
    </tr>`;
    }).join("");
  }
  var LLDP_ADMIN = { 1: "Nur Senden", 2: "Nur Empfangen", 3: "Senden & Empfangen", 4: "Deaktiviert" };
  var LLDP_ADMIN_BADGE = { 1: "badge-yellow", 2: "badge-yellow", 3: "badge-green", 4: "badge-gray" };
  var lastLldpData = null;
  function renderDetailLldp(data) {
    lastLldpData = data;
    const ctrlEl = q("lldp-controls");
    const cfgWrap = q("lldp-config-wrap");
    const cfgBody = q("tbl-lldp-cfg")?.querySelector("tbody");
    const tbody = q("tbl-lldp").querySelector("tbody");
    tbody.innerHTML = data.entries.length ? data.entries.map((e) => `<tr>
        <td style="font-weight:600">${h(e.localPortName)}</td>
        <td>${h(e.remSysName || "\u2014")}</td>
        <td class="mono" style="color:var(--text2)">${h(e.remPortDesc || e.remPortId || "\u2014")}</td>
        <td style="color:var(--text2);font-size:12px">${h((e.remSysDesc || "").split("\n")[0] || "\u2014")}</td>
      </tr>`).join("") : `<tr><td colspan="4" class="empty">Keine LLDP-Nachbarn</td></tr>`;
    if (!data.portConfig?.length) {
      if (cfgWrap) cfgWrap.style.display = "none";
      if (ctrlEl) ctrlEl.innerHTML = "";
      return;
    }
    if (cfgWrap) cfgWrap.style.display = "";
    if (ctrlEl) ctrlEl.innerHTML = `
    <button class="btn btn-sm" onclick="toggleLldpAll(true)">Alle aktivieren</button>
    <button class="btn btn-sm btn-danger" onclick="toggleLldpAll(false)">Alle deaktivieren</button>`;
    if (cfgBody) cfgBody.innerHTML = data.portConfig.map((p) => {
      const enabled = p.adminStatus !== 4;
      return `<tr>
      <td class="mono">${h(p.portName)}</td>
      <td><span class="badge ${LLDP_ADMIN_BADGE[p.adminStatus] || "badge-gray"}">${LLDP_ADMIN[p.adminStatus] || "\u2014"}</span></td>
      <td><button class="btn btn-sm${enabled ? " btn-danger" : ""}" onclick="toggleLldpPort('${p.cfgOid}',${p.portIndex},${!enabled})">${enabled ? "Deaktivieren" : "Aktivieren"}</button></td>
    </tr>`;
    }).join("");
  }
  async function toggleLldpPort(cfgOid, portIndex, enable) {
    const ip = q("detail-ip").textContent.trim();
    if (!ip) return;
    try {
      await snmpSet(ip, cfgOid, "i", enable ? 3 : 4);
      const data = await (window.snmpQ?.(ip, "lldp") ?? Promise.resolve({ entries: [], portConfig: [] }));
      renderDetailLldp(data);
    } catch (e) {
      alert("Fehler: " + e.message);
    }
  }
  async function toggleLldpAll(enable) {
    const ip = q("detail-ip").textContent.trim();
    if (!ip || !lastLldpData?.portConfig) return;
    try {
      await Promise.all(lastLldpData.portConfig.map((p) => snmpSet(ip, p.cfgOid, "i", enable ? 3 : 4)));
      const data = await (window.snmpQ?.(ip, "lldp") ?? Promise.resolve({ entries: [], portConfig: [] }));
      renderDetailLldp(data);
    } catch (e) {
      alert("Fehler: " + e.message);
    }
  }
  function renderDetailVlan(data) {
    const tbody = q("tbl-vlan-detail").querySelector("tbody");
    if (!data.entries.length) {
      tbody.innerHTML = `<tr><td colspan="3" class="empty">Keine VLANs gefunden</td></tr>`;
      return;
    }
    tbody.innerHTML = data.entries.map((e) => `<tr>
    <td class="mono" style="font-weight:600">${e.vlanId}</td>
    <td>${h(e.name || "\u2014")}</td>
    <td><span class="badge ${e.active ? "badge-green" : "badge-gray"}">${e.active ? "Aktiv" : "Inaktiv"}</span></td>
  </tr>`).join("");
  }
  function adminBadge2(val) {
    if (val === "1" || val === "up") return '<span class="badge badge-green">Up</span>';
    if (val === "2" || val === "down") return '<span class="badge badge-red">Down</span>';
    return `<span class="badge badge-gray">${h(val || "\u2014")}</span>`;
  }
  async function snmpSet(host, oid, type, value) {
    const r = await fetch("/snmpset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host, oid, type, value })
    });
    const data = await r.json();
    if (!r.ok || data.error) throw new Error(data.error || "SNMP SET fehlgeschlagen");
    return data;
  }
  var lastStpData = null;
  var lastPoeData = null;
  var lastLoopData = null;
  async function toggleStpPort(port, enable) {
    const ip = q("detail-ip").textContent.trim();
    const meta = lastStpData?._meta || { oidBase: "1.3.6.1.2.1.17.2.15.1.4", enableValue: 1, disableValue: 2 };
    try {
      await snmpSet(ip, `${meta.oidBase}.${port}`, "i", enable ? meta.enableValue : meta.disableValue);
      const data = await (window.snmpQ?.(ip, "stp") ?? Promise.resolve({ entries: [], portEntries: [] }));
      renderDetailStp(data);
    } catch (e) {
      alert("Fehler: " + e.message);
    }
  }
  async function toggleStpAll(enable) {
    const ip = q("detail-ip").textContent.trim();
    const meta = lastStpData?._meta || { oidBase: "1.3.6.1.2.1.17.2.15.1.4", enableValue: 1, disableValue: 2 };
    try {
      for (const p of lastStpData?.portEntries || [])
        await snmpSet(ip, `${meta.oidBase}.${p.port}`, "i", enable ? meta.enableValue : meta.disableValue);
      const data = await (window.snmpQ?.(ip, "stp") ?? Promise.resolve({ entries: [], portEntries: [] }));
      renderDetailStp(data);
    } catch (e) {
      alert("Fehler: " + e.message);
    }
  }
  async function setSTPMode() {
    const ip = q("detail-ip").textContent.trim();
    const meta = lastStpData?._meta;
    if (!meta?.globalOid) return;
    const sel = document.getElementById("stp-mode-select");
    if (!sel) return;
    const value = parseInt(sel.value);
    try {
      await snmpSet(ip, meta.globalOid, "i", value);
      await new Promise((r) => setTimeout(r, 800));
      const data = await (window.snmpQ?.(ip, "stp") ?? Promise.resolve({ entries: [], portEntries: [] }));
      renderDetailStp(data);
    } catch (e) {
      alert("Fehler: " + e.message);
    }
  }
  async function togglePoePort(group, port, enable) {
    const ip = q("detail-ip").textContent.trim();
    try {
      await snmpSet(ip, `1.3.6.1.2.1.105.1.1.1.3.${group}.${port}`, "i", enable ? 1 : 2);
      const data = await (window.snmpQ?.(ip, "poe") ?? Promise.resolve({ main: {}, portEntries: [] }));
      renderDetailPoe(data);
    } catch (e) {
      alert("Fehler: " + e.message);
    }
  }
  async function togglePoeAll(enable) {
    const ip = q("detail-ip").textContent.trim();
    const ports = lastPoeData?.portEntries || [];
    try {
      for (const p of ports) await snmpSet(ip, `1.3.6.1.2.1.105.1.1.1.3.${p.group}.${p.port}`, "i", enable ? 1 : 2);
      const data = await (window.snmpQ?.(ip, "poe") ?? Promise.resolve({ main: {}, portEntries: [] }));
      renderDetailPoe(data);
    } catch (e) {
      alert("Fehler: " + e.message);
    }
  }
  async function toggleLoopPort(port, enable) {
    const ip = q("detail-ip").textContent.trim();
    const meta = lastLoopData?._meta || { oidBase: "1.3.6.1.2.1.17.2.15.1.4", enableValue: 1, disableValue: 2 };
    try {
      await snmpSet(ip, `${meta.oidBase}.${port}`, "i", enable ? meta.enableValue : meta.disableValue);
      const data = await (window.snmpQ?.(ip, "loop") ?? Promise.resolve({ ports: [] }));
      renderDetailLoop(data);
    } catch (e) {
      alert("Fehler: " + e.message);
    }
  }
  async function toggleLoopAll(enable) {
    const ip = q("detail-ip").textContent.trim();
    const meta = lastLoopData?._meta || { oidBase: "1.3.6.1.2.1.17.2.15.1.4", enableValue: 1, disableValue: 2 };
    try {
      for (const p of lastLoopData?.ports || [])
        await snmpSet(ip, `${meta.oidBase}.${p.port}`, "i", enable ? meta.enableValue : meta.disableValue);
      const data = await (window.snmpQ?.(ip, "loop") ?? Promise.resolve({ ports: [] }));
      renderDetailLoop(data);
    } catch (e) {
      alert("Fehler: " + e.message);
    }
  }
  function renderDetailPorts(data) {
    const tbody = q("tbl-ports").querySelector("tbody");
    if (!data.entries.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty">Keine Ports gefunden</td></tr>`;
      return;
    }
    tbody.innerHTML = data.entries.map((e) => `<tr>
    <td class="mono">${h(e.name || "\u2014")}</td>
    <td>${h(e.descr || "\u2014")}</td>
    <td>${adminBadge2(e.adminStatus)}</td>
    <td>${adminBadge2(e.operStatus)}</td>
    <td class="mono">${(() => {
      const s = e.highSpeed || Math.round((e.speed || 0) / 1e6);
      if (!s) return "\u2014";
      return s >= 1e3 ? (s / 1e3).toFixed(s % 1e3 ? 1 : 0) + " Gbps" : s + " Mbps";
    })()}</td>
    <td class="mono">${e.pvid || "\u2014"}</td>
  </tr>`).join("");
  }
  function renderDetailStp(data) {
    lastStpData = data;
    const STP_STATE2 = { 1: "Disabled", 2: "Blocking", 3: "Listening", 4: "Learning", 5: "Forwarding", 6: "Broken" };
    const STP_BADGE2 = { 1: "badge-gray", 2: "badge-orange", 3: "badge-yellow", 4: "badge-yellow", 5: "badge-green", 6: "badge-red" };
    const g = data.global || {};
    q("stp-global").innerHTML = [
      { label: "Priorit\xE4t", value: g.priority || "\u2014" },
      { label: "Root Bridge", value: g.designatedRoot || "\u2014", mono: true },
      { label: "Root Port", value: g.rootPort || "\u2014" },
      { label: "Root-Kosten", value: g.rootCost != null ? g.rootCost : "\u2014" },
      { label: "Max Age", value: g.maxAge ? g.maxAge + "s" : "\u2014" },
      { label: "Hello Time", value: g.helloTime ? g.helloTime + "s" : "\u2014" },
      { label: "Fwd Delay", value: g.fwdDelay ? g.fwdDelay + "s" : "\u2014" },
      { label: "Topo-Wechsel", value: g.topChanges || "\u2014" }
    ].map((c) => `<div class="info-card"><div class="label">${c.label}</div><div class="value${c.mono ? " mono" : ""}">${c.value}</div></div>`).join("");
    const tbody = q("tbl-stp").querySelector("tbody");
    const meta = data._meta || {};
    const isPrivate = meta.mibType === "private";
    if (!data.portEntries.length) {
      q("stp-controls").innerHTML = "";
      tbody.innerHTML = `<tr><td colspan="6" class="empty">Keine STP-Ports</td></tr>`;
      return;
    }
    const anyEnabled = data.portEntries.some((p) => p.portEnabled !== false);
    const modeLabel = data.global?.modeLabel ? ` (${data.global.modeLabel})` : "";
    const modeSelector = meta.globalOid ? `
    <select id="stp-mode-select" style="height:30px;border-radius:6px;border:1px solid var(--border);background:var(--card-bg);color:var(--text1);padding:0 6px;font-size:13px">
      ${(meta.modes || []).map((m) => `<option value="${m.value}"${String(m.value) === String(data.global?.mode) ? "selected" : ""}>${h(m.label)}</option>`).join("")}
    </select>
    <button class="btn btn-sm" onclick="setSTPMode()">Modus setzen</button>
    <span style="color:var(--border);margin:0 2px">|</span>` : "";
    q("stp-controls").innerHTML = `${modeSelector}
    <button class="btn btn-sm" onclick="toggleStpAll(true)">Alle aktivieren</button>
    <button class="btn btn-sm btn-danger" onclick="toggleStpAll(false)">Alle deaktivieren</button>
    <span style="font-size:12px;color:var(--text2)">STP${h(modeLabel)}: <span class="badge ${anyEnabled ? "badge-green" : "badge-gray"}">${anyEnabled ? "Aktiv" : "Inaktiv"}</span></span>`;
    if (isPrivate) {
      q("thead-stp").innerHTML = "<tr><th>Port</th><th>Priorit\xE4t</th><th>Admin Pfadkosten</th><th>Edge</th><th>Aktiv</th><th></th></tr>";
      tbody.innerHTML = data.portEntries.map((p) => {
        const enabled = p.portEnabled !== false;
        const edge = p.edgeAdmin === "1" ? '<span class="badge badge-green">Ja</span>' : '<span class="badge badge-gray">Nein</span>';
        return `<tr>
        <td class="mono">${h(p.portName)}</td>
        <td class="mono">${p.priority || "\u2014"}</td>
        <td class="mono">${p.pathCost || "\u2014"}</td>
        <td>${edge}</td>
        <td><span class="badge ${enabled ? "badge-green" : "badge-gray"}">${enabled ? "Ja" : "Nein"}</span></td>
        <td><button class="btn btn-sm${enabled ? " btn-danger" : ""}" onclick="toggleStpPort('${p.port}',${!enabled})">${enabled ? "Deaktivieren" : "Aktivieren"}</button></td>
      </tr>`;
      }).join("");
    } else {
      q("thead-stp").innerHTML = "<tr><th>Port</th><th>Status</th><th>Priorit\xE4t</th><th>Pfadkosten</th><th>Wechsel</th><th></th></tr>";
      tbody.innerHTML = data.portEntries.map((p) => {
        const stateN = parseInt(p.state);
        const enabled = p.portEnabled !== false;
        return `<tr>
        <td class="mono">${h(p.portName)}</td>
        <td><span class="badge ${STP_BADGE2[stateN] || "badge-gray"}">${STP_STATE2[stateN] || p.state || "\u2014"}</span></td>
        <td class="mono">${p.priority || "\u2014"}</td>
        <td class="mono">${p.pathCost || "\u2014"}</td>
        <td class="mono">${p.fwdTrans || "\u2014"}</td>
        <td><button class="btn btn-sm${enabled ? " btn-danger" : ""}" onclick="toggleStpPort('${p.port}',${!enabled})">${enabled ? "Deaktivieren" : "Aktivieren"}</button></td>
      </tr>`;
      }).join("");
    }
  }
  function renderDetailPoe(data) {
    lastPoeData = data;
    const POE_STATUS2 = { 1: "Disabled", 2: "Searching", 3: "Delivering", 4: "Fault", 5: "Test", 6: "OtherFault" };
    const POE_BADGE2 = { 1: "badge-gray", 2: "badge-yellow", 3: "badge-green", 4: "badge-red", 5: "badge-yellow", 6: "badge-red" };
    const POE_CLASS2 = { 0: "Class 0", 1: "Class 1", 2: "Class 2", 3: "Class 3", 4: "Class 4" };
    const m = data.main || {};
    if (selectedDevice?.ip && state_default.deviceStore[selectedDevice.ip] && m.power) {
      state_default.deviceStore[selectedDevice.ip].poeMain = { power: m.power, consumption: m.consumption || 0 };
      window.renderDevices?.();
    }
    const pct = m.power && m.consumption ? Math.round(m.consumption / m.power * 100) : null;
    const barColor = pct === null ? "var(--accent)" : pct > 85 ? "#ef4444" : pct > 65 ? "#f97316" : "#22c55e";
    q("poe-global").innerHTML = `
    ${m.power ? `<div style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">
        <span style="font-size:12px;font-weight:600;color:var(--text2)">PoE Verbrauch</span>
        <span style="font-size:13px;font-weight:700;color:${barColor}">${m.consumption || 0}W / ${m.power}W${pct !== null ? " (" + pct + "%)" : ""}</span>
      </div>
      <div style="height:10px;background:var(--bg3);border-radius:6px;overflow:hidden">
        <div style="height:100%;width:${Math.min(pct || 0, 100)}%;background:${barColor};border-radius:6px;transition:width .4s"></div>
      </div>
    </div>` : ""}
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      ${[{ label: "Max. Leistung", value: m.power ? m.power + "W" : "\u2014" }, { label: "Verbrauch", value: m.consumption ? m.consumption + "W" : "\u2014" }, { label: "Status", value: m.operStatus ? m.operStatus === "1" ? "On" : "Off" : "\u2014" }].map((c) => `<div class="info-card"><div class="label">${c.label}</div><div class="value">${c.value}</div></div>`).join("")}
    </div>`;
    const tbody = q("tbl-poe").querySelector("tbody");
    if (!data.portEntries.length) {
      q("poe-controls").innerHTML = "";
      tbody.innerHTML = `<tr><td colspan="5" class="empty">Keine PoE-Ports gefunden</td></tr>`;
      return;
    }
    const anyEnabled = data.portEntries.some((e) => e.adminEnable === "1" || e.adminEnable === "true");
    q("poe-controls").innerHTML = `
    <button class="btn btn-sm" onclick="togglePoeAll(true)">Alle aktivieren</button>
    <button class="btn btn-sm btn-danger" onclick="togglePoeAll(false)">Alle deaktivieren</button>
    <span style="font-size:12px;color:var(--text2)">PoE: <span class="badge ${anyEnabled ? "badge-green" : "badge-gray"}">${anyEnabled ? "Aktiv" : "Inaktiv"}</span></span>`;
    tbody.innerHTML = data.portEntries.map((e) => {
      const stN = parseInt(e.detectionStatus);
      const admin = e.adminEnable === "1" || e.adminEnable === "true";
      return `<tr>
      <td class="mono">${e.group}.${e.port}</td>
      <td>${admin ? '<span class="badge badge-green">An</span>' : '<span class="badge badge-gray">Aus</span>'}</td>
      <td><span class="badge ${POE_BADGE2[stN] || "badge-gray"}">${POE_STATUS2[stN] || e.detectionStatus || "\u2014"}</span></td>
      <td>${POE_CLASS2[parseInt(e.powerClass)] || e.powerClass || "\u2014"}</td>
      <td><button class="btn btn-sm${admin ? " btn-danger" : ""}" onclick="togglePoePort(${e.group},${e.port},${!admin})">${admin ? "Deaktivieren" : "Aktivieren"}</button></td>
    </tr>`;
    }).join("");
  }
  function renderDetailLoop(data) {
    lastLoopData = data;
    const tbody = q("tbl-loop").querySelector("tbody");
    if (!data.ports.length) {
      q("loop-controls").innerHTML = "";
      tbody.innerHTML = `<tr><td colspan="3" class="empty">Keine Daten</td></tr>`;
      return;
    }
    const anyEnabled = data.ports.some((p) => p.portEnabled !== false);
    q("loop-controls").innerHTML = `
    <button class="btn btn-sm" onclick="toggleLoopAll(true)">Alle aktivieren</button>
    <button class="btn btn-sm btn-danger" onclick="toggleLoopAll(false)">Alle deaktivieren</button>
    <span style="font-size:12px;color:var(--text2)">Loop Protection: <span class="badge ${anyEnabled ? "badge-green" : "badge-gray"}">${anyEnabled ? "Aktiv" : "Inaktiv"}</span></span>`;
    const STP_LP = { 1: "Kein Link", 2: "Blockiert", 3: "Lernen", 4: "Lernen", 5: "Normal", 6: "Fehler" };
    const STP_LP_BADGE = { 1: "badge-gray", 2: "badge-orange", 3: "badge-yellow", 4: "badge-yellow", 5: "badge-green", 6: "badge-red" };
    const LP_STATUS = { ok: "Normal", loop: "Loop erkannt!", down: "Kein Link", disabled: "LP inaktiv" };
    const LP_BADGE = { ok: "badge-green", loop: "badge-red", down: "badge-gray", disabled: "badge-gray" };
    tbody.innerHTML = data.ports.map((p) => {
      const enabled = p.portEnabled !== false;
      let lpBadge;
      if (p.lpStatus) {
        const label = LP_STATUS[p.lpStatus] || p.lpStatus;
        const badge = LP_BADGE[p.lpStatus] || "badge-gray";
        const title = p.lpTime ? ` title="Loop erkannt: ${h(p.lpTime)}"` : "";
        lpBadge = `<span class="badge ${badge}"${title}>${label}</span>`;
      } else {
        const stateN = parseInt(p.state);
        lpBadge = `<span class="badge ${STP_LP_BADGE[stateN] || "badge-gray"}">${STP_LP[stateN] || "\u2014"}</span>`;
      }
      return `<tr>
      <td class="mono">${h(p.portName)}</td>
      <td>${lpBadge}</td>
      <td><button class="btn btn-sm${enabled ? " btn-danger" : ""}" onclick="toggleLoopPort('${p.port}',${!enabled})">${enabled ? "Deaktivieren" : "Aktivieren"}</button></td>
    </tr>`;
    }).join("");
  }
  function renderScriptOutputHtml(results, ip) {
    const r0 = results?.[0];
    const cmdCount = r0?.combined ? r0.commands?.length ?? 0 : results?.length ?? 0;
    let lines = [`# Ger\xE4t: ${ip}  |  ${cmdCount} Befehl(e)  |  ${(/* @__PURE__ */ new Date()).toLocaleString("de-DE")}`, ""];
    if (r0?.combined) {
      for (const cmd of r0.commands ?? []) lines.push(`$ ${cmd}`);
      lines.push(`[exit ${r0.exitCode}]`, "");
      if (r0.stdout && r0.stdout.trim()) lines.push(r0.stdout.trimEnd(), "");
      if (r0.stderr && r0.stderr.trim()) lines.push(r0.stderr.trimEnd());
    } else {
      for (const r of results ?? []) {
        lines.push(`$ ${r.cmd}  [exit ${r.exitCode}]`);
        if (r.stdout && r.stdout.trim()) lines.push(r.stdout.trimEnd());
        if (r.stderr && r.stderr.trim()) lines.push(r.stderr.trimEnd());
        lines.push("");
      }
    }
    return `<pre style="margin:0;padding:14px 16px;font-family:'JetBrains Mono',monospace;font-size:12px;line-height:1.6;color:var(--text1);white-space:pre-wrap;word-break:break-all">${esc2(lines.join("\n"))}</pre>`;
  }
  window.toggleIfaceAdmin = toggleIfaceAdmin;
  window.toggleLldpPort = toggleLldpPort;
  window.toggleLldpAll = toggleLldpAll;
  window.toggleStpPort = toggleStpPort;
  window.toggleStpAll = toggleStpAll;
  window.setSTPMode = setSTPMode;
  window.togglePoePort = togglePoePort;
  window.togglePoeAll = togglePoeAll;
  window.toggleLoopPort = toggleLoopPort;
  window.toggleLoopAll = toggleLoopAll;

  // ui/tabs/topology.js
  var topoNodes = {};
  var topoEdges = [];
  var topoLldpMap = {};
  var _topoSavedPos = (() => {
    try {
      return JSON.parse(localStorage.getItem("onsite_topo_pos") || "{}");
    } catch (e) {
      return {};
    }
  })();
  var topoMacSearch = "";
  var topoMacResults = [];
  var topoTx = 0;
  var topoTy = 0;
  var topoScale = 1;
  var topoDragNode = null;
  var topoPan = null;
  var topoWasDrag = false;
  var topoRootId = "";
  var topoDetailId = null;
  var topoViewMode = "default";
  var trafficEnabled = false;
  var trafficData = {};
  var trafficHistory = {};
  var trafficTimer = null;
  var NW = 190;
  var NH = 84;
  var HG = 230;
  var VG = 140;
  var TOPO_TYPE_BADGE = {
    switch: { label: "SW", bg: "rgba(170,218,247,.15)", color: "#aadaf7" },
    "lx-ap": { label: "AP", bg: "rgba(249,115,22,.15)", color: "#f97316" },
    "lcos-ap": { label: "AP", bg: "rgba(249,115,22,.15)", color: "#f97316" },
    router: { label: "GW", bg: "rgba(37,99,235,.15)", color: "#7b9fff" },
    firewall: { label: "FW", bg: "rgba(239,68,68,.15)", color: "#ef4444" }
  };
  function resolveTopoNeighbor(entry, srcIp) {
    const sysName = (entry.remSysName || "").toLowerCase();
    const remMac = (entry.remMac || "").replace(/[:\-\. ]/g, "").toLowerCase();
    const remPortMac = (entry.remPortMac || "").replace(/[:\-\. ]/g, "").toLowerCase();
    const remChasIp = entry.remChassisIp || "";
    const normMac2 = (m) => (m || "").replace(/[:\-\. ]/g, "").toLowerCase();
    const normStr = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const sysNorm = normStr(sysName);
    for (const d of Object.values(state_default.deviceStore)) {
      if (sysName && (d.name || "").toLowerCase() === sysName) return d.ip;
      if (remMac) {
        if (normMac2(d.mac) === remMac) return d.ip;
        if (d.macs?.some((m) => normMac2(m) === remMac)) return d.ip;
      }
      if (remPortMac) {
        if (normMac2(d.mac) === remPortMac) return d.ip;
        if (d.macs?.some((m) => normMac2(m) === remPortMac)) return d.ip;
      }
      if (remChasIp && d.ip === remChasIp) return d.ip;
    }
    if (sysNorm) {
      for (const d of Object.values(state_default.deviceStore)) {
        const dn = normStr(d.name);
        if (dn && (sysNorm.startsWith(dn) || dn.startsWith(sysNorm))) return d.ip;
      }
    }
    if (sysName) {
      for (const d of Object.values(state_default.deviceStore)) {
        const dn = (d.name || "").toLowerCase();
        if (dn && (dn.includes(sysName) || sysName.includes(dn))) return d.ip;
      }
    }
    const normPort = (s) => {
      const t = (s || "").trim();
      return /^\d+$/.test(t) ? String(parseInt(t, 10)) : t.toLowerCase();
    };
    const myLocal = normPort(entry.localPortName);
    const myRemote = normPort(entry.remPortId);
    if (myLocal && myRemote && srcIp) {
      for (const [devIp, devEntries] of Object.entries(topoLldpMap)) {
        if (devIp === srcIp) continue;
        for (const de of devEntries) {
          if (normPort(de.localPortName) === myRemote && normPort(de.remPortId) === myLocal) return devIp;
        }
      }
    }
    return null;
  }
  function portLabelForRemote(e, tgtIp, lldpMap) {
    const rpi = (e.remPortId || "").trim();
    const isMac = /^([0-9a-fA-F]{2}[:\- ]){5}[0-9a-fA-F]{2}$/.test(rpi);
    if (!isMac) return rpi;
    if (e.remPortDesc) return e.remPortDesc;
    if (tgtIp) {
      const srcDev = state_default.deviceStore[e._srcIp] || {};
      const srcMacs = new Set(
        [srcDev.mac || "", ...srcDev.macs || []].map((m) => m.replace(/[:\-\. ]/g, "").toLowerCase()).filter(Boolean)
      );
      const rev = (lldpMap[tgtIp] || []).find((r) => {
        const rm = (r.remMac || "").replace(/[:\-\. ]/g, "").toLowerCase();
        const rpm = (r.remPortMac || "").replace(/[:\-\. ]/g, "").toLowerCase();
        if (rm && srcMacs.has(rm) || rpm && srcMacs.has(rpm) || r.remChassisIp === e._srcIp) return true;
        return resolveTopoNeighbor(r, tgtIp) === e._srcIp;
      });
      if (rev?.localPortName) return rev.localPortName;
    }
    return rpi;
  }
  function buildTopoGraph(lldpMap) {
    topoNodes = {};
    topoEdges = [];
    Object.values(state_default.deviceStore).filter((d) => {
      if (d.online === false) return false;
      if (state_default.topoLocFilter !== "all" && (d.location || "") !== state_default.topoLocFilter) return false;
      return true;
    }).forEach((d) => {
      topoNodes[d.ip] = {
        id: d.ip,
        name: d.name || d.ip,
        type: d.type || "unknown",
        os: d.os || "",
        model: d.model || "",
        location: d.location || "",
        online: d.online,
        ghost: false,
        x: 0,
        y: 0,
        fixed: false
      };
    });
    const edgeSet = /* @__PURE__ */ new Set();
    Object.entries(lldpMap).forEach(([srcIp, entries]) => {
      entries.forEach((e) => {
        e._srcIp = srcIp;
        const tgtIp = resolveTopoNeighbor(e, srcIp);
        let tgtId = tgtIp;
        if (!tgtIp) {
          tgtId = "ghost_" + (e.remSysName || e.remMac || "unknown").replace(/[^a-z0-9]/gi, "_");
          if (!topoNodes[tgtId]) {
            const _rpi = (e.remPortId || "").trim();
            const _portMac = /^([0-9a-fA-F]{2}[:\- ]){5}[0-9a-fA-F]{2}$/.test(_rpi);
            const ghostMac = e.remMac ? e.remMac.toLowerCase() : _portMac ? _rpi.replace(/[\- ]/g, ":").toLowerCase() : "";
            const ghostInfo = e.remPortDesc || (!_portMac && e.remSysName && _rpi ? _rpi : "");
            topoNodes[tgtId] = {
              id: tgtId,
              name: e.remSysName || e.remPortId || "Unbekannt",
              type: "unknown",
              os: "",
              model: "",
              online: void 0,
              ghost: true,
              x: 0,
              y: 0,
              fixed: false,
              ghostMac,
              ghostInfo,
              ghostSrc: srcIp
            };
          }
        }
        const edgeKey = [srcIp, tgtId].sort().join("||");
        if (edgeSet.has(edgeKey)) {
          const ex = topoEdges.find((ed) => ed.id === edgeKey);
          if (ex && ex.src === tgtId && !ex.dstPort) ex.dstPort = e.localPortName;
          if (ex && ex.src === srcIp && !ex.dstPort) ex.dstPort = portLabelForRemote(e, tgtIp, lldpMap);
        } else {
          edgeSet.add(edgeKey);
          topoEdges.push({
            id: edgeKey,
            src: srcIp,
            tgt: tgtId,
            srcPort: e.localPortName || "",
            dstPort: portLabelForRemote(e, tgtIp, lldpMap)
          });
        }
      });
    });
  }
  function layoutTopo(rootId) {
    const ids = Object.keys(topoNodes);
    if (!ids.length) return {};
    const adj = {};
    ids.forEach((id) => {
      adj[id] = [];
    });
    topoEdges.forEach((e) => {
      if (adj[e.src] !== void 0 && topoNodes[e.tgt]) adj[e.src].push(e.tgt);
      if (adj[e.tgt] !== void 0 && topoNodes[e.src]) adj[e.tgt].push(e.src);
    });
    let root = ids.includes(rootId) ? rootId : "";
    if (!root) {
      const deg = {};
      ids.forEach((id) => {
        deg[id] = (adj[id] || []).length;
      });
      root = [...ids].sort((a, b) => deg[b] - deg[a])[0] || ids[0];
      topoRootId = root;
    }
    const level = {}, byLevel = {};
    const queue = [root];
    let head = 0;
    level[root] = 0;
    byLevel[0] = [root];
    while (head < queue.length) {
      const curr = queue[head++];
      (adj[curr] || []).forEach((next) => {
        if (level[next] === void 0) {
          level[next] = level[curr] + 1;
          if (!byLevel[level[next]]) byLevel[level[next]] = [];
          byLevel[level[next]].push(next);
          queue.push(next);
        }
      });
    }
    const levels = Object.keys(byLevel).map(Number).sort((a, b) => a - b);
    levels.forEach((lvl) => {
      const group = byLevel[lvl];
      const totalW = (group.length - 1) * HG;
      group.forEach((id, i) => {
        topoNodes[id].x = i * HG - totalW / 2;
        topoNodes[id].y = lvl * VG;
      });
    });
    const unconnected = ids.filter((id) => level[id] === void 0);
    const maxLvl = levels.length ? Math.max(...levels) : 0;
    const unconnY = (maxLvl + 2) * VG;
    const totalUW = (unconnected.length - 1) * HG;
    unconnected.forEach((id, i) => {
      topoNodes[id].x = i * HG - totalUW / 2;
      topoNodes[id].y = unconnY;
    });
    Object.values(topoNodes).forEach((n) => {
      const s = _topoSavedPos[n.id];
      if (s) {
        n.x = s.x;
        n.y = s.y;
      }
    });
    return { level, byLevel, unconnected, maxLvl };
  }
  function buildTopoSelector() {
    const devIds = Object.keys(topoNodes).filter((id) => !topoNodes[id].ghost);
    if (!devIds.length) return;
    if (!devIds.includes(topoRootId)) {
      const deg = {};
      devIds.forEach((id) => {
        deg[id] = 0;
      });
      topoEdges.forEach((e) => {
        if (deg[e.src] !== void 0) deg[e.src]++;
        if (deg[e.tgt] !== void 0) deg[e.tgt]++;
      });
      topoRootId = [...devIds].sort((a, b) => deg[b] - deg[a])[0] || devIds[0];
    }
    const sorted = [...devIds].sort((a, b) => (topoNodes[a].name || "").localeCompare(topoNodes[b].name || ""));
    const sel = q("topo-root-select");
    sel.innerHTML = sorted.map(
      (id) => `<option value="${h(id)}"${id === topoRootId ? " selected" : ""}>${h(topoNodes[id].name)}</option>`
    ).join("");
  }
  function topoChangeRoot() {
    topoRootId = q("topo-root-select").value;
    layoutTopo(topoRootId);
    renderTopoSvg();
    setTimeout(topoFit, 50);
  }
  function topoTheme() {
    const dark = document.documentElement.dataset.theme === "dark";
    return {
      // Node text — matches --text / --text2 from CSS variables
      nodeText: dark ? "#e8f0f8" : "rgba(15,30,55,.92)",
      nodeSub: dark ? "#7ea8c8" : "rgba(74,100,120,.75)",
      nodePort: dark ? "rgba(200,225,248,.9)" : "rgba(30,50,80,.88)",
      portStroke: dark ? "rgba(10,22,40,.95)" : "rgba(240,244,248,.95)",
      // Node backgrounds
      bgOnline: dark ? "rgba(52,217,123,.06)" : "rgba(26,138,62,.05)",
      bgOffline: dark ? "rgba(240,85,104,.06)" : "rgba(211,47,47,.05)",
      bgUnknown: dark ? "rgba(77,166,255,.04)" : "rgba(100,116,139,.05)",
      // Node border + dot colours (new dark palette)
      borderOnline: dark ? "rgba(52,217,123,.6)" : "rgba(26,138,62,.55)",
      borderOffline: dark ? "rgba(240,85,104,.5)" : "rgba(211,47,47,.4)",
      borderUnknown: dark ? "rgba(77,166,255,.3)" : "rgba(100,116,139,.4)",
      dotOnline: dark ? "#2dd4a0" : "#1a8a3e",
      dotOffline: dark ? "#f05568" : "#d32f2f",
      dotUnknown: dark ? "rgba(126,168,200,.6)" : "rgba(100,116,139,.6)",
      // Ghost nodes
      ghostBg: dark ? "rgba(22,40,68,.8)" : "rgba(220,230,240,.85)",
      ghostText: dark ? "#a8c8e8" : "rgba(74,100,120,.85)",
      ghostSub: dark ? "#5e8aaa" : "rgba(120,140,160,.75)",
      ghostBorder: dark ? "rgba(77,166,255,.25)" : "rgba(100,116,139,.35)",
      // Separator line / label
      sepStroke: dark ? "rgba(77,166,255,.1)" : "rgba(0,40,85,.1)",
      sepText: dark ? "rgba(126,168,200,.4)" : "rgba(100,116,139,.4)"
    };
  }
  var trafficPollCount = 0;
  function toggleTraffic() {
    trafficEnabled = !trafficEnabled;
    const btn = document.getElementById("topo-traffic-btn");
    if (btn) {
      btn.textContent = trafficEnabled ? "Traffic: An" : "Traffic";
      btn.style.color = trafficEnabled ? "#22c55e" : "";
      btn.style.borderColor = trafficEnabled ? "rgba(34,197,94,.4)" : "";
    }
    if (trafficEnabled) {
      trafficPollCount = 0;
      setTopoStatus("\u{1F4E1} Bandbreite wird gemessen\u2026 (erste Werte nach ~5s)");
      fetchTrafficData();
      trafficTimer = setInterval(fetchTrafficData, 5e3);
    } else {
      clearInterval(trafficTimer);
      trafficTimer = null;
      trafficData = {};
      trafficHistory = {};
      setTopoStatus("");
      renderTopoSvg();
    }
  }
  async function fetchTrafficData() {
    try {
      const res = await fetch("/api/iftraffic");
      if (!res.ok) {
        setTopoStatus("\u26A0 Traffic-Abfrage fehlgeschlagen (HTTP " + res.status + ")");
        return;
      }
      trafficData = await res.json();
      trafficPollCount++;
      const devCount = Object.keys(trafficData).length;
      if (trafficPollCount === 1) {
        setTopoStatus(`\u{1F4E1} Erste Messung l\xE4uft (${devCount} Ger\xE4t${devCount !== 1 ? "e" : ""})\u2026 warte auf Delta\u2026`);
      } else {
        let maxBps = 0;
        Object.values(trafficData).forEach((d) => Object.values(d).forEach((i) => {
          maxBps = Math.max(maxBps, i.inBps, i.outBps);
        }));
        setTopoStatus(`\u{1F4F6} Traffic aktiv \xB7 ${devCount} Ger\xE4t${devCount !== 1 ? "e" : ""} \xB7 max ${formatBps(maxBps)}`);
      }
      topoEdges.forEach((e) => {
        const iface = getIfaceForEdge(e);
        if (!iface) return;
        const key = `${e.src}|${e.srcPort || ""}`;
        if (!trafficHistory[key]) trafficHistory[key] = [];
        trafficHistory[key].push({ inBps: iface.inBps, outBps: iface.outBps });
        if (trafficHistory[key].length > 12) trafficHistory[key].shift();
      });
      renderTopoSvg();
      if (topoDetailId) topoOpenDetail(topoDetailId);
    } catch (err) {
      setTopoStatus("\u26A0 Traffic-Fehler: " + err.message);
    }
  }
  function setTopoStatus(msg) {
    const el = q("topo-status");
    if (el) el.textContent = msg;
  }
  function searchTopoMac(val) {
    topoMacSearch = val.trim().toLowerCase();
    q("topo-mac-clear").style.display = topoMacSearch ? "" : "none";
    topoMacResults = [];
    if (topoMacSearch.length >= 4) {
      const infraMacs = new Set(Object.values(state_default.deviceStore).map((d) => (d.mac || "").toLowerCase()).filter(Boolean));
      const wlanMacs = /* @__PURE__ */ new Set();
      Object.values(state_default.deviceStore).forEach((dev) => {
        (dev.wlanClients || []).forEach((c) => {
          const mac = (c.mac || "").toLowerCase();
          const ip = (c.ip || "").toLowerCase();
          const host = (c.hostname || "").toLowerCase();
          if (mac.includes(topoMacSearch) || ip.includes(topoMacSearch) || host.includes(topoMacSearch)) {
            wlanMacs.add(mac);
            topoMacResults.push({ switchIp: dev.ip, switchName: dev.name || dev.ip, port: c.ssid ? `${c.ssid} \xB7 ${c.band || "WLAN"}` : "WLAN", mac: c.mac || "", ip: c.ip || "", hostname: c.hostname || "", type: "wlan" });
          }
        });
      });
      Object.values(state_default.deviceStore).forEach((dev) => {
        (dev.fdbEntries || []).forEach((e) => {
          const mac = (e.mac || "").toLowerCase();
          const ip = (e.ip || "").toLowerCase();
          if (mac.includes(topoMacSearch) || ip.includes(topoMacSearch)) {
            if (!infraMacs.has(mac) && !wlanMacs.has(mac))
              topoMacResults.push({ switchIp: dev.ip, switchName: dev.name || dev.ip, port: e.port || "?", mac: e.mac || "", ip: e.ip || "", type: "fdb" });
          }
        });
      });
    }
    renderTopoSvg();
    if (topoMacSearch.length >= 4) {
      setTopoStatus(topoMacResults.length ? `${topoMacResults.length} Treffer f\xFCr \u201E${topoMacSearch}"` : `Keine Treffer f\xFCr \u201E${topoMacSearch}"`);
    } else if (!topoMacSearch) {
      setTopoStatus("");
    }
  }
  function clearTopoMacSearch() {
    const inp = q("topo-mac-search");
    if (inp) inp.value = "";
    searchTopoMac("");
  }
  function getIfaceForEdge(edge) {
    const map = trafficData[edge.src];
    if (!map || !edge.srcPort) return null;
    if (map[edge.srcPort]) return map[edge.srcPort];
    const norm = (s) => (s || "").toLowerCase().replace(/\s+/g, "").replace(/[\-_]/g, "");
    const t = norm(edge.srcPort);
    for (const [k, v] of Object.entries(map)) {
      if (norm(k) === t) return v;
    }
    const extractNum = (s) => {
      const m = (s || "").match(/(\d+)\s*[a-z]?\s*$/i);
      return m ? parseInt(m[1], 10) : null;
    };
    const edgeNum = extractNum(edge.srcPort);
    if (edgeNum !== null) {
      const physRe = /^(port|gigabit|switch|ethernet|eth|ge|fe|te|lan)/i;
      for (const [k, v] of Object.entries(map)) {
        if (physRe.test(k) && extractNum(k) === edgeNum) return v;
      }
      for (const [k, v] of Object.entries(map)) {
        if (/^\d+$/.test(k.trim()) && parseInt(k.trim(), 10) === edgeNum) return v;
      }
    }
    return null;
  }
  function edgeUtilPct(edge) {
    return getIfaceForEdge(edge)?.utilPct || 0;
  }
  function edgeWidthWithTraffic(base, util) {
    return !trafficEnabled || !util ? base : base + Math.min(3.5, util / 100 * 3.5);
  }
  function edgeColorWithTraffic(base, util) {
    if (!trafficEnabled || util < 60) return base;
    return util < 80 ? "rgba(234,179,8,.85)" : "rgba(239,68,68,.9)";
  }
  function formatBps(bps) {
    if (bps >= 1e9) return (bps / 1e9).toFixed(2) + " Gbps";
    if (bps >= 1e6) return (bps / 1e6).toFixed(1) + " Mbps";
    if (bps >= 1e3) return (bps / 1e3).toFixed(0) + " kbps";
    return bps + " bps";
  }
  function trafficEdgeHover(event, src, srcPort) {
    const tt = document.getElementById("traffic-tt");
    if (!tt || !trafficEnabled) return;
    const iface = getIfaceForEdge({ src, srcPort });
    if (!iface) {
      tt.style.display = "none";
      return;
    }
    const key = `${src}|${srcPort}`;
    const hist = trafficHistory[key] || [];
    const pts = hist.length > 1 ? hist : [{ inBps: 0, outBps: 0 }, { inBps: 0, outBps: 0 }];
    const MAX = Math.max(...pts.map((p) => Math.max(p.inBps, p.outBps)), iface.inBps, iface.outBps, 1);
    const W = 120, H = 36, step = W / (pts.length - 1);
    const spark = (key2) => pts.map((p, i) => `${(i * step).toFixed(1)},${(H - p[key2] / MAX * H).toFixed(1)}`).join(" ");
    const util = iface.utilPct.toFixed(1);
    const spd = iface.speedBps ? ` \xB7 ${formatBps(iface.speedBps)}` : "";
    const devName = state_default.deviceStore[src]?.name || src;
    const histKey = `${src}|${srcPort}`;
    const hist2 = trafficHistory[histKey] || [];
    const pts2 = hist2.length > 1 ? hist2 : [{ inBps: 0, outBps: 0 }, { inBps: 0, outBps: 0 }];
    const MAX2 = Math.max(...pts2.map((p) => Math.max(p.inBps, p.outBps)), iface.inBps, iface.outBps, 1);
    const step2 = W / (pts2.length - 1);
    const spark2 = (k) => pts2.map((p, i) => `${(i * step2).toFixed(1)},${(H - p[k] / MAX2 * H).toFixed(1)}`).join(" ");
    tt.innerHTML = `
    <div style="font-size:10px;color:#94a3b8;margin-bottom:2px">${h(devName)}</div>
    <div style="font-size:11px;font-weight:700;color:#e2e8f0;margin-bottom:5px">Port: ${h(srcPort)}</div>
    <svg width="${W}" height="${H}" style="display:block;margin-bottom:5px;overflow:visible">
      <polyline points="${spark2("outBps")}" fill="none" stroke="#f97316" stroke-width="1.5" stroke-linejoin="round"/>
      <polyline points="${spark2("inBps")}"  fill="none" stroke="#22c55e" stroke-width="1.5" stroke-linejoin="round"/>
    </svg>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:10px">
      <span style="color:#f97316">TX: ${h(formatBps(iface.outBps))}</span>
      <span style="color:#22c55e">RX: ${h(formatBps(iface.inBps))}</span>
      <span style="color:#94a3b8;grid-column:1/-1">${util}% Auslastung${h(spd)}</span>
    </div>`;
    tt.style.display = "block";
    tt.style.left = event.clientX + 16 + "px";
    tt.style.top = event.clientY - 20 + "px";
  }
  function trafficEdgeLeave() {
    const tt = document.getElementById("traffic-tt");
    if (tt) tt.style.display = "none";
  }
  function toggleTopoMode() {
    topoViewMode = topoViewMode === "blueprint" ? "default" : "blueprint";
    const btn = document.getElementById("topo-bp-btn");
    if (btn) {
      btn.textContent = topoViewMode === "blueprint" ? "Normal" : "Blueprint";
      btn.style.color = topoViewMode === "blueprint" ? "#00c8ff" : "";
      btn.style.borderColor = topoViewMode === "blueprint" ? "rgba(0,200,255,.4)" : "";
    }
    q("topo-container").classList.toggle("bp-mode", topoViewMode === "blueprint");
    renderTopoSvg();
  }
  function bpNodeHover(id) {
    const g = q("topo-g");
    const neighbors = /* @__PURE__ */ new Set([id]);
    topoEdges.forEach((e) => {
      if (e.src === id || e.tgt === id) {
        neighbors.add(e.src);
        neighbors.add(e.tgt);
      }
    });
    g.querySelectorAll("[data-bp-node]").forEach((el) => {
      el.style.opacity = neighbors.has(el.getAttribute("data-bp-node")) ? "1" : "0.1";
    });
    g.querySelectorAll("[data-bp-edge-src]").forEach((el) => {
      const s = el.getAttribute("data-bp-edge-src");
      const t = el.getAttribute("data-bp-edge-tgt");
      el.style.opacity = neighbors.has(s) && neighbors.has(t) ? "1" : "0.05";
    });
  }
  function bpNodeHoverEnd() {
    q("topo-g").querySelectorAll("[data-bp-node],[data-bp-edge-src]").forEach((el) => {
      el.style.opacity = "";
    });
  }
  function renderTopoSvgBlueprint() {
    const nodes = Object.values(topoNodes);
    q("topo-empty").style.display = nodes.length ? "none" : "";
    if (!nodes.length) {
      q("topo-g").innerHTML = "";
      return;
    }
    const hw = NW / 2, hh = NH / 2;
    const CR = 12;
    function borderPt(cx, cy, tx, ty) {
      const dx = tx - cx, dy = ty - cy;
      if (!dx && !dy) return { x: cx, y: cy + hh };
      const sX = dx ? hw / Math.abs(dx) : Infinity;
      const sY = dy ? hh / Math.abs(dy) : Infinity;
      const s = Math.min(sX, sY);
      return { x: cx + dx * s, y: cy + dy * s };
    }
    function bpEdgePath(fx, fy, tx, ty) {
      const midX = (fx + tx) / 2;
      if (Math.abs(tx - fx) < 4) return `M${fx.toFixed(1)},${fy.toFixed(1)} L${tx.toFixed(1)},${ty.toFixed(1)}`;
      const sx1 = midX >= fx ? 1 : -1;
      const sx2 = tx >= midX ? 1 : -1;
      const sy = ty > fy ? 1 : ty < fy ? -1 : 0;
      const rr = Math.min(CR, Math.abs(midX - fx) - 1, Math.abs(ty - fy) / 2 + 0.1);
      if (rr < 2 || sy === 0) return `M${fx.toFixed(1)},${fy.toFixed(1)} H${midX.toFixed(1)} V${ty.toFixed(1)} H${tx.toFixed(1)}`;
      return `M${fx.toFixed(1)},${fy.toFixed(1)} H${(midX - sx1 * rr).toFixed(1)} Q${midX.toFixed(1)},${fy.toFixed(1)} ${midX.toFixed(1)},${(fy + sy * rr).toFixed(1)} V${(ty - sy * rr).toFixed(1)} Q${midX.toFixed(1)},${ty.toFixed(1)} ${(midX + sx2 * rr).toFixed(1)},${ty.toFixed(1)} H${tx.toFixed(1)}`;
    }
    function bpAccent(type) {
      switch (type) {
        case "switch":
          return "#00c8ff";
        case "lx-ap":
        case "lcos-ap":
          return "#ff8c00";
        case "router":
          return "#4d8fff";
        case "firewall":
          return "#ef4444";
        default:
          return "#64748b";
      }
    }
    function bpEdgeColor(e, bothOnline, ghost) {
      if (ghost) return "rgba(40,60,100,.5)";
      if (e.type === "wds") return bothOnline ? "#ff8c00" : "rgba(255,140,0,.3)";
      if (e.type === "l2tp") return bothOnline ? "#22c55e" : "rgba(34,197,94,.3)";
      return bothOnline ? "#00c8ff" : "rgba(0,200,255,.3)";
    }
    let svg = "";
    const connectedIds = new Set(topoEdges.flatMap((e) => [e.src, e.tgt]));
    const unconn = nodes.filter((n) => !connectedIds.has(n.id));
    const conn = nodes.filter((n) => connectedIds.has(n.id));
    if (unconn.length && conn.length) {
      const uy = Math.min(...unconn.map((n) => n.y));
      const xs = unconn.map((n) => n.x);
      const x1 = Math.min(...xs) - hw - 30, x2 = Math.max(...xs) + hw + 30;
      svg += `<line x1="${x1}" y1="${uy - 55}" x2="${x2}" y2="${uy - 55}" stroke="rgba(0,200,255,.12)" stroke-width="1" stroke-dasharray="4,4"/>`;
      svg += `<text x="${(x1 + x2) / 2}" y="${uy - 64}" text-anchor="middle" font-size="9" font-weight="700" fill="rgba(0,200,255,.25)" font-family="system-ui,sans-serif" letter-spacing="0.12em">KEINE VERBINDUNG</text>`;
    }
    const pairCount = {}, pairSeen = {};
    topoEdges.forEach((e) => {
      const k = [e.src, e.tgt].sort().join("||");
      pairCount[k] = (pairCount[k] || 0) + 1;
      pairSeen[k] = 0;
    });
    const LOFF = 14;
    function bpLabelPt(cx, cy, bx, by) {
      if (Math.abs(Math.abs(by - cy) - hh) < 0.5) return { x: bx, y: cy + Math.sign(by - cy) * (hh + LOFF), anchor: "middle" };
      return { x: cx + Math.sign(bx - cx) * (hw + LOFF), y: by, anchor: bx > cx ? "start" : "end" };
    }
    topoEdges.forEach((e) => {
      const f = topoNodes[e.src], t = topoNodes[e.tgt];
      if (!f || !t) return;
      const bothOnline = f.online === true && t.online === true;
      const ghost = f.ghost || t.ghost;
      const pairKey = [e.src, e.tgt].sort().join("||");
      const total = pairCount[pairKey] || 1;
      const idx = pairSeen[pairKey]++;
      const offset = (idx - (total - 1) / 2) * 44;
      const fs = borderPt(f.x, f.y, t.x, t.y);
      const te = borderPt(t.x, t.y, f.x, f.y);
      const fxA = fs.x, fyA = fs.y + offset;
      const txA = te.x, tyA = te.y + offset;
      const util = ghost ? 0 : edgeUtilPct(e);
      const color = edgeColorWithTraffic(bpEdgeColor(e, bothOnline, ghost), util);
      const w = edgeWidthWithTraffic(ghost ? 1 : 1.5, util);
      const isActive = bothOnline && !ghost && e.type !== "l2tp";
      const d = bpEdgePath(fxA, fyA, txA, tyA);
      const portStyle = `font-size="9" font-weight="600" fill="${color}" font-family="monospace,system-ui" opacity="0.75"`;
      const tevt = trafficEnabled && !ghost && e.srcPort ? ` onmouseenter="trafficEdgeHover(event,'${h(e.src)}','${h(e.srcPort)}')" onmouseleave="trafficEdgeLeave()"  style="cursor:crosshair"` : "";
      svg += `<g data-bp-edge-src="${h(e.src)}" data-bp-edge-tgt="${h(e.tgt)}">`;
      if (tevt) {
        svg += `<path d="${d}" stroke="transparent" stroke-width="14" fill="none"${tevt}/>`;
      }
      if (isActive) {
        svg += `<path d="${d}" stroke="${color}" stroke-width="${w + 3}" fill="none" opacity="0.07" style="pointer-events:none"/>`;
        svg += `<path class="topo-bp-flow" d="${d}" stroke="${color}" stroke-width="${w}" fill="none" stroke-linecap="round" style="pointer-events:none"/>`;
      } else {
        const da = ghost || !bothOnline ? ' stroke-dasharray="5,4"' : "";
        svg += `<path d="${d}" stroke="${color}" stroke-width="${w}" fill="none"${da} style="pointer-events:none"/>`;
      }
      if (trafficEnabled && !ghost) {
        const iface = getIfaceForEdge(e);
        if (iface && (iface.outBps > 1e3 || iface.inBps > 1e3)) {
          const lx = (fxA + txA) / 2, ly = (fyA + tyA) / 2;
          svg += `<text x="${lx.toFixed(1)}" y="${(ly - 10).toFixed(1)}" text-anchor="middle" font-size="8" font-weight="700" fill="#f97316" font-family="monospace,system-ui" style="pointer-events:none">TX ${h(formatBps(iface.outBps))}</text>`;
          svg += `<text x="${lx.toFixed(1)}" y="${(ly + 1).toFixed(1)}" text-anchor="middle" font-size="8" font-weight="700" fill="#22c55e" font-family="monospace,system-ui" style="pointer-events:none">RX ${h(formatBps(iface.inBps))}</text>`;
        }
      }
      if (e.srcPort) {
        const lp = bpLabelPt(f.x, f.y, fs.x, fs.y);
        svg += `<text x="${lp.x.toFixed(1)}" y="${(lp.y + offset * 0.3).toFixed(1)}" text-anchor="${lp.anchor}" ${portStyle}>${h(e.srcPort)}</text>`;
      }
      if (e.dstPort) {
        const rp = bpLabelPt(t.x, t.y, te.x, te.y);
        svg += `<text x="${rp.x.toFixed(1)}" y="${(rp.y + offset * 0.3).toFixed(1)}" text-anchor="${rp.anchor}" ${portStyle}>${h(e.dstPort)}</text>`;
      }
      svg += `</g>`;
    });
    nodes.forEach((node) => {
      const { x, y } = node;
      const rx = x - hw, ry = y - hh;
      const isRoot = node.id === topoRootId;
      const ac = node.ghost ? "#64748b" : bpAccent(node.type);
      if (node.ghost) {
        const dn = node.name.length > 22 ? node.name.slice(0, 21) + "\u2026" : node.name;
        const gmac = node.ghostMac || "";
        const ginfo = node.ghostInfo || "";
        const gSrcName = node.ghostSrc ? state_default.deviceStore[node.ghostSrc]?.name || node.ghostSrc : "";
        const extras = (gmac ? 1 : 0) + (ginfo ? 1 : 0) + (gSrcName ? 1 : 0);
        const cardH = NH + (extras >= 2 ? 20 : extras === 1 ? 10 : 0);
        const nameY = ry + (extras >= 2 ? 17 : extras === 1 ? 20 : 25);
        const macY = ry + (extras >= 2 ? 29 : 35);
        const infoY = ry + (extras >= 2 ? 41 : 35);
        const srcY = ry + (extras >= 3 ? 52 : extras === 2 ? 52 : extras === 1 ? 48 : 42);
        const tagY = ry + (extras >= 3 ? 63 : extras >= 2 ? 63 : extras === 1 ? 58 : 42);
        svg += `<g class="topo-node" data-bp-node="${h(node.id)}" opacity="0.55" onmousedown="topoNodeDragStart(event,'${h(node.id)}',event)" onclick="topoNodeClick('${h(node.id)}')" onmouseenter="bpNodeHover('${h(node.id)}')" onmouseleave="bpNodeHoverEnd()">
        <rect x="${rx}" y="${ry}" width="${NW}" height="${cardH}" rx="6" fill="#0f2540" stroke="rgba(148,163,184,.4)" stroke-width="1" stroke-dasharray="5,3"/>
        <text x="${rx + NW / 2}" y="${nameY}" text-anchor="middle" font-size="12" font-weight="600" fill="rgba(148,163,184,.7)" font-family="system-ui,sans-serif">${h(dn)}</text>
        ${gmac ? `<text x="${rx + NW / 2}" y="${macY}"  text-anchor="middle" font-size="9" fill="rgba(100,116,139,.6)" font-family="monospace,system-ui">${h(gmac)}</text>` : ""}
        ${ginfo ? `<text x="${rx + NW / 2}" y="${infoY}" text-anchor="middle" font-size="9" fill="rgba(100,116,139,.5)" font-family="system-ui,sans-serif">${h(ginfo)}</text>` : ""}
        ${gSrcName ? `<text x="${rx + NW / 2}" y="${srcY}" text-anchor="middle" font-size="8" fill="rgba(100,116,139,.4)" font-family="system-ui,sans-serif">via ${h(gSrcName)}</text>` : ""}
        <text x="${rx + NW / 2}" y="${tagY}" text-anchor="middle" font-size="9" fill="rgba(100,116,139,.35)" font-family="system-ui,sans-serif" font-style="italic">nicht verwaltet</text>
      </g>`;
        return;
      }
      const badge = TOPO_TYPE_BADGE[node.type];
      const badgeLabel = badge?.label || "?";
      const dname = node.name.length > 21 ? node.name.slice(0, 20) + "\u2026" : node.name;
      const dsub = (node.model || node.os || "").slice(0, 26);
      const dloc = (node.location || "").slice(0, 28);
      const glow = isRoot ? ` filter="url(#topo-glow)"` : "";
      const ledFill = node.online === true ? ac : node.online === false ? "#1c304a" : "rgba(80,110,150,.5)";
      const ledStroke = node.online !== true ? ` stroke="${ac}" stroke-width="1.5"` : "";
      const ledAnim = node.online === true ? `<circle cx="${rx + 14}" cy="${y}" r="5" fill="${ac}" opacity="0"><animate attributeName="r" values="5;10;5" dur="2.5s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.5;0;0.5" dur="2.5s" repeatCount="indefinite"/></circle>` : "";
      const rootPulse = isRoot ? `<rect x="${rx - 1}" y="${ry - 1}" width="${NW + 2}" height="${NH + 2}" rx="7" fill="none" stroke="${ac}" stroke-width="1.5" opacity="0"><animate attributeName="opacity" values="0.65;0;0.65" dur="2.8s" repeatCount="indefinite"/></rect>` : "";
      svg += `<g class="topo-node" data-bp-node="${h(node.id)}" onmousedown="topoNodeDragStart(event,'${h(node.id)}',event)" onclick="topoNodeClick('${h(node.id)}')" onmouseenter="bpNodeHover('${h(node.id)}')" onmouseleave="bpNodeHoverEnd()"${glow}>
      ${rootPulse}
      <rect x="${rx}" y="${ry}" width="${NW}" height="${NH}" rx="6" fill="#102236" stroke="${ac}" stroke-width="${isRoot ? 2 : 1.2}"/>
      <rect x="${rx}" y="${ry}" width="4" height="${NH}" rx="3" fill="${ac}"/>
      <rect x="${rx + 4}" y="${ry}" width="${NW - 4}" height="${NH}" fill="${ac}" opacity="0.07"/>
      <circle cx="${rx + 14}" cy="${y}" r="5" fill="${ledFill}"${ledStroke}/>
      ${ledAnim}
      <rect x="${rx + NW - 32}" y="${ry + 6}" width="24" height="13" rx="3" fill="${ac}" fill-opacity="0.18"/>
      <text x="${rx + NW - 20}" y="${ry + 16}" text-anchor="middle" font-size="8" font-weight="700" fill="${ac}" font-family="monospace,system-ui">${h(badgeLabel)}</text>
      <text x="${rx + 26}" y="${ry + 26}" font-size="12" font-weight="600" fill="#e2eeff" font-family="system-ui,sans-serif">${h(dname)}</text>
      <text x="${rx + 26}" y="${ry + 41}" font-size="10" fill="${ac}" font-family="monospace,system-ui" opacity="0.8">${h(dsub || "\u2013")}</text>
      <text x="${rx + 26}" y="${ry + 56}" font-size="9" fill="rgba(140,190,230,.55)" font-family="monospace,system-ui">${h(node.id)}</text>
      ${dloc ? `<text x="${rx + 26}" y="${ry + 70}" font-size="9" fill="rgba(140,190,230,.6)" font-family="system-ui,sans-serif">&#128205; ${h(dloc)}</text>` : ""}
    </g>`;
    });
    q("topo-g").innerHTML = svg;
  }
  function renderTopoSvg() {
    if (topoViewMode === "blueprint") {
      renderTopoSvgBlueprint();
      return;
    }
    const nodes = Object.values(topoNodes);
    q("topo-empty").style.display = nodes.length ? "none" : "";
    if (!nodes.length) {
      q("topo-g").innerHTML = "";
      return;
    }
    const hw = NW / 2, hh = NH / 2;
    function borderPt(cx, cy, tx, ty) {
      const dx = tx - cx, dy = ty - cy;
      if (!dx && !dy) return { x: cx, y: cy + hh };
      const sX = dx ? hw / Math.abs(dx) : Infinity;
      const sY = dy ? hh / Math.abs(dy) : Infinity;
      const s = Math.min(sX, sY);
      return { x: cx + dx * s, y: cy + dy * s };
    }
    const LOFF = 14;
    function labelPt(cx, cy, bx, by) {
      if (Math.abs(Math.abs(by - cy) - hh) < 0.5) {
        return { x: bx, y: cy + Math.sign(by - cy) * (hh + LOFF), anchor: "middle" };
      }
      return { x: cx + Math.sign(bx - cx) * (hw + LOFF), y: by, anchor: bx > cx ? "start" : "end" };
    }
    let svg = "";
    const tt = topoTheme();
    const connectedIds = new Set(topoEdges.flatMap((e) => [e.src, e.tgt]));
    const unconn = nodes.filter((n) => !connectedIds.has(n.id));
    const conn = nodes.filter((n) => connectedIds.has(n.id));
    if (unconn.length && conn.length) {
      const uy = Math.min(...unconn.map((n) => n.y));
      const xs = unconn.map((n) => n.x);
      const x1 = Math.min(...xs) - hw - 30, x2 = Math.max(...xs) + hw + 30;
      svg += `<line x1="${x1}" y1="${uy - 55}" x2="${x2}" y2="${uy - 55}" stroke="${tt.sepStroke}" stroke-width="1" stroke-dasharray="6,5"/>`;
      svg += `<text x="${(x1 + x2) / 2}" y="${uy - 64}" text-anchor="middle" font-size="9" font-weight="600" fill="${tt.sepText}" font-family="system-ui,sans-serif" letter-spacing="0.1em">KEINE VERBINDUNG</text>`;
    }
    const pairCount = {}, pairSeen = {};
    topoEdges.forEach((e) => {
      const k = [e.src, e.tgt].sort().join("||");
      pairCount[k] = (pairCount[k] || 0) + 1;
      pairSeen[k] = 0;
    });
    function edgeColor(e, bothOnline, ghost) {
      if (ghost) return "rgba(100,116,139,.4)";
      if (e.type === "wds") return bothOnline ? "rgba(249,115,22,.7)" : "rgba(249,115,22,.3)";
      if (e.type === "l2tp") return bothOnline ? "rgba(34,197,94,.7)" : "rgba(34,197,94,.3)";
      return bothOnline ? "rgba(37,99,235,.6)" : "rgba(37,99,235,.25)";
    }
    topoEdges.forEach((e) => {
      const f = topoNodes[e.src], t = topoNodes[e.tgt];
      if (!f || !t) return;
      const bothOnline = f.online === true && t.online === true;
      const ghost = f.ghost || t.ghost;
      const pairKey = [e.src, e.tgt].sort().join("||");
      const total = pairCount[pairKey] || 1;
      const idx = pairSeen[pairKey]++;
      const offset = (idx - (total - 1) / 2) * 44;
      const midY = (f.y + t.y) / 2 + offset;
      const midX = (f.x + t.x) / 2 + (f.y === t.y ? offset : 0);
      const fs = borderPt(f.x, f.y, t.x, t.y);
      const te = borderPt(t.x, t.y, f.x, f.y);
      const util = ghost ? 0 : edgeUtilPct(e);
      const color = edgeColorWithTraffic(edgeColor(e, bothOnline, ghost), util);
      const w = edgeWidthWithTraffic(ghost ? 1.5 : 2, util);
      const disconnected = e.type ? e.connected === false : !bothOnline;
      const dash = ghost || disconnected ? ' stroke-dasharray="5,4"' : "";
      const tevt = trafficEnabled && !ghost && e.srcPort ? ` onmouseenter="trafficEdgeHover(event,'${h(e.src)}','${h(e.srcPort)}')" onmouseleave="trafficEdgeLeave()" style="cursor:crosshair"` : "";
      const edgePath = `M${fs.x.toFixed(1)},${fs.y.toFixed(1)} C${fs.x.toFixed(1)},${midY} ${te.x.toFixed(1)},${midY} ${te.x.toFixed(1)},${te.y.toFixed(1)}`;
      if (tevt) {
        svg += `<path d="${edgePath}" stroke="transparent" stroke-width="14" fill="none"${tevt}/>`;
        svg += `<path d="${edgePath}" stroke="${color}" stroke-width="${w}" fill="none"${dash} style="pointer-events:none"/>`;
      } else {
        svg += `<path d="${edgePath}" stroke="${color}" stroke-width="${w}" fill="none"${dash}/>`;
      }
      if (trafficEnabled && !ghost) {
        const iface = getIfaceForEdge(e);
        if (iface && (iface.outBps > 1e3 || iface.inBps > 1e3)) {
          const lx = (fs.x + te.x) / 2, ly = (fs.y + te.y) / 2 + offset * 0.5;
          const ts2 = `text-anchor="middle" font-size="8" font-weight="700" font-family="monospace,system-ui" paint-order="stroke" stroke="${tt.portStroke}" stroke-width="3"`;
          svg += `<text x="${lx.toFixed(1)}" y="${(ly - 6).toFixed(1)}" ${ts2} fill="#f97316">TX ${h(formatBps(iface.outBps))}</text>`;
          svg += `<text x="${lx.toFixed(1)}" y="${(ly + 5).toFixed(1)}" ${ts2} fill="#22c55e">RX ${h(formatBps(iface.inBps))}</text>`;
        }
      }
      const ts = `font-size="10" font-weight="600" fill="${tt.nodePort}" font-family="system-ui,sans-serif" paint-order="stroke" stroke="${tt.portStroke}" stroke-width="4" stroke-linejoin="round" dominant-baseline="middle"`;
      if (e.srcPort) {
        const lp = labelPt(f.x, f.y, fs.x, fs.y);
        svg += `<text x="${lp.x.toFixed(1)}" y="${(lp.y + offset * 0.3).toFixed(1)}" text-anchor="${lp.anchor}" ${ts} fill="${color}">${h(e.srcPort)}</text>`;
      }
      if (e.dstPort) {
        const rp = labelPt(t.x, t.y, te.x, te.y);
        svg += `<text x="${rp.x.toFixed(1)}" y="${(rp.y + offset * 0.3).toFixed(1)}" text-anchor="${rp.anchor}" ${ts} fill="${color}">${h(e.dstPort)}</text>`;
      }
    });
    nodes.forEach((node) => {
      const { x, y } = node;
      const rx = x - hw, ry = y - hh;
      const isRoot = node.id === topoRootId;
      if (node.ghost) {
        const dn = node.name.length > 22 ? node.name.slice(0, 21) + "\u2026" : node.name;
        const gmac = node.ghostMac || "";
        const ginfo = node.ghostInfo || "";
        const gSrcName = node.ghostSrc ? state_default.deviceStore[node.ghostSrc]?.name || node.ghostSrc : "";
        const extras = (gmac ? 1 : 0) + (ginfo ? 1 : 0) + (gSrcName ? 1 : 0);
        const nameY = ry + (extras >= 2 ? 17 : extras === 1 ? 20 : 25);
        const macY = ry + (extras >= 2 ? 29 : 35);
        const infoY = ry + (extras >= 2 ? 41 : 35);
        const srcY = ry + (extras >= 3 ? 52 : extras === 2 ? 52 : extras === 1 ? 48 : 42);
        const tagY = ry + (extras >= 3 ? 63 : extras === 2 ? 63 : extras === 1 ? 58 : 42);
        svg += `<g class="topo-node" opacity="0.65" onmousedown="topoNodeDragStart(event,'${h(node.id)}',event)" onclick="topoNodeClick('${h(node.id)}')">
        <rect class="topo-node-rect" x="${rx}" y="${ry}" width="${NW}" height="${NH + (extras >= 2 ? 20 : extras === 1 ? 10 : 0)}" rx="8" fill="${tt.ghostBg}" stroke="${tt.ghostBorder}" stroke-width="1.5" stroke-dasharray="6,4"/>
        <text x="${rx + NW / 2}" y="${nameY}" text-anchor="middle" font-size="12" font-weight="600" fill="${tt.ghostText}" font-family="system-ui,sans-serif">${h(dn)}</text>
        ${gmac ? `<text x="${rx + NW / 2}" y="${macY}"  text-anchor="middle" font-size="9" fill="${tt.ghostText}" font-family="monospace,system-ui">${h(gmac)}</text>` : ""}
        ${ginfo ? `<text x="${rx + NW / 2}" y="${infoY}" text-anchor="middle" font-size="9" fill="${tt.ghostSub}"  font-family="system-ui,sans-serif">${h(ginfo)}</text>` : ""}
        ${gSrcName ? `<text x="${rx + NW / 2}" y="${srcY}" text-anchor="middle" font-size="8" fill="${tt.ghostSub}" font-family="system-ui,sans-serif" opacity="0.7">via ${h(gSrcName)}</text>` : ""}
        <text x="${rx + NW / 2}" y="${tagY}" text-anchor="middle" font-size="9" fill="${tt.ghostSub}" font-family="system-ui,sans-serif" font-style="italic">nicht verwaltet</text>
      </g>`;
        return;
      }
      const dotColor = node.online === true ? tt.dotOnline : node.online === false ? tt.dotOffline : tt.dotUnknown;
      const TYPE_COLOR_RGB = { router: "37,99,235", firewall: "239,68,68", switch: "14,165,233", "lx-ap": "249,115,22", "lcos-ap": "249,115,22" };
      const tcRgb = TYPE_COLOR_RGB[node.type];
      const borderColor = tcRgb ? `rgba(${tcRgb},${node.online === true ? ".65" : ".3"})` : node.online === true ? tt.borderOnline : node.online === false ? tt.borderOffline : tt.borderUnknown;
      const bgFill = tcRgb ? `rgba(${tcRgb},${node.online === true ? ".07" : ".03"})` : node.online === true ? tt.bgOnline : node.online === false ? tt.bgOffline : tt.bgUnknown;
      const glow = isRoot ? ' filter="url(#topo-glow)"' : "";
      const badge = TOPO_TYPE_BADGE[node.type];
      const badgeLabel = badge?.label || "?";
      const badgeBg = badge?.bg || "rgba(100,116,139,.15)";
      const badgeColor = badge?.color || "rgba(148,163,184,.9)";
      const dname = node.name.length > 21 ? node.name.slice(0, 20) + "\u2026" : node.name;
      const dsub = (node.model || node.os || "").slice(0, 26);
      const dloc = (node.location || "").slice(0, 28);
      svg += `<g class="topo-node" onmousedown="topoNodeDragStart(event,'${h(node.id)}',event)" onclick="topoNodeClick('${h(node.id)}');"${glow}>
      <rect class="topo-node-rect" x="${rx}" y="${ry}" width="${NW}" height="${NH}" rx="8" fill="${bgFill}" stroke="${borderColor}" stroke-width="${isRoot ? 2.5 : 1.5}"/>
      ${isRoot ? `<rect x="${rx - 2}" y="${ry - 2}" width="${NW + 4}" height="${NH + 4}" rx="10" fill="none" stroke="${borderColor}" stroke-width="0.5" opacity="0.4"/>` : ""}
      <circle cx="${rx + 14}" cy="${y}" r="5" fill="${dotColor}"${node.online === true ? ' filter="url(#topo-glow)"' : ""}/>
      <rect x="${rx + NW - 34}" y="${ry + 6}" width="26" height="14" rx="4" fill="${badgeBg}"/>
      <text x="${rx + NW - 21}" y="${ry + 16}" text-anchor="middle" font-size="9" font-weight="800" fill="${badgeColor}" font-family="system-ui,sans-serif">${h(badgeLabel)}</text>
      <text x="${rx + 26}" y="${ry + 26}" font-size="12" font-weight="700" fill="${tt.nodeText}" font-family="system-ui,sans-serif">${h(dname)}</text>
      <text x="${rx + 26}" y="${ry + 43}" font-size="10" fill="${tt.nodeSub}" font-family="system-ui,sans-serif">${h(dsub || "\u2013")}</text>
      ${dloc ? `<text x="${rx + 26}" y="${ry + 59}" font-size="9" fill="${tt.nodeSub}" font-family="system-ui,sans-serif" opacity="0.7">&#128205; ${h(dloc)}</text>` : ""}
    </g>`;
    });
    if (topoMacResults.length) {
      const bySwitch = {};
      topoMacResults.forEach((r) => {
        if (!bySwitch[r.switchIp]) bySwitch[r.switchIp] = [];
        bySwitch[r.switchIp].push(r);
      });
      const hw2 = NW / 2, hh2 = NH / 2;
      const CW = 150, CH = 52, CGAP = 16;
      Object.entries(bySwitch).forEach(([switchIp, results]) => {
        const node = topoNodes[switchIp];
        if (!node) return;
        svg += `<rect x="${(node.x - hw2 - 5).toFixed(1)}" y="${(node.y - hh2 - 5).toFixed(1)}" width="${NW + 10}" height="${NH + 10}" rx="12" fill="none" stroke="rgba(251,191,36,.85)" stroke-width="2" stroke-dasharray="6,3"/>`;
        const totalW = results.length * CW + (results.length - 1) * CGAP;
        const startX = node.x - totalW / 2 + CW / 2;
        const cy = node.y + hh2 + 70;
        results.forEach((r, i) => {
          const cx = startX + i * (CW + CGAP);
          const isWlan = r.type === "wlan";
          const boxColor = isWlan ? "rgba(34,197,94," : "rgba(251,191,36,";
          const extraLines = [r.hostname, r.ip].filter(Boolean);
          const boxH = CH + extraLines.length * 14;
          svg += `<line x1="${node.x.toFixed(1)}" y1="${(node.y + hh2).toFixed(1)}" x2="${cx.toFixed(1)}" y2="${(cy - boxH / 2).toFixed(1)}" stroke="${boxColor}.55)" stroke-width="1.5" stroke-dasharray="4,3"/>`;
          const lx = (node.x + cx) / 2 + 6, ly = (node.y + hh2 + cy - boxH / 2) / 2 - 3;
          svg += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" font-size="9" font-weight="700" fill="${boxColor}.9)" font-family="system-ui,sans-serif" paint-order="stroke" stroke="var(--bg2)" stroke-width="3">${h(r.port)}</text>`;
          svg += `<rect x="${(cx - CW / 2).toFixed(1)}" y="${(cy - boxH / 2).toFixed(1)}" width="${CW}" height="${boxH}" rx="8" fill="${boxColor}.08)" stroke="${boxColor}.7)" stroke-width="1.5"/>`;
          svg += `<text x="${cx.toFixed(1)}" y="${(cy - boxH / 2 + 18).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="700" fill="${boxColor}.95)" font-family="monospace,system-ui">${h(r.mac)}</text>`;
          let lineY = cy - boxH / 2 + 34;
          if (r.hostname) {
            svg += `<text x="${cx.toFixed(1)}" y="${lineY.toFixed(1)}" text-anchor="middle" font-size="10" fill="${boxColor}.8)" font-family="system-ui,sans-serif">${h(r.hostname.length > 20 ? r.hostname.slice(0, 19) + "\u2026" : r.hostname)}</text>`;
            lineY += 14;
          }
          if (r.ip) {
            svg += `<text x="${cx.toFixed(1)}" y="${lineY.toFixed(1)}" text-anchor="middle" font-size="10" fill="${boxColor}.6)" font-family="monospace,system-ui">${h(r.ip)}</text>`;
          }
        });
      });
    }
    q("topo-g").innerHTML = svg;
  }
  function topoNodeClick(id) {
    if (topoWasDrag) {
      topoWasDrag = false;
      return;
    }
    topoOpenDetail(id);
  }
  function topoOpenDetail(id) {
    const node = topoNodes[id];
    if (!node) return;
    topoDetailId = id;
    const dotColor = node.online === true ? "#a0ed3a" : node.online === false ? "#ff004d" : "rgba(100,116,139,.6)";
    q("topo-detail-dot").style.background = dotColor;
    q("topo-detail-name").textContent = node.name;
    const subParts = [node.model, node.os, node.ghost ? null : node.id].filter(Boolean);
    q("topo-detail-sub").textContent = subParts.join(" \xB7 ") || "\u2013";
    const locEl = q("topo-detail-location");
    if (locEl) {
      locEl.textContent = node.location || "";
      locEl.style.display = node.location ? "" : "none";
    }
    q("topo-detail-setroot").style.display = node.ghost ? "none" : "";
    const entries = topoLldpMap[id] || [];
    let html = "";
    if (entries.length) {
      html += `<div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">LLDP Nachbarn (${entries.length})</div>`;
      html += `<table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="color:var(--text3);font-size:10px">
      <th style="text-align:left;padding:0 6px 4px 0;font-weight:600">Port</th>
      <th style="text-align:left;padding:0 6px 4px 0;font-weight:600">Nachbar</th>
      <th style="text-align:left;padding:0 0 4px 0;font-weight:600">Gegenstelle</th>
    </tr></thead><tbody>`;
      entries.forEach((e) => {
        html += `<tr style="border-top:1px solid var(--border)">
        <td style="padding:5px 6px 5px 0;color:#60a5fa;font-weight:600">${h(e.localPortName || "\u2013")}</td>
        <td style="padding:5px 6px 5px 0;font-weight:600">${h(e.remSysName || e.remPortId || "?")}</td>
        <td style="padding:5px 0;color:var(--text3);font-size:11px">${h(e.remPortDesc || e.remPortId || "\u2013")}</td>
      </tr>`;
      });
      html += `</tbody></table>`;
    }
    const links = topoEdges.filter((e) => e.tgt === id || e.src === id);
    if (links.length) {
      const typeColor = { wds: "var(--orange)", l2tp: "var(--green)" };
      const typeLabel = { wds: "WDS", l2tp: "L2TP", undefined: "LLDP" };
      html += `<div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin:14px 0 8px">Verbindungen (${links.length})</div>`;
      links.forEach((e) => {
        const otherId = e.src === id ? e.tgt : e.src;
        const other = topoNodes[otherId];
        if (!other) return;
        const myPort = e.src === id ? e.srcPort : e.dstPort;
        const theirPort = e.src === id ? e.dstPort : e.srcPort;
        const tcolor = typeColor[e.type] || "#60a5fa";
        const tlabel = typeLabel[e.type] || "LLDP";
        html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 8px;background:var(--bg2);border-radius:6px;font-size:12px;margin-bottom:4px">
        <span style="font-weight:600">${h(other.name)}</span>
        <span style="display:flex;gap:6px;align-items:center">
          <span style="font-size:10px;color:${tcolor};font-weight:700">${tlabel}</span>
          <span style="color:var(--text3);font-size:11px">${h([myPort, theirPort].filter(Boolean).join(" \u2192 "))}</span>
        </span>
      </div>`;
      });
    }
    if (trafficEnabled && links.length) {
      let trafficRows = "";
      links.forEach((e) => {
        const iface = getIfaceForEdge({ src: e.src, srcPort: e.srcPort });
        if (!iface) return;
        const otherId = e.src === id ? e.tgt : e.src;
        const other = topoNodes[otherId];
        const myPort = e.src === id ? e.srcPort : e.dstPort;
        const txBps = e.src === id ? iface.outBps : iface.inBps;
        const rxBps = e.src === id ? iface.inBps : iface.outBps;
        if (txBps < 100 && rxBps < 100) return;
        trafficRows += `<div style="background:var(--bg2);border-radius:6px;padding:6px 8px;margin-bottom:4px;font-size:11px">
        <div style="display:flex;justify-content:space-between;margin-bottom:3px">
          <span style="font-weight:600;color:var(--text1)">${h(other?.name || otherId)}</span>
          <span style="color:var(--text3)">${h(myPort || "\u2013")}</span>
        </div>
        <div style="display:flex;gap:12px">
          <span style="color:#f97316">TX: ${h(formatBps(txBps))}</span>
          <span style="color:#22c55e">RX: ${h(formatBps(rxBps))}</span>
          <span style="color:#64748b">${iface.utilPct.toFixed(1)}%</span>
        </div>
      </div>`;
      });
      if (trafficRows) {
        html += `<div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin:14px 0 8px">Live Traffic</div>${trafficRows}`;
      }
    }
    if (!html) html = `<p style="color:var(--text3);font-size:12px">Keine LLDP-Daten verf\xFCgbar.<br>LLDP Sync starten um Verbindungen zu laden.</p>`;
    q("topo-detail-content").innerHTML = html;
    q("topo-detail").style.display = "flex";
  }
  function topoCloseDetail() {
    q("topo-detail").style.display = "none";
    topoDetailId = null;
  }
  function topoSetRootFromDetail() {
    if (!topoDetailId || topoNodes[topoDetailId]?.ghost) return;
    topoRootId = topoDetailId;
    q("topo-root-select").value = topoRootId;
    layoutTopo(topoRootId);
    renderTopoSvg();
    setTimeout(topoFit, 50);
  }
  function topoSvgPt(e) {
    const r = q("topo-svg").getBoundingClientRect();
    return { x: (e.clientX - r.left - topoTx) / topoScale, y: (e.clientY - r.top - topoTy) / topoScale };
  }
  function topoNodeDragStart(e, id) {
    e.stopPropagation();
    const pt = topoSvgPt(e), n = topoNodes[id];
    if (!n) return;
    topoDragNode = { id, ox: pt.x - n.x, oy: pt.y - n.y };
    topoWasDrag = false;
  }
  function topoBgDragStart(e) {
    if (topoDragNode) return;
    topoPan = { sx: e.clientX, sy: e.clientY, tx: topoTx, ty: topoTy };
  }
  function topoMouseMove(e) {
    if (topoDragNode) {
      const pt = topoSvgPt(e), n = topoNodes[topoDragNode.id];
      if (!n) return;
      n.x = pt.x - topoDragNode.ox;
      n.y = pt.y - topoDragNode.oy;
      topoWasDrag = true;
      renderTopoSvg();
    } else if (topoPan) {
      topoTx = topoPan.tx + (e.clientX - topoPan.sx);
      topoTy = topoPan.ty + (e.clientY - topoPan.sy);
      const g = document.getElementById("topo-g");
      if (g) g.setAttribute("transform", `translate(${topoTx},${topoTy}) scale(${topoScale})`);
    }
  }
  function topoMouseUp() {
    if (topoDragNode && topoWasDrag) {
      const pos = {};
      Object.values(topoNodes).forEach((n) => {
        pos[n.id] = { x: n.x, y: n.y };
      });
      try {
        localStorage.setItem("onsite_topo_pos", JSON.stringify(pos));
      } catch (e) {
      }
      Object.assign(_topoSavedPos, pos);
    }
    topoDragNode = null;
    topoPan = null;
    topoWasDrag = false;
  }
  window.addEventListener("mouseup", () => {
    if (topoDragNode && topoWasDrag) {
      const pos = {};
      Object.values(topoNodes).forEach((n) => {
        pos[n.id] = { x: n.x, y: n.y };
      });
      try {
        localStorage.setItem("onsite_topo_pos", JSON.stringify(pos));
      } catch (e) {
      }
      Object.assign(_topoSavedPos, pos);
      topoDragNode = null;
      topoPan = null;
      topoWasDrag = false;
    }
  });
  window.topoResetLayout = function() {
    localStorage.removeItem("onsite_topo_pos");
    Object.keys(_topoSavedPos).forEach((k) => delete _topoSavedPos[k]);
    layoutTopo(topoRootId);
    renderTopoSvg();
    setTimeout(topoFit, 50);
  };
  function topoWheel(e) {
    e.preventDefault();
    const svgEl = q("topo-svg");
    const r = svgEl.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const newScale = Math.max(0.1, Math.min(5, topoScale * factor));
    topoTx = mx - (mx - topoTx) * (newScale / topoScale);
    topoTy = my - (my - topoTy) * (newScale / topoScale);
    topoScale = newScale;
    const g = document.getElementById("topo-g");
    if (g) g.setAttribute("transform", `translate(${topoTx},${topoTy}) scale(${topoScale})`);
  }
  function topoZoom(factor) {
    topoScale = Math.max(0.1, Math.min(5, topoScale * factor));
    const g = document.getElementById("topo-g");
    if (g) g.setAttribute("transform", `translate(${topoTx},${topoTy}) scale(${topoScale})`);
  }
  function topoFit() {
    const svgEl = q("topo-svg");
    const W = svgEl.clientWidth || 900, H = svgEl.clientHeight || 620;
    const nodes = Object.values(topoNodes);
    if (!nodes.length) return;
    const xs = nodes.map((n) => n.x), ys = nodes.map((n) => n.y);
    const minX = Math.min(...xs) - NW / 2 - 20, maxX = Math.max(...xs) + NW / 2 + 20;
    const minY = Math.min(...ys) - NH / 2 - 20, maxY = Math.max(...ys) + NH / 2 + 20;
    const sw = maxX - minX, sh = maxY - minY;
    topoScale = Math.min(W / sw, H / sh, 1.5);
    topoTx = W / 2 - (minX + maxX) / 2 * topoScale;
    topoTy = H / 2 - (minY + maxY) / 2 * topoScale;
    const g = document.getElementById("topo-g");
    if (g) g.setAttribute("transform", `translate(${topoTx},${topoTy}) scale(${topoScale})`);
  }
  async function syncWdsAll() {
    const btn = q("btn-wds-sync");
    const st = q("dev-sync-status");
    const lxDevs = Object.values(state_default.deviceStore).filter((d) => d.type === "lx-ap" && d.online !== false && matchesLocFilter(d));
    if (!lxDevs.length) {
      st.className = "status-bar error";
      st.textContent = state_default.devLocFilter !== "all" ? `Keine online LX APs im Standort \u201E${state_default.devLocFilter}".` : 'Keine online LX Access Points \u2013 bitte zuerst "Status" ausf\xFChren.';
      return;
    }
    btn.disabled = true;
    st.className = "status-bar loading";
    state_default.meshData.length = 0;
    let done = 0;
    try {
      for (let i = 0; i < lxDevs.length; i += 4) {
        await Promise.all(lxDevs.slice(i, i + 4).map(async (dev) => {
          try {
            const result = await window.snmpQ(dev.ip, "wds");
            if (result.configured) window.mergeMeshResult?.(dev.ip, dev.name || dev.ip, result);
          } catch {
          }
          done++;
          st.innerHTML = `<span class="spinner"></span> WDS \u2013 ${done} / ${lxDevs.length} \u2013 ${h(dev.name || dev.ip)}`;
        }));
      }
      await fetch("/api/devices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(state_default.deviceStore) });
      st.className = "status-bar ok";
      st.textContent = `WDS abgeschlossen \u2013 ${state_default.meshData.length} Verbindungen.`;
      window.renderDevices?.();
      window.renderMesh?.();
    } catch (e) {
      st.className = "status-bar error";
      st.textContent = `Fehler: ${e.message}`;
    } finally {
      btn.disabled = false;
      btn.textContent = "WDS";
    }
  }
  async function syncL2tpAll() {
    const btn = q("btn-l2tp-sync2");
    const st = q("dev-sync-status");
    const lxDevs = Object.values(state_default.deviceStore).filter((d) => d.type === "lx-ap" && d.online !== false && matchesLocFilter(d));
    if (!lxDevs.length) {
      st.className = "status-bar error";
      st.textContent = state_default.devLocFilter !== "all" ? `Keine online LX APs im Standort \u201E${state_default.devLocFilter}".` : 'Keine online LX Access Points \u2013 bitte zuerst "Status" ausf\xFChren.';
      return;
    }
    btn.disabled = true;
    st.className = "status-bar loading";
    state_default.l2tpData.length = 0;
    let done = 0;
    try {
      for (let i = 0; i < lxDevs.length; i += 4) {
        await Promise.all(lxDevs.slice(i, i + 4).map(async (dev) => {
          try {
            const result = await window.snmpQ(dev.ip, "l2tp");
            if (result.configured) window.mergeL2tpResult?.(dev.ip, dev.name || dev.ip, result);
          } catch {
          }
          done++;
          st.innerHTML = `<span class="spinner"></span> L2TPv3 \u2013 ${done} / ${lxDevs.length} \u2013 ${h(dev.name || dev.ip)}`;
        }));
      }
      await fetch("/api/devices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(state_default.deviceStore) });
      st.className = "status-bar ok";
      st.textContent = `L2TPv3 abgeschlossen \u2013 ${state_default.l2tpData.length} Endpunkte.`;
      window.renderDevices?.();
      window.renderL2tp?.();
    } catch (e) {
      st.className = "status-bar error";
      st.textContent = `Fehler: ${e.message}`;
    } finally {
      btn.disabled = false;
      btn.textContent = "L2TPv3";
    }
  }
  function setClientsFilter(f) {
    state_default.clientsFilter = f;
    ["all", "wlan", "fdb"].forEach((id) => q("clf-" + id)?.classList.toggle("active", id === f));
    window.renderClients?.();
  }
  function clearClientsData() {
    if (!confirm("Client Explorer Daten l\xF6schen?")) return;
    state_default.clientsData = [];
    Object.values(state_default.deviceStore).forEach((d) => {
      delete d.wlanClients;
      delete d.fdbEntries;
    });
    fetch("/api/devices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(state_default.deviceStore) });
    window.renderClients?.();
    setBadge("clients", 0);
  }
  function normalizeExplorerMac(s) {
    if (s == null) return null;
    const hex = String(s).replace(/[^0-9a-fA-F]/g, "").toLowerCase();
    if (hex.length !== 12) return null;
    return hex.match(/.{2}/g).join(":");
  }
  function buildNacPostBodyFromApi(data, macAllowlist) {
    return {
      radiusHost: data.radiusHost || "",
      radiusAuthPort: Number(data.radiusAuthPort) || 1812,
      radiusAcctPort: Number(data.radiusAcctPort) || 1813,
      policyUrl: data.policyUrl || "",
      notes: data.notes || "",
      embeddedRadiusEnabled: !!data.embeddedRadiusEnabled,
      embeddedRadiusBind: data.embeddedRadiusBind || "0.0.0.0",
      embeddedAuthPort: Number(data.embeddedAuthPort) || 1812,
      embeddedAcctPort: Number(data.embeddedAcctPort) || 1813,
      embeddedCoaPort: Math.min(65535, Math.max(0, Number(data.embeddedCoaPort) || 0)),
      embeddedVlanAssignmentEnabled: !!data.embeddedVlanAssignmentEnabled,
      nacAuthMode: data.nacAuthMode || "mac_allowlist",
      macAllowlist,
      radiusUsers: Array.isArray(data.radiusUsers) ? data.radiusUsers : []
    };
  }
  var nacAllowlistFetchPromise = null;
  function ensureNacAllowlistLoaded() {
    if (Array.isArray(state_default.nacMacAllowlistCache)) return;
    if (nacAllowlistFetchPromise) return;
    nacAllowlistFetchPromise = fetch("/api/nac").then((r) => parseFetchJsonLenient(r)).then((data) => {
      if (data && Array.isArray(data.macAllowlist)) {
        state_default.nacMacAllowlistCache = data.macAllowlist.map((row) => ({ ...row }));
      } else if (state_default.nacMacAllowlistCache === null) {
        state_default.nacMacAllowlistCache = [];
      }
    }).catch(() => {
      if (state_default.nacMacAllowlistCache === null) state_default.nacMacAllowlistCache = [];
    }).finally(() => {
      nacAllowlistFetchPromise = null;
      window.renderClients?.();
    });
  }
  function lookupNacEntry(macRaw) {
    const norm = normalizeExplorerMac(macRaw);
    if (!norm || !Array.isArray(state_default.nacMacAllowlistCache)) return null;
    return state_default.nacMacAllowlistCache.find((e) => String(e.mac || "").trim().toLowerCase() === norm) || null;
  }
  var clientsNacClickBound = false;
  function bindClientsNacClickOnce() {
    if (clientsNacClickBound) return;
    const tbl = q("tbl-clients");
    if (!tbl) return;
    tbl.addEventListener("click", (e) => {
      const rm = e.target.closest("button[data-nac-remove]");
      if (rm) {
        e.preventDefault();
        const mac2 = rm.getAttribute("data-nac-mac") || "";
        clientsRemoveMacFromNac(mac2);
        return;
      }
      const btn = e.target.closest("button[data-nac-add]");
      if (!btn) return;
      e.preventDefault();
      const mac = btn.getAttribute("data-nac-mac") || "";
      const host = btn.getAttribute("data-nac-host") || "";
      clientsAddMacToNac(mac, host);
    });
    clientsNacClickBound = true;
  }
  async function clientsAddMacToNac(macRaw, hostnameHint) {
    const mac = normalizeExplorerMac(macRaw);
    if (!mac) {
      alert("Ung\xFCltige MAC-Adresse");
      return;
    }
    try {
      const r = await fetch("/api/nac");
      const data = await parseFetchJson(r);
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      const list = Array.isArray(data.macAllowlist) ? [...data.macAllowlist] : [];
      if (list.some((e) => String(e.mac || "").trim().toLowerCase() === mac)) {
        alert("Diese MAC ist bereits in den freigegebenen Adressen (NAC).");
        return;
      }
      const label = String(hostnameHint || "").trim().slice(0, 120);
      list.push({ mac, label });
      const body = buildNacPostBodyFromApi(data, list);
      const pr = await fetch("/api/nac", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const out = await parseFetchJson(pr);
      if (!pr.ok) throw new Error(out.error || `HTTP ${pr.status}`);
      let msg = `MAC ${mac} wurde unter NAC \u2192 freigegebene MAC-Adressen gespeichert.`;
      if (data.nacAuthMode !== "mac_allowlist") {
        msg += "\n\nHinweis: Der eingebettete RADIUS nutzt die MAC-Liste nur im Modus \u201ENur freigegebene MAC-Adressen\u201C \u2014 bei PAP bitte in NAC umschalten.";
      }
      alert(msg);
      if (Array.isArray(out.macAllowlist)) {
        state_default.nacMacAllowlistCache = out.macAllowlist.map((row) => ({ ...row }));
      }
      window.renderClients?.();
      window.renderNac?.();
    } catch (e) {
      alert(e.message || "Speichern fehlgeschlagen");
    }
  }
  async function clientsRemoveMacFromNac(macRaw) {
    const mac = normalizeExplorerMac(macRaw);
    if (!mac) {
      alert("Ung\xFCltige MAC-Adresse");
      return;
    }
    if (!window.confirm(`MAC ${mac} aus den NAC-Freigaben (freigegebene MAC-Adressen) entfernen?`)) return;
    try {
      const r = await fetch("/api/nac");
      const data = await parseFetchJson(r);
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      const prev = Array.isArray(data.macAllowlist) ? data.macAllowlist : [];
      const list = prev.filter((e) => String(e.mac || "").trim().toLowerCase() !== mac);
      if (list.length === prev.length) {
        alert("Diese MAC war nicht in der NAC-Liste.");
        return;
      }
      const body = buildNacPostBodyFromApi(data, list);
      const pr = await fetch("/api/nac", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const out = await parseFetchJson(pr);
      if (!pr.ok) throw new Error(out.error || `HTTP ${pr.status}`);
      let msg = `MAC ${mac} wurde aus den freigegebenen MAC-Adressen entfernt.`;
      if (data.nacAuthMode !== "mac_allowlist") {
        msg += "\n\nHinweis: Die MAC-Liste wirkt nur im Modus \u201ENur freigegebene MAC-Adressen\u201C.";
      }
      alert(msg);
      if (Array.isArray(out.macAllowlist)) {
        state_default.nacMacAllowlistCache = out.macAllowlist.map((row) => ({ ...row }));
      }
      window.renderClients?.();
      window.renderNac?.();
    } catch (e) {
      alert(e.message || "Entfernen fehlgeschlagen");
    }
  }
  function renderClients() {
    ensureNacAllowlistLoaded();
    bindClientsNacClickOnce();
    const srch = (q("clients-search")?.value || "").toLowerCase();
    const filtered = state_default.clientsData.filter((r) => {
      if (state_default.clientsFilter !== "all" && r.type !== state_default.clientsFilter) return false;
      if (srch) {
        const hay = [r.mac, r.ip, r.hostname, r.ssid, r.port, r.sourceName].join(" ").toLowerCase();
        if (!hay.includes(srch)) return false;
      }
      return true;
    });
    const tbody = q("tbl-clients")?.querySelector("tbody");
    if (!tbody) return;
    setBadge("clients", state_default.clientsData.length || null);
    q("cnt-clients").textContent = filtered.length ? `${filtered.length}` : "";
    if (!filtered.length) {
      tbody.innerHTML = `<tr><td colspan="11" class="empty">${state_default.clientsData.length ? "Keine Eintr\xE4ge f\xFCr diesen Filter" : '\u201EWLAN Clients" im Ger\xE4te-Tab starten um Daten zu laden'}</td></tr>`;
      return;
    }
    const portMacCount = {};
    state_default.clientsData.filter((r) => r.type === "fdb" && r.port).forEach((r) => {
      const key = (r.sourceName || "") + "|" + r.port;
      portMacCount[key] = (portMacCount[key] || 0) + 1;
    });
    const UPLINK_THRESHOLD = parseInt(q("uplink-threshold")?.value, 10) || 3;
    tbody.innerHTML = filtered.map((r) => {
      const typeTag = r.type === "wlan" ? `<span class="badge badge-blue">WLAN</span>` : `<span class="badge badge-gray">Switch-MAC</span>`;
      const sig = r.signal != null && r.signal !== "" ? parseInt(r.signal) : null;
      const sigBadge = sig !== null && !isNaN(sig) ? `<span class="badge ${sig >= -60 ? "badge-green" : sig >= -75 ? "badge-yellow" : "badge-red"}">${sig} dBm</span>` : "\u2014";
      const portKey = (r.sourceName || "") + "|" + r.port;
      const isUplink = r.type === "fdb" && r.port && (portMacCount[portKey] || 0) >= UPLINK_THRESHOLD;
      const ssidOrPort = r.type === "wlan" ? r.ssid ? `<span class="badge badge-blue">${h(r.ssid)}</span>` : "\u2014" : r.port ? `<span style="color:var(--text2);font-size:12px">${h(r.port)}</span>${isUplink ? ` <span class="badge badge-orange" title="${portMacCount[portKey]} MACs an diesem Port">Uplink</span>` : ""}` : "\u2014";
      const chanStr = r.channel ? r.chanWidth ? `CH ${r.channel} <span style="color:var(--text3);font-size:11px">${h(r.chanWidth)}</span>` : `CH ${r.channel}` : "\u2014";
      const nacEntry = lookupNacEntry(r.mac);
      const labelTrim = nacEntry && String(nacEntry.label || "").trim();
      const nacLabelCell = nacEntry ? labelTrim ? `<span style="color:var(--text2);font-size:12px" title="Bezeichnung aus NAC">${h(labelTrim)}</span>${nacEntry.vlan != null && nacEntry.vlan !== "" ? ` <span class="badge badge-gray" title="Dynamisches VLAN (NAC)">VLAN ${h(String(nacEntry.vlan))}</span>` : ""}` : '<span style="font-size:11px;color:var(--text3)">In NAC, ohne Bezeichnung</span>' : "\u2014";
      const nacActionCell = nacEntry ? `<button type="button" class="btn btn-sm btn-danger" data-nac-remove="1" data-nac-mac="${h(r.mac)}" title="Aus freigegebenen MAC-Adressen (NAC) entfernen">Entfernen</button>` : `<button type="button" class="btn btn-sm" data-nac-add="1" data-nac-mac="${h(r.mac)}" data-nac-host="${h(r.hostname || "")}" title="Zur NAC-Freigabeliste hinzuf\xFCgen (eingebetteter RADIUS)">Hinzuf\xFCgen</button>`;
      return `<tr>
      <td style="color:var(--text2)">${h(r.sourceName)}</td>
      <td>${typeTag}</td>
      <td class="mono" style="cursor:pointer;color:var(--accent)" onclick="openTopoWithMac('${h(r.mac)}')" title="Im Netzwerkplan anzeigen">${h(r.mac)}</td>
      <td class="mono" style="color:var(--text2)">${r.ip ? h(r.ip) : "\u2014"}</td>
      <td style="color:var(--text2)">${r.hostname ? h(r.hostname) : "\u2014"}</td>
      <td>${ssidOrPort}</td>
      <td>${r.band ? `<span class="badge badge-gray">${h(r.band)}</span>` : "\u2014"}</td>
      <td style="color:var(--text2);font-size:12px">${r.type === "wlan" ? chanStr : "\u2014"}</td>
      <td>${r.type === "wlan" ? sigBadge : "\u2014"}</td>
      <td style="max-width:200px;word-break:break-word">${nacLabelCell}</td>
      <td style="white-space:nowrap">${nacActionCell}</td>
    </tr>`;
    }).join("");
  }
  function openTopoWithMac(mac) {
    window.showTab?.("topology");
    setTimeout(() => {
      const inp = q("topo-mac-search");
      if (inp) {
        inp.value = mac;
        searchTopoMac(mac);
      }
    }, 80);
  }
  function geraeteSync() {
    window.showTab?.("scanner");
    setTimeout(() => window.startScan?.(), 50);
  }
  async function syncTopologyAll() {
    const btn = q("btn-topo-sync-all");
    const st = q("dev-sync-status");
    const allDevs = Object.values(state_default.deviceStore).filter(matchesLocFilter);
    if (!allDevs.length) {
      st.className = "status-bar error";
      st.textContent = state_default.devLocFilter !== "all" ? `Keine Ger\xE4te im Standort \u201E${state_default.devLocFilter}".` : "Keine Ger\xE4te gespeichert \u2013 bitte zuerst Ger\xE4te importieren.";
      return;
    }
    btn.disabled = true;
    btn.textContent = "\u27F3 L\xE4uft\u2026";
    st.className = "status-bar loading";
    try {
      st.innerHTML = `<span class="spinner"></span> Phase 1/6: Status pr\xFCfen \u2013 0 / ${allDevs.length}`;
      let done = 0;
      async function checkStatus(dev) {
        try {
          await window.snmpQ(dev.ip, "ping");
          if (state_default.deviceStore[dev.ip]) state_default.deviceStore[dev.ip].online = true;
        } catch {
          if (state_default.deviceStore[dev.ip]) state_default.deviceStore[dev.ip].online = false;
        }
        done++;
        st.innerHTML = `<span class="spinner"></span> Phase 1/6: Status pr\xFCfen \u2013 ${done} / ${allDevs.length} \u2013 ${h(dev.name || dev.ip)}`;
        window.renderDevices?.();
      }
      const CONC_STATUS = 5;
      for (let i = 0; i < allDevs.length; i += CONC_STATUS) {
        await Promise.all(allDevs.slice(i, i + CONC_STATUS).map(checkStatus));
      }
      const lxOnline = Object.values(state_default.deviceStore).filter((d) => d.type === "lx-ap" && d.online === true && matchesLocFilter(d));
      state_default.meshData.length = 0;
      done = 0;
      st.innerHTML = `<span class="spinner"></span> Phase 2/6: WiFi Mesh \u2013 0 / ${lxOnline.length}`;
      async function syncWds(dev) {
        try {
          const result = await window.snmpQ(dev.ip, "wds");
          if (result.configured) window.mergeMeshResult?.(dev.ip, dev.name || dev.ip, result);
        } catch {
        }
        done++;
        st.innerHTML = `<span class="spinner"></span> Phase 2/6: WiFi Mesh \u2013 ${done} / ${lxOnline.length} \u2013 ${h(dev.name || dev.ip)}`;
      }
      const CONC_WDS = 4;
      for (let i = 0; i < lxOnline.length; i += CONC_WDS) {
        await Promise.all(lxOnline.slice(i, i + CONC_WDS).map(syncWds));
      }
      state_default.l2tpData.length = 0;
      done = 0;
      st.innerHTML = `<span class="spinner"></span> Phase 3/6: L2TPv3 \u2013 0 / ${lxOnline.length}`;
      async function syncL2tpDev(dev) {
        try {
          const result = await window.snmpQ(dev.ip, "l2tp");
          if (result.configured) window.mergeL2tpResult?.(dev.ip, dev.name || dev.ip, result);
        } catch {
        }
        done++;
        st.innerHTML = `<span class="spinner"></span> Phase 3/6: L2TPv3 \u2013 ${done} / ${lxOnline.length} \u2013 ${h(dev.name || dev.ip)}`;
      }
      const CONC_L2TP = 4;
      for (let i = 0; i < lxOnline.length; i += CONC_L2TP) {
        await Promise.all(lxOnline.slice(i, i + CONC_L2TP).map(syncL2tpDev));
      }
      const onlineDevs = Object.values(state_default.deviceStore).filter((d) => d.online !== false && matchesLocFilter(d));
      st.innerHTML = `<span class="spinner"></span> Phase 4/6: LLDP \u2013 0 / ${onlineDevs.length}`;
      await window.lldpSyncCore?.(onlineDevs, (d, total, dev) => {
        st.innerHTML = `<span class="spinner"></span> Phase 4/6: LLDP \u2013 ${d} / ${total} \u2013 ${h(dev.name || dev.ip)}`;
      });
      done = 0;
      st.innerHTML = `<span class="spinner"></span> Phase 5/6: MAC-Adressen \u2013 0 / ${onlineDevs.length}`;
      const macQueue = [...onlineDevs];
      async function macWorker() {
        while (macQueue.length) {
          const dev = macQueue.shift();
          try {
            const isSwitch = dev.type === "switch";
            const [ifResult, fdbResult] = await Promise.all([
              window.snmpQ(dev.ip, "ifmacs"),
              isSwitch ? window.snmpQ(dev.ip, "mac") : Promise.resolve(null)
            ]);
            if (state_default.deviceStore[dev.ip] && ifResult.macs?.length) state_default.deviceStore[dev.ip].macs = ifResult.macs;
            if (state_default.deviceStore[dev.ip] && isSwitch && fdbResult?.entries?.length)
              state_default.deviceStore[dev.ip].fdbEntries = fdbResult.entries.map((e) => ({
                ...e,
                type: "fdb",
                sourceIp: dev.ip,
                sourceName: dev.name || dev.ip
              }));
          } catch {
          }
          done++;
          st.innerHTML = `<span class="spinner"></span> Phase 5/6: MAC-Adressen \u2013 ${done} / ${onlineDevs.length} \u2013 ${h(dev.name || dev.ip)}`;
        }
      }
      await Promise.all(Array(Math.min(3, onlineDevs.length || 1)).fill(null).map(macWorker));
      const apOnline = Object.values(state_default.deviceStore).filter((d) => (d.type === "lx-ap" || d.type === "lcos-ap") && d.online !== false && matchesLocFilter(d));
      done = 0;
      st.innerHTML = `<span class="spinner"></span> Phase 6/6: WLAN Clients \u2013 0 / ${apOnline.length}`;
      for (let i = 0; i < apOnline.length; i += 4) {
        await Promise.all(apOnline.slice(i, i + 4).map(async (dev) => {
          try {
            const result = await window.snmpQ(dev.ip, "wlan", { os: dev.os || "", devType: dev.type });
            if (state_default.deviceStore[dev.ip]) {
              state_default.deviceStore[dev.ip].wlanClients = result.entries.map((e) => ({
                ...e,
                sourceIp: dev.ip,
                sourceName: dev.name || dev.ip,
                type: "wlan"
              }));
            }
          } catch {
            if (state_default.deviceStore[dev.ip]) state_default.deviceStore[dev.ip].wlanClients = [];
          }
          done++;
          st.innerHTML = `<span class="spinner"></span> Phase 6/6: WLAN Clients \u2013 ${done} / ${apOnline.length} \u2013 ${h(dev.name || dev.ip)}`;
        }));
      }
      st.innerHTML = `<span class="spinner"></span> Daten werden gespeichert\u2026`;
      try {
        await fetch("/api/devices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(state_default.deviceStore) });
      } catch (e) {
        console.error("Fehler beim Speichern:", e);
      }
      window.rebuildCachedData?.();
      state_default.dashLastDataSync = (/* @__PURE__ */ new Date()).toISOString();
      const onlineCnt = Object.values(state_default.deviceStore).filter((d) => d.online === true).length;
      logActivity(`Datensync: ${onlineCnt} Ger\xE4te online`);
      st.className = "status-bar ok";
      st.textContent = "Sync abgeschlossen.";
      window.renderDevices?.();
      window.renderMesh?.();
      window.renderL2tp?.();
      window.renderClients?.();
      buildTopoFromStore();
    } catch (e) {
      st.className = "status-bar error";
      st.textContent = `Fehler: ${e.message}`;
      console.error("syncTopologyAll:", e);
    } finally {
      btn.disabled = false;
      btn.textContent = "\u27F3 Daten Abrufen";
    }
  }
  function buildTopoFromStore() {
    topoLldpMap = {};
    Object.values(state_default.deviceStore).forEach((dev) => {
      if (dev.lldpData?.length) topoLldpMap[dev.ip] = dev.lldpData;
    });
    buildTopoGraph(topoLldpMap);
    const existingPairs = new Set(topoEdges.map((e) => [e.src, e.tgt].sort().join("||")));
    const edgeIdSet = new Set(topoEdges.map((e) => e.id));
    let wdsCnt = 0;
    Object.values(state_default.deviceStore).forEach((dev) => {
      (dev.wdsLinks || []).forEach((link) => {
        if (!link.mac) return;
        const peerDev = resolvePeerDev(link.mac);
        if (!peerDev || peerDev.ip === dev.ip) return;
        if (!topoNodes[peerDev.ip]) {
          topoNodes[peerDev.ip] = {
            id: peerDev.ip,
            name: peerDev.name || peerDev.ip,
            type: peerDev.type || "unknown",
            os: peerDev.os || "",
            model: peerDev.model || "",
            location: peerDev.location || "",
            online: peerDev.online,
            ghost: false,
            x: 0,
            y: 0,
            fixed: false
          };
        }
        const edgeId = "wds:" + [dev.ip, peerDev.ip].sort().join("||");
        if (edgeIdSet.has(edgeId)) return;
        edgeIdSet.add(edgeId);
        topoEdges.push({
          id: edgeId,
          src: dev.ip,
          tgt: peerDev.ip,
          srcPort: link.linkName || "WDS",
          dstPort: "",
          type: "wds",
          label: link.band || "WDS",
          connected: link.connected
        });
        wdsCnt++;
      });
    });
    let l2tpCnt = 0;
    Object.values(state_default.deviceStore).forEach((dev) => {
      (dev.l2tpEndpoints || []).forEach((ep) => {
        const remoteIp = ep.remoteIp;
        if (!remoteIp || remoteIp === dev.ip) return;
        if (!topoNodes[remoteIp]) {
          const rd = state_default.deviceStore[remoteIp];
          topoNodes[remoteIp] = {
            id: remoteIp,
            name: rd ? rd.name || remoteIp : remoteIp,
            type: rd?.type || "unknown",
            os: rd?.os || "",
            model: rd?.model || "",
            location: rd?.location || "",
            online: rd ? rd.online : false,
            ghost: !rd,
            x: 0,
            y: 0,
            fixed: false,
            ghostMac: "",
            ghostInfo: ep.endpointName ? `L2TP \xB7 ${ep.endpointName}` : "L2TP",
            ghostSrc: dev.ip
          };
        }
        const edgeId = "l2tp:" + [dev.ip, remoteIp].sort().join("||");
        if (edgeIdSet.has(edgeId)) return;
        edgeIdSet.add(edgeId);
        topoEdges.push({
          id: edgeId,
          src: dev.ip,
          tgt: remoteIp,
          srcPort: ep.endpointName || "L2TP",
          dstPort: "",
          type: "l2tp",
          label: "L2TP",
          connected: ep.state === "connected"
        });
        l2tpCnt++;
      });
    });
    buildTopoSelector();
    layoutTopo(topoRootId);
    renderTopoSvg();
    setTimeout(topoFit, 60);
    const nc = Object.keys(topoNodes).length;
    const ec = topoEdges.length;
    const devWithLldp = Object.values(state_default.deviceStore).filter((d) => d.lldpData?.length).length;
    const st = q("topo-status");
    if (!devWithLldp && !wdsCnt && !l2tpCnt) {
      st.className = "status-bar error";
      st.textContent = "Keine Verbindungsdaten gespeichert \u2013 bitte LLDP Sync, Mesh Sync oder L2TP Sync unter den jeweiligen Tabs ausf\xFChren.";
    } else {
      const parts = [];
      if (devWithLldp) parts.push(`LLDP: ${devWithLldp} Ger\xE4t${devWithLldp !== 1 ? "e" : ""}`);
      if (wdsCnt) parts.push(`WDS: ${wdsCnt} Link${wdsCnt !== 1 ? "s" : ""}`);
      if (l2tpCnt) parts.push(`L2TP: ${l2tpCnt} Verbindung${l2tpCnt !== 1 ? "en" : ""}`);
      st.className = "status-bar ok";
      st.textContent = `${nc} Knoten, ${ec} Kante${ec !== 1 ? "n" : ""} \u2013 ${parts.join(" \xB7 ")}`;
    }
  }

  // ui/tabs/nav.js
  function toggleScriptOsGroup(id) {
    const wrap = document.getElementById(id);
    const chevron = document.getElementById(id + "-chev");
    if (!wrap) return;
    const open = wrap.classList.toggle("open");
    if (chevron) chevron.style.transform = open ? "" : "rotate(-90deg)";
  }
  function toggleScriptOs() {
    const wrap = document.getElementById("script-os-checks-wrap");
    const chevron = document.getElementById("script-os-chevron");
    if (!wrap) return;
    const collapsed = wrap.style.maxHeight === "0px" || wrap.style.opacity === "0";
    wrap.style.maxHeight = collapsed ? "200px" : "0";
    wrap.style.opacity = collapsed ? "1" : "0";
    if (chevron) chevron.style.transform = collapsed ? "" : "rotate(-90deg)";
  }
  function toggleGroup(name) {
    const grp = document.getElementById("tgroup-" + name);
    if (!grp) return;
    grp.classList.toggle("collapsed");
  }
  function initMenuGroups() {
    document.querySelectorAll(".tab-group").forEach((grp) => grp.classList.add("collapsed"));
  }
  function showTab(name) {
    if (name !== "syslog") window.stopSyslogAutoRefresh?.();
    if (name !== "traps") window.stopTrapsAutoRefresh?.();
    if (name !== "roaming") window.stopRoamingSyslogAutoRefresh?.();
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    const tab = q("tab-" + name);
    if (tab) tab.classList.add("active");
    const panel = q("panel-" + name);
    if (panel) panel.classList.add("active");
    if (tab) {
      const grp = tab.closest(".tab-group");
      if (grp?.classList.contains("collapsed")) {
        const gname = grp.id.replace("tgroup-", "");
        grp.classList.remove("collapsed");
      }
    }
    if (name !== "detail") {
      q("detail-badge").style.display = "none";
      window.stopSparkPoll?.();
    }
    if (name === "dashboard") window.renderDashboard?.();
    if (name === "wifidash") window.renderWifiDashboard?.();
    if (name === "wifi-settings") window.renderWifiSettings?.();
    if (name === "nac") window.renderNac?.();
    if (name === "freeradius") window.renderFreeRadius?.();
    if (name === "wifiplan") window.renderWifiPlan?.();
    if (name === "roaming") {
      window.loadRoamingSyslog?.();
      window.applyRoamingSyslogAutoRefresh?.();
    }
    if (name === "sensors") window.renderSensorsTab?.();
    if (name === "stp") window.renderStpTab?.();
    if (name === "poe") window.renderPoeTab?.();
    if (name === "porttest") window.populatePortTestSelect?.();
    if (name === "devices") window.renderDevices?.();
    if (name === "topology") window.buildTopoFromStore?.();
    if (name === "traffic") window.initTrafficTab?.();
    if (name !== "traffic") window.stopTrafficPoll?.();
    if (name === "vlantracer") window.vtInit?.();
    if (name === "loopdetect") window.ldInit?.();
    if (name === "sdn") window.showSdnTab?.("vlan");
    if (name === "mib") window.initMibBrowser?.();
    if (name === "backup") window.initBackup?.();
    if (name === "scripting") window.loadScriptList?.();
    if (name === "sni") window.sniTabActivated?.();
    if (name === "traps") {
      window.loadTraps?.();
      window.applyTrapsAutoRefresh?.();
    }
    if (name === "syslog") {
      window.loadSyslog?.();
      window.applySyslogAutoRefresh?.();
    }
    if (name === "rollout") {
      q("tbl-rollout").querySelector("tbody").innerHTML = '<tr><td colspan="6" class="empty">Noch kein Scan gestartet</td></tr>';
      q("cnt-rollout").textContent = "";
      q("rollout-progress-wrap").style.display = "none";
      window.setRolloutStatus?.("", "");
      state_default.rolloutFoundCnt = 0;
    }
    if (name === "scanner") {
      q("tbl-scan").querySelector("tbody").innerHTML = "";
      q("cnt-scan").textContent = "";
      q("scan-progress-wrap").style.display = "none";
      q("btn-save-all").style.display = "none";
      q("btn-update-details").style.display = "none";
      q("sep-save-all").style.display = "none";
      window.setScanStatus?.("", "");
      state_default.scanResults = [];
      state_default.scanFoundCnt = 0;
    }
  }
  window.toggleScriptOsGroup = toggleScriptOsGroup;
  window.toggleScriptOs = toggleScriptOs;
  window.toggleGroup = toggleGroup;
  window.initMenuGroups = initMenuGroups;
  window.showTab = showTab;

  // ui/tabs/wifi-plan.js
  var wpScale = 1;
  var wpOffX = 0;
  var wpOffY = 0;
  var wpDragging = false;
  var wpDragX = 0;
  var wpDragY = 0;
  var wpNodeDrag = null;
  var wpNodes = {};
  var wpBandFilter = "all";
  var wpFirstRender = true;
  function wpSetBandFilter(band) {
    wpBandFilter = band;
    ["all", "2.4", "5", "6"].forEach((b) => {
      const el = document.getElementById("wpf-" + b);
      if (el) el.classList.toggle("active", (b === "all" ? "all" : b + " GHz") === band || b === "all" && band === "all");
    });
    renderWifiPlanSvg();
  }
  var _wpSavedPos = (() => {
    try {
      return JSON.parse(localStorage.getItem("onsite_wp_pos") || "{}");
    } catch (e) {
      return {};
    }
  })();
  function wpApplyTransform() {
    const g = q("wifiplan-g");
    if (g) g.setAttribute("transform", `translate(${wpOffX},${wpOffY}) scale(${wpScale})`);
  }
  function wifiPlanZoom(f) {
    wpScale = Math.max(0.2, Math.min(4, wpScale * f));
    wpApplyTransform();
  }
  function wifiPlanFit() {
    const ids = Object.keys(wpNodes);
    if (!ids.length) return;
    const xs = ids.map((id) => wpNodes[id].x), ys = ids.map((id) => wpNodes[id].y);
    const minX = Math.min(...xs) - 100, maxX = Math.max(...xs) + 100;
    const minY = Math.min(...ys) - 60, maxY = Math.max(...ys) + 60;
    const ctr = q("wifiplan-container");
    const cw = ctr?.clientWidth || 900, ch = ctr?.clientHeight || 640;
    wpScale = Math.min(cw / (maxX - minX), ch / (maxY - minY), 2);
    wpOffX = cw / 2 - (minX + maxX) / 2 * wpScale;
    wpOffY = ch / 2 - (minY + maxY) / 2 * wpScale;
    wpApplyTransform();
  }
  function wpBgDragStart(e) {
    if (e.target.closest(".wp-node")) return;
    wpDragging = true;
    wpDragX = e.clientX - wpOffX;
    wpDragY = e.clientY - wpOffY;
  }
  function wpMouseMove(e) {
    if (wpNodeDrag) {
      const svgEl = q("wifiplan-svg");
      const rect = svgEl.getBoundingClientRect();
      wpNodes[wpNodeDrag.id].x = (e.clientX - rect.left - wpOffX) / wpScale;
      wpNodes[wpNodeDrag.id].y = (e.clientY - rect.top - wpOffY) / wpScale;
      renderWifiPlanSvg();
    } else if (wpDragging) {
      wpOffX = e.clientX - wpDragX;
      wpOffY = e.clientY - wpDragY;
      wpApplyTransform();
    }
  }
  function wpSavePositions() {
    const pos = {};
    Object.values(wpNodes).forEach((n) => {
      pos[n.id] = { x: n.x, y: n.y };
    });
    try {
      localStorage.setItem("onsite_wp_pos", JSON.stringify(pos));
    } catch (e) {
    }
  }
  function wpMouseUp() {
    if (wpNodeDrag) wpSavePositions();
    wpDragging = false;
    wpNodeDrag = null;
  }
  window.addEventListener("mouseup", () => {
    if (wpNodeDrag) {
      wpSavePositions();
      wpNodeDrag = null;
      wpDragging = false;
    }
  });
  function wpResetLayout() {
    localStorage.removeItem("onsite_wp_pos");
    Object.keys(_wpSavedPos).forEach((k) => delete _wpSavedPos[k]);
    Object.values(wpNodes).forEach((n) => {
      n.x = 0;
      n.y = 0;
    });
    wpFirstRender = true;
    renderWifiPlan();
  }
  function wpWheel(e) {
    e.preventDefault();
    const f = e.deltaY < 0 ? 1.1 : 0.9;
    const rect = q("wifiplan-container").getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    wpOffX = mx - (mx - wpOffX) * f;
    wpOffY = my - (my - wpOffY) * f;
    wpScale = Math.max(0.2, Math.min(4, wpScale * f));
    wpApplyTransform();
  }
  function wpNodeDragStart(e, id) {
    e.stopPropagation();
    wpNodeDrag = { id };
  }
  function chanOverlapColor(chA, bandA, chB, bandB) {
    if (bandA !== bandB) return null;
    const a = parseInt(chA), b = parseInt(chB);
    if (isNaN(a) || isNaN(b)) return null;
    if (bandA === "2.4 GHz") {
      const diff = Math.abs(a - b);
      if (diff === 0) return "#ef4444";
      if (diff < 5) return "#f97316";
      return null;
    }
    if (bandA === "5 GHz" || bandA === "6 GHz") {
      if (a === b) return "#ef4444";
      const blocks5 = [[36, 40, 44, 48], [52, 56, 60, 64], [100, 104, 108, 112], [116, 120, 124, 128], [132, 136, 140, 144], [149, 153, 157, 161], [165, 169, 173, 177]];
      const blocks6 = [[1, 5, 9, 13], [17, 21, 25, 29], [33, 37, 41, 45], [49, 53, 57, 61], [65, 69, 73, 77], [81, 85, 89, 93], [97, 101, 105, 109], [113, 117, 121, 125], [129, 133, 137, 141], [145, 149, 153, 157], [161, 165, 169, 173], [177, 181, 185, 189]];
      const blocks = bandA === "5 GHz" ? blocks5 : blocks6;
      const inSame = blocks.some((bl) => bl.includes(a) && bl.includes(b));
      if (inSame) return "#f97316";
      return null;
    }
    return null;
  }
  function channelPlausibleForBand(band, ch) {
    const n = parseInt(String(ch), 10);
    if (!n || !band) return false;
    if (band === "2.4 GHz") return n >= 1 && n <= 14;
    if (band === "5 GHz") return n >= 36 && n <= 177;
    if (band === "6 GHz") return n >= 1 && n <= 233;
    return false;
  }
  function wifiPlanChannelsForAp(ap) {
    const rc = ap.radioChannels;
    if (!Array.isArray(rc) || !rc.length) return [];
    return rc.map((r) => ({
      channel: typeof r.channel === "number" ? r.channel : parseInt(String(r.channel), 10) || 0,
      band: r.band || "",
      noise: r.noise ?? null,
      utilization: r.utilization ?? null
    })).filter((r) => r.channel > 0 && r.band && channelPlausibleForBand(r.band, r.channel)).sort((a, b) => a.channel - b.channel);
  }
  function renderWifiPlan() {
    const dark = document.documentElement.dataset.theme === "dark";
    const ownAps = Object.values(state_default.deviceStore).filter(
      (d) => (d.type === "lx-ap" || d.type === "lcos-ap") && d.online === true
    );
    const onlineApIps = new Set(ownAps.map((a) => a.ip));
    Object.keys(wpNodes).forEach((id) => {
      if (id.startsWith("foreign:")) return;
      if (!onlineApIps.has(id)) delete wpNodes[id];
    });
    const hasData = ownAps.some((a) => (a.radioChannels || []).length || (a.neighborAps || []).length || (a.wlanClients || []).length);
    q("wifiplan-empty").style.display = hasData ? "none" : "";
    if (!hasData) {
      q("wifiplan-g").innerHTML = "";
      return;
    }
    const ownIps = new Set(ownAps.map((a) => a.ip));
    ownAps.forEach((ap) => {
      if (!wpNodes[ap.ip]) {
        const saved = _wpSavedPos[ap.ip];
        wpNodes[ap.ip] = { id: ap.ip, x: saved?.x ?? 0, y: saved?.y ?? 0 };
      }
      const node = wpNodes[ap.ip];
      node.label = ap.name || ap.ip;
      node.sub = ap.ip;
      node.type = ap.type;
      node.online = ap.online !== false;
      node.channels = wifiPlanChannelsForAp(ap);
      node.clients = (ap.wlanClients || []).length;
      node.own = true;
      node.neighborAps = ap.neighborAps || [];
    });
    const foreignBssids = {};
    ownAps.forEach((ap) => {
      (ap.neighborAps || []).forEach((n) => {
        if (ownIps.has(n.ip)) return;
        if (!foreignBssids[n.bssid]) foreignBssids[n.bssid] = { ...n, seenBy: [] };
        if (!foreignBssids[n.bssid].seenBy.includes(ap.ip))
          foreignBssids[n.bssid].seenBy.push(ap.ip);
      });
    });
    const foreignById = {};
    Object.values(foreignBssids).forEach((f) => {
      const key = f.ip && f.ip !== "0.0.0.0" ? `ip:${f.ip}` : `bssid:${f.bssid}`;
      if (!foreignById[key]) foreignById[key] = { ...f, bands: [] };
      if (f.band && !foreignById[key].bands.includes(f.band)) foreignById[key].bands.push(f.band);
      if (!foreignById[key].ssid && f.ssid) foreignById[key].ssid = f.ssid;
    });
    Object.values(foreignById).forEach((f) => {
      const fid = `foreign:${f.bssid}`;
      if (!wpNodes[fid]) {
        const s = _wpSavedPos[fid];
        wpNodes[fid] = { id: fid, x: s?.x ?? 0, y: s?.y ?? 0 };
      }
      const node = wpNodes[fid];
      node.label = f.ssid || f.bssid.slice(0, 11);
      node.sub = f.bssid;
      node.type = "foreign";
      node.own = false;
      node.online = true;
      const fch = f.channel != null && f.channel !== "" ? parseInt(String(f.channel), 10) : 0;
      node.channels = fch > 0 && f.band && channelPlausibleForBand(f.band, fch) ? [{ channel: fch, band: f.band }] : [];
      node.clients = 0;
      node.seenBy = f.seenBy;
    });
    const currentForeignIds = new Set(Object.values(foreignById).map((f) => `foreign:${f.bssid}`));
    Object.keys(wpNodes).forEach((id) => {
      if (!id.startsWith("foreign:")) return;
      if (!currentForeignIds.has(id)) delete wpNodes[id];
    });
    const ownIds = ownAps.map((a) => a.ip).filter((id) => wpNodes[id]);
    const foreignIds = Object.values(foreignById).map((f) => `foreign:${f.bssid}`);
    const needsLayout = ownIds.every((id) => wpNodes[id].x === 0 && wpNodes[id].y === 0);
    if (needsLayout) {
      const innerR = Math.max(120, ownIds.length * 60);
      const outerR = innerR + Math.max(120, foreignIds.length * 40);
      ownIds.forEach((id, i) => {
        const angle = 2 * Math.PI * i / Math.max(ownIds.length, 1) - Math.PI / 2;
        wpNodes[id].x = Math.round(Math.cos(angle) * innerR);
        wpNodes[id].y = Math.round(Math.sin(angle) * innerR);
      });
      foreignIds.forEach((id, i) => {
        const angle = 2 * Math.PI * i / Math.max(foreignIds.length, 1) - Math.PI / 2;
        wpNodes[id].x = Math.round(Math.cos(angle) * outerR);
        wpNodes[id].y = Math.round(Math.sin(angle) * outerR);
      });
    }
    if (needsLayout || wpFirstRender) {
      wpFirstRender = false;
      setTimeout(wifiPlanFit, 50);
    }
    const edges = [];
    const edgePairs = /* @__PURE__ */ new Set();
    function addEdgesForAps(idA, idB, channelsA, channelsB, dashed = false) {
      const pairKey = [idA, idB].sort().join("||");
      if (edgePairs.has(pairKey)) return;
      let worstColor = null;
      let labels = [];
      channelsA.forEach((rA) => {
        channelsB.forEach((rB) => {
          const c = chanOverlapColor(rA.channel, rA.band, rB.channel, rB.band);
          if (!c) return;
          if (!worstColor || c === "#ef4444") worstColor = c;
          else if (c === "#f97316" && worstColor !== "#ef4444") worstColor = c;
          labels.push(`CH${rA.channel}\u2194CH${rB.channel}`);
        });
      });
      if (worstColor) {
        edgePairs.add(pairKey);
        edges.push({ a: idA, b: idB, color: worstColor, label: labels[0] || "", dashed });
      } else {
        edgePairs.add(pairKey);
        edges.push({ a: idA, b: idB, color: dark ? "rgba(100,120,150,0.3)" : "rgba(150,170,200,0.4)", label: "", dashed });
      }
    }
    for (let i = 0; i < ownIds.length; i++) {
      for (let j = i + 1; j < ownIds.length; j++) {
        const nodeA = wpNodes[ownIds[i]], nodeB = wpNodes[ownIds[j]];
        addEdgesForAps(ownIds[i], ownIds[j], nodeA.channels, nodeB.channels, false);
      }
    }
    Object.values(foreignById).forEach((f) => {
      const fid = `foreign:${f.bssid}`;
      const fch = f.channel != null && f.channel !== "" ? parseInt(String(f.channel), 10) : 0;
      const fChannels = fch > 0 && f.band && channelPlausibleForBand(f.band, fch) ? [{ channel: fch, band: f.band }] : [];
      f.seenBy.forEach((ownIp) => {
        const ownChannels = wpNodes[ownIp]?.channels || [];
        addEdgesForAps(fid, ownIp, fChannels, ownChannels, true);
      });
    });
    const wdsEdges = [];
    const wdsPairs = /* @__PURE__ */ new Set();
    const linkNameMap = {};
    ownAps.forEach((ap) => {
      (ap.wdsLinks || []).filter((l) => l.connected).forEach((link) => {
        if (!linkNameMap[link.linkName]) linkNameMap[link.linkName] = [];
        linkNameMap[link.linkName].push({ apIp: ap.ip, link });
      });
    });
    Object.values(linkNameMap).forEach((entries) => {
      for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
          const { apIp: aIp, link: lA } = entries[i];
          const { apIp: bIp, link: lB } = entries[j];
          const pairKey = [aIp, bIp].sort().join("||");
          if (wdsPairs.has(pairKey)) return;
          wdsPairs.add(pairKey);
          const sig = Math.max(lA.signal || 0, lB.signal || 0);
          wdsEdges.push({ a: aIp, b: bIp, signal: sig, band: lA.band || lB.band, txRate: lA.txRate, rxRate: lA.rxRate });
        }
      }
    });
    if (!wdsEdges.length) {
      const wdsAps = ownAps.filter((ap) => (ap.wdsLinks || []).some((l) => l.connected));
      for (let i = 0; i < wdsAps.length; i++) {
        for (let j = i + 1; j < wdsAps.length; j++) {
          const pairKey = [wdsAps[i].ip, wdsAps[j].ip].sort().join("||");
          if (wdsPairs.has(pairKey)) continue;
          wdsPairs.add(pairKey);
          const lA = (wdsAps[i].wdsLinks || []).find((l) => l.connected) || {};
          const lB = (wdsAps[j].wdsLinks || []).find((l) => l.connected) || {};
          const sig = Math.max(lA.signal || 0, lB.signal || 0);
          wdsEdges.push({ a: wdsAps[i].ip, b: wdsAps[j].ip, signal: sig, band: lA.band || lB.band, txRate: lA.txRate, rxRate: lA.rxRate });
        }
      }
    }
    wdsEdges.forEach((e) => {
      if (wpNodes[e.a]) wpNodes[e.a].hasWds = true;
      if (wpNodes[e.b]) wpNodes[e.b].hasWds = true;
    });
    window._wpWdsEdges = wdsEdges;
    const _b5 = [[36, 40, 44, 48], [52, 56, 60, 64], [100, 104, 108, 112], [116, 120, 124, 128], [132, 136, 140, 144], [149, 153, 157, 161], [165, 169, 173, 177]];
    const _b6 = [[1, 5, 9, 13], [17, 21, 25, 29], [33, 37, 41, 45], [49, 53, 57, 61], [65, 69, 73, 77], [81, 85, 89, 93], [97, 101, 105, 109], [113, 117, 121, 125], [129, 133, 137, 141], [145, 149, 153, 157], [161, 165, 169, 173], [177, 181, 185, 189]];
    window._wpCoChanPairs = {};
    const coChanEntries = [];
    ownAps.forEach((ap) => {
      wifiPlanChannelsForAp(ap).forEach((r) => {
        coChanEntries.push({ apIp: ap.ip, band: r.band, channel: String(r.channel) });
      });
    });
    [{ band: "2.4 GHz", blocks: null }, { band: "5 GHz", blocks: _b5 }, { band: "6 GHz", blocks: _b6 }].forEach(({ band, blocks }) => {
      const bEntries = coChanEntries.filter((c) => c.band === band && c.channel);
      const chanData = {};
      bEntries.forEach((c) => {
        if (!chanData[c.channel]) chanData[c.channel] = {};
        chanData[c.channel][c.apIp] = true;
      });
      Object.entries(chanData).forEach(([ch, apsObj]) => {
        const aps = Object.keys(apsObj);
        if (aps.length < 2) return;
        for (let i = 0; i < aps.length; i++) for (let j = i + 1; j < aps.length; j++) {
          const k = [aps[i], aps[j]].sort().join("||");
          if (!window._wpCoChanPairs[k]) window._wpCoChanPairs[k] = [];
          window._wpCoChanPairs[k].push({ band, label: `CH${ch}`, color: "#ef4444" });
        }
      });
      if (blocks) blocks.forEach((block) => {
        const blockAps = {};
        bEntries.filter((c) => block.includes(parseInt(c.channel))).forEach((c) => {
          blockAps[c.apIp] = c.channel;
        });
        const aps = Object.keys(blockAps);
        if (aps.length < 2) return;
        for (let i = 0; i < aps.length; i++) for (let j = i + 1; j < aps.length; j++) {
          if (blockAps[aps[i]] === blockAps[aps[j]]) continue;
          const k = [aps[i], aps[j]].sort().join("||");
          if (!window._wpCoChanPairs[k]) window._wpCoChanPairs[k] = [];
          if (!window._wpCoChanPairs[k].some((p) => p.band === band))
            window._wpCoChanPairs[k].push({ band, label: `CH${blockAps[aps[i]]}\u2194${blockAps[aps[j]]}`, color: "#f97316" });
        }
      });
    });
    renderWifiPlanSvg();
  }
  function renderWifiPlanSvg() {
    const dark = document.documentElement.dataset.theme === "dark";
    const NW2 = 200;
    const bandColor = (b) => b === "2.4 GHz" ? "#f97316" : b === "5 GHz" ? "#22c55e" : b === "6 GHz" ? "#818cf8" : "#7ea8c8";
    function nodeH(node) {
      return 54 + Math.max(1, (node.channels || []).length) * 22;
    }
    function borderPt(node, tx, ty) {
      const NH2 = nodeH(node), hw = NW2 / 2, hh = NH2 / 2;
      const dx = tx - node.x, dy = ty - node.y;
      if (!dx && !dy) return { x: node.x, y: node.y + hh };
      const sX = dx ? hw / Math.abs(dx) : Infinity;
      const sY = dy ? hh / Math.abs(dy) : Infinity;
      const s = Math.min(sX, sY);
      return { x: node.x + dx * s, y: node.y + dy * s };
    }
    const nodes = Object.values(wpNodes);
    q("wifiplan-empty").style.display = nodes.length ? "none" : "";
    if (!nodes.length) {
      q("wifiplan-g").innerHTML = "";
      return;
    }
    const ownNodes = nodes.filter((n) => n.own);
    const foreignNodes = nodes.filter((n) => !n.own);
    const wdsEdges = window._wpWdsEdges || [];
    let svg = "";
    const bgStr = dark ? "#0d1b2a" : "#f0f4f8";
    ownNodes.forEach((node) => {
      if (!node.online) return;
      const r = 110 + (node.channels || []).length * 10;
      svg += `<circle cx="${node.x}" cy="${node.y}" r="${r}" fill="${dark ? "rgba(249,115,22,0.03)" : "rgba(249,115,22,0.025)"}" stroke="${dark ? "rgba(249,115,22,0.10)" : "rgba(249,115,22,0.07)"}" stroke-dasharray="5,5"/>`;
    });
    wdsEdges.forEach((e) => {
      const nA = wpNodes[e.a], nB = wpNodes[e.b];
      if (!nA || !nB) return;
      const fs = borderPt(nA, nB.x, nB.y);
      const te = borderPt(nB, nA.x, nA.y);
      const sigVal = e.signal ? -e.signal : null;
      const sigColor = !sigVal ? "#f97316" : sigVal >= -65 ? "#22c55e" : sigVal >= -75 ? "#84cc16" : "#f97316";
      const midX = (fs.x + te.x) / 2, midY = (fs.y + te.y) / 2;
      const label = e.signal ? `${-e.signal} dBm` : "WDS";
      const rateLabel = e.txRate ? ` \xB7 ${e.txRate}/${e.rxRate} Mbps` : "";
      svg += `<line x1="${fs.x.toFixed(1)}" y1="${fs.y.toFixed(1)}" x2="${te.x.toFixed(1)}" y2="${te.y.toFixed(1)}" stroke="${sigColor}" stroke-width="3.5" opacity="0.75"/>`;
      svg += `<rect x="${(midX - 36).toFixed(1)}" y="${(midY - 10).toFixed(1)}" width="72" height="16" rx="4" fill="${bgStr}" opacity="0.85"/>`;
      svg += `<text x="${midX.toFixed(1)}" y="${(midY + 1).toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="9" fill="${sigColor}" font-family="system-ui" font-weight="700">WDS ${h(label)}${h(rateLabel)}</text>`;
    });
    ownNodes.forEach((nodeA, i) => {
      for (let j = i + 1; j < ownNodes.length; j++) {
        const nodeB = ownNodes[j];
        const hasWds = wdsEdges.some((e) => e.a === nodeA.id && e.b === nodeB.id || e.a === nodeB.id && e.b === nodeA.id);
        const pairKey = [nodeA.id, nodeB.id].sort().join("||");
        const allPairs = (window._wpCoChanPairs || {})[pairKey] || [];
        const activePairs = wpBandFilter === "all" ? allPairs : allPairs.filter((p) => p.band === wpBandFilter);
        const neutralColor = dark ? "rgba(100,140,200,0.13)" : "rgba(100,130,180,0.13)";
        let lineColor = neutralColor;
        let label = "";
        if (activePairs.length) {
          const hasCoChan = activePairs.some((p) => p.color === "#ef4444");
          lineColor = hasCoChan ? "#ef4444" : "#f97316";
          label = activePairs.map((p) => p.label).join(" \xB7 ");
        }
        const fs = borderPt(nodeA, nodeB.x, nodeB.y);
        const te = borderPt(nodeB, nodeA.x, nodeA.y);
        const midX = (fs.x + te.x) / 2, midY = (fs.y + te.y) / 2;
        const strokeW = activePairs.length ? hasWds ? 1.5 : 2.2 : hasWds ? 1 : 1.2;
        svg += `<line x1="${fs.x.toFixed(1)}" y1="${fs.y.toFixed(1)}" x2="${te.x.toFixed(1)}" y2="${te.y.toFixed(1)}" stroke="${lineColor}" stroke-width="${strokeW}" ${hasWds ? 'stroke-dasharray="4,3"' : ""}/>`;
        if (label) {
          const labelY = hasWds ? midY + 14 : midY;
          const lw = label.length * 5 + 10;
          svg += `<rect x="${(midX - lw / 2).toFixed(1)}" y="${(labelY - 8).toFixed(1)}" width="${lw}" height="14" rx="3" fill="${bgStr}" opacity="0.85"/>`;
          svg += `<text x="${midX.toFixed(1)}" y="${(labelY + 1).toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="8" fill="${lineColor}" font-family="system-ui" font-weight="700">${h(label)}</text>`;
        }
      }
    });
    foreignNodes.forEach((fNode) => {
      (fNode.seenBy || []).forEach((ownIp) => {
        const ownNode = wpNodes[ownIp];
        if (!ownNode) return;
        const fs = borderPt(fNode, ownNode.x, ownNode.y);
        const te = borderPt(ownNode, fNode.x, fNode.y);
        let lineColor = dark ? "rgba(120,120,120,0.25)" : "rgba(150,150,150,0.25)";
        (fNode.channels || []).forEach((rF) => {
          (ownNode.channels || []).forEach((rO) => {
            const c = chanOverlapColor(rF.channel, rF.band, rO.channel, rO.band);
            if (c === "#ef4444") lineColor = "rgba(239,68,68,0.5)";
            else if (c === "#f97316" && !lineColor.includes("239")) lineColor = "rgba(249,115,22,0.4)";
          });
        });
        svg += `<line x1="${fs.x.toFixed(1)}" y1="${fs.y.toFixed(1)}" x2="${te.x.toFixed(1)}" y2="${te.y.toFixed(1)}" stroke="${lineColor}" stroke-width="1.2" stroke-dasharray="5,4"/>`;
      });
    });
    ownNodes.forEach((node) => {
      const NH2 = nodeH(node), hw = NW2 / 2, hh = NH2 / 2;
      const rx = node.x - hw, ry = node.y - hh;
      const dotC = node.online ? "#22c55e" : "#ef4444";
      const borderC = node.hasWds ? dark ? "rgba(249,115,22,0.9)" : "rgba(200,90,10,0.8)" : dark ? "rgba(249,115,22,0.6)" : "rgba(200,90,10,0.5)";
      const bgC = dark ? "rgba(249,115,22,0.09)" : "rgba(249,115,22,0.05)";
      const textC = dark ? "#e8f0f8" : "rgba(15,30,55,.92)";
      const subC = dark ? "#7ea8c8" : "rgba(74,100,120,.75)";
      const cntLabel = node.clients > 0 ? ` \xB7 ${node.clients}` : "";
      let radioRows = "";
      (node.channels || []).sort((a, b) => (Number(a.channel) || 0) - (Number(b.channel) || 0)).forEach((r, ri) => {
        const ry2 = ry + 50 + ri * 22;
        const bc = bandColor(r.band);
        const util = r.utilization ?? null;
        const noise = r.noise ?? null;
        const barW = 40, barH = 5, barX = rx + 120;
        const utilPct = util !== null ? Math.min(util, 100) : 0;
        const utilColor = utilPct > 70 ? "#ef4444" : utilPct > 40 ? "#f97316" : "#22c55e";
        const bandShort = r.band.replace(" GHz", "G");
        radioRows += `<text x="${rx + 10}" y="${ry2 + 4}" font-size="9" font-weight="700" fill="${bc}" font-family="monospace,system-ui">CH${r.channel}</text>`;
        radioRows += `<text x="${rx + 46}" y="${ry2 + 4}" font-size="8" fill="${bc}" opacity="0.75" font-family="system-ui">${bandShort}</text>`;
        if (noise !== null) {
          radioRows += `<text x="${rx + 76}" y="${ry2 + 4}" font-size="7.5" fill="${subC}" font-family="monospace,system-ui">${noise}dBm</text>`;
        }
        if (util !== null) {
          radioRows += `<rect x="${barX}" y="${ry2 - 1}" width="${barW}" height="${barH}" rx="2" fill="${dark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.10)"}"/>`;
          radioRows += `<rect x="${barX}" y="${ry2 - 1}" width="${Math.round(barW * utilPct / 100)}" height="${barH}" rx="2" fill="${utilColor}"/>`;
          radioRows += `<text x="${barX + barW + 4}" y="${ry2 + 4}" font-size="8" fill="${utilColor}" font-family="system-ui" font-weight="700">${util}%</text>`;
        }
      });
      const wdsBadge = node.hasWds ? `<rect x="${rx + NW2 - 58}" y="${ry + 5}" width="22" height="13" rx="4" fill="rgba(34,197,94,0.2)"/><text x="${rx + NW2 - 47}" y="${ry + 14}" text-anchor="middle" font-size="8" font-weight="700" fill="#22c55e" font-family="system-ui">WDS</text>` : "";
      svg += `<g class="wp-node" style="cursor:move" onmousedown="wpNodeDragStart(event,'${h(node.id)}')" onclick="openDeviceDetail('${h(node.id)}')">
      <rect x="${rx}" y="${ry}" width="${NW2}" height="${NH2}" rx="8" fill="${bgC}" stroke="${borderC}" stroke-width="${node.hasWds ? 2.5 : 1.8}" filter="url(#wp-glow)"/>
      <circle cx="${rx + 10}" cy="${ry + 18}" r="4" fill="${dotC}"/>
      ${wdsBadge}
      <rect x="${rx + NW2 - 30}" y="${ry + 5}" width="22" height="13" rx="4" fill="rgba(249,115,22,0.2)"/>
      <text x="${rx + NW2 - 19}" y="${ry + 14}" text-anchor="middle" font-size="8" font-weight="800" fill="#f97316" font-family="system-ui">AP</text>
      <text x="${rx + 18}" y="${ry + 20}" font-size="12" font-weight="700" fill="${textC}" font-family="system-ui,sans-serif">${h(node.label)}</text>
      <text x="${rx + 18}" y="${ry + 34}" font-size="8.5" fill="${subC}" font-family="system-ui,sans-serif">${h(node.id)}${cntLabel ? ` <tspan fill="var(--cyan)">${h(cntLabel)} &#9679;</tspan>` : ""}</text>
      <line x1="${rx + 6}" y1="${ry + 41}" x2="${rx + NW2 - 6}" y2="${ry + 41}" stroke="${dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)"}" stroke-width="1"/>
      ${radioRows}
    </g>`;
    });
    foreignNodes.forEach((node) => {
      const NH2 = nodeH(node), hw = NW2 / 2, hh = NH2 / 2;
      const rx = node.x - hw, ry = node.y - hh;
      const borderC = dark ? "rgba(100,120,150,0.35)" : "rgba(100,120,150,0.35)";
      const bgC = dark ? "rgba(20,32,52,0.85)" : "rgba(218,226,238,0.85)";
      const textC = dark ? "#7a9db8" : "rgba(74,100,120,.80)";
      let radioRows = "";
      (node.channels || []).forEach((r, ri) => {
        const ry2 = ry + 48 + ri * 20;
        const bc = bandColor(r.band);
        radioRows += `<text x="${rx + 10}" y="${ry2 + 4}" font-size="9" font-weight="700" fill="${bc}" font-family="monospace">CH${r.channel}</text>`;
        radioRows += `<text x="${rx + 46}" y="${ry2 + 4}" font-size="8" fill="${textC}" font-family="system-ui">${r.band.replace(" GHz", "G")}</text>`;
      });
      svg += `<g class="wp-node" style="cursor:move" onmousedown="wpNodeDragStart(event,'${h(node.id)}')">
      <rect x="${rx}" y="${ry}" width="${NW2}" height="${NH2}" rx="8" fill="${bgC}" stroke="${borderC}" stroke-width="1.2" stroke-dasharray="5,3"/>
      <rect x="${rx + NW2 - 44}" y="${ry + 5}" width="36" height="13" rx="4" fill="${dark ? "rgba(100,120,150,0.2)" : "rgba(100,120,150,0.15)"}"/>
      <text x="${rx + NW2 - 26}" y="${ry + 14}" text-anchor="middle" font-size="8" font-weight="700" fill="${textC}" font-family="system-ui">FREMD</text>
      <text x="${rx + 10}" y="${ry + 20}" font-size="11" font-weight="600" fill="${textC}" font-family="system-ui">${h(node.label)}</text>
      <text x="${rx + 10}" y="${ry + 34}" font-size="8" fill="${textC}" opacity="0.6" font-family="monospace">${h(node.sub)}</text>
      <line x1="${rx + 6}" y1="${ry + 41}" x2="${rx + NW2 - 6}" y2="${ry + 41}" stroke="${dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)"}" stroke-width="1"/>
      ${radioRows}
    </g>`;
    });
    q("wifiplan-g").innerHTML = svg;
    wpApplyTransform();
    const leg = q("wifiplan-legend");
    if (leg) leg.innerHTML = `<span style="color:#22c55e">\u2501\u2501</span> WDS-Link (RSSI) &nbsp;<span style="color:#ef4444">\u2501</span> Co-Channel &nbsp;<span style="color:#f97316">\u2501</span> Teilw. Overlap &nbsp;<span style="color:${dark ? "rgba(100,140,200,0.9)" : "rgba(100,130,180,0.8)"}">\u2501</span> Kein Overlap &nbsp;<span style="color:${dark ? "rgba(120,120,120,0.7)" : "rgba(150,150,150,0.7)"}">\u254C</span> Fremd-AP &nbsp;<span style="color:#f97316">\u2588\u2591</span> Kanalauslastung`;
  }
  window.wpSetBandFilter = wpSetBandFilter;
  window.wifiPlanZoom = wifiPlanZoom;
  window.wifiPlanFit = wifiPlanFit;
  window.wpBgDragStart = wpBgDragStart;
  window.wpMouseMove = wpMouseMove;
  window.wpMouseUp = wpMouseUp;
  window.wpResetLayout = wpResetLayout;
  window.wpWheel = wpWheel;
  window.wpNodeDragStart = wpNodeDragStart;
  window.renderWifiPlan = renderWifiPlan;
  window.renderWifiPlanSvg = renderWifiPlanSvg;

  // ui/tabs/scripting.js
  var ALL_SCRIPT_OS = ["LCOS", "LCOS LX", "LCOS FX", "LCOS SX 3", "LCOS SX 4", "LCOS SX 5"];
  var OS_SSH_USER = {
    "LCOS SX 3": "admin",
    "LCOS SX 4": "admin",
    "LCOS SX 5": "admin",
    "LCOS LX": "root",
    "LCOS": "root",
    "LCOS FX": "root"
  };
  var SCRIPT_DEV_LABEL_STYLE = "display:flex;align-items:center;gap:6px;padding:3px 8px;cursor:pointer;font-size:12px;min-width:0";
  var SCRIPT_MANUAL_LABEL_STYLE = "display:flex;align-items:center;gap:6px;padding:3px 8px;cursor:pointer;font-size:12px";
  var _scripts = {};
  var _activeScript = null;
  function esc3(s) {
    return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function scriptDeviceList() {
    return q("script-device-list");
  }
  function populateScriptLocationSelect() {
    const sel = q("script-loc-select");
    if (!sel) return;
    const locs = getLocations();
    const cur = sel.value;
    sel.innerHTML = '<option value="">Standort\u2026</option>' + locs.map((l) => `<option value="${h(l)}">${h(l)}</option>`).join("");
    if (cur && locs.includes(cur)) sel.value = cur;
  }
  function scriptDeviceRowHtml(dev, checked) {
    return `<label data-loc="${h(dev.location || "")}" style="${SCRIPT_DEV_LABEL_STYLE}"><input type="checkbox" class="script-dev-cb" value="${h(dev.ip)}" data-os="${h(dev.os || "")}"${checked ? " checked" : ""}><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h(dev.name || dev.ip)}</span><span style="color:var(--text3);font-family:monospace;font-size:11px;flex-shrink:0">${h(dev.ip)}</span></label>`;
  }
  async function loadScriptList() {
    try {
      const r = await fetch("/api/scripte");
      _scripts = await r.json();
    } catch {
      _scripts = {};
    }
    renderScriptList();
  }
  function renderScriptList() {
    const el = q("script-list");
    let html = "";
    for (const os of ALL_SCRIPT_OS) {
      const list = _scripts[os] || [];
      if (!list.length) continue;
      const hasActive = _activeScript && _activeScript._os === os;
      const open = hasActive;
      const osId = "sog-" + os.replace(/\s/g, "_");
      html += `<div class="script-os-group">
      <div class="script-os-label" onclick="toggleScriptOsGroup('${osId}')">
        <span>${os}</span>
        <span class="sg-chevron" id="${osId}-chev" style="transform:${open ? "" : "rotate(-90deg)"}">\u25BE</span>
      </div>
      <div class="script-os-items${open ? " open" : ""}" id="${osId}">`;
      for (const s of list) {
        const active = hasActive && _activeScript._file === s._file ? " active" : "";
        html += `<div class="script-item${active}" onclick="scriptOpen('${os.replace(/'/g, "\\'")}','${s._file.replace(/'/g, "\\'")}')">
        <span class="script-item-name">${s._protected ? "\u{1F512} " : ""}${esc3(s.name)}</span>
        ${s.description ? `<span class="script-item-desc">${esc3(s.description)}</span>` : ""}
      </div>`;
      }
      html += `</div></div>`;
    }
    el.innerHTML = html || '<div style="padding:16px;font-size:12px;color:var(--text3)">Keine Scripts vorhanden</div>';
  }
  function scriptOpen(os, file) {
    const s = (_scripts[os] || []).find((x) => x._file === file);
    if (!s) return;
    _activeScript = { ...s, _os: os };
    renderScriptList();
    scriptFillForm(_activeScript);
  }
  function scriptNew() {
    _activeScript = null;
    renderScriptList();
    scriptFillForm({ name: "", description: "", os: [], commands: [], _file: null, _os: null });
  }
  function scriptFillForm(s) {
    q("script-empty-hint").style.display = "none";
    q("script-form").style.display = "block";
    q("script-run-box").style.display = "flex";
    q("script-output").style.display = "none";
    q("script-name").value = s.name || "";
    q("script-desc").value = s.description || "";
    q("script-commands").value = (s.commands || []).join("\n");
    const scriptOs = Array.isArray(s.os) ? s.os[0] : s.os;
    q("script-os-checks").querySelectorAll("input[type=radio]").forEach((rb) => {
      rb.checked = rb.value === scriptOs;
    });
    const userEl = q("script-run-user");
    if (userEl && scriptOs) userEl.value = OS_SSH_USER[scriptOs] || "root";
    renderScriptDevices();
  }
  function renderScriptDevices() {
    const devList = scriptDeviceList();
    if (!devList) return;
    const scriptOs = _activeScript?._os || null;
    const osFilter = scriptOs ? [scriptOs] : null;
    const checked = new Set([...devList.querySelectorAll("input.script-dev-cb:checked")].map((cb) => cb.value));
    const devices = Object.values(state_default.deviceStore).filter((d) => !osFilter || d.os && osFilter.includes(d.os)).sort((a, b) => (a.name || a.ip).localeCompare(b.name || b.ip));
    devList.innerHTML = devices.length ? devices.map((dev) => scriptDeviceRowHtml(dev, checked.has(dev.ip))).join("") : `<div style="padding:8px 10px;font-size:12px;color:var(--text3)">Keine Ger\xE4te in der Ger\xE4teliste</div>`;
    populateScriptLocationSelect();
  }
  function scriptGetForm() {
    const osEl = q("script-os-checks").querySelector("input[type=radio]:checked");
    const os = osEl ? [osEl.value] : [];
    const commands = q("script-commands").value.split("\n").map((l) => l.trim()).filter(Boolean);
    return {
      name: q("script-name").value.trim(),
      description: q("script-desc").value.trim(),
      os,
      commands,
      _file: _activeScript?._file || null,
      _os: _activeScript?._os || null
    };
  }
  async function scriptSave() {
    const s = scriptGetForm();
    if (!s.name) return alert("Name erforderlich");
    if (!s.os.length) return alert("Bitte ein Betriebssystem ausw\xE4hlen");
    if (!s.commands.length) return alert("Mindestens ein Befehl erforderlich");
    const r = await fetch("/api/scripte", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
    const d = await r.json();
    if (!d.ok) return alert("Fehler: " + d.error);
    _activeScript = { ...s, _file: d.file, _os: s.os[0] };
    await loadScriptList();
  }
  async function scriptDelete() {
    if (!_activeScript) return;
    if (_activeScript._protected) {
      alert("Das ROLLOUT-Script kann nicht gel\xF6scht werden.");
      return;
    }
    if (!confirm(`Script "${_activeScript.name}" l\xF6schen?`)) return;
    const r = await fetch(`/api/scripte?os=${encodeURIComponent(_activeScript._os)}&file=${encodeURIComponent(_activeScript._file)}`, { method: "DELETE" });
    const d = await r.json();
    if (!d.ok) return alert("Fehler: " + d.error);
    _activeScript = null;
    q("script-empty-hint").style.display = "block";
    q("script-form").style.display = "none";
    q("script-run-box").style.display = "none";
    q("script-output").style.display = "none";
    await loadScriptList();
  }
  function scriptSelectAll(checked) {
    scriptDeviceList()?.querySelectorAll("input.script-dev-cb").forEach((cb) => {
      cb.checked = checked;
    });
  }
  function scriptSelectDevicesByLocation() {
    const sel = q("script-loc-select");
    const devList = scriptDeviceList();
    if (!sel || !devList) return;
    const target = sel.value;
    if (!target) {
      alert("Bitte einen Standort w\xE4hlen.");
      return;
    }
    devList.querySelectorAll("input.script-dev-cb").forEach((cb) => {
      const label = cb.closest("label");
      if (!label || !label.hasAttribute("data-loc")) return;
      const loc = label.getAttribute("data-loc") || "";
      cb.checked = loc === target;
    });
  }
  function scriptAddCustomIp() {
    const ip = q("script-run-ip").value.trim();
    if (!ip) return;
    const list = scriptDeviceList();
    if (!list) return;
    if ([...list.querySelectorAll("input.script-dev-cb")].some((cb) => cb.value === ip)) {
      q("script-run-ip").value = "";
      return;
    }
    const label = document.createElement("label");
    label.setAttribute("data-loc", "");
    label.style.cssText = SCRIPT_MANUAL_LABEL_STYLE;
    label.innerHTML = `<input type="checkbox" class="script-dev-cb" value="${h(ip)}" checked><span style="flex:1;font-family:monospace">${h(ip)}</span>`;
    list.appendChild(label);
    q("script-run-ip").value = "";
  }
  async function scriptRun() {
    const scriptOs = _activeScript && _activeScript._os || "";
    const devList = scriptDeviceList();
    const checkedCbs = devList ? [...devList.querySelectorAll("input.script-dev-cb:checked")] : [];
    const ips = checkedCbs.map((cb) => cb.value);
    const manualIp = q("script-run-ip").value.trim();
    if (manualIp && !ips.includes(manualIp)) ips.push(manualIp);
    if (!ips.length) return alert("Bitte mindestens ein Ger\xE4t ausw\xE4hlen oder eine IP eingeben");
    const user = q("script-run-user").value.trim();
    const pass = q("script-run-pass").value;
    if (!user || !pass) return alert("User und Passwort erforderlich");
    const commands = q("script-commands").value.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!commands.length) return alert("Keine Befehle vorhanden");
    const btn = q("script-run-btn");
    btn.disabled = true;
    q("script-output").style.display = "block";
    q("script-output-body").innerHTML = "";
    for (let i = 0; i < ips.length; i++) {
      const ip = ips[i];
      btn.textContent = `\u23F3 ${i + 1}/${ips.length} \xB7 ${ip}`;
      const block = document.createElement("div");
      block.innerHTML = `<div style="padding:8px 14px;color:var(--text3);font-size:12px">Verbinde mit ${h(ip)}\u2026</div>`;
      q("script-output-body").appendChild(block);
      block.scrollIntoView({ behavior: "smooth", block: "nearest" });
      try {
        const r = await fetch("/api/scripte/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ip, user, pass, commands, os: scriptOs })
        });
        const d = await r.json();
        if (d.error) throw new Error(d.error);
        block.innerHTML = renderScriptOutputHtml(d.results, ip);
      } catch (e) {
        block.innerHTML = `<div class="script-result-block"><div style="padding:6px 14px;font-weight:600;font-size:12px;color:var(--text2)"># ${h(ip)}</div><div class="script-result-error">Fehler: ${h(e.message)}</div></div>`;
      }
    }
    btn.disabled = false;
    btn.textContent = "\u25B6 Ausf\xFChren";
  }
  window.loadScriptList = loadScriptList;
  window.renderScriptList = renderScriptList;
  window.scriptOpen = scriptOpen;
  window.scriptNew = scriptNew;
  window.renderScriptDevices = renderScriptDevices;
  window.scriptSave = scriptSave;
  window.scriptDelete = scriptDelete;
  window.scriptSelectAll = scriptSelectAll;
  window.scriptSelectDevicesByLocation = scriptSelectDevicesByLocation;
  window.scriptAddCustomIp = scriptAddCustomIp;
  window.scriptRun = scriptRun;

  // ui/tabs/traffic.js
  var polling = false;
  var pollTimer = null;
  var pollCount = 0;
  var liveData = {};
  var historyCache = {};
  var selectedDev = "";
  var selectedRange = "live";
  var selectedLink = "";
  var localHistory = {};
  var trafficSort = { col: "util", dir: "desc" };
  var cachedEdges = [];
  function formatBps2(bps) {
    if (bps >= 1e9) return (bps / 1e9).toFixed(2) + " Gbps";
    if (bps >= 1e6) return (bps / 1e6).toFixed(1) + " Mbps";
    if (bps >= 1e3) return (bps / 1e3).toFixed(0) + " kbps";
    return bps + " bps";
  }
  function formatBpsShort(bps) {
    if (bps >= 1e9) return (bps / 1e9).toFixed(1) + "G";
    if (bps >= 1e6) return (bps / 1e6).toFixed(0) + "M";
    if (bps >= 1e3) return (bps / 1e3).toFixed(0) + "k";
    return bps + "";
  }
  function getLldpEdges() {
    const edges = [];
    const seen = /* @__PURE__ */ new Set();
    for (const dev of Object.values(state_default.deviceStore)) {
      if (!dev.lldpData?.length) continue;
      for (const entry of dev.lldpData) {
        const srcIp = dev.ip;
        const srcPort = entry.localPortName || "";
        const remName = entry.remSysName || entry.remPortId || "";
        const remPort = entry.remPortId || entry.remPortDesc || "";
        const tgtIp = resolveNeighborIp(entry, srcIp);
        const key = [srcIp, tgtIp || remName, srcPort].sort().join("||");
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({
          srcIp,
          srcPort,
          srcName: dev.name || dev.ip,
          tgtIp,
          tgtPort: remPort,
          tgtName: tgtIp ? state_default.deviceStore[tgtIp]?.name || tgtIp : remName,
          key: srcIp + "|" + srcPort
        });
      }
    }
    cachedEdges = edges;
    return edges;
  }
  function resolveNeighborIp(entry, srcIp) {
    if (entry.remChassisIp && entry.remChassisIp !== "0.0.0.0" && state_default.deviceStore[entry.remChassisIp]) {
      return entry.remChassisIp;
    }
    const remMac = (entry.remMac || "").replace(/[\-\. ]/g, ":").toLowerCase();
    for (const d of Object.values(state_default.deviceStore)) {
      if (d.ip === srcIp) continue;
      const macs = [d.mac, ...d.macs || []].map((m) => (m || "").replace(/[\-\. ]/g, ":").toLowerCase()).filter(Boolean);
      if (remMac && macs.includes(remMac)) return d.ip;
    }
    return null;
  }
  function edgeByKey(key) {
    return cachedEdges.find((e) => e.key === key);
  }
  function trafficTogglePoll() {
    if (polling) stopPoll();
    else startPoll();
  }
  function startPoll() {
    polling = true;
    pollCount = 0;
    const btn = q("traffic-toggle-btn");
    if (btn) {
      btn.textContent = "\u25A0 Stop";
      btn.classList.add("btn-danger");
    }
    setStatus("\u{1F4E1} Starte Traffic-Messung\u2026");
    fetchLive();
    const interval = (state_default.appSettings?.trafficPollInterval || 60) * 1e3;
    pollTimer = setInterval(fetchLive, interval);
  }
  function stopPoll() {
    polling = false;
    clearInterval(pollTimer);
    pollTimer = null;
    const btn = q("traffic-toggle-btn");
    if (btn) {
      btn.textContent = "\u25B6 Start";
      btn.classList.remove("btn-danger");
    }
    setStatus("");
  }
  async function fetchLive() {
    try {
      const params = new URLSearchParams({ lldp: "1" });
      if (selectedDev) params.set("ip", selectedDev);
      const res = await fetch("/api/iftraffic?" + params);
      if (!res.ok) {
        setStatus("\u26A0 HTTP " + res.status);
        return;
      }
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
      if (!selectedLink && edges.length) {
        selectedLink = edges[0].key;
      }
      const devCount = Object.keys(liveData).length;
      if (pollCount === 1) {
        setStatus(`\u{1F4E1} Erste Messung (${devCount} Ger\xE4t${devCount !== 1 ? "e" : ""})\u2026 warte auf Delta\u2026`);
      } else {
        let maxBps = 0;
        Object.values(liveData).forEach((d) => Object.values(d).forEach((i) => {
          maxBps = Math.max(maxBps, i.inBps, i.outBps);
        }));
        setStatus(`\u{1F4F6} Live \xB7 ${devCount} Ger\xE4t${devCount !== 1 ? "e" : ""} \xB7 max ${formatBps2(maxBps)}`);
      }
      renderTable();
      renderChart();
    } catch (err) {
      setStatus("\u26A0 Fehler: " + err.message);
    }
  }
  function findIface(ifMap, portName) {
    if (!ifMap || !portName) return null;
    if (ifMap[portName]) return ifMap[portName];
    const norm = (s) => (s || "").toLowerCase().replace(/[\s\-_]/g, "");
    const t = norm(portName);
    for (const [k, v] of Object.entries(ifMap)) {
      if (norm(k) === t) return v;
    }
    const extractNum = (s) => {
      const m = (s || "").match(/(\d+)\s*[a-z]?\s*$/i);
      return m ? parseInt(m[1], 10) : null;
    };
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
  async function fetchHistory() {
    try {
      const url = selectedDev ? `/api/traffic-history?ip=${encodeURIComponent(selectedDev)}` : "/api/traffic-history";
      const res = await fetch(url);
      if (!res.ok) return;
      historyCache = await res.json();
      renderChart();
      renderTable();
    } catch {
    }
  }
  function trafficSelectLink(key) {
    selectedLink = key;
    renderTable();
    renderChart();
  }
  function trafficDevChanged() {
    selectedDev = q("traffic-dev-select")?.value || "";
    selectedLink = "";
    if (selectedRange !== "live") fetchHistory();
    else if (polling) fetchLive();
  }
  function trafficRangeChanged() {
    selectedRange = q("traffic-range-select")?.value || "live";
    if (selectedRange === "live") {
      if (!polling) {
        renderChart();
        renderTable();
      }
    } else {
      fetchHistory();
    }
  }
  function trafficClearHistory() {
    if (!confirm("Traffic-History wirklich l\xF6schen?")) return;
    fetch("/api/traffic-history", { method: "DELETE" }).then(() => {
      historyCache = {};
      localHistory = {};
      setStatus("\u2713 History gel\xF6scht");
      renderChart();
      renderTable();
    });
  }
  function initTrafficTab() {
    populateDevSelect();
    if (state_default.appSettings?.trafficAutoStart && !polling) startPoll();
    if (selectedRange !== "live") {
      fetchHistory();
    } else if (polling) {
      renderTable();
      renderChart();
    }
  }
  function stopTrafficPoll() {
    if (polling) stopPoll();
  }
  function populateDevSelect() {
    const sel = q("traffic-dev-select");
    if (!sel) return;
    const devs = Object.values(state_default.deviceStore).filter((d) => d.lldpData?.length).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    sel.innerHTML = '<option value="">Alle Ger\xE4te</option>' + devs.map((d) => `<option value="${h(d.ip)}"${d.ip === selectedDev ? " selected" : ""}>${h(d.name || d.ip)}</option>`).join("");
  }
  function setStatus(msg) {
    const el = q("traffic-status");
    if (el) el.innerHTML = msg;
  }
  function renderTable() {
    const tbody = q("tbl-traffic")?.querySelector("tbody");
    if (!tbody) return;
    const edges = getLldpEdges();
    const rows = [];
    const warnPct = state_default.appSettings?.trafficWarnThreshold || 80;
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
        srcName: e.srcName,
        srcPort: e.srcPort,
        tgtName: e.tgtName,
        inBps: iface?.inBps || 0,
        outBps: iface?.outBps || 0,
        util: iface?.utilPct || 0,
        speedBps: iface?.speedBps || 0,
        avg5in,
        avg5out,
        avg1hIn,
        avg1hOut,
        key: e.key,
        hist,
        warnPct
      });
    }
    rows.sort((a, b) => {
      let va, vb;
      switch (trafficSort.col) {
        case "dev":
          va = a.srcName;
          vb = b.srcName;
          break;
        case "iface":
          va = a.srcPort;
          vb = b.srcPort;
          break;
        case "neighbor":
          va = a.tgtName;
          vb = b.tgtName;
          break;
        case "tx":
          va = a.outBps;
          vb = b.outBps;
          break;
        case "rx":
          va = a.inBps;
          vb = b.inBps;
          break;
        case "util":
          va = a.util;
          vb = b.util;
          break;
        default:
          va = a.util;
          vb = b.util;
      }
      if (typeof va === "string") return trafficSort.dir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
      return trafficSort.dir === "asc" ? va - vb : vb - va;
    });
    const cnt = q("cnt-traffic");
    if (cnt) cnt.textContent = rows.length ? `(${rows.length})` : "";
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="empty">Keine LLDP-Uplinks mit Traffic-Daten</td></tr>';
      return;
    }
    if (!selectedLink && rows.length) selectedLink = rows[0].key;
    tbody.innerHTML = rows.map((r) => {
      const utilColor = r.util >= r.warnPct ? r.util >= 90 ? "var(--red)" : "var(--yellow)" : "var(--green)";
      const sparkSvg = buildSparklineSvg(r.hist, 110, 24);
      const sel = r.key === selectedLink;
      const rowStyle = sel ? "background:var(--accent-bg, rgba(59,130,246,.08));cursor:pointer" : "cursor:pointer";
      return `<tr onclick="trafficSelectLink('${h(r.key)}')" style="${rowStyle}">
      <td style="font-weight:600;font-size:12px">${sel ? "\u25B8 " : ""}${h(r.srcName)}</td>
      <td class="mono" style="font-size:11px">${h(r.srcPort)}</td>
      <td style="font-size:12px;color:var(--text2)">${h(r.tgtName)}</td>
      <td style="text-align:right;font-size:12px;color:#f97316;font-weight:600">${formatBps2(r.outBps)}</td>
      <td style="text-align:right;font-size:12px;color:#22c55e;font-weight:600">${formatBps2(r.inBps)}</td>
      <td style="text-align:right;font-size:12px"><span style="color:${utilColor};font-weight:700">${r.util.toFixed(1)}%</span>${r.speedBps ? `<span style="color:var(--text3);font-size:10px;margin-left:4px">(${formatBpsShort(r.speedBps)})</span>` : ""}</td>
      <td style="text-align:right;font-size:11px;color:var(--text2)" title="\xD8 TX: ${formatBps2(r.avg5out)} / \xD8 RX: ${formatBps2(r.avg5in)}">\u2191${formatBpsShort(r.avg5out)} \u2193${formatBpsShort(r.avg5in)}</td>
      <td style="text-align:right;font-size:11px;color:var(--text3)" title="\xD8 TX: ${formatBps2(r.avg1hOut)} / \xD8 RX: ${formatBps2(r.avg1hIn)}">\u2191${formatBpsShort(r.avg1hOut)} \u2193${formatBpsShort(r.avg1hIn)}</td>
      <td>${sparkSvg}</td>
    </tr>`;
    }).join("");
  }
  function buildSparklineSvg(hist, w, ht) {
    if (!hist || hist.length < 2) return '<span style="color:var(--text3);font-size:10px">\u2014</span>';
    const max = Math.max(...hist.map((p) => Math.max(p.in, p.out)), 1);
    const step = w / (hist.length - 1);
    const pts = (key) => hist.map((p, i) => `${(i * step).toFixed(1)},${(ht - p[key] / max * ht).toFixed(1)}`).join(" ");
    return `<svg width="${w}" height="${ht}" style="display:block;overflow:visible">
    <polyline points="${pts("out")}" fill="none" stroke="#f97316" stroke-width="1.2" stroke-linejoin="round" opacity="0.8"/>
    <polyline points="${pts("in")}" fill="none" stroke="#22c55e" stroke-width="1.2" stroke-linejoin="round" opacity="0.8"/>
  </svg>`;
  }
  function renderChart() {
    const canvas = q("traffic-canvas");
    const emptyEl = q("traffic-chart-empty");
    const labelEl = q("traffic-chart-label");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    const W = Math.floor(rect.width - 24);
    const H = 260;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!selectedLink) {
      ctx.clearRect(0, 0, W, H);
      if (emptyEl) emptyEl.style.display = "";
      if (emptyEl) emptyEl.textContent = "Klicke auf eine Verbindung in der Tabelle";
      if (labelEl) labelEl.innerHTML = "";
      renderStats([]);
      return;
    }
    const edge = edgeByKey(selectedLink);
    const [linkIp, linkPort] = selectedLink.split("|");
    if (labelEl) {
      const devName = edge?.srcName || linkIp;
      const neighbor = edge?.tgtName || "?";
      labelEl.innerHTML = `<span style="font-weight:700;color:var(--text1)">${h(devName)}</span><span style="color:var(--text3);margin:0 6px">\u2192</span><span style="color:var(--text2)">${h(neighbor)}</span><span style="color:var(--text3);margin-left:8px;font-size:11px;font-family:monospace">${h(linkPort)}</span>`;
    }
    let dataPoints = [];
    if (selectedRange === "live") {
      const hist = localHistory[selectedLink];
      if (!hist?.length) {
        ctx.clearRect(0, 0, W, H);
        if (emptyEl) {
          emptyEl.style.display = "";
          emptyEl.textContent = "Noch keine Live-Daten f\xFCr diesen Link";
        }
        renderStats([]);
        return;
      }
      dataPoints = hist.map((s) => ({ ts: Math.floor(s.ts / 1e3), in: s.in, out: s.out }));
    } else {
      const minutes = parseInt(selectedRange, 10) || 60;
      const cutoff = Math.floor(Date.now() / 1e3) - minutes * 60;
      const entry = historyCache[linkIp]?.[linkPort];
      if (entry?.samples?.length) {
        dataPoints = entry.samples.filter((s) => s.ts >= cutoff);
      }
    }
    if (dataPoints.length < 2) {
      ctx.clearRect(0, 0, W, H);
      if (emptyEl) {
        emptyEl.style.display = "";
        emptyEl.textContent = selectedRange === "live" ? "Noch keine Live-Daten f\xFCr diesen Link" : "Keine History-Daten im gew\xE4hlten Zeitraum";
      }
      renderStats([]);
      return;
    }
    if (emptyEl) emptyEl.style.display = "none";
    drawChart(ctx, W, H, dataPoints);
    renderStats(dataPoints);
  }
  function drawChart(ctx, W, H, pts) {
    const dark = document.documentElement.classList.contains("dark");
    const PAD = { top: 28, right: 16, bottom: 32, left: 62 };
    const cw = W - PAD.left - PAD.right;
    const ch = H - PAD.top - PAD.bottom;
    ctx.clearRect(0, 0, W, H);
    const maxVal = Math.max(...pts.map((p) => Math.max(p.in, p.out)), 1);
    const niceMax = niceScale(maxVal);
    const minTs = pts[0].ts;
    const maxTs = pts[pts.length - 1].ts;
    const tsRange = Math.max(maxTs - minTs, 1);
    const xOf = (p) => PAD.left + (p.ts - minTs) / tsRange * cw;
    const yOf = (v) => PAD.top + ch - v / niceMax * ch;
    ctx.strokeStyle = dark ? "rgba(255,255,255,.06)" : "rgba(0,0,0,.06)";
    ctx.lineWidth = 1;
    const gridSteps = 5;
    for (let i = 0; i <= gridSteps; i++) {
      const y = PAD.top + ch * i / gridSteps;
      ctx.beginPath();
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(W - PAD.right, y);
      ctx.stroke();
    }
    ctx.fillStyle = dark ? "rgba(255,255,255,.4)" : "rgba(0,0,0,.35)";
    ctx.font = "10px system-ui, sans-serif";
    ctx.textAlign = "right";
    for (let i = 0; i <= gridSteps; i++) {
      const val = niceMax * (gridSteps - i) / gridSteps;
      ctx.fillText(formatBpsShort(val), PAD.left - 6, PAD.top + ch * i / gridSteps + 3);
    }
    ctx.textAlign = "center";
    const xLabels = selectedRange === "live" ? 6 : 8;
    for (let i = 0; i <= xLabels; i++) {
      const ts = minTs + tsRange * i / xLabels;
      const x = PAD.left + cw * i / xLabels;
      const d = new Date(ts * 1e3);
      const label = d.getHours().toString().padStart(2, "0") + ":" + d.getMinutes().toString().padStart(2, "0");
      ctx.fillText(label, x, H - PAD.bottom + 16);
    }
    ctx.beginPath();
    ctx.moveTo(xOf(pts[0]), yOf(0));
    for (const p of pts) ctx.lineTo(xOf(p), yOf(p.out));
    ctx.lineTo(xOf(pts[pts.length - 1]), yOf(0));
    ctx.closePath();
    ctx.fillStyle = "rgba(249,115,22,.12)";
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(xOf(pts[0]), yOf(0));
    for (const p of pts) ctx.lineTo(xOf(p), yOf(p.in));
    ctx.lineTo(xOf(pts[pts.length - 1]), yOf(0));
    ctx.closePath();
    ctx.fillStyle = "rgba(34,197,94,.10)";
    ctx.fill();
    ctx.beginPath();
    ctx.strokeStyle = "#f97316";
    ctx.lineWidth = 1.8;
    ctx.lineJoin = "round";
    for (let i = 0; i < pts.length; i++) {
      const x = xOf(pts[i]), y = yOf(pts[i].out);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.strokeStyle = "#22c55e";
    ctx.lineWidth = 1.8;
    for (let i = 0; i < pts.length; i++) {
      const x = xOf(pts[i]), y = yOf(pts[i].in);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    const last = pts[pts.length - 1];
    if (last) {
      ctx.font = "bold 11px system-ui, sans-serif";
      ctx.textAlign = "left";
      const rx = xOf(last) + 4;
      ctx.fillStyle = "#f97316";
      ctx.fillText(formatBps2(last.out), Math.min(rx, W - PAD.right - 60), yOf(last.out) - 4);
      ctx.fillStyle = "#22c55e";
      ctx.fillText(formatBps2(last.in), Math.min(rx, W - PAD.right - 60), yOf(last.in) + 12);
    }
    ctx.font = "11px system-ui, sans-serif";
    const lx = PAD.left + 8;
    ctx.fillStyle = "#f97316";
    ctx.fillRect(lx, PAD.top - 18, 12, 3);
    ctx.fillStyle = dark ? "#e2e8f0" : "#334155";
    ctx.textAlign = "left";
    ctx.fillText("TX (Out)", lx + 16, PAD.top - 14);
    ctx.fillStyle = "#22c55e";
    ctx.fillRect(lx + 90, PAD.top - 18, 12, 3);
    ctx.fillStyle = dark ? "#e2e8f0" : "#334155";
    ctx.fillText("RX (In)", lx + 106, PAD.top - 14);
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
  function renderStats(pts) {
    const el = q("traffic-stats");
    if (!el) return;
    if (!pts.length) {
      el.innerHTML = "";
      return;
    }
    const avgIn = Math.round(pts.reduce((a, p) => a + p.in, 0) / pts.length);
    const avgOut = Math.round(pts.reduce((a, p) => a + p.out, 0) / pts.length);
    const maxIn = Math.max(...pts.map((p) => p.in));
    const maxOut = Math.max(...pts.map((p) => p.out));
    const last = pts[pts.length - 1];
    const card = (label, value, color) => `
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:10px 14px">
      <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">${label}</div>
      <div style="font-size:16px;font-weight:700;color:${color}">${value}</div>
    </div>`;
    el.innerHTML = card("Aktuell TX", formatBps2(last?.out || 0), "#f97316") + card("Aktuell RX", formatBps2(last?.in || 0), "#22c55e") + card("\xD8 TX", formatBps2(avgOut), "#fb923c") + card("\xD8 RX", formatBps2(avgIn), "#4ade80") + card("Max TX", formatBps2(maxOut), "#ea580c") + card("Max RX", formatBps2(maxIn), "#16a34a") + card("Zeitraum", formatDuration(pts), "var(--text2)");
  }
  function formatDuration(pts) {
    if (pts.length < 2) return "\u2014";
    const sec = pts[pts.length - 1].ts - pts[0].ts;
    if (sec < 120) return sec + "s";
    if (sec < 7200) return Math.round(sec / 60) + " Min";
    return (sec / 3600).toFixed(1) + " Std";
  }
  function trafficSortClick(col) {
    if (trafficSort.col === col) {
      trafficSort.dir = trafficSort.dir === "asc" ? "desc" : "asc";
    } else {
      trafficSort.col = col;
      trafficSort.dir = col === "dev" || col === "iface" || col === "neighbor" ? "asc" : "desc";
    }
    renderTable();
  }

  // ui/tabs/sni-tool.js
  var sniPollT = null;
  function sniSchedulePoll() {
    if (sniPollT != null) return;
    const tick = async () => {
      if (!q("panel-sni")?.classList.contains("active")) {
        sniPollT = null;
        return;
      }
      await sniRefresh();
      sniPollT = setTimeout(tick, 2e3);
    };
    sniPollT = setTimeout(tick, 2e3);
  }
  function sniTabActivated() {
    sniRefresh();
    sniSchedulePoll();
  }
  async function sniRefresh() {
    try {
      const r = await fetch("/api/tools/sni");
      const d = await r.json();
      sniApplyState(d);
    } catch (e) {
      const st = q("sni-status");
      if (st) st.textContent = "Fehler: " + (e.message || String(e));
    }
  }
  function sniApplyState(d) {
    const run = d.running;
    const st = q("sni-status");
    const btnS = q("sni-btn-start");
    const btnP = q("sni-btn-stop");
    const portEl = q("sni-port");
    if (btnS) btnS.disabled = !!run;
    if (btnP) btnP.disabled = !run;
    if (portEl) portEl.disabled = !!run;
    const filt = q("sni-filter");
    if (filt) filt.disabled = !!run;
    if (st) {
      st.textContent = run ? `Aktiv auf ${d.bind || "0.0.0.0"}:${d.port}` + (d.filterDomains && d.filterDomains.length ? ` \xB7 Filter: ${d.filterDomains.join(", ")}` : "") : "Gestoppt";
    }
    const tb = q("tbody-sni");
    if (!tb) return;
    const rows = [...d.logs || []].reverse();
    if (!rows.length) {
      tb.innerHTML = '<tr><td colspan="4" class="empty">Keine Eintr\xE4ge</td></tr>';
      return;
    }
    tb.innerHTML = rows.map((e) => {
      const t = new Date(e.ts).toLocaleString("de-DE");
      if (e.msg) {
        return `<tr><td>${h(t)}</td><td colspan="2" style="color:var(--text3)">${h(e.msg)}</td><td>\u2014</td></tr>`;
      }
      const sniCell = e.sni ? h(e.sni) : `<span style="color:var(--text3)">(${h(e.reason || "\u2014")})</span>`;
      return `<tr><td>${h(t)}</td><td style="font-family:monospace;font-size:11px">${h(e.remote || "")}</td><td>${sniCell}</td><td>${e.bytes ?? "\u2014"}</td></tr>`;
    }).join("");
  }
  async function sniStart() {
    const port = parseInt(q("sni-port")?.value || "8443", 10);
    const filterDomains = q("sni-filter")?.value?.trim() || "";
    const r = await fetch("/api/tools/sni/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ port, filterDomains })
    });
    const d = await r.json();
    if (!r.ok) {
      alert(d.error || "Start fehlgeschlagen");
      await sniRefresh();
      return;
    }
    sniApplyState(d);
  }
  async function sniStop() {
    const r = await fetch("/api/tools/sni/stop", { method: "POST" });
    const d = await r.json();
    if (!r.ok) alert(d.error || "Stopp fehlgeschlagen");
    sniApplyState(d);
  }
  async function sniClearLogs() {
    const r = await fetch("/api/tools/sni/clear", { method: "POST" });
    const d = await r.json();
    sniApplyState(d);
  }
  window.sniTabActivated = sniTabActivated;
  window.sniStart = sniStart;
  window.sniStop = sniStop;
  window.sniClearLogs = sniClearLogs;

  // ui/tabs/vlan-tracer.js
  var _devCredentials = (...a) => window.devCredentials?.(...a);
  var vtAbort = null;
  function vtInit() {
    const seen = {};
    Object.values(state_default.deviceStore).forEach((d) => {
      (d.vlanData?.entries || []).forEach((v) => {
        seen[v.vlanId] = v.name || "";
      });
    });
    const sel = q("vt-vlan-select");
    const ids = Object.keys(seen).map(Number).sort((a, b) => a - b);
    if (ids.length > 0) {
      sel.innerHTML = '<option value="">\u2014 VLAN w\xE4hlen \u2014</option>' + ids.map((id) => `<option value="${id}">${id}${seen[id] ? " \u2013 " + h(seen[id]) : ""}</option>`).join("");
      sel.style.display = "";
    } else {
      sel.style.display = "none";
    }
  }
  async function vtRun() {
    const vid = parseInt(q("vt-vlan-id").value);
    if (!vid || vid < 1 || vid > 4094) {
      q("vt-status").textContent = "Bitte eine VLAN-ID eingeben (1\u20134094).";
      return;
    }
    if (vtAbort) {
      vtAbort.abort();
    }
    vtAbort = new AbortController();
    const sig = vtAbort.signal;
    const devices = Object.values(state_default.deviceStore).filter((d) => d.ip && d.online !== false);
    if (!devices.length) {
      q("vt-status").textContent = "Keine Ger\xE4te vorhanden. Zuerst Status pr\xFCfen.";
      return;
    }
    q("vt-result").style.display = "none";
    q("vt-empty").style.display = "none";
    q("btn-vt-run").disabled = true;
    q("vt-progress").style.display = "";
    q("vt-bar").style.width = "0%";
    q("vt-status").textContent = "";
    const results = [];
    let done = 0;
    for (const dev of devices) {
      if (sig.aborted) break;
      q("vt-progress-lbl").textContent = `${done + 1} / ${devices.length} \u2013 ${h(dev.name || dev.ip)}`;
      q("vt-bar").style.width = Math.round(done / devices.length * 100) + "%";
      try {
        const creds = _devCredentials(dev.ip);
        const r = await fetch("/snmp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ host: dev.ip, type: "vlan-trace", vlanId: vid, ...creds }),
          signal: sig
        });
        const data = await r.json();
        if (!data.error && data.found) {
          results.push({ dev, data });
          if (data.allVlans?.length && q("vt-vlan-select").options.length <= 1) {
            const sel = q("vt-vlan-select");
            sel.innerHTML = '<option value="">\u2014 VLAN w\xE4hlen \u2014</option>' + data.allVlans.map((v) => `<option value="${v.id}">${v.id}${v.name ? " \u2013 " + h(v.name) : ""}</option>`).join("");
            sel.style.display = "";
          }
        }
      } catch (e) {
        if (sig.aborted) break;
      }
      done++;
    }
    q("vt-progress").style.display = "none";
    q("btn-vt-run").disabled = false;
    q("vt-bar").style.width = "0%";
    if (!results.length) {
      q("vt-empty").style.display = "";
      q("vt-status").textContent = `VLAN ${vid} auf keinem Ger\xE4t gefunden.`;
      return;
    }
    const vlanName = results[0]?.data?.vlanName || "";
    q("vt-title").innerHTML = `VLAN <b>${vid}</b>${vlanName ? " \u2013 " + h(vlanName) : ""} &nbsp;<span style="font-size:12px;color:var(--text2)">(${results.length} Ger\xE4t${results.length !== 1 ? "e" : ""})</span>`;
    q("vt-status").textContent = `${results.length} Ger\xE4t${results.length !== 1 ? "e" : ""} mit VLAN ${vid} gefunden.`;
    q("vt-tbody").innerHTML = results.map(({ dev, data }) => {
      const tagged = data.ports.filter((p) => p.mode === "tagged");
      const untagged = data.ports.filter((p) => p.mode === "untagged");
      const taggedStr = tagged.map((p) => `<span class="badge" style="background:rgba(45,95,255,.15);color:var(--accent);border:1px solid rgba(45,95,255,.3);font-size:10px;padding:1px 5px">${h(p.ifName)}</span>`).join(" ") || "\u2013";
      const untaggedStr = untagged.map((p) => `<span class="badge" style="background:rgba(74,222,128,.12);color:var(--green);border:1px solid rgba(74,222,128,.3);font-size:10px;padding:1px 5px">${h(p.ifName)}</span>`).join(" ") || "\u2013";
      return `<tr>
      <td style="font-weight:600">${h(dev.name || dev.ip)}</td>
      <td style="color:var(--text2);font-size:12px">${h(dev.ip)}</td>
      <td style="font-size:12px;color:var(--text2)">${h(dev.location || "\u2013")}</td>
      <td style="line-height:2">${taggedStr}</td>
      <td style="line-height:2">${untaggedStr}</td>
      <td style="text-align:center;color:var(--text2);font-size:12px">${data.ports.length}</td>
    </tr>`;
    }).join("");
    q("vt-result").style.display = "";
  }
  function ldInit() {
    q("ld-result").style.display = "none";
    q("ld-empty").style.display = "none";
    q("ld-status").textContent = "";
  }
  async function ldRun() {
    const devices = Object.values(state_default.deviceStore).filter((d) => d.ip && d.online !== false && (d.os || "").startsWith("LCOS SX"));
    if (!devices.length) {
      q("ld-status").textContent = "Keine Switches vorhanden. Zuerst Status pr\xFCfen.";
      return;
    }
    q("ld-result").style.display = "none";
    q("ld-empty").style.display = "none";
    q("btn-ld-run").disabled = true;
    q("ld-progress").style.display = "";
    q("ld-bar").style.width = "0%";
    q("ld-status").textContent = "";
    const results = [];
    let done = 0;
    for (const dev of devices) {
      q("ld-progress-lbl").textContent = `${done + 1} / ${devices.length} \u2013 ${h(dev.name || dev.ip)}`;
      q("ld-bar").style.width = Math.round(done / devices.length * 100) + "%";
      try {
        const creds = _devCredentials(dev.ip);
        const r = await fetch("/snmp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ host: dev.ip, type: "loop-detect", ...creds })
        });
        const data = await r.json();
        if (!data.error) results.push({ dev, data });
      } catch (e) {
      }
      done++;
    }
    q("ld-progress").style.display = "none";
    q("btn-ld-run").disabled = false;
    q("ld-bar").style.width = "0%";
    if (!results.length) {
      q("ld-empty").style.display = "";
      q("ld-status").textContent = "Keine SNMP-Antworten erhalten.";
      return;
    }
    state_default.ldLastResults = results;
    const dangerCount = results.filter((r) => r.data.risk === "danger").length;
    const warningCount = results.filter((r) => r.data.risk === "warning").length;
    q("ld-status").textContent = `${results.length} Ger\xE4t${results.length !== 1 ? "e" : ""} gepr\xFCft` + (dangerCount ? ` \xB7 ${dangerCount} kritisch` : "") + (warningCount ? ` \xB7 ${warningCount} Warnung${warningCount !== 1 ? "en" : ""}` : "");
    const riskBadge = (risk) => {
      const map = {
        ok: ["\u{1F7E2}", "rgba(74,222,128,.15)", "var(--green)", "1px solid rgba(74,222,128,.4)", "OK"],
        warning: ["\u{1F7E1}", "rgba(250,200,60,.15)", "#e6b800", "1px solid rgba(250,200,60,.4)", "Warnung"],
        danger: ["\u{1F534}", "rgba(239,68,68,.15)", "var(--red)", "1px solid rgba(239,68,68,.4)", "Kritisch"]
      };
      const [icon, bg, color, border, label] = map[risk] || map.ok;
      return `<span class="badge" style="background:${bg};color:${color};border:${border};font-size:11px;padding:2px 8px">${icon} ${label}</span>`;
    };
    const riskOrder = { danger: 0, warning: 1, ok: 2 };
    results.sort((a, b) => (riskOrder[a.data.risk] ?? 3) - (riskOrder[b.data.risk] ?? 3));
    q("ld-tbody").innerHTML = results.map(({ dev, data }) => {
      const blockStr = data.blockingPorts?.length ? data.blockingPorts.map((p) => `<span class="badge" style="background:rgba(250,200,60,.15);color:#e6b800;border:1px solid rgba(250,200,60,.4);font-size:10px;padding:1px 5px">${h(p)}</span>`).join(" ") : "\u2013";
      const brokenStr = data.brokenPorts?.length ? data.brokenPorts.map((p) => `<span class="badge" style="background:rgba(239,68,68,.15);color:var(--red);border:1px solid rgba(239,68,68,.4);font-size:10px;padding:1px 5px">${h(p)}</span>`).join(" ") : "";
      const portCell = [blockStr, brokenStr].filter((s) => s && s !== "\u2013").join(" ") || "\u2013";
      const lpCount = data.lpProtectedPorts?.length ?? 0;
      const lpCell = lpCount ? `<span style="color:var(--green);font-size:12px">\u2714 ${lpCount} Port${lpCount !== 1 ? "s" : ""}</span>` : '<span style="color:var(--text2);font-size:12px">\u2013</span>';
      const ldPorts = data.lpDetectedPorts || [];
      const ldCell = ldPorts.length ? ldPorts.map((p) => `<span class="badge" style="background:rgba(239,68,68,.15);color:var(--red);border:1px solid rgba(239,68,68,.4);font-size:10px;padding:1px 5px">${h(p)}</span>`).join(" ") : '<span style="color:var(--text2);font-size:12px">\u2013</span>';
      const conflictCount = data.stpLpConflictCount ?? 0;
      const conflictCell = conflictCount > 0 ? `<span class="badge" style="background:rgba(251,191,36,.15);color:var(--amber);border:1px solid rgba(251,191,36,.4);font-size:11px;padding:2px 7px" title="Ports mit Loop Protection und STP gleichzeitig aktiv">\u26A0 ${conflictCount}</span>` : '<span style="color:var(--text2);font-size:12px">\u2013</span>';
      return `<tr>
      <td style="font-weight:600">${h(dev.name || dev.ip)}</td>
      <td style="color:var(--text2);font-size:12px">${h(dev.ip)}</td>
      <td style="font-size:12px;color:var(--text2)">${h(dev.location || "\u2013")}</td>
      <td style="text-align:center">${data.stpActive ? '<span style="color:var(--green)">\u2714</span>' : '<span style="color:var(--text2)">\u2013</span>'}</td>
      <td style="text-align:center;font-size:13px">${data.topoChanges ?? "\u2013"}</td>
      <td style="font-size:12px;color:var(--text2)">${h(data.topoTimeStr || "\u2013")}</td>
      <td>${lpCell}</td>
      <td style="line-height:2">${ldCell}</td>
      <td style="text-align:center">${conflictCell}</td>
      <td style="line-height:2">${portCell}</td>
      <td>${riskBadge(data.risk || "ok")}</td>
    </tr>`;
    }).join("");
    q("ld-result").style.display = "";
  }
  window.vtInit = vtInit;
  window.vtRun = vtRun;
  window.ldInit = ldInit;
  window.ldRun = ldRun;

  // ui/tabs/syslog.js
  var syslogData = [];
  var syslogAutoTimer = null;
  var SYSLOG_AUTOREFRESH_LS = "onsite-syslog-autorefresh";
  var SYSLOG_AUTOREFRESH_MS = 5e3;
  function isSyslogPanelActive() {
    return q("panel-syslog")?.classList.contains("active");
  }
  function stopSyslogAutoRefreshTimer() {
    if (syslogAutoTimer) {
      clearInterval(syslogAutoTimer);
      syslogAutoTimer = null;
    }
  }
  function setSyslogAutoRefresh(enabled) {
    localStorage.setItem(SYSLOG_AUTOREFRESH_LS, enabled ? "1" : "0");
    const cb = q("syslog-autorefresh");
    if (cb) cb.checked = enabled;
    stopSyslogAutoRefreshTimer();
    if (enabled && isSyslogPanelActive()) {
      syslogAutoTimer = setInterval(() => {
        loadSyslog();
      }, SYSLOG_AUTOREFRESH_MS);
    }
  }
  function applySyslogAutoRefresh() {
    stopSyslogAutoRefreshTimer();
    if (localStorage.getItem(SYSLOG_AUTOREFRESH_LS) === "1" && isSyslogPanelActive()) {
      syslogAutoTimer = setInterval(() => {
        loadSyslog();
      }, SYSLOG_AUTOREFRESH_MS);
    }
  }
  function stopSyslogAutoRefresh() {
    stopSyslogAutoRefreshTimer();
  }
  function initSyslogAutoRefreshUi() {
    const cb = q("syslog-autorefresh");
    if (!cb) return;
    cb.checked = localStorage.getItem(SYSLOG_AUTOREFRESH_LS) === "1";
  }
  var SEV_COLORS = {
    emerg: "#ef4444",
    alert: "#ef4444",
    crit: "#ef4444",
    err: "#f97316",
    warning: "#eab308",
    notice: "#3b82f6",
    info: "var(--text2)",
    debug: "var(--text3)"
  };
  function escHtml(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  async function loadSyslog() {
    const sev = q("syslog-severity-filter")?.value || "";
    const ip = q("syslog-ip-filter")?.value?.trim() || "";
    let url = "/api/syslog?limit=500";
    if (sev) url += `&severity=${sev}`;
    if (ip) url += `&ip=${encodeURIComponent(ip)}`;
    const tb = q("tbody-syslog");
    try {
      const r = await fetch(url);
      let body;
      try {
        body = await r.json();
      } catch {
        if (tb) tb.innerHTML = `<tr><td colspan="6" class="empty" style="color:var(--red)">Antwort ist kein JSON (HTTP ${r.status})</td></tr>`;
        syslogData = [];
        return;
      }
      if (!r.ok) {
        const msg = body && (body.error || body.message) || `HTTP ${r.status}`;
        if (tb) tb.innerHTML = `<tr><td colspan="6" class="empty" style="color:var(--red)">${h(String(msg))}</td></tr>`;
        syslogData = [];
        return;
      }
      syslogData = Array.isArray(body) ? body : [];
      renderSyslog(syslogData);
      if ((q("syslog-search")?.value || "").trim()) filterSyslogLocal();
    } catch (e) {
      if (tb) tb.innerHTML = `<tr><td colspan="6" class="empty" style="color:var(--red)">${h(e.message || "Fehler beim Laden")}</td></tr>`;
      syslogData = [];
    }
  }
  function filterSyslogLocal() {
    const search = (q("syslog-search")?.value || "").toLowerCase();
    if (!search) {
      renderSyslog(syslogData);
      return;
    }
    const filtered = syslogData.filter(
      (e) => (e.message || "").toLowerCase().includes(search) || (e.from || "").includes(search) || (e.program || "").toLowerCase().includes(search) || (e.hostname || "").toLowerCase().includes(search)
    );
    renderSyslog(filtered);
  }
  function renderSyslog(data) {
    const tb = q("tbody-syslog");
    const cnt = q("cnt-syslog");
    if (!tb) return;
    const rows = Array.isArray(data) ? data : [];
    if (cnt) cnt.textContent = rows.length ? `(${rows.length})` : "";
    if (!rows.length) {
      tb.innerHTML = '<tr><td colspan="6" class="empty">Keine Syslog-Nachrichten</td></tr>';
      return;
    }
    tb.innerHTML = rows.slice(0, 300).map((e) => {
      const ts = e.ts ? new Date(e.ts).toLocaleString("de-DE") : "\u2014";
      const sevColor = SEV_COLORS[e.severity] || "var(--text2)";
      const msg = escHtml(e.message || e.raw || "");
      const msgShort = msg.length > 200 ? msg.slice(0, 200) + "\u2026" : msg;
      return `<tr>
      <td style="white-space:nowrap;font-size:11px;color:var(--text3)">${ts}</td>
      <td style="font-family:monospace;font-size:11px">${escHtml(e.from)}</td>
      <td><span style="color:${sevColor};font-weight:600;font-size:11px">${escHtml(e.severity || "?")}</span></td>
      <td style="font-size:11px;color:var(--text3)">${escHtml(e.facility || "")}</td>
      <td style="font-size:11px">${escHtml(e.program || "")}</td>
      <td style="font-size:11px;max-width:500px;word-break:break-word" title="${msg}">${msgShort}</td>
    </tr>`;
    }).join("");
  }
  async function clearSyslog() {
    await fetch("/api/syslog", { method: "DELETE" });
    syslogData = [];
    renderSyslog([]);
  }

  // ui/lib/oui.js
  function macToOuiKey(mac) {
    if (!mac || typeof mac !== "string") return null;
    const p = mac.trim().replace(/[^0-9A-Fa-f]/g, "");
    if (p.length < 6) return null;
    return p.slice(0, 6).toUpperCase();
  }
  function formatOui(key6) {
    if (!key6 || key6.length !== 6) return null;
    return `${key6.slice(0, 2)}:${key6.slice(2, 4)}:${key6.slice(4, 6)}`;
  }
  function isLocallyAdministeredMac(mac) {
    const key = macToOuiKey(mac);
    if (!key) return false;
    const first = parseInt(key.slice(0, 2), 16);
    return (first & 2) !== 0;
  }
  function lookupMacVendor(mac) {
    const key = macToOuiKey(mac);
    if (!key) return { oui: null, vendor: null, local: false };
    const oui = formatOui(key);
    const local = isLocallyAdministeredMac(mac);
    if (local) return { oui, vendor: null, local: true };
    return { oui, vendor: OUI_MAP[key] || null, local: false };
  }
  var OUI_MAP = {
    "000C29": "VMware",
    "005056": "VMware",
    "0C0E76": "LANCOM Systems",
    "000569": "Cisco",
    "001A11": "Cisco",
    "001B21": "Cisco",
    "001E13": "Cisco",
    "001E79": "Cisco",
    "002304": "Cisco",
    "00259C": "Cisco",
    "005007": "Cisco",
    "009092": "Cisco",
    "00E014": "Cisco",
    "00E016": "Cisco",
    "00E034": "Cisco",
    "00E08F": "Cisco",
    "00E0A3": "Cisco",
    "00E0B0": "Cisco",
    "00E0F7": "Cisco",
    "00E0F9": "Cisco",
    "00E0FC": "Cisco",
    "00E0FE": "Cisco",
    "001A2B": "Cisco",
    "001A9A": "Cisco",
    "001B54": "Cisco",
    "001C0E": "Cisco",
    "001DA1": "Cisco",
    "001DD8": "Cisco",
    "001E14": "Cisco",
    "001F9E": "Cisco",
    "002155": "Cisco",
    "002333": "Cisco",
    "00269F": "Cisco",
    "00E0A6": "Cisco",
    "00CDFE": "Apple",
    "109ADD": "Apple",
    "14B484": "Samsung",
    "18E288": "Intel",
    "1C69A5": "Samsung",
    "20A99B": "Intel",
    "24A2E1": "Apple",
    "28C68E": "NETGEAR",
    "28CFDA": "Apple",
    "2C3ECF": "Samsung",
    "2CF05D": "Samsung",
    "30D9D9": "Apple",
    "34A395": "Intel",
    "34E6D7": "Dell",
    "38F9D3": "Apple",
    "3C5CC3": "Samsung",
    "3CA10D": "Apple",
    "40A6D9": "Apple",
    "40B034": "Samsung",
    "44D15E": "Samsung",
    "48BF6B": "Samsung",
    "4C6641": "Samsung",
    "4CBCA5": "Samsung",
    "50EAD6": "Apple",
    "54AE27": "Apple",
    "54B802": "Samsung",
    "58B035": "Samsung",
    "5C5948": "Apple",
    "5C969D": "Apple",
    "5CF5DA": "Samsung",
    "60C547": "Apple",
    "64B473": "Samsung",
    "68A86D": "Apple",
    "6C4008": "Apple",
    "6C8DC1": "Samsung",
    "70A2B3": "Samsung",
    "74E424": "Samsung",
    "78A3E4": "Samsung",
    "78CA39": "Apple",
    "7C04D0": "Apple",
    "7C2EDD": "Samsung",
    "7C50DA": "Samsung",
    "7C8BCA": "Apple",
    "80B686": "Samsung",
    "84FCFE": "Apple",
    "88C663": "Samsung",
    "8C7712": "Samsung",
    "8C7C92": "Apple",
    "90B11C": "Dell",
    "94E979": "Samsung",
    "980DAF": "Apple",
    "98F0AB": "Apple",
    "9C207B": "Samsung",
    "9C4FDA": "Samsung",
    "9C8BA0": "Samsung",
    "A0D37A": "Intel",
    "A4B197": "Samsung",
    "A4C494": "Samsung",
    "A4F1E8": "Apple",
    "A8A159": "Samsung",
    "AC1F6B": "Samsung",
    "ACBC32": "Apple",
    "B065BD": "Samsung",
    "B4F61C": "Samsung",
    "B8B7F1": "Samsung",
    "BC4760": "Samsung",
    "BC5436": "Apple",
    "BC72B1": "Samsung",
    "BC8520": "Samsung",
    "BC8CC4": "Samsung",
    "C02C7A": "Samsung",
    "C06394": "Apple",
    "C0A600": "Samsung",
    "C4084A": "Samsung",
    "C44202": "Samsung",
    "C4576E": "Samsung",
    "C48372": "Samsung",
    "C4AE12": "Samsung",
    "C808E9": "Samsung",
    "C8D15E": "Samsung",
    "CC3A61": "Samsung",
    "D022BE": "Apple",
    "D02544": "Samsung",
    "D087E2": "Samsung",
    "D0C5D3": "Samsung",
    "D463C6": "Samsung",
    "D487D8": "Samsung",
    "D4E8B2": "Samsung",
    "D831CF": "Samsung",
    "D85B2A": "Samsung",
    "D89E3F": "Apple",
    "D8C4E9": "Samsung",
    "DC6672": "Samsung",
    "E09971": "Samsung",
    "E0B9BA": "Apple",
    "E425E7": "Apple",
    "E432CB": "Samsung",
    "E458E7": "Samsung",
    "E4F8F4": "Samsung",
    "E8039A": "Samsung",
    "E84E84": "Samsung",
    "E88D28": "Samsung",
    "E8B4C8": "Samsung",
    "EC852F": "Samsung",
    "F01898": "Samsung",
    "F0D1A9": "Apple",
    "F40F24": "Samsung",
    "F4428F": "Samsung",
    "F47B5E": "Samsung",
    "F4C248": "Samsung",
    "F4F15A": "Samsung",
    "F4F951": "Samsung",
    "F80CF3": "Samsung",
    "F84ABF": "Samsung",
    "F8A2D0": "Samsung",
    "FC1910": "Samsung",
    "FC4203": "Samsung",
    "FC643A": "Samsung",
    "FC8B97": "Samsung",
    "FCC734": "Samsung",
    "FCD848": "Samsung",
    "FCF136": "Samsung",
    "24A43C": "Ubiquiti",
    "44D9E7": "Ubiquiti",
    "68D79A": "Ubiquiti",
    "74D435": "Ubiquiti",
    "78A351": "Ubiquiti",
    "802AA8": "Ubiquiti",
    "B4FBE4": "Ubiquiti",
    "D021F9": "Ubiquiti",
    "F09FC2": "Ubiquiti",
    "001D0F": "TP-Link",
    "001F33": "TP-Link",
    "002127": "TP-Link",
    "14CC20": "TP-Link",
    "1C61B4": "TP-Link",
    "30B49E": "TP-Link",
    "50C7BF": "TP-Link",
    "54C80F": "TP-Link",
    "60E327": "TP-Link",
    "646EEA": "TP-Link",
    "6C5940": "TP-Link",
    "78A106": "TP-Link",
    "90F652": "TP-Link",
    "A842A1": "TP-Link",
    "B04E26": "TP-Link",
    "C025E9": "TP-Link",
    "C04A00": "TP-Link",
    "000FB5": "NETGEAR",
    "00146B": "NETGEAR",
    "00184D": "NETGEAR",
    "001B2F": "NETGEAR",
    "001E2A": "NETGEAR",
    "00226F": "NETGEAR",
    "08863B": "NETGEAR",
    "104FA8": "NETGEAR",
    "20E564": "NETGEAR",
    "2C3033": "NETGEAR",
    "30469A": "NETGEAR",
    "403CFC": "NETGEAR",
    "6C7220": "NETGEAR",
    "9C3DCF": "NETGEAR",
    "A021B7": "NETGEAR",
    "A06391": "NETGEAR",
    "B03956": "NETGEAR",
    "B07FB9": "NETGEAR",
    "C03F0E": "NETGEAR",
    "C40415": "NETGEAR",
    "C43DC7": "NETGEAR",
    "CC28AA": "NETGEAR",
    "E0469A": "NETGEAR",
    "E091F5": "NETGEAR",
    "E8FCAF": "NETGEAR",
    "F87394": "NETGEAR"
  };

  // ui/tabs/roaming-syslog.js
  var MAC_RE = /(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}/g;
  var OUI_ONLY_SOURCE = "(?<![0-9A-Fa-f])(?:[0-9A-Fa-f]{2}[:-]){2}[0-9A-Fa-f]{2}(?![:-][0-9A-Fa-f]{2})";
  var OUI_ONLY_RE = new RegExp(OUI_ONLY_SOURCE, "gi");
  var OUI_ONLY_TEST = new RegExp(OUI_ONLY_SOURCE, "i");
  var roamTrackerCache = { tracks: null, meta: null };
  var nacAllowlistFetchPromise2 = null;
  function normalizeMacForNacLookup(s) {
    if (s == null) return null;
    const hex = String(s).replace(/[^0-9a-fA-F]/g, "").toLowerCase();
    if (hex.length !== 12) return null;
    return hex.match(/.{2}/g).join(":");
  }
  function ensureNacAllowlistForRoaming() {
    if (Array.isArray(state_default.nacMacAllowlistCache)) return;
    if (nacAllowlistFetchPromise2) return;
    nacAllowlistFetchPromise2 = fetch("/api/nac").then((r) => parseFetchJsonLenient(r)).then((data) => {
      if (data && Array.isArray(data.macAllowlist)) {
        state_default.nacMacAllowlistCache = data.macAllowlist.map((row) => ({ ...row }));
      } else if (state_default.nacMacAllowlistCache === null) {
        state_default.nacMacAllowlistCache = [];
      }
    }).catch(() => {
      if (state_default.nacMacAllowlistCache === null) state_default.nacMacAllowlistCache = [];
    }).finally(() => {
      nacAllowlistFetchPromise2 = null;
      renderRoamTrackerCached();
    });
  }
  function nacMetaForTrack(t) {
    if (!Array.isArray(state_default.nacMacAllowlistCache)) return { label: "", vlan: void 0 };
    const norm = normalizeMacForNacLookup(t.mac);
    if (!norm) return { label: "", vlan: void 0 };
    const row = state_default.nacMacAllowlistCache.find((e) => String(e.mac || "").trim().toLowerCase() === norm);
    if (!row) return { label: "", vlan: void 0 };
    const label = String(row.label || "").trim();
    let vlan;
    if (row.vlan != null && row.vlan !== "") {
      const n = parseInt(String(row.vlan), 10);
      if (!Number.isNaN(n) && n >= 1 && n <= 4094) vlan = n;
    }
    return { label, vlan };
  }
  function isRoamingSyslogEntry(e) {
    const t = `${e.message || ""}
${e.raw || ""}
${e.program || ""}
${e.hostname || ""}`.toLowerCase();
    if (/\broam|roaming|reassoc|re-assoc|802\.11r|bss transition|fast transition|dot11r|\b11r\b|pmk\b|okc\b|mobility domain/.test(t)) return true;
    if (/(wlan|wifi|802\.11|hostapd|wpa_supplicant|ath|nl80211)/.test(t) && /(reassoc|disassoc|deauth|new bssid|different ap|wechsel|hand-?off|sticky|ft\s|ieee\s*802)/.test(t)) return true;
    if (/(sta|station|client).{0,120}(ap|bss|bssid)/.test(t) && /(chang|switch|move|von|nach|new|another)/.test(t)) return true;
    return false;
  }
  function normMac(m) {
    return m.replace(/-/g, ":").toUpperCase();
  }
  function fullMacCoversOui(fullNorm, ouiNorm) {
    return fullNorm.startsWith(ouiNorm) && fullNorm.length > ouiNorm.length;
  }
  function ouiIsContiguousInFullMac(ouiNorm, fullNorm) {
    const o = ouiNorm.split(":");
    const f = fullNorm.split(":");
    if (o.length !== 3 || f.length < 3) return false;
    const O = o.map((x) => x.toUpperCase());
    for (let i = 0; i <= f.length - 3; i++) {
      if (f[i].toUpperCase() === O[0] && f[i + 1].toUpperCase() === O[1] && f[i + 2].toUpperCase() === O[2]) return true;
    }
    return false;
  }
  function textHasMacOrOui(text) {
    MAC_RE.lastIndex = 0;
    return MAC_RE.test(text) || OUI_ONLY_TEST.test(text);
  }
  function apLabel(ip) {
    const devs = state_default.deviceStore || {};
    const d = Object.values(devs).find((x) => x.ip === ip);
    return d ? d.name || ip : ip;
  }
  function apHtml(ip) {
    const name = apLabel(ip);
    if (name !== ip) {
      return `${escHtml2(name)} <span style="color:var(--text3);font-size:10px">${escHtml2(ip)}</span>`;
    }
    return escHtml2(ip);
  }
  var roamingSyslogTimer = null;
  var ROAMING_SYSLOG_LS = "onsite-roaming-syslog-autorefresh";
  var ROAMING_SYSLOG_MS = 5e3;
  function isRoamingPanelActive() {
    return q("panel-roaming")?.classList.contains("active");
  }
  function stopRoamingSyslogTimer() {
    if (roamingSyslogTimer) {
      clearInterval(roamingSyslogTimer);
      roamingSyslogTimer = null;
    }
  }
  function setRoamingSyslogAutoRefresh(enabled) {
    localStorage.setItem(ROAMING_SYSLOG_LS, enabled ? "1" : "0");
    const cb = q("roaming-autorefresh");
    if (cb) cb.checked = enabled;
    stopRoamingSyslogTimer();
    if (enabled && isRoamingPanelActive()) {
      roamingSyslogTimer = setInterval(() => {
        loadRoamingSyslog();
      }, ROAMING_SYSLOG_MS);
    }
  }
  function applyRoamingSyslogAutoRefresh() {
    stopRoamingSyslogTimer();
    if (localStorage.getItem(ROAMING_SYSLOG_LS) === "1" && isRoamingPanelActive()) {
      roamingSyslogTimer = setInterval(() => {
        loadRoamingSyslog();
      }, ROAMING_SYSLOG_MS);
    }
  }
  function stopRoamingSyslogAutoRefresh() {
    stopRoamingSyslogTimer();
  }
  function initRoamingSyslogAutoRefreshUi() {
    const cb = q("roaming-autorefresh");
    if (!cb) return;
    cb.checked = localStorage.getItem(ROAMING_SYSLOG_LS) === "1";
  }
  function escHtml2(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  var SEV_COLORS2 = {
    emerg: "#ef4444",
    alert: "#ef4444",
    crit: "#ef4444",
    err: "#f97316",
    warning: "#eab308",
    notice: "#3b82f6",
    info: "var(--text2)",
    debug: "var(--text3)"
  };
  function extractClientEvents(filtered) {
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const e of filtered) {
      const text = `${e.message || ""} ${e.raw || ""}`;
      MAC_RE.lastIndex = 0;
      OUI_ONLY_RE.lastIndex = 0;
      const fullMacs = [...new Set((text.match(MAC_RE) || []).map(normMac))];
      const ouiRaw = text.match(OUI_ONLY_RE) || [];
      const ouiNormList = [...new Set(ouiRaw.map(normMac))].filter(
        (oui) => !fullMacs.some((f) => fullMacCoversOui(f, oui) || ouiIsContiguousInFullMac(oui, f))
      );
      const macs = [...fullMacs, ...ouiNormList.map((o) => `${o}:00:00:00`)];
      if (!macs.length) continue;
      for (let i = 0; i < macs.length; i++) {
        const mac = macs[i];
        const partialOui = i >= fullMacs.length;
        const displayMac = partialOui ? ouiNormList[i - fullMacs.length] : null;
        const key = `${e.ts}|${mac}|${e.from}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          ts: e.ts,
          mac,
          partialOui,
          displayMac,
          reporterIp: e.from,
          syslogHostname: e.hostname || "",
          severity: e.severity || "",
          program: e.program || "",
          message: (e.message || e.raw || "").slice(0, 600)
        });
      }
    }
    out.sort((a, b) => new Date(a.ts) - new Date(b.ts));
    return out;
  }
  var SEV_PROBLEM_BAD = /* @__PURE__ */ new Set(["emerg", "alert", "crit"]);
  var SEV_PROBLEM_KW = /failed|timeout|reject|denied|invalid|error|abort/i;
  function isBenignWlanSeverityMsg(msg) {
    return /\bidle\s+timeout\b/i.test(String(msg || ""));
  }
  function isSeverityProblemEvent(ev) {
    if (!ev) return false;
    const s = String(ev.severity || "").toLowerCase();
    if (SEV_PROBLEM_BAD.has(s)) return true;
    const msg = ev.message || "";
    return SEV_PROBLEM_KW.test(msg) && !isBenignWlanSeverityMsg(msg) && !/success|ok\b/i.test(msg);
  }
  function detectProblems(evs, roams) {
    const out = [];
    if (evs.some((e) => isSeverityProblemEvent(e))) {
      out.push({ level: "bad", text: "Fehler oder hohe Severity in den Meldungen" });
    }
    if (roams.length >= 3) {
      const pairCounts = {};
      for (const r of roams) {
        const k = [r.fromAp, r.toAp].sort().join("|");
        pairCounts[k] = (pairCounts[k] || 0) + 1;
      }
      const maxP = Math.max(0, ...Object.values(pairCounts));
      if (maxP >= 4) {
        out.push({ level: "warn", text: `H\xE4ufiges Pendeln zwischen denselben APs (${maxP}\xD7)` });
      }
    }
    if (roams.length >= 2) {
      const tEnd = new Date(roams[roams.length - 1].ts).getTime();
      const tStart = tEnd - 10 * 60 * 1e3;
      const recent = roams.filter((r) => new Date(r.ts).getTime() >= tStart);
      if (recent.length >= 5) {
        out.push({ level: "warn", text: "Sehr viele Roams in 10 Minuten" });
      }
    }
    if (roams.length >= 8) {
      const span = new Date(roams[roams.length - 1].ts) - new Date(roams[0].ts);
      if (span < 3600 * 1e3) {
        out.push({ level: "warn", text: "Viele Roams innerhalb 1 Stunde" });
      }
    }
    return out;
  }
  function buildTracks(events) {
    const byMac = {};
    for (const ev of events) {
      if (!byMac[ev.mac]) byMac[ev.mac] = [];
      byMac[ev.mac].push(ev);
    }
    const tracks = [];
    for (const [mac, evs] of Object.entries(byMac)) {
      evs.sort((a, b) => new Date(a.ts) - new Date(b.ts));
      const roams = [];
      for (let i = 1; i < evs.length; i++) {
        if (evs[i].reporterIp !== evs[i - 1].reporterIp) {
          const stepIndex = roams.length + 1;
          roams.push({
            ts: evs[i].ts,
            fromAp: evs[i - 1].reporterIp,
            toAp: evs[i].reporterIp,
            eventIndexAfter: i,
            stepIndex
          });
        }
      }
      tracks.push({
        mac,
        partialOui: evs.some((x) => x.partialOui),
        displayOui: evs.find((x) => x.displayMac)?.displayMac || null,
        events: evs,
        roams,
        problems: detectProblems(evs, roams)
      });
    }
    tracks.sort((a, b) => {
      const badDiff = b.problems.filter((p) => p.level === "bad").length - a.problems.filter((p) => p.level === "bad").length;
      if (badDiff !== 0) return badDiff;
      const wdiff = b.problems.filter((p) => p.level === "warn").length - a.problems.filter((p) => p.level === "warn").length;
      if (wdiff !== 0) return wdiff;
      return b.roams.length - a.roams.length;
    });
    return tracks;
  }
  function fmtShort(ts) {
    if (!ts) return "\u2014";
    try {
      return new Date(ts).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch {
      return ts;
    }
  }
  function fmtLong(ts) {
    if (!ts) return "\u2014";
    try {
      return new Date(ts).toLocaleString("de-DE", {
        weekday: "short",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      });
    } catch {
      return ts;
    }
  }
  function formatRoamEventDetail(ev) {
    if (!ev) return '<div class="roam-ev-missing">\u2014</div>';
    const prob = isSeverityProblemEvent(ev) ? " roam-ev-block--prob" : "";
    const msg = escHtml2(ev.message || "");
    return `<div class="roam-ev-block${prob}">
    <div class="roam-ev-grid">
      <span class="roam-ev-k">Zeit</span><span>${escHtml2(fmtLong(ev.ts))}</span>
      <span class="roam-ev-k">Absender (IP)</span><span class="roam-ev-mono">${escHtml2(ev.reporterIp || "")}</span>
      <span class="roam-ev-k">Syslog-Hostname</span><span>${escHtml2(ev.syslogHostname || "\u2014")}</span>
      <span class="roam-ev-k">Severity</span><span>${escHtml2(ev.severity || "\u2014")}</span>
      <span class="roam-ev-k">Programm</span><span>${escHtml2(ev.program || "\u2014")}</span>
    </div>
    <div class="roam-ev-msg-label">Nachricht</div>
    <pre class="roam-detail-msg">${msg}</pre>
  </div>`;
  }
  var roamDetailEscapeHandler = null;
  function buildRoamDetailHtml(t) {
    const wlan = enrichFromWlan(t.mac);
    const syslogHosts = syslogHostnamesForTrack(t.events);
    const v = lookupMacVendor(t.mac);
    const showMac = t.partialOui && t.displayOui ? t.displayOui : t.mac;
    let meta = `<div class="roam-detail-meta">
    <div><span class="roam-dm-k">MAC</span><span class="roam-dm-v roam-dm-mono">${escHtml2(showMac)}</span></div>`;
    if (t.partialOui) {
      meta += '<div class="roam-dm-note">Nur OUI-Pr\xE4fix in den Syslog-Zeilen erkannt (keine vollst\xE4ndige MAC).</div>';
    }
    if (v.vendor || v.oui) {
      meta += `<div><span class="roam-dm-k">Hersteller</span><span class="roam-dm-v">${v.local ? escHtml2(`Lokal / Privacy \xB7 ${v.oui || ""}`) : escHtml2([v.vendor, v.oui ? `(${v.oui})` : ""].filter(Boolean).join(" "))}</span></div>`;
    }
    const nacM = nacMetaForTrack(t);
    if (nacM.label) {
      meta += `<div><span class="roam-dm-k">NAC</span><span class="roam-dm-v">${escHtml2(nacM.label)}${nacM.vlan != null ? ` <span class="badge badge-gray">VLAN ${escHtml2(String(nacM.vlan))}</span>` : ""}</span></div>`;
    }
    meta += "</div>";
    if (wlan) {
      meta += `<div class="roam-detail-wlan">
      <div class="roam-dm-section-title">WLAN-Scan (Ger\xE4teliste)</div>
      <div class="roam-ev-grid">
        <span class="roam-ev-k">Hostname</span><span>${escHtml2(wlan.hostname || "\u2014")}</span>
        <span class="roam-ev-k">IP</span><span class="roam-ev-mono">${escHtml2(wlan.ip || "\u2014")}</span>
        <span class="roam-ev-k">SSID</span><span>${escHtml2(wlan.ssid || "\u2014")}</span>
        <span class="roam-ev-k">Band / Kanal</span><span>${escHtml2([wlan.band, wlan.channel != null && wlan.channel !== "" ? `Kanal ${wlan.channel}` : ""].filter(Boolean).join(" \xB7 ") || "\u2014")}</span>
        <span class="roam-ev-k">Signal</span><span>${wlan.signal != null && wlan.signal !== "" ? `${escHtml2(String(wlan.signal))} dBm` : "\u2014"}</span>
        <span class="roam-ev-k">AP (Scan)</span><span>${escHtml2(wlan.apName || "")} <span class="roam-ev-mono">${escHtml2(wlan.apIp || "")}</span></span>
      </div>
    </div>`;
    }
    if (syslogHosts.length) {
      meta += `<div class="roam-detail-hosts">Syslog-Hostnamen in den Meldungen: <span class="roam-ev-mono">${escHtml2([...new Set(syslogHosts)].join(", "))}</span></div>`;
    }
    if ((t.problems || []).length) {
      meta += `<div class="roam-detail-problems">${(t.problems || []).map(
        (p) => `<span class="roaming-badge ${p.level === "bad" ? "roaming-badge-bad" : "roaming-badge-warn"}">${escHtml2(p.text)}</span>`
      ).join(" ")}</div>`;
    }
    const evSorted = [...t.events || []].sort((a, b) => new Date(b.ts) - new Date(a.ts));
    const nAll = evSorted.length;
    const nProb = evSorted.filter(isSeverityProblemEvent).length;
    let body = "";
    if (t.roams.length) {
      const total = t.roams.length;
      const ordered = [...t.roams].sort((a, b) => new Date(b.ts) - new Date(a.ts));
      body += '<div class="roam-detail-steps-region">';
      body += `<p class="roam-detail-intro">Roam-Schritte: <strong>neueste zuerst</strong>. Pro Schritt: Syslog-Zeile unmittelbar vor dem AP-Wechsel und ausl\xF6sende Zeile danach.</p>`;
      for (const r of ordered) {
        const i = r.eventIndexAfter;
        const fromEv = i != null && t.events[i - 1] ? t.events[i - 1] : null;
        const toEv = i != null ? t.events[i] : null;
        body += `<section class="roam-detail-step">
        <div class="roam-detail-step-h">
          <span class="roam-detail-step-nr">Schritt ${r.stepIndex} / ${total}</span>
          <span class="roam-detail-step-ts">${escHtml2(fmtLong(r.ts))}</span>
        </div>
        <div class="roam-detail-apline">von ${apHtml(r.fromAp)} <span class="roaming-tl-arrow">\u2192</span> ${apHtml(r.toAp)}</div>
        <div class="roam-detail-pair">
          <div class="roam-detail-pair-col">
            <div class="roam-detail-pair-title">Vorherige Meldung (gleicher Client, noch alter AP)</div>
            ${formatRoamEventDetail(fromEv)}
          </div>
          <div class="roam-detail-pair-col">
            <div class="roam-detail-pair-title">Nachfolgende Meldung (Wechsel erkannt)</div>
            ${formatRoamEventDetail(toEv)}
          </div>
        </div>
      </section>`;
      }
      body += "</div>";
    } else if ((t.events || []).length) {
      body += '<p class="roam-detail-intro roam-detail-hide-if-sev-empty">Kein erkannter AP-Wechsel (Absender-IP blieb gleich). Unten alle zugeh\xF6rigen Syslog-Zeilen.</p>';
    }
    body += `<h4 class="roam-dm-section-title roam-detail-hide-if-sev-empty" style="margin-top:20px">Alle zugeh\xF6rigen Syslog-Ereignisse (${nAll}) \u2014 neueste zuerst</h4>`;
    if (!evSorted.length) {
      body += '<p class="roam-detail-empty roam-detail-hide-if-sev-empty">Keine Ereignisse.</p>';
    } else {
      body += '<div class="roam-detail-all-events roam-detail-hide-if-sev-empty">';
      for (const ev of evSorted) {
        body += formatRoamEventDetail(ev);
      }
      body += "</div>";
    }
    const filterBar = `<div class="roam-detail-filter-bar">
    <label class="roam-detail-filter-label" for="roam-detail-ev-filter">Eintr\xE4ge filtern</label>
    <select id="roam-detail-ev-filter" class="roam-detail-filter-select input-field" onchange="roamDetailEventFilterChange(this)">
      <option value="all">Alle anzeigen</option>
      <option value="sev">Nur \u201EFehler oder hohe Severity\u201C</option>
    </select>
    <span class="roam-detail-filter-hint" aria-live="polite"></span>
  </div>`;
    const emptySev = '<p class="roam-detail-sev-filter-empty">Keine Eintr\xE4ge, die diesem Filter entsprechen (emerg/alert/crit oder Fehler-Stichw\xF6rter in der Nachricht).</p>';
    return `${meta}<div class="roam-detail-filter-root" data-ev-filter="all" data-n-all="${nAll}" data-n-prob="${nProb}">${filterBar}${emptySev}<div class="roam-detail-filterable-body roam-detail-hide-if-sev-empty">${body}</div></div>`;
  }
  function roamDetailEventFilterChange(selectEl) {
    const root = q("roaming-detail-body")?.querySelector(".roam-detail-filter-root");
    if (!root || !selectEl) return;
    root.dataset.evFilter = selectEl.value === "sev" ? "sev" : "all";
    const hint = root.querySelector(".roam-detail-filter-hint");
    const nAll = parseInt(root.dataset.nAll, 10) || 0;
    const nProb = parseInt(root.dataset.nProb, 10) || 0;
    if (hint) {
      if (root.dataset.evFilter === "sev") {
        hint.textContent = nProb ? `${nProb} von ${nAll} Eintr\xE4gen entsprechen dem Filter.` : "";
      } else {
        hint.textContent = nProb ? `${nProb} von ${nAll} Eintr\xE4gen w\xFCrden mit diesem Filter angezeigt.` : "";
      }
    }
  }
  function openRoamDetailView(mac) {
    const { tracks } = roamTrackerCache;
    const t = tracks?.find((x) => x.mac === mac);
    if (!t) {
      window.alert?.("Keine Tracker-Daten f\xFCr diese MAC. Bitte den Roaming-Tab aktualisieren.");
      return;
    }
    const overlay = q("roaming-detail-overlay");
    const titleEl = q("roaming-detail-title");
    const bodyEl = q("roaming-detail-body");
    if (!overlay || !titleEl || !bodyEl) return;
    titleEl.textContent = `Roaming-Verlauf \xB7 ${t.partialOui && t.displayOui ? t.displayOui : t.mac}`;
    bodyEl.innerHTML = buildRoamDetailHtml(t);
    const sel = q("roam-detail-ev-filter");
    if (sel) roamDetailEventFilterChange(sel);
    overlay.style.display = "flex";
    if (roamDetailEscapeHandler) document.removeEventListener("keydown", roamDetailEscapeHandler);
    roamDetailEscapeHandler = (e) => {
      if (e.key === "Escape") closeRoamDetailView();
    };
    document.addEventListener("keydown", roamDetailEscapeHandler);
  }
  function closeRoamDetailView() {
    const overlay = q("roaming-detail-overlay");
    if (overlay) overlay.style.display = "none";
    if (roamDetailEscapeHandler) {
      document.removeEventListener("keydown", roamDetailEscapeHandler);
      roamDetailEscapeHandler = null;
    }
  }
  function enrichFromWlan(mac) {
    const M = mac.toUpperCase();
    for (const c of state_default.clientsData || []) {
      if (c.type !== "wlan") continue;
      if ((c.mac || "").toUpperCase() === M) {
        return {
          hostname: c.hostname || "",
          ip: c.ip || "",
          ssid: c.ssid || "",
          band: c.band || "",
          signal: c.signal,
          channel: c.channel,
          apName: c.sourceName || "",
          apIp: c.sourceIp || ""
        };
      }
    }
    for (const d of Object.values(state_default.deviceStore || {})) {
      for (const c of d.wlanClients || []) {
        if ((c.mac || "").toUpperCase() === M) {
          return {
            hostname: c.hostname || "",
            ip: c.ip || "",
            ssid: c.ssid || "",
            band: c.band || "",
            signal: c.signal,
            channel: c.channel,
            apName: d.name || d.ip,
            apIp: d.ip
          };
        }
      }
    }
    return null;
  }
  function syslogHostnamesForTrack(events) {
    const h2 = /* @__PURE__ */ new Set();
    for (const ev of events) {
      if (ev.syslogHostname) h2.add(ev.syslogHostname);
    }
    return [...h2];
  }
  function roamSortTh(label, col, thStyle = "") {
    const sort = state_default.roamSort;
    const active = sort.col === col;
    const cls = active ? sort.dir === 1 ? "sortable sort-asc" : "sortable sort-desc" : "sortable";
    const st = thStyle ? ` style="${thStyle}"` : "";
    return `<th class="${cls}" onclick="roamSortClick('${col}')"${st}>${label}</th>`;
  }
  function roamSortKey(t, col) {
    const wlan = enrichFromWlan(t.mac);
    const v = lookupMacVendor(t.mac);
    const macKey = (t.displayOui || t.mac).toLowerCase();
    switch (col) {
      case "mac":
        return macKey;
      case "vendor": {
        if (v.local) return `0privacy\0${(v.oui || "").toLowerCase()}\0${macKey}`;
        if (v.vendor) return `1${v.vendor.toLowerCase()}\0${macKey}`;
        if (v.oui) return `2unknown\0${v.oui.toLowerCase()}\0${macKey}`;
        return `3\0${macKey}`;
      }
      case "client":
        if (!wlan) return "\uFFFF";
        return `${(wlan.hostname || "").toLowerCase()}\0${wlan.ip || ""}\0${(wlan.ssid || "").toLowerCase()}`;
      case "nacLabel": {
        const nm = nacMetaForTrack(t);
        if (!nm.label) return "\uFFFF";
        return nm.label.toLowerCase() + "\0" + macKey;
      }
      case "roams":
        return t.roams.length;
      case "last":
        return t.events.length ? new Date(t.events[t.events.length - 1].ts).getTime() : 0;
      case "hints": {
        const p = t.problems || [];
        if (!p.length) return "";
        return p.map((x) => `${x.level}:${x.text}`).join("|").toLowerCase();
      }
      case "verlauf":
        return t.roams.length * 1e6 + t.events.length;
      default:
        return "";
    }
  }
  function roamSortClick(col) {
    clickSort(state_default.roamSort, col, renderRoamTrackerCached);
  }
  function renderRoamTrackerCached() {
    const { tracks, meta } = roamTrackerCache;
    if (!tracks || !meta) return;
    renderRoamingTracker(tracks, meta);
  }
  function formatClientInfoCell(wlan, syslogHosts) {
    const lines = [];
    if (wlan) {
      const hn = wlan.hostname || "\u2014";
      lines.push(`<div style="font-weight:600">${escHtml2(hn)}</div>`);
      const bits = [];
      if (wlan.ip) bits.push(`IP ${escHtml2(wlan.ip)}`);
      if (wlan.ssid) bits.push(`SSID ${escHtml2(wlan.ssid)}`);
      if (wlan.band) bits.push(escHtml2(wlan.band));
      if (bits.length) lines.push(`<div style="font-size:11px;color:var(--text3)">${bits.join(" \xB7 ")}</div>`);
      if (wlan.signal != null && wlan.signal !== "") {
        lines.push(`<div style="font-size:11px;color:var(--text3)">Signal ${escHtml2(String(wlan.signal))} dBm${wlan.channel != null && wlan.channel !== "" ? ` \xB7 Kanal ${escHtml2(String(wlan.channel))}` : ""}</div>`);
      }
      lines.push(`<div style="font-size:10px;color:var(--text3)">WLAN-Scan: ${escHtml2(wlan.apName || "")} <span style="font-family:var(--mono)">${escHtml2(wlan.apIp || "")}</span></div>`);
    } else {
      lines.push('<div style="font-size:11px;color:var(--text3)">WLAN-Scan: <em>keine Daten</em> <span style="font-size:10px">\u2014 zuerst <b>WiFi Analyse \u2192 Aktualisieren</b></span></div>');
    }
    const sh = syslogHosts.filter(Boolean);
    if (sh.length) {
      lines.push(`<div style="font-size:10px;color:var(--text3)">Syslog-Host: ${escHtml2([...new Set(sh)].join(", "))}</div>`);
    }
    return `<div class="roam-cell-info">${lines.join("")}</div>`;
  }
  function rowSearchBlob(t, wlan, syslogHosts) {
    const parts = [t.mac];
    if (t.displayOui) parts.push(t.displayOui);
    const nm = nacMetaForTrack(t);
    if (nm.label) parts.push(nm.label);
    const v = lookupMacVendor(t.mac);
    parts.push(v.oui || "", v.vendor || "", v.local ? "privacy lokal" : "");
    for (const p of t.problems || []) parts.push(p.text);
    for (const r of t.roams) {
      parts.push(r.fromAp, r.toAp, apLabel(r.fromAp), apLabel(r.toAp));
    }
    if (wlan) {
      parts.push(wlan.hostname, wlan.ip, wlan.ssid, wlan.band, wlan.apName, wlan.apIp);
    }
    parts.push(...syslogHosts);
    return parts.join(" ").toLowerCase();
  }
  function formatRoamMacCell(mac, track) {
    const showMac = track?.partialOui && track?.displayOui ? track.displayOui : mac;
    const partialNote = track?.partialOui ? '<div class="roam-oui-hint" style="margin-top:4px">Nur OUI-Pr\xE4fix in Syslog (keine vollst\xE4ndige MAC)</div>' : "";
    return `<div class="roam-mac-cell">${escHtml2(showMac)}</div>${partialNote}`;
  }
  function formatRoamVendorCell(mac) {
    const { oui, vendor, local } = lookupMacVendor(mac);
    if (!oui) return '<span style="font-size:11px;color:var(--text3)">\u2014</span>';
    if (local) {
      return `<div class="roam-oui-hint roam-oui-local">Lokale / Privacy-MAC \xB7 ${escHtml2(oui)}</div>`;
    }
    if (vendor) {
      return `<div class="roam-oui-hint">${escHtml2(vendor)} <span class="roam-oui-code">(${escHtml2(oui)})</span></div>`;
    }
    return `<div class="roam-oui-hint">OUI ${escHtml2(oui)} \u2014 nicht in der lokalen Herstellerliste</div>`;
  }
  var MAX_TL = 32;
  function filterRoamTable() {
    const inp = q("roaming-client-search");
    const needle = (inp?.value || "").trim().toLowerCase();
    q("tbody-roaming-tracker")?.querySelectorAll("tr.roam-track-row").forEach((tr) => {
      const hay = (tr.getAttribute("data-search") || "").toLowerCase();
      tr.style.display = !needle || hay.includes(needle) ? "" : "none";
    });
  }
  function renderRoamingTracker(tracks, meta) {
    roamTrackerCache = { tracks, meta };
    const root = q("roaming-tracker-root");
    if (!root) return;
    ensureNacAllowlistForRoaming();
    const totalRoams = tracks.reduce((s, t) => s + t.roams.length, 0);
    const badHints = tracks.reduce((s, t) => s + t.problems.filter((p) => p.level === "bad").length, 0);
    const warnHints = tracks.reduce((s, t) => s + t.problems.filter((p) => p.level === "warn").length, 0);
    if (!tracks.length) {
      root.innerHTML = meta.noMacLines > 0 ? `<div class="roaming-sum">In den passenden Syslog-Zeilen wurde <strong>keine MAC-Adresse</strong> erkannt (${meta.noMacLines} Zeilen). Bitte Rohdaten pr\xFCfen oder Ger\xE4te-Logging erweitern.</div>` : '<div class="roaming-sum">Keine Roaming-Syslog-Zeilen vorhanden.</div>';
      return;
    }
    const sumParts = [
      `<strong>${tracks.length}</strong> Clients (MAC)`,
      `<strong>${totalRoams}</strong> vermutete Roam-Schritte`
    ];
    if (badHints) sumParts.push(`<span class="roaming-sum-bad">${badHints} kritische Hinweise</span>`);
    if (warnHints) sumParts.push(`<span class="roaming-sum-warn">${warnHints} Warnungen</span>`);
    if (meta.noMacLines) {
      sumParts.push(`<span style="color:var(--text3)">${meta.noMacLines} Syslog-Zeilen ohne MAC (nur unten in der Tabelle)</span>`);
    }
    let html = `<div class="roaming-sum">${sumParts.join(" \xB7 ")}<br><span style="font-size:11px;color:var(--text3);margin-top:6px;display:inline-block">Roam-Schritt = gleiche Client-MAC, n\xE4chste Meldung von <em>anderem</em> Syslog-Absender (meist anderer AP). Zus\xE4tzliche Infos aus WLAN-Scan (WiFi Analyse) und Syslog-Hostnamen.</span></div>`;
    const sortedTracks = state_default.roamSort.col ? applySort(tracks, state_default.roamSort, roamSortKey) : [...tracks];
    html += `<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap">
    <input class="search-input" id="roaming-client-search" placeholder="Suche: MAC, Hostname, SSID, AP-Name, IP \u2026" oninput="filterRoamTable()" style="width:min(100%,420px)">
    <span style="font-size:11px;color:var(--text3)">${tracks.length} Zeilen</span>
  </div>`;
    html += `<div class="roaming-table-wrap"><table class="roaming-track-table">
    <thead><tr>
      ${roamSortTh("MAC", "mac")}
      ${roamSortTh("Hersteller", "vendor")}
      ${roamSortTh("Client-Info", "client")}
      ${roamSortTh("Bezeichnung (NAC)", "nacLabel", "min-width:100px;max-width:200px")}
      ${roamSortTh("Roam-Schritte", "roams", "text-align:right;white-space:nowrap")}
      ${roamSortTh("Zuletzt (Syslog)", "last", "white-space:nowrap")}
      ${roamSortTh("Hinweise", "hints")}
      ${roamSortTh("Verlauf", "verlauf", "min-width:140px")}
      <th style="width:96px">Details</th>
      <th style="width:52px"></th>
    </tr></thead><tbody id="tbody-roaming-tracker">`;
    for (const t of sortedTracks) {
      const wlan = enrichFromWlan(t.mac);
      const syslogHosts = syslogHostnamesForTrack(t.events);
      const searchAttr = h(rowSearchBlob(t, wlan, syslogHosts));
      const lastTs = t.events.length ? t.events[t.events.length - 1].ts : "";
      let tlInner = "";
      const roamsPreview = t.roams.slice(-MAX_TL);
      const hiddenOlder = t.roams.length - roamsPreview.length;
      for (const r of [...roamsPreview].reverse()) {
        tlInner += `<div class="roaming-tl-row">
        <div class="roaming-tl-time">${escHtml2(fmtShort(r.ts))}</div>
        <div class="roaming-tl-ap">von ${apHtml(r.fromAp)} <span class="roaming-tl-arrow">\u2192</span> ${apHtml(r.toAp)}</div>
      </div>`;
      }
      if (hiddenOlder > 0) {
        tlInner += `<div class="roaming-card-note">\u2026 ${hiddenOlder} \xE4ltere Schritte (in \u201EDetails\u201C vollst\xE4ndig)</div>`;
      }
      const verlaufCell = t.roams.length ? `<details class="roam-details"><summary style="cursor:pointer;font-size:11px;color:var(--accent)">${t.roams.length} Schritt${t.roams.length !== 1 ? "e" : ""} <span style="color:var(--text3);font-weight:400">(neueste zuerst)</span></summary><div class="roaming-timeline" style="margin-top:8px">${tlInner}</div></details>` : `<span style="font-size:11px;color:var(--text3)">${t.events.length} Syslog, kein AP-Wechsel \xB7 ${apHtml(t.events[t.events.length - 1].reporterIp)}</span>`;
      const detailBtn = t.events.length ? `<button type="button" class="btn btn-sm" onclick='openRoamDetailView(${JSON.stringify(t.mac)})' title="Vollst\xE4ndiger Verlauf mit allen Syslog-Feldern">Details</button>` : '<span style="font-size:10px;color:var(--text3)">\u2014</span>';
      const probOnly = (t.problems || []).length ? (t.problems || []).map(
        (p) => `<span class="roaming-badge ${p.level === "bad" ? "roaming-badge-bad" : "roaming-badge-warn"}" style="display:inline-block;margin:2px 4px 2px 0">${escHtml2(p.text)}</span>`
      ).join("") : !t.roams.length && t.events.length ? '<span class="roaming-badge roaming-badge-info">Kein AP-Wechsel</span>' : '<span style="font-size:11px;color:var(--text3)">\u2014</span>';
      const nm = nacMetaForTrack(t);
      const nacLabelCell = nm.label ? `<span style="color:var(--text2);font-size:12px" title="Bezeichnung aus NAC">${escHtml2(nm.label)}</span>${nm.vlan != null ? ` <span class="badge badge-gray" title="Dynamisches VLAN (NAC)">VLAN ${escHtml2(String(nm.vlan))}</span>` : ""}` : "\u2014";
      const macDelBtn = !t.partialOui ? `<button type="button" class="btn btn-sm btn-ghost" title="Alle Syslog-Zeilen mit dieser MAC l\xF6schen" onclick='deleteRoamingTrackerMac(${JSON.stringify(t.mac)})'>\xD7</button>` : '<span style="font-size:10px;color:var(--text3)" title="Nur OUI in Syslog \u2014 Zeilen einzeln unten l\xF6schen">\u2014</span>';
      html += `<tr class="roam-track-row" data-search="${searchAttr}">
      <td>${formatRoamMacCell(t.mac, t)}</td>
      <td class="roam-vendor-td">${formatRoamVendorCell(t.mac)}</td>
      <td>${formatClientInfoCell(wlan, syslogHosts)}</td>
      <td style="max-width:200px;word-break:break-word">${nacLabelCell}</td>
      <td style="text-align:right;font-variant-numeric:tabular-nums">${t.roams.length}</td>
      <td style="font-size:11px;color:var(--text3);white-space:nowrap">${escHtml2(fmtShort(lastTs))}</td>
      <td style="max-width:280px">${probOnly}</td>
      <td>${verlaufCell}</td>
      <td style="text-align:center;vertical-align:middle">${detailBtn}</td>
      <td style="text-align:center;vertical-align:middle">${macDelBtn}</td>
    </tr>`;
    }
    html += "</tbody></table></div>";
    root.innerHTML = html;
    filterRoamTable();
  }
  async function loadRoamingSyslog() {
    const ip = q("roaming-syslog-ip-filter")?.value?.trim() || "";
    let url = "/api/syslog?limit=3000";
    if (ip) url += `&ip=${encodeURIComponent(ip)}`;
    const tb = q("tbody-roaming-syslog");
    const hint = q("roaming-syslog-hint");
    const tracker = q("roaming-tracker-root");
    try {
      const r = await fetch(url);
      let body;
      try {
        body = await r.json();
      } catch {
        if (tb) tb.innerHTML = `<tr><td colspan="7" class="empty" style="color:var(--red)">Antwort ist kein JSON (HTTP ${r.status})</td></tr>`;
        if (hint) hint.textContent = "";
        if (tracker) tracker.innerHTML = "";
        return;
      }
      if (!r.ok) {
        const msg = body && (body.error || body.message) || `HTTP ${r.status}`;
        if (tb) tb.innerHTML = `<tr><td colspan="7" class="empty" style="color:var(--red)">${h(String(msg))}</td></tr>`;
        if (hint) hint.textContent = "";
        if (tracker) tracker.innerHTML = "";
        return;
      }
      const list = Array.isArray(body) ? body : [];
      const filtered = list.filter(isRoamingSyslogEntry);
      const noMacLines = filtered.filter((e) => {
        const t = `${e.message || ""} ${e.raw || ""}`;
        MAC_RE.lastIndex = 0;
        return !textHasMacOrOui(t);
      }).length;
      if (hint) {
        hint.textContent = list.length ? `${filtered.length} von ${list.length} Syslog-Zeilen nach Roaming-Stichworten \xB7 Tracker nutzt Zeilen mit MAC + wechselndem Absender.` : "Keine Syslog-Daten \u2014 Ger\xE4te m\xFCssen an UDP/1514 senden.";
      }
      const clientEvents = extractClientEvents(filtered);
      const tracks = buildTracks(clientEvents);
      renderRoamingTracker(tracks, { noMacLines, filteredCount: filtered.length });
      renderRoamingSyslogTable(filtered.slice(0, 400));
    } catch (e) {
      if (tb) tb.innerHTML = `<tr><td colspan="7" class="empty" style="color:var(--red)">${h(e.message || "Fehler beim Laden")}</td></tr>`;
      if (hint) hint.textContent = "";
      if (tracker) tracker.innerHTML = "";
    }
  }
  function renderRoamingSyslogTable(rows) {
    const tb = q("tbody-roaming-syslog");
    const cnt = q("cnt-roaming-syslog");
    if (!tb) return;
    if (cnt) cnt.textContent = rows.length ? `(${rows.length})` : "";
    if (!rows.length) {
      tb.innerHTML = '<tr><td colspan="7" class="empty">Keine passenden Roaming-Eintr\xE4ge im Syslog \u2014 Stichworte: roam, reassoc, 802.11r, WLAN-Client-Wechsel \u2026</td></tr>';
      return;
    }
    tb.innerHTML = rows.map((e) => {
      const ts = e.ts ? new Date(e.ts).toLocaleString("de-DE") : "\u2014";
      const sevColor = SEV_COLORS2[e.severity] || "var(--text2)";
      const msg = escHtml2(e.message || e.raw || "");
      const msgShort = msg.length > 220 ? msg.slice(0, 220) + "\u2026" : msg;
      const payload = encodeURIComponent(JSON.stringify({
        ts: e.ts,
        from: e.from,
        message: e.message == null ? "" : e.message
      }));
      return `<tr>
      <td style="white-space:nowrap;font-size:11px;color:var(--text3)">${ts}</td>
      <td style="font-family:monospace;font-size:11px">${escHtml2(e.from)}</td>
      <td><span style="color:${sevColor};font-weight:600;font-size:11px">${escHtml2(e.severity || "?")}</span></td>
      <td style="font-size:11px;color:var(--text3)">${escHtml2(e.facility || "")}</td>
      <td style="font-size:11px">${escHtml2(e.program || "")}</td>
      <td style="font-size:11px;max-width:520px;word-break:break-word" title="${msg}">${msgShort}</td>
      <td style="text-align:center;vertical-align:middle"><button type="button" class="btn btn-sm btn-ghost" title="Diese Zeile aus dem Syslog l\xF6schen" onclick="roamingDeleteSyslogRow(this)" data-payload="${payload}">\xD7</button></td>
    </tr>`;
    }).join("");
  }
  async function roamingDeleteSyslogRow(btn) {
    let payload;
    try {
      payload = JSON.parse(decodeURIComponent(btn.dataset.payload || ""));
    } catch {
      return;
    }
    try {
      const r = await fetch("/api/syslog/entry", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok || body.ok === false) {
        window.alert?.(body && body.error || `L\xF6schen fehlgeschlagen (HTTP ${r.status})`);
        return;
      }
      await loadRoamingSyslog();
    } catch (e) {
      window.alert?.(e.message || "Netzwerkfehler");
    }
  }
  async function clearRoamingSyslogAll() {
    if (!window.confirm("Alle gespeicherten Syslog-Eintr\xE4ge l\xF6schen? Betrifft Roaming, Syslog-Tab und UDP/1514-Puffer.")) return;
    try {
      const r = await fetch("/api/syslog", { method: "DELETE" });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        window.alert?.(body && body.error || `HTTP ${r.status}`);
        return;
      }
      await loadRoamingSyslog();
    } catch (e) {
      window.alert?.(e.message || "Netzwerkfehler");
    }
  }
  async function deleteRoamingTrackerMac(mac) {
    if (!mac || !window.confirm(`Alle Syslog-Zeilen mit dieser MAC l\xF6schen?
${mac}`)) return;
    try {
      const r = await fetch("/api/syslog/delete-for-mac", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mac })
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        window.alert?.(body && body.error || `HTTP ${r.status}`);
        return;
      }
      await loadRoamingSyslog();
    } catch (e) {
      window.alert?.(e.message || "Netzwerkfehler");
    }
  }

  // ui/tabs/backup.js
  var backupFiles = [];
  var currentIp = "";
  var currentFile = "";
  function escHtml3(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#39;").replace(/"/g, "&quot;");
  }
  function backupStatus(msg, err) {
    const el = q("backup-status");
    if (!el) return;
    el.textContent = msg;
    el.style.color = err ? "var(--red)" : "var(--text3)";
    if (msg) setTimeout(() => {
      if (el.textContent === msg) el.textContent = "";
    }, 8e3);
  }
  function populateBackupDevSelect() {
    const sel = q("backup-dev-select");
    if (!sel) return;
    const devs = Object.values(state_default.deviceStore || {}).sort((a, b) => (a.name || a.sysName || a.ip || "").localeCompare(b.name || b.sysName || b.ip || ""));
    sel.innerHTML = '<option value="">\u2014 Ger\xE4t w\xE4hlen \u2014</option>' + devs.map((d) => `<option value="${d.ip}" data-os="${d.os || ""}">${d.name || d.sysName || d.ip} (${d.ip})</option>`).join("");
  }
  async function loadBackupList() {
    const sel = q("backup-dev-select");
    const ip = sel?.value;
    if (!ip) {
      q("backup-list").innerHTML = '<div style="padding:20px;text-align:center;color:var(--text3);font-size:12px">Ger\xE4t w\xE4hlen</div>';
      return;
    }
    currentIp = ip;
    try {
      const r = await fetch(`/api/backup/list?ip=${ip}`);
      backupFiles = await r.json();
      renderBackupList();
    } catch {
      backupStatus("Fehler beim Laden", true);
    }
  }
  function renderBackupList() {
    const el = q("backup-list");
    if (!el) return;
    if (!backupFiles.length) {
      el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text3);font-size:12px">Keine Backups vorhanden</div>';
      return;
    }
    el.innerHTML = backupFiles.map((f, i) => {
      const ts = new Date(f.ts).toLocaleString("de-DE");
      const kb = (f.size / 1024).toFixed(1);
      const active = f.filename === currentFile ? "background:rgba(37,99,235,.15);" : "";
      const bin = /\.(lcfsx|cfg|xml)$/i.test(f.filename);
      const dl = bin ? `<a class="btn-micro" href="/api/backup/download?ip=${encodeURIComponent(currentIp)}&file=${encodeURIComponent(f.filename)}" download title="Bin\xE4rdatei herunterladen" onclick="event.stopPropagation()" style="text-decoration:none;color:var(--accent)">\u2B07</a>` : "";
      return `<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;${active}border-top:${i ? "1px solid var(--border)" : "none"};cursor:pointer" onclick="showBackupContent('${escHtml3(f.filename)}')">
      <span style="flex:1;font-size:12px;font-weight:500">${ts}</span>
      <span style="font-size:10px;color:var(--text3)">${kb} KB</span>
      ${dl}
      <button class="btn-micro" onclick="event.stopPropagation();deleteBackupFile('${escHtml3(f.filename)}')" title="L\xF6schen">\u2715</button>
    </div>`;
    }).join("");
    const diffSel = q("backup-diff-select");
    if (diffSel) {
      diffSel.innerHTML = '<option value="">\u2014 Diff mit\u2026 \u2014</option>' + backupFiles.map((f) => `<option value="${f.filename}">${new Date(f.ts).toLocaleString("de-DE")}</option>`).join("");
    }
  }
  async function showBackupContent(filename) {
    currentFile = filename;
    renderBackupList();
    const el = q("backup-content");
    const diffSel = q("backup-diff-select");
    if (diffSel) diffSel.style.display = "";
    try {
      const r = await fetch(`/api/backup/content?ip=${currentIp}&file=${filename}`);
      const text = await r.text();
      el.innerHTML = escHtml3(text);
    } catch {
      el.innerHTML = '<span style="color:var(--red)">Fehler beim Laden</span>';
    }
  }
  async function loadBackupDiff() {
    const diffSel = q("backup-diff-select");
    const fileB = diffSel?.value;
    if (!fileB || !currentFile || fileB === currentFile) return;
    const el = q("backup-content");
    try {
      const r = await fetch("/api/backup/diff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip: currentIp, fileA: currentFile, fileB })
      });
      const diff = await r.json();
      if (diff.error) throw new Error(diff.error);
      let html = `<div style="margin-bottom:8px;font-weight:600;color:var(--text2)">Diff: ${currentFile} vs ${fileB}</div>`;
      html += `<div style="margin-bottom:6px;font-size:11px;color:var(--text3)">${diff.same} gleiche Zeilen \xB7 ${diff.removed.length} entfernt \xB7 ${diff.added.length} hinzugef\xFCgt</div>`;
      if (diff.removed.length) html += diff.removed.map((l) => `<div style="background:rgba(239,68,68,.12);color:#ef4444;padding:1px 6px;border-radius:2px">- ${escHtml3(l)}</div>`).join("");
      if (diff.added.length) html += diff.added.map((l) => `<div style="background:rgba(34,197,94,.12);color:#22c55e;padding:1px 6px;border-radius:2px">+ ${escHtml3(l)}</div>`).join("");
      if (!diff.removed.length && !diff.added.length) html += '<div style="color:var(--text3)">Keine Unterschiede</div>';
      el.innerHTML = html;
    } catch (e) {
      el.innerHTML = `<span style="color:var(--red)">${escHtml3(e.message)}</span>`;
    }
  }
  async function runBackup() {
    const sel = q("backup-dev-select");
    const ip = sel?.value;
    if (!ip) return backupStatus("Ger\xE4t w\xE4hlen", true);
    const opt = sel.selectedOptions[0];
    const os = opt?.dataset?.os || "";
    backupStatus("Backup wird erstellt\u2026");
    try {
      const r = await fetch("/api/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip, os })
      });
      const data = await r.json();
      if (data.error) throw new Error(data.error);
      let msg = `\u2713 Backup gespeichert (${(data.size / 1024).toFixed(1)} KB)`;
      if (data.warn) msg += " \u2014 " + data.warn;
      backupStatus(msg);
      await loadBackupList();
    } catch (e) {
      backupStatus(e.message, true);
    }
  }
  async function runBackupAll() {
    backupStatus("Alle Backups werden erstellt\u2026");
    try {
      const r = await fetch("/api/backup/all", { method: "POST" });
      const results = await r.json();
      if (results.error) throw new Error(results.error);
      const ok = results.filter((r2) => !r2.error).length;
      const fail = results.filter((r2) => r2.error).length;
      backupStatus(`${ok} gesichert, ${fail} fehlgeschlagen`);
      if (currentIp) await loadBackupList();
    } catch (e) {
      backupStatus(e.message, true);
    }
  }
  async function deleteBackupFile(filename) {
    if (!confirm(`Backup ${filename} l\xF6schen?`)) return;
    try {
      await fetch(`/api/backup?ip=${currentIp}&file=${filename}`, { method: "DELETE" });
      await loadBackupList();
      if (currentFile === filename) {
        currentFile = "";
        q("backup-content").innerHTML = '<div style="color:var(--text3);text-align:center;padding:20px;font-family:system-ui">Backup ausw\xE4hlen</div>';
      }
    } catch {
    }
  }
  function initBackup() {
    populateBackupDevSelect();
  }

  // ui/tabs/mib-browser.js
  var mibResults = [];
  var mibHistory = [];
  function mibHost() {
    const sel = q("mib-dev-select");
    return sel?.value || "";
  }
  function mibStatus(msg, err) {
    const el = q("mib-status");
    if (!el) return;
    el.textContent = msg;
    el.style.color = err ? "var(--red)" : "var(--text3)";
    if (msg) setTimeout(() => {
      if (el.textContent === msg) el.textContent = "";
    }, 8e3);
  }
  function parseVarbindLine(raw) {
    const m = raw.match(/^([\d.]+)\s*=\s*(\w[\w-]*):\s*(.*)/s);
    if (m) return { oid: m[1].replace(/^\./, ""), type: m[2], value: m[3].trim().replace(/^"(.*)"$/, "$1") };
    const m2 = raw.match(/^([\d.]+)\s*=\s*(.*)/s);
    if (m2) return { oid: m2[1].replace(/^\./, ""), type: "?", value: m2[2].trim() };
    return null;
  }
  function populateMibDevSelect() {
    const sel = q("mib-dev-select");
    if (!sel) return;
    const devs = Object.values(state_default.deviceStore || {}).sort((a, b) => (a.name || a.sysName || a.ip || "").localeCompare(b.name || b.sysName || b.ip || ""));
    sel.innerHTML = '<option value="">\u2014 Ger\xE4t / IP \u2014</option>' + devs.map((d) => `<option value="${d.ip}">${d.name || d.sysName || d.ip} (${d.ip})</option>`).join("");
  }
  async function mibWalk(oidOverride) {
    const host = q("mib-host-input")?.value?.trim() || mibHost();
    const oid = oidOverride || q("mib-oid")?.value?.trim() || "1.3.6.1.2.1.1";
    if (!host) return mibStatus("Kein Ger\xE4t gew\xE4hlt", true);
    if (!oid) return mibStatus("Keine OID angegeben", true);
    if (!oidOverride) q("mib-oid").value = oid;
    mibStatus("Walk l\xE4uft\u2026");
    q("mib-run-btn")?.setAttribute("disabled", "");
    try {
      const r = await fetch("/api/mib", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host, oid, action: "walk" })
      });
      const data = await r.json();
      if (data.error) throw new Error(data.error);
      mibResults = (data.lines || []).map(parseVarbindLine).filter(Boolean);
      mibHistory.push({ oid, host, count: mibResults.length });
      if (mibHistory.length > 30) mibHistory.shift();
      renderMibResults();
      mibStatus(`${mibResults.length} Ergebnisse`);
    } catch (e) {
      mibStatus(e.message, true);
    } finally {
      q("mib-run-btn")?.removeAttribute("disabled");
    }
  }
  async function mibGet() {
    const host = q("mib-host-input")?.value?.trim() || mibHost();
    const oid = q("mib-oid")?.value?.trim();
    if (!host) return mibStatus("Kein Ger\xE4t gew\xE4hlt", true);
    if (!oid) return mibStatus("Keine OID angegeben", true);
    mibStatus("GET l\xE4uft\u2026");
    try {
      const r = await fetch("/api/mib", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host, oid, action: "get" })
      });
      const data = await r.json();
      if (data.error) throw new Error(data.error);
      mibResults = (data.lines || []).map(parseVarbindLine).filter(Boolean);
      renderMibResults();
      mibStatus(`${mibResults.length} Ergebnis(se)`);
    } catch (e) {
      mibStatus(e.message, true);
    }
  }
  async function mibSet() {
    const host = q("mib-host-input")?.value?.trim() || mibHost();
    const oid = q("mib-oid")?.value?.trim();
    const type = q("mib-set-type")?.value || "i";
    const value = q("mib-set-value")?.value || "";
    if (!host || !oid) return mibStatus("Host und OID erforderlich", true);
    if (!confirm(`SNMP SET auf ${host}:
OID: ${oid}
Typ: ${type}
Wert: ${value}

Fortfahren?`)) return;
    mibStatus("SET l\xE4uft\u2026");
    try {
      const r = await fetch("/snmpset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host, oid, type, value })
      });
      const data = await r.json();
      if (data.error) throw new Error(data.error);
      mibStatus("SET erfolgreich \u2713");
      await mibGet();
    } catch (e) {
      mibStatus("SET Fehler: " + e.message, true);
    }
  }
  function mibWalkFrom(oid) {
    q("mib-oid").value = oid;
    mibWalk(oid);
  }
  function mibPreset(oid) {
    q("mib-oid").value = oid;
    mibWalk(oid);
  }
  function mibCopyOid(oid) {
    navigator.clipboard?.writeText(oid);
    mibStatus("OID kopiert: " + oid);
  }
  function escHtml4(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function formatValue(type, value) {
    if (type === "Hex-STRING") {
      const hex = value.replace(/\s+/g, " ");
      const bytes = hex.split(" ").filter(Boolean);
      if (bytes.length === 6) return `<span class="mib-mac">${bytes.map((b) => b.padStart(2, "0")).join(":")}</span>`;
      if (bytes.length <= 32) return `<code>${escHtml4(hex)}</code>`;
      return `<code title="${escHtml4(hex)}">${escHtml4(hex.slice(0, 60))}\u2026</code>`;
    }
    if (type === "Timeticks") {
      const m = value.match(/\((\d+)\)/);
      if (m) {
        const t = parseInt(m[1]) / 100;
        const d = Math.floor(t / 86400), h2 = Math.floor(t % 86400 / 3600), min = Math.floor(t % 3600 / 60), s = Math.floor(t % 60);
        return `${d}d ${h2}h ${min}m ${s}s <span style="color:var(--text3)">(${m[1]})</span>`;
      }
    }
    if (type === "IpAddress") return `<span style="color:var(--cyan)">${escHtml4(value)}</span>`;
    if (type === "Counter32" || type === "Counter64" || type === "Gauge32") {
      return `<span style="color:var(--accent)">${escHtml4(value)}</span>`;
    }
    const str = escHtml4(value);
    return str.length > 120 ? `<span title="${str}">${str.slice(0, 120)}\u2026</span>` : str;
  }
  function renderMibResults() {
    const wrap = q("mib-results");
    if (!wrap) return;
    if (!mibResults.length) {
      wrap.innerHTML = '<div style="padding:30px;text-align:center;color:var(--text3)">Keine Ergebnisse</div>';
      return;
    }
    const cnt = q("mib-result-count");
    if (cnt) cnt.textContent = `${mibResults.length} Eintr\xE4ge`;
    const rows = mibResults.map((r, i) => `<tr>
    <td class="mib-oid-cell" title="${escHtml4(r.oid)}">
      <span class="mib-oid-text">${escHtml4(r.oid)}</span>
      <span class="mib-oid-actions">
        <button class="btn-micro" onclick="mibWalkFrom('${r.oid}')" title="Walk ab hier">\u2193</button>
        <button class="btn-micro" onclick="mibCopyOid('${r.oid}')" title="OID kopieren">\u29C9</button>
      </span>
    </td>
    <td><span class="mib-type-badge">${escHtml4(r.type)}</span></td>
    <td class="mib-val-cell">${formatValue(r.type, r.value)}</td>
  </tr>`).join("");
    wrap.innerHTML = `<table class="mib-table">
    <thead><tr><th style="width:38%">OID</th><th style="width:12%">Typ</th><th>Wert</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
  }
  function mibDevChanged() {
    const sel = q("mib-dev-select");
    const inp = q("mib-host-input");
    if (sel?.value && inp) inp.value = sel.value;
  }
  function initMibBrowser() {
    populateMibDevSelect();
  }

  // ui/tabs/nac.js
  function macRowsHtml(rows) {
    if (!rows.length) {
      return '<tr><td colspan="4" class="empty">Keine MACs \u2014 im Modus \u201ENur freigegebene MACs" werden alle Access-Requests abgelehnt</td></tr>';
    }
    return rows.map((row) => `
      <tr>
        <td><input class="search-input nac-mac" style="width:100%;font-family:var(--mono);font-size:12px;box-sizing:border-box" value="${h(row.mac)}"></td>
        <td><input class="search-input nac-label" style="width:100%;box-sizing:border-box" value="${h(row.label || "")}"></td>
        <td style="width:72px"><input class="search-input nac-mac-vlan" type="number" min="1" max="4094" placeholder="VLAN" title="Optional: 1\u20134094 wenn dynamische VLANs aktiv" style="width:100%;box-sizing:border-box;font-size:12px" value="${row.vlan != null ? h(String(row.vlan)) : ""}"></td>
        <td style="width:44px"><button type="button" class="btn btn-sm btn-danger" onclick="nacRemoveMacRow(this)">\xD7</button></td>
      </tr>`).join("");
  }
  function papRowsHtml(users) {
    if (!users.length) {
      return '<tr><td colspan="4" class="empty">Keine Benutzer \u2014 Access-Reject f\xFCr alle</td></tr>';
    }
    return users.map((u) => `
      <tr>
        <td><input class="search-input nac-pap-user" style="width:100%;box-sizing:border-box" value="${h(u.user)}"></td>
        <td><input class="search-input nac-pap-pass" type="password" style="width:100%;box-sizing:border-box" value="${h(u.pass)}" placeholder="Passwort" autocomplete="new-password"></td>
        <td style="width:72px"><input class="search-input nac-pap-vlan" type="number" min="1" max="4094" placeholder="VLAN" title="Optional: 1\u20134094 wenn dynamische VLANs aktiv" style="width:100%;box-sizing:border-box;font-size:12px" value="${u.vlan != null ? h(String(u.vlan)) : ""}"></td>
        <td style="width:44px"><button type="button" class="btn btn-sm btn-danger" onclick="nacRemovePapRow(this)">\xD7</button></td>
      </tr>`).join("");
  }
  function certRowsHtml(certs) {
    if (!certs.length) {
      return '<tr><td colspan="5" class="empty">Keine Dateien in data/nac-certs</td></tr>';
    }
    return certs.map((c) => {
      const sub = c.subject || c.kind || "\u2014";
      const until = c.validTo || "\u2014";
      const ondel = JSON.stringify(`nacDeleteCert(${JSON.stringify(c.name)})`);
      return `<tr>
      <td style="font-family:var(--mono);font-size:11px">${h(c.name)}</td>
      <td style="font-size:12px">${h(c.kind || "")}</td>
      <td style="font-size:11px;max-width:220px;overflow:hidden;text-overflow:ellipsis" title="${h(sub)}">${h(sub)}</td>
      <td style="font-size:11px">${h(until)}</td>
      <td><button type="button" class="btn btn-sm btn-danger" onclick=${ondel}>L\xF6schen</button></td>
    </tr>`;
    }).join("");
  }
  async function renderNac() {
    const root = q("nac-root");
    if (!root) return;
    let data;
    try {
      const r = await fetch("/api/nac");
      data = await parseFetchJson(r);
      if (!r.ok) throw new Error(data.error || "NAC-Daten konnten nicht geladen werden");
    } catch (e) {
      root.innerHTML = `<div class="status-bar error" style="margin-bottom:12px">${h(e.message)}</div>`;
      return;
    }
    state_default.nacMacAllowlistCache = Array.isArray(data.macAllowlist) ? data.macAllowlist.map((row) => ({ ...row })) : [];
    window.renderClients?.();
    let certs = [];
    try {
      const cr = await fetch("/api/nac/certs");
      const cj = await parseFetchJsonLenient(cr);
      if (cr.ok && cj.certs) certs = cj.certs;
    } catch (_) {
    }
    const macs = Array.isArray(data.macAllowlist) ? data.macAllowlist : [];
    const users = Array.isArray(data.radiusUsers) ? data.radiusUsers : [];
    const st = data.embeddedRadiusStatus || {};
    const mode = data.nacAuthMode || "mac_allowlist";
    const en = !!data.embeddedRadiusEnabled;
    const listenAuth = !!st.listeningAuth;
    const running = en && listenAuth;
    const detailBits = [
      st.listeningAuth ? `Auth UDP ${st.bind || "0.0.0.0"}:${st.authPort}` : "",
      st.listeningAcct ? `Acct ${st.acctPort}` : "",
      st.listeningCoa ? `CoA ${st.coaPort}` : "",
      st.lastError ? `Letzter Fehler: ${st.lastError}` : ""
    ].filter(Boolean);
    const embeddedStatusHtml = !en ? '<span style="color:var(--text3)">Aus</span> \u2014 RADIUS ist in der Konfiguration deaktiviert.' : running ? `<span style="color:#22c55e;font-weight:600">L\xE4uft</span>${detailBits.length ? ` \xB7 <span style="color:var(--text2);font-weight:400">${h(detailBits.join(" \xB7 "))}</span>` : ""}` : `<span style="color:var(--orange);font-weight:600">Aktiviert, aber nicht aktiv</span>${detailBits.length ? ` \xB7 <span style="color:var(--text2);font-weight:400">${h(detailBits.join(" \xB7 "))}</span>` : ""}`;
    const startDis = running;
    const stopDis = !en && !listenAuth;
    root.innerHTML = `
  <div style="max-width:960px;min-width:0;box-sizing:border-box">
    <p style="font-size:13px;color:var(--text2);line-height:1.55;margin:0 0 14px">
      <strong>NAC</strong>: OnSite kann einen <strong>eingebetteten RADIUS-Server</strong> (UDP) bereitstellen \u2014 typischerweise f\xFCr <strong>MAC-Authentifizierung (MAB)</strong> an Switches/APs oder f\xFCr Tests.
      <strong>EAP-TLS</strong> unterst\xFCtzt diese eingebettete Instanz <strong>nicht</strong> \u2014 daf\xFCr nutzen Sie z.\u202FB. <strong>FreeRADIUS</strong> (Men\xFC <em>Sicherheit \u2192 FreeRADIUS</em>), Windows <strong>NPS</strong> oder <strong>Cisco ISE</strong>. Die <strong>Zertifikatsablage</strong> unten hilft bei Verwaltung und \xDCberblick; sie ersetzt keinen EAP-TLS-f\xE4higen RADIUS-Server.
    </p>

    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:16px 18px;margin-bottom:14px;min-width:0;overflow-x:auto;box-sizing:border-box">
      <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Eingebetteter RADIUS-Server (OnSite)</div>
      <p style="font-size:12px;color:var(--text2);margin:0 0 10px">UDP-RADIUS auf diesem Host. <strong>Shared Secret</strong> und Ports legen Sie im folgenden Block fest \u2014 zum Starten muss ein Secret gesetzt sein (oder bereits gespeichert).</p>
      <div style="display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-bottom:12px;padding:10px 12px;background:var(--bg3);border-radius:var(--radius);border:1px solid var(--border)">
        <span style="font-size:12px;color:var(--text3)">Status:</span>
        <span id="nac-embedded-status-line">${embeddedStatusHtml}</span>
        <div style="flex:1;min-width:8px"></div>
        <button type="button" class="btn btn-sm" onclick="nacEmbeddedRadiusRefresh()">Aktualisieren</button>
        <button type="button" class="btn btn-sm btn-primary" onclick="nacEmbeddedRadiusStart()" ${startDis ? "disabled" : ""}>Start</button>
        <button type="button" class="btn btn-sm btn-danger" onclick="nacEmbeddedRadiusStop()" ${stopDis ? "disabled" : ""}>Stopp</button>
      </div>
      <p style="font-size:11px;color:var(--text3);margin:0">Nach <strong>Stopp</strong> werden keine Access-Requests mehr angenommen. <strong>Start</strong> \xFCbernimmt die aktuellen Werte aus dem Konfigurationsblock (Ports, MAC/PAP, Secret).</p>
    </div>

    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:16px 18px;margin-bottom:14px">
      <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">RADIUS- &amp; NAC-Konfiguration</div>
      <p style="font-size:12px;color:var(--text2);margin:0 0 10px">Bindung und Ports gelten f\xFCr diesen Host. <strong>Shared Secret</strong> muss identisch zur Konfiguration am NAS (Switch/AP) sein.</p>
      <input type="hidden" id="nac-embedded-enabled-state" value="${data.embeddedRadiusEnabled ? "true" : "false"}">
      <input type="hidden" id="nac-embedded-secret-was-set" value="${data.embeddedRadiusSecretSet ? "1" : "0"}">
      <div style="display:grid;grid-template-columns:1fr 88px 88px 88px 88px;gap:10px;align-items:end;margin-bottom:10px">
        <div>
          <label style="font-size:11px;color:var(--text3)">Listen-Adresse</label>
          <input class="search-input" id="nac-embedded-bind" style="width:100%;box-sizing:border-box" value="${h(data.embeddedRadiusBind || "0.0.0.0")}" placeholder="0.0.0.0">
        </div>
        <div>
          <label style="font-size:11px;color:var(--text3)">Auth-UDP</label>
          <input class="search-input" id="nac-embedded-auth-port" type="number" min="1" max="65535" value="${Number(data.embeddedAuthPort) || 1812}">
        </div>
        <div>
          <label style="font-size:11px;color:var(--text3)">Acct-UDP</label>
          <input class="search-input" id="nac-embedded-acct-port" type="number" min="1" max="65535" value="${Number(data.embeddedAcctPort) || 1813}">
        </div>
        <div>
          <label style="font-size:11px;color:var(--text3)">CoA</label>
          <input class="search-input" id="nac-embedded-coa-port" type="number" min="0" max="65535" title="0 = aus, oft 3799" value="${Number(data.embeddedCoaPort) || 0}">
        </div>
      </div>
      <p style="font-size:11px;color:var(--text3);margin:0 0 10px"><strong>CoA/Disconnect:</strong> Port <code style="font-size:10px">0</code> = aus. \xDCblich <strong>3799</strong> \u2014 muss <em>anders</em> als Auth- und Acct-Port sein. Eingehende <em>CoA-Request</em> / <em>Disconnect-Request</em> werden protokolliert und mit ACK beantwortet (keine Policy-\xC4nderung in OnSite).</p>
      <label style="display:flex;align-items:flex-start;gap:8px;margin-bottom:10px;font-size:13px;cursor:pointer;max-width:52em">
        <input type="checkbox" id="nac-embedded-vlan" ${data.embeddedVlanAssignmentEnabled ? "checked" : ""} style="margin-top:3px">
        <span><strong>Dynamische VLANs</strong> (802.1Q): Bei erfolgreicher Auth sendet OnSite im <strong>Access-Accept</strong> die RADIUS-Attribute <code style="font-size:11px">Tunnel-Type=VLAN</code>, <code style="font-size:11px">Tunnel-Medium-Type=IEEE-802</code> und <code style="font-size:11px">Tunnel-Private-Group-Id</code> mit der unten pro MAC bzw. pro PAP-Benutzer eingetragenen VLAN-ID (1\u20134094). Leer lassen = nur Accept ohne VLAN-Zuweisung. Der Switch/AP muss MAB/RADIUS-VLAN unterst\xFCtzen.</span>
      </label>
      <div style="margin-bottom:10px">
        <label style="font-size:11px;color:var(--text3)">Authentifizierungsmodus</label>
        <select class="search-input" id="nac-auth-mode" style="width:100%;max-width:420px" onchange="nacOnModeChange()">
          <option value="mac_allowlist" ${mode === "mac_allowlist" ? "selected" : ""}>Nur freigegebene MAC-Adressen (Calling-Station-Id / User-Name)</option>
          <option value="pap_users" ${mode === "pap_users" ? "selected" : ""}>Benutzer/Passwort (PAP, einfach \u2014 nur Tests/Lab)</option>
        </select>
      </div>
      <div style="margin-bottom:10px">
        <label style="font-size:11px;color:var(--text3)">Shared Secret ${data.embeddedRadiusSecretSet ? "(gesetzt)" : "(leer)"}</label>
        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">
          <input class="search-input" type="password" id="nac-embedded-secret" style="width:min(360px,100%);font-family:var(--mono)" placeholder="${data.embeddedRadiusSecretSet ? "Neues Secret eingeben zum \xC4ndern" : "Secret eingeben"}" autocomplete="new-password">
          <button type="button" class="btn btn-sm btn-ghost" onclick="nacClearEmbeddedSecret()">Secret entfernen</button>
        </div>
      </div>
      <div id="nac-mac-section" style="display:${mode === "mac_allowlist" ? "block" : "none"}">
        <div style="font-size:11px;font-weight:700;color:var(--text3);margin:12px 0 6px">Freigegebene MAC-Adressen</div>
        <div class="table-wrap" style="margin-bottom:8px">
          <table style="width:100%"><thead><tr><th>MAC</th><th>Bezeichnung</th><th style="width:80px">VLAN</th><th style="width:44px"></th></tr></thead>
          <tbody id="nac-mac-body">${macRowsHtml(macs)}</tbody></table>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px;align-items:center">
          <input class="search-input" id="nac-new-mac" style="width:200px;font-family:var(--mono);font-size:12px" placeholder="aa:bb:cc:dd:ee:ff" maxlength="17">
          <input class="search-input" id="nac-new-label" style="width:min(200px,100%)" placeholder="Bezeichnung" maxlength="120">
          <input class="search-input" id="nac-new-vlan" type="number" min="1" max="4094" style="width:88px" placeholder="VLAN" title="Optional">
          <button type="button" class="btn btn-sm" onclick="nacAddMacRow()">Hinzuf\xFCgen</button>
        </div>
      </div>
      <div id="nac-pap-section" style="display:${mode === "pap_users" ? "block" : "none"}">
        <div style="font-size:11px;font-weight:700;color:var(--text3);margin:12px 0 6px">PAP-Benutzer</div>
        <div class="table-wrap" style="margin-bottom:8px">
          <table style="width:100%"><thead><tr><th>Benutzername</th><th>Passwort</th><th style="width:80px">VLAN</th><th style="width:44px"></th></tr></thead>
          <tbody id="nac-pap-body">${papRowsHtml(users)}</tbody></table>
        </div>
        <button type="button" class="btn btn-sm" onclick="nacAddPapRow()">Benutzer hinzuf\xFCgen</button>
      </div>
      <button type="button" class="btn btn-sm btn-primary" onclick="saveNacConfig()" style="margin-top:12px">NAC speichern &amp; RADIUS neu starten</button>
    </div>

    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:16px 18px;margin-bottom:14px">
      <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">RADIUS-Protokoll (Accounting &amp; CoA)</div>
      <p style="font-size:12px;color:var(--text2);margin:0 0 10px">Append-only: <code style="font-size:11px">data/nac-radius-log.jsonl</code> \u2014 neuester Eintrag zuerst in der Tabelle.</p>
      <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">
        <button type="button" class="btn btn-sm" onclick="loadNacRadiusLog()">Aktualisieren</button>
        <button type="button" class="btn btn-sm btn-danger" onclick="clearNacRadiusLog()">Protokoll leeren</button>
      </div>
      <div class="table-wrap" style="max-height:340px;overflow:auto">
        <table style="width:100%;font-size:11px"><thead><tr><th>Zeit</th><th>Art</th><th>User / Session</th><th>Calling-Station</th><th>Status / Paket</th><th>NAS</th><th>Remote</th></tr></thead>
        <tbody id="nac-radius-log-body"><tr><td colspan="7" class="empty">Lade\u2026</td></tr></tbody></table>
      </div>
    </div>

    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:16px 18px;margin-bottom:14px">
      <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Zertifikate (PEM)</div>
      <p style="font-size:12px;color:var(--text2);margin:0 0 10px">Speicherort: <code style="font-size:11px">data/nac-certs</code>. F\xFCr <strong>EAP-TLS</strong> brauchen Sie in der Regel einen separaten RADIUS mit TLS \u2014 hier nur Ablage und \xDCbersicht (Laufzeit, Subject).</p>
      <div class="table-wrap" style="margin-bottom:12px">
        <table style="width:100%"><thead><tr><th>Datei</th><th>Typ</th><th>Subject</th><th>G\xFCltig bis</th><th></th></tr></thead>
        <tbody id="nac-cert-body">${certRowsHtml(certs)}</tbody></table>
      </div>
      <div style="display:grid;grid-template-columns:160px 1fr;gap:8px;margin-bottom:8px;align-items:start">
        <div>
          <label style="font-size:11px;color:var(--text3)">Dateiname</label>
          <input class="search-input" id="nac-cert-name" style="width:100%;box-sizing:border-box" placeholder="z.\u202FB. server.crt" maxlength="63">
        </div>
        <div>
          <label style="font-size:11px;color:var(--text3)">PEM-Inhalt</label>
          <textarea class="search-input" id="nac-cert-pem" rows="5" style="width:100%;box-sizing:border-box;font-family:var(--mono);font-size:11px" placeholder="-----BEGIN CERTIFICATE-----"></textarea>
        </div>
      </div>
      <button type="button" class="btn btn-sm" onclick="nacUploadCert()">Zertifikat / Key speichern</button>
    </div>

    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:16px 18px;min-width:0;overflow-x:auto;box-sizing:border-box">
      <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Externer RADIUS / Policy (Referenz)</div>
      <div style="display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr) minmax(0,1fr);gap:10px;margin-bottom:10px;align-items:end">
        <div style="min-width:0">
          <label style="display:block;font-size:11px;color:var(--text3);margin-bottom:4px;line-height:1.3">RADIUS-Host</label>
          <input class="search-input" id="nac-radius-host" style="width:100%;max-width:100%;box-sizing:border-box" value="${h(data.radiusHost || "")}">
        </div>
        <div style="min-width:0">
          <label style="display:block;font-size:11px;color:var(--text3);margin-bottom:4px;line-height:1.3">Auth-Port</label>
          <input class="search-input" id="nac-radius-auth" type="number" style="width:100%;max-width:100%;box-sizing:border-box" value="${Number(data.radiusAuthPort) || 1812}">
        </div>
        <div style="min-width:0">
          <label style="display:block;font-size:11px;color:var(--text3);margin-bottom:4px;line-height:1.3;word-break:break-word" title="Accounting-Port">Acct-Port</label>
          <input class="search-input" id="nac-radius-acct" type="number" style="width:100%;max-width:100%;box-sizing:border-box" value="${Number(data.radiusAcctPort) || 1813}">
        </div>
      </div>
      <div style="margin-bottom:10px">
        <label style="font-size:11px;color:var(--text3)">Policy-URL</label>
        <input class="search-input" id="nac-policy-url" style="width:100%;box-sizing:border-box" value="${h(data.policyUrl || "")}">
      </div>
      <div style="margin-bottom:10px">
        <label style="font-size:11px;color:var(--text3)">Notizen</label>
        <textarea class="search-input" id="nac-notes" rows="2" style="width:100%;box-sizing:border-box">${h(data.notes || "")}</textarea>
      </div>
      <button type="button" class="btn btn-sm btn-primary" onclick="saveNacConfig()">Speichern</button>
    </div>
  </div>`;
    loadNacRadiusLog();
  }
  async function loadNacRadiusLog() {
    const tb = q("nac-radius-log-body");
    if (!tb) return;
    tb.innerHTML = '<tr><td colspan="7" class="empty">Lade\u2026</td></tr>';
    try {
      const r = await fetch("/api/nac/radius-log?limit=400");
      const d = await parseFetchJson(r);
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      const rows = d.entries || [];
      if (!rows.length) {
        tb.innerHTML = '<tr><td colspan="7" class="empty">Keine Eintr\xE4ge</td></tr>';
        return;
      }
      tb.innerHTML = rows.map((e) => {
        const kind = e.kind === "coa" ? "CoA" : "Accounting";
        const detail = e.kind === "coa" ? String(e.packetCode || "") : String(e.acctStatusType ?? "");
        const userS = [e.userName, e.acctSessionId || e.sessionId].filter(Boolean).join(" \xB7 ") || "\u2014";
        const mac = e.callingStationId || "\u2014";
        const nas = e.nasIp || "\u2014";
        return `<tr>
        <td style="white-space:nowrap">${h(String(e.ts || "").slice(0, 24))}</td>
        <td>${h(kind)}</td>
        <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis" title="${h(userS)}">${h(userS)}</td>
        <td style="font-family:var(--mono);max-width:140px;overflow:hidden;text-overflow:ellipsis">${h(mac)}</td>
        <td>${h(detail)}</td>
        <td style="font-family:var(--mono);font-size:10px">${h(nas)}</td>
        <td style="font-family:var(--mono);font-size:10px">${h(e.remote || "")}</td>
      </tr>`;
      }).join("");
    } catch (err) {
      tb.innerHTML = `<tr><td colspan="7" class="empty">${h(err.message)}</td></tr>`;
    }
  }
  async function clearNacRadiusLog() {
    if (!confirm("RADIUS-Protokoll (JSONL) wirklich leeren?")) return;
    try {
      const r = await fetch("/api/nac/radius-log", { method: "DELETE" });
      const d = await parseFetchJson(r);
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      await loadNacRadiusLog();
    } catch (e) {
      alert(e.message || "Fehler");
    }
  }
  function nacOnModeChange() {
    const mode = q("nac-auth-mode")?.value || "mac_allowlist";
    const ms = q("nac-mac-section");
    const ps = q("nac-pap-section");
    if (ms) ms.style.display = mode === "mac_allowlist" ? "block" : "none";
    if (ps) ps.style.display = mode === "pap_users" ? "block" : "none";
  }
  function parseVlanField(el) {
    if (!el) return void 0;
    const s = String(el.value || "").trim();
    if (!s) return void 0;
    const n = parseInt(s, 10);
    if (Number.isNaN(n) || n < 1 || n > 4094) return void 0;
    return n;
  }
  function nacCollectMacs() {
    const tbody = q("nac-mac-body");
    if (!tbody) return [];
    const out = [];
    tbody.querySelectorAll("tr").forEach((tr) => {
      if (tr.querySelector("td.empty")) return;
      const mac = tr.querySelector(".nac-mac")?.value?.trim().toLowerCase();
      const label = tr.querySelector(".nac-label")?.value?.trim() || "";
      if (!mac) return;
      const vlan = parseVlanField(tr.querySelector(".nac-mac-vlan"));
      const row = { mac, label };
      if (vlan != null) row.vlan = vlan;
      out.push(row);
    });
    return out;
  }
  function nacCollectPap() {
    const tbody = q("nac-pap-body");
    if (!tbody) return [];
    const out = [];
    tbody.querySelectorAll("tr").forEach((tr) => {
      if (tr.querySelector("td.empty")) return;
      const user = tr.querySelector(".nac-pap-user")?.value?.trim() || "";
      const pass = tr.querySelector(".nac-pap-pass")?.value || "";
      if (!user) return;
      const vlan = parseVlanField(tr.querySelector(".nac-pap-vlan"));
      const row = { user, pass };
      if (vlan != null) row.vlan = vlan;
      out.push(row);
    });
    return out;
  }
  function nacAddMacRow() {
    const macIn = q("nac-new-mac");
    const labIn = q("nac-new-label");
    const mac = (macIn?.value || "").trim().toLowerCase();
    const label = (labIn?.value || "").trim().slice(0, 120);
    const macRe = /^([0-9a-f]{2}):([0-9a-f]{2}):([0-9a-f]{2}):([0-9a-f]{2}):([0-9a-f]{2}):([0-9a-f]{2})$/;
    if (!macRe.test(mac)) {
      alert("MAC im Format aa:bb:cc:dd:ee:ff");
      return;
    }
    const tbody = q("nac-mac-body");
    if (!tbody) return;
    const empty = tbody.querySelector("td.empty");
    if (empty) empty.closest("tr")?.remove();
    const vlanIn = q("nac-new-vlan");
    const vlan = parseVlanField(vlanIn);
    const vlanCell = vlan != null ? `<td style="width:72px"><input class="search-input nac-mac-vlan" type="number" min="1" max="4094" placeholder="VLAN" style="width:100%;box-sizing:border-box;font-size:12px" value="${vlan}"></td>` : `<td style="width:72px"><input class="search-input nac-mac-vlan" type="number" min="1" max="4094" placeholder="VLAN" style="width:100%;box-sizing:border-box;font-size:12px" value=""></td>`;
    tbody.insertAdjacentHTML("beforeend", `
    <tr>
      <td><input class="search-input nac-mac" style="width:100%;font-family:var(--mono);font-size:12px;box-sizing:border-box" value="${h(mac)}"></td>
      <td><input class="search-input nac-label" style="width:100%;box-sizing:border-box" value="${h(label)}"></td>
      ${vlanCell}
      <td><button type="button" class="btn btn-sm btn-danger" onclick="nacRemoveMacRow(this)">\xD7</button></td>
    </tr>`);
    if (macIn) macIn.value = "";
    if (labIn) labIn.value = "";
    if (vlanIn) vlanIn.value = "";
  }
  function nacRemoveMacRow(btn) {
    const tr = btn?.closest?.("tr");
    tr?.remove();
    const tbody = q("nac-mac-body");
    if (tbody && !tbody.querySelector(".nac-mac")) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty">Keine MACs</td></tr>';
    }
  }
  function nacAddPapRow() {
    const tbody = q("nac-pap-body");
    if (!tbody) return;
    const empty = tbody.querySelector("td.empty");
    if (empty) empty.closest("tr")?.remove();
    tbody.insertAdjacentHTML("beforeend", `
    <tr>
      <td><input class="search-input nac-pap-user" style="width:100%;box-sizing:border-box" value=""></td>
      <td><input class="search-input nac-pap-pass" type="password" style="width:100%;box-sizing:border-box" value="" autocomplete="new-password"></td>
      <td style="width:72px"><input class="search-input nac-pap-vlan" type="number" min="1" max="4094" placeholder="VLAN" style="width:100%;box-sizing:border-box;font-size:12px" value=""></td>
      <td><button type="button" class="btn btn-sm btn-danger" onclick="nacRemovePapRow(this)">\xD7</button></td>
    </tr>`);
  }
  function nacRemovePapRow(btn) {
    const tr = btn?.closest?.("tr");
    tr?.remove();
    const tbody = q("nac-pap-body");
    if (tbody && !tbody.querySelector(".nac-pap-user")) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty">Keine Benutzer</td></tr>';
    }
  }
  async function nacClearEmbeddedSecret() {
    if (!confirm("Shared Secret wirklich l\xF6schen? Der RADIUS-Server startet ohne Secret nicht.")) return;
    try {
      const r = await fetch("/api/nac", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ embeddedRadiusSecret: "" })
      });
      const d = await parseFetchJson(r);
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      await renderNac();
    } catch (e) {
      alert(e.message || "Fehler");
    }
  }
  async function nacUploadCert() {
    const name = q("nac-cert-name")?.value?.trim();
    const pem = q("nac-cert-pem")?.value?.trim();
    if (!name || !pem) {
      alert("Dateiname und PEM-Inhalt angeben");
      return;
    }
    try {
      const r = await fetch("/api/nac/cert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, pem })
      });
      const d = await parseFetchJson(r);
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      if (q("nac-cert-pem")) q("nac-cert-pem").value = "";
      await renderNac();
    } catch (e) {
      alert(e.message || "Upload fehlgeschlagen");
    }
  }
  async function nacDeleteCert(name) {
    if (!confirm(`Datei \u201E${name}\u201C l\xF6schen?`)) return;
    try {
      const r = await fetch(`/api/nac/cert/${encodeURIComponent(name)}`, { method: "DELETE" });
      const d = await parseFetchJson(r);
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      await renderNac();
    } catch (e) {
      alert(e.message || "L\xF6schen fehlgeschlagen");
    }
  }
  function collectNacConfigBody(overrides = {}) {
    const en = overrides.embeddedRadiusEnabled !== void 0 ? !!overrides.embeddedRadiusEnabled : q("nac-embedded-enabled-state")?.value === "true";
    const body = {
      radiusHost: q("nac-radius-host")?.value || "",
      radiusAuthPort: parseInt(q("nac-radius-auth")?.value, 10) || 1812,
      radiusAcctPort: parseInt(q("nac-radius-acct")?.value, 10) || 1813,
      policyUrl: q("nac-policy-url")?.value || "",
      notes: q("nac-notes")?.value || "",
      embeddedRadiusEnabled: en,
      embeddedRadiusBind: q("nac-embedded-bind")?.value || "0.0.0.0",
      embeddedAuthPort: parseInt(q("nac-embedded-auth-port")?.value, 10) || 1812,
      embeddedAcctPort: parseInt(q("nac-embedded-acct-port")?.value, 10) || 1813,
      embeddedCoaPort: Math.min(65535, Math.max(0, parseInt(q("nac-embedded-coa-port")?.value, 10) || 0)),
      embeddedVlanAssignmentEnabled: !!q("nac-embedded-vlan")?.checked,
      nacAuthMode: q("nac-auth-mode")?.value || "mac_allowlist",
      macAllowlist: nacCollectMacs(),
      radiusUsers: nacCollectPap()
    };
    const sec = q("nac-embedded-secret")?.value;
    if (sec && sec.trim()) body.embeddedRadiusSecret = sec.trim();
    return body;
  }
  async function nacEmbeddedRadiusRefresh() {
    await renderNac();
  }
  async function nacEmbeddedRadiusStart() {
    const typed = (q("nac-embedded-secret")?.value || "").trim();
    const wasSet = q("nac-embedded-secret-was-set")?.value === "1";
    if (!typed && !wasSet) {
      alert("Bitte zuerst ein Shared Secret im Konfigurationsblock setzen (und bei Bedarf \u201ENAC speichern\u201C).");
      return;
    }
    try {
      const r = await fetch("/api/nac", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(collectNacConfigBody({ embeddedRadiusEnabled: true }))
      });
      const d = await parseFetchJson(r);
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      await renderNac();
    } catch (e) {
      alert(e.message || "Start fehlgeschlagen");
    }
  }
  async function nacEmbeddedRadiusStop() {
    if (!confirm("Eingebetteten RADIUS-Server wirklich stoppen?")) return;
    try {
      const r = await fetch("/api/nac", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(collectNacConfigBody({ embeddedRadiusEnabled: false }))
      });
      const d = await parseFetchJson(r);
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      await renderNac();
    } catch (e) {
      alert(e.message || "Stopp fehlgeschlagen");
    }
  }
  async function saveNacConfig() {
    const st = q("nac-save-status");
    if (st) st.textContent = "Speichern\u2026";
    const body = collectNacConfigBody();
    try {
      const r = await fetch("/api/nac", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const d = await parseFetchJson(r);
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      if (st) st.textContent = "Gespeichert.";
      setTimeout(() => {
        if (st) st.textContent = "";
      }, 4e3);
      await renderNac();
    } catch (e) {
      if (st) st.textContent = "";
      alert(e.message || "Speichern fehlgeschlagen");
    }
  }

  // ui/tabs/freeradius.js
  function frDockerStatusLineHtml(d) {
    if (!d.available && d.error) {
      return `<span style="color:var(--orange)">${h(d.error)}</span>`;
    }
    if (d.running) {
      return `<span style="color:#22c55e;font-weight:600">L\xE4uft</span> <span style="font-size:11px;color:var(--text3)">(${h(d.status || "")})</span>`;
    }
    if (d.status === "not_found") {
      return '<span style="color:var(--text3)">Kein Container \u2014 Start legt ihn an</span>';
    }
    return `<span style="color:var(--text3)">Gestoppt</span> <span style="font-size:11px">(${h(d.status || "\u2014")})</span>`;
  }
  function frRowsHtml(clients) {
    if (!clients.length) {
      return '<tr><td colspan="4" class="empty">Keine Clients \u2014 mindestens einen Eintrag speichern</td></tr>';
    }
    return clients.map((c) => `
      <tr>
        <td><input class="search-input fr-client-name" style="width:100%;box-sizing:border-box" value="${h(c.name)}" placeholder="z.\u202FB. nas_core"></td>
        <td><input class="search-input fr-ipaddr" style="width:100%;font-family:var(--mono);font-size:12px;box-sizing:border-box" value="${h(c.ipaddr)}" placeholder="* oder 192.168.0.0/24"></td>
        <td><input class="search-input fr-secret" type="password" style="width:100%;box-sizing:border-box" value="${h(c.secret)}" autocomplete="new-password" placeholder="Shared Secret"></td>
        <td style="width:44px"><button type="button" class="btn btn-sm btn-danger" onclick="frRemoveClientRow(this)">\xD7</button></td>
      </tr>`).join("");
  }
  async function renderFreeRadius() {
    const root = q("freeradius-root");
    if (!root) return;
    let fr = { clients: [], notes: "" };
    try {
      const frRes = await fetch("/api/freeradius/config");
      const frJson = await frRes.json();
      if (frRes.ok && frJson.clients) fr = frJson;
    } catch (e) {
      root.innerHTML = `<div class="status-bar error" style="margin-bottom:12px">${h(e.message || "FreeRADIUS-Daten konnten nicht geladen werden")}</div>`;
      return;
    }
    let frDocker = { available: false, running: false };
    try {
      const dRes = await fetch("/api/freeradius/docker");
      const dJson = await dRes.json();
      if (dRes.ok) frDocker = dJson;
    } catch (_) {
    }
    const frStartDis = !frDocker.available || frDocker.running === true;
    const frStopDis = !frDocker.available || frDocker.status === "not_found";
    root.innerHTML = `
  <div style="max-width:960px;min-width:0;box-sizing:border-box">
    <p style="font-size:13px;color:var(--text2);line-height:1.55;margin:0 0 14px">
      <strong>FreeRADIUS</strong> im Docker-Container: NAS-<strong>clients</strong> (Shared Secret, erlaubte Quell-IP/CIDR). OnSite schreibt <code style="font-size:11px">docker/freeradius/clients.conf</code> und <code style="font-size:11px">data/freeradius.json</code>. Nach \xC4nderungen den Container <strong>neu starten</strong> oder unten <strong>Stopp</strong>/<strong>Start</strong> (siehe <code style="font-size:11px">docker/freeradius/README.md</code>).
    </p>

    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:16px 18px;margin-bottom:14px;min-width:0;overflow-x:auto;box-sizing:border-box">
      <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Container &amp; Docker Compose</div>
      <div style="display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-bottom:12px;padding:10px 12px;background:var(--bg3);border-radius:var(--radius);border:1px solid var(--border)">
        <span style="font-size:12px;color:var(--text3)">Container <code style="font-size:11px">onsite-freeradius</code>:</span>
        <span id="fr-docker-status-text">${frDockerStatusLineHtml(frDocker)}</span>
        <div style="flex:1;min-width:8px"></div>
        <button type="button" class="btn btn-sm" onclick="refreshFreeRadiusDockerStatus()">Aktualisieren</button>
        <button type="button" class="btn btn-sm btn-primary" onclick="freeRadiusDockerStart()" ${frStartDis ? "disabled" : ""}>Start</button>
        <button type="button" class="btn btn-sm btn-danger" onclick="freeRadiusDockerStop()" ${frStopDis ? "disabled" : ""}>Stopp</button>
      </div>

      <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">NAS-Clients</div>
      <p style="font-size:12px;color:var(--text2);margin:0 0 10px">Mindestens einen Client mit Secret und erlaubter Quelle speichern.</p>
      <div class="table-wrap" style="margin-bottom:8px">
        <table style="width:100%"><thead><tr><th>Name</th><th>IP / CIDR</th><th>Secret</th><th style="width:44px"></th></tr></thead>
        <tbody id="fr-clients-body">${frRowsHtml(Array.isArray(fr.clients) ? fr.clients : [])}</tbody></table>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;align-items:center">
        <button type="button" class="btn btn-sm" onclick="frAddClientRow()">Client hinzuf\xFCgen</button>
        <button type="button" class="btn btn-sm btn-primary" onclick="saveFreeRadiusConfig()">Speichern</button>
      </div>
      <label style="font-size:11px;color:var(--text3)">Notizen</label>
      <textarea class="search-input" id="fr-notes" rows="2" style="width:100%;box-sizing:border-box;margin-top:4px" placeholder="Optional">${h(fr.notes || "")}</textarea>
    </div>
  </div>`;
  }
  function frCollectClients() {
    const tbody = q("fr-clients-body");
    if (!tbody) return [];
    const out = [];
    tbody.querySelectorAll("tr").forEach((tr) => {
      if (tr.querySelector("td.empty")) return;
      const name = tr.querySelector(".fr-client-name")?.value?.trim() || "";
      const ipaddr = tr.querySelector(".fr-ipaddr")?.value?.trim() || "*";
      const secret = tr.querySelector(".fr-secret")?.value || "";
      if (!name) return;
      out.push({ name, ipaddr, secret });
    });
    return out;
  }
  function frAddClientRow() {
    const tbody = q("fr-clients-body");
    if (!tbody) return;
    const empty = tbody.querySelector("td.empty");
    if (empty) empty.closest("tr")?.remove();
    tbody.insertAdjacentHTML("beforeend", `
    <tr>
      <td><input class="search-input fr-client-name" style="width:100%;box-sizing:border-box" value=""></td>
      <td><input class="search-input fr-ipaddr" style="width:100%;font-family:var(--mono);font-size:12px;box-sizing:border-box" value="*" placeholder="* oder CIDR"></td>
      <td><input class="search-input fr-secret" type="password" style="width:100%;box-sizing:border-box" value="" autocomplete="new-password"></td>
      <td><button type="button" class="btn btn-sm btn-danger" onclick="frRemoveClientRow(this)">\xD7</button></td>
    </tr>`);
  }
  function frRemoveClientRow(btn) {
    const tr = btn?.closest?.("tr");
    tr?.remove();
    const tbody = q("fr-clients-body");
    if (tbody && !tbody.querySelector(".fr-client-name")) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty">Keine Clients</td></tr>';
    }
  }
  async function refreshFreeRadiusDockerStatus() {
    await renderFreeRadius();
  }
  async function freeRadiusDockerStart() {
    try {
      const r = await fetch("/api/freeradius/docker/start", { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Start fehlgeschlagen");
      await renderFreeRadius();
    } catch (e) {
      alert(e.message || "Start fehlgeschlagen");
    }
  }
  async function freeRadiusDockerStop() {
    try {
      const r = await fetch("/api/freeradius/docker/stop", { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Stopp fehlgeschlagen");
      await renderFreeRadius();
    } catch (e) {
      alert(e.message || "Stopp fehlgeschlagen");
    }
  }
  async function saveFreeRadiusConfig() {
    try {
      const r = await fetch("/api/freeradius/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clients: frCollectClients(),
          notes: q("fr-notes")?.value || ""
        })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      alert("Gespeichert. FreeRADIUS-Container neu starten, damit clients.conf wirksam wird (siehe docker/freeradius/README.md).");
      await renderFreeRadius();
    } catch (e) {
      alert(e.message || "Speichern fehlgeschlagen");
    }
  }

  // ui/main.js
  function setTopoLocFilter(v) {
    state_default.topoLocFilter = v;
    buildTopoFromStore();
  }
  window.S = state_default;
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
  window.topoZoom = topoZoom;
  window.topoFit = topoFit;
  window.toggleTopoMode = toggleTopoMode;
  window.toggleTraffic = toggleTraffic;
  window.setTopoLocFilter = setTopoLocFilter;
  window.searchTopoMac = searchTopoMac;
  window.clearTopoMacSearch = clearTopoMacSearch;
  window.topoBgDragStart = topoBgDragStart;
  window.topoMouseMove = topoMouseMove;
  window.topoMouseUp = topoMouseUp;
  window.topoWheel = topoWheel;
  window.topoSetRootFromDetail = topoSetRootFromDetail;
  window.topoCloseDetail = topoCloseDetail;
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
  window.bpNodeHover = bpNodeHover;
  window.bpNodeHoverEnd = bpNodeHoverEnd;
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
  window.matchesImportFilter = matchesImportFilter2;
  window.detectOsFromCriteria = detectOsFromCriteria;
  window.detectDeviceType = detectDeviceType;
  window.fetchGlobalVars = fetchGlobalVars;
  window.renderGlobalVarsList = renderGlobalVarsList;
  window.loadActivationTokens = loadActivationTokens;
  window.renderLicenseStatus = renderLicenseStatus;
  window.h = h;
  window.q = q;
  (async function init() {
    initTheme();
    initMenuGroups();
    initSyslogAutoRefreshUi();
    initTrapsAutoRefreshUi();
    initRoamingSyslogAutoRefreshUi();
    fetch("/api/version").then((r) => r.json()).then((d) => {
      const el = q("version-tag");
      if (el) el.textContent = d.version;
    }).catch(() => {
    });
    fetch("/api/license").then((r) => r.json()).then(renderLicenseStatus).catch(() => {
    });
    await loadSettings();
    registerAutoSyncHandlers(checkAllDeviceStatus);
    await loadCriteria();
    await loadVlans();
    await loadDevices();
    await fetchGlobalVars();
    fetchUptimeStats();
    showTab("dashboard");
    const savedToken = localStorage.getItem("lmc_token");
    if (savedToken) {
      const el = q("lmc-token");
      if (el) {
        el.value = savedToken;
      }
      const cb = q("lmc-save-token");
      if (cb) cb.checked = true;
    }
    const p = new URLSearchParams(location.search);
    if (p.get("host")) openDeviceDetail(p.get("host"));
  })();
})();
