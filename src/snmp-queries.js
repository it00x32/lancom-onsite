const { runSnmpWalk, runSnmpGet, runSnmpSet, snmpVal, macFromDecOid, macFromHexStr, decodeOidStr, encodeOidStr } = require('./snmp-session');

// Parses Q-Bridge bitmap: each bit = one bridge port (bit 7 of byte 0 = port 1)
function parseBitmapPorts(hexStr) {
  const ports = new Set();
  const bytes = String(hexStr).trim().split(/\s+/);
  bytes.forEach((h, byteIdx) => {
    const byte = parseInt(h, 16);
    if (isNaN(byte)) return;
    for (let bit = 7; bit >= 0; bit--) {
      if (byte & (1 << bit)) ports.add(byteIdx * 8 + (8 - bit));
    }
  });
  return ports;
}

// ── System Info (MIB-II System Group) ────────────────────────────────────────

async function snmpSystem(host, community, version) {
  const out = await runSnmpWalk(host, community, version, '1.3.6.1.2.1.1');
  const result = {};
  out.split('\n').forEach(line => {
    const m = line.match(/\.1\.3\.6\.1\.2\.1\.1\.(\d+)\.0\s*=\s*(.*)/);
    if (!m) return;
    const val = snmpVal(m[2]);
    switch (m[1]) {
      case '1': result.sysDescr    = val; break;
      case '3': result.sysUpTime   = val; break;  // Timeticks raw string
      case '4': result.sysContact  = val; break;
      case '5': result.sysName     = val; break;
      case '6': result.sysLocation = val; break;
    }
  });
  return result;
}

// ── Interfaces (IF-MIB) ───────────────────────────────────────────────────────

async function snmpInterfaces(host, community, version) {
  const [ifOut, ifxOut] = await Promise.all([
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.2.2.1'),   // ifTable
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.31.1.1.1'),// ifXTable
  ]);

  const ifaces = {};

  // ifTable
  ifOut.split('\n').forEach(line => {
    const m = line.match(/\.2\.2\.1\.(\d+)\.(\d+)\s*=\s*(.*)/);
    if (!m) return;
    const [col, idx, rawVal] = [parseInt(m[1]), m[2], m[3]];
    if (!ifaces[idx]) ifaces[idx] = { idx };
    const val = snmpVal(rawVal);
    switch (col) {
      case 2:  ifaces[idx].descr       = val; break;
      case 5:  ifaces[idx].speed       = parseInt(val) || 0; break;
      case 7:  ifaces[idx].adminStatus = val; break;  // up(1), down(2)
      case 8:  ifaces[idx].operStatus  = val; break;  // up(1), down(2)
      case 10: ifaces[idx].inOctets    = parseInt(val) || 0; break;
      case 16: ifaces[idx].outOctets   = parseInt(val) || 0; break;
    }
  });

  // ifXTable (Namen + 64-bit Counters + HighSpeed)
  ifxOut.split('\n').forEach(line => {
    const m = line.match(/\.31\.1\.1\.1\.(\d+)\.(\d+)\s*=\s*(.*)/);
    if (!m) return;
    const [col, idx, rawVal] = [parseInt(m[1]), m[2], m[3]];
    if (!ifaces[idx]) ifaces[idx] = { idx };
    const val = snmpVal(rawVal);
    switch (col) {
      case 1:  ifaces[idx].name = val; break;
      case 6: {
        const n = parseInt(val) || 0;
        if (n) { ifaces[idx].inOctets = n; ifaces[idx].is64 = true; }
        break;
      }
      case 10: {
        const n = parseInt(val) || 0;
        if (n) { ifaces[idx].outOctets = n; ifaces[idx].is64 = true; }
        break;
      }
      case 15: ifaces[idx].highSpeed = parseInt(val) || 0; break;
    }
  });

  return Object.values(ifaces)
    .filter(i => i.descr || i.name)
    .sort((a, b) => parseInt(a.idx) - parseInt(b.idx));
}

// ── MAC / ARP Tabelle ─────────────────────────────────────────────────────────

async function snmpMac(host, community, version) {
  const [fdbOut, qfdbOut, bpOut, ifNameOut, arpOut] = await Promise.all([
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.17.4.3.1.2'),    // dot1dTpFdbPort
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.17.7.1.2.2.1.2'),// dot1qTpFdbPort
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.17.1.4.1.2'),    // dot1dBasePortIfIndex
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.31.1.1.1.1'),    // ifName
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.4.22.1.2'),      // ARP ip→mac
  ]);

  const macToBp = {};
  fdbOut.split('\n').forEach(line => {
    const m = line.match(/17\.4\.3\.1\.2\.([\d.]+)\s*=\s*INTEGER:\s*(\d+)/);
    if (m) { const mac = macFromDecOid(m[1]); if (mac) macToBp[mac] = parseInt(m[2]); }
  });
  if (Object.keys(macToBp).length === 0) {
    qfdbOut.split('\n').forEach(line => {
      const m = line.match(/17\.7\.1\.2\.2\.1\.2\.\d+\.([\d.]+)\s*=\s*INTEGER:\s*(\d+)/);
      if (m) { const mac = macFromDecOid(m[1]); if (mac && !macToBp[mac]) macToBp[mac] = parseInt(m[2]); }
    });
  }

  const bpToIf = {};
  bpOut.split('\n').forEach(line => {
    const m = line.match(/17\.1\.4\.1\.2\.(\d+)\s*=\s*INTEGER:\s*(\d+)/);
    if (m) bpToIf[m[1]] = m[2];
  });

  const ifNames = {};
  ifNameOut.split('\n').forEach(line => {
    const m = line.match(/31\.1\.1\.1\.1\.(\d+)\s*=\s*(?:STRING:\s*)?"?([^"\n]+?)"?\s*$/);
    if (m) ifNames[m[1]] = m[2].trim();
  });

  const macToIp = {};
  arpOut.split('\n').forEach(line => {
    const m = line.match(/4\.22\.1\.2\.\d+\.([\d.]+)\s*=\s*(?:Hex-STRING:\s*)?([\dA-Fa-f ]+)\s*$/);
    if (m && m[1].split('.').length === 4) {
      const mac = macFromHexStr(m[2].trim());
      if (mac) macToIp[mac] = m[1];
    }
  });

  const entries = Object.entries(macToBp).map(([mac, bp]) => {
    const ifIdx = bpToIf[String(bp)];
    const port  = ifIdx ? (ifNames[ifIdx] || `Port ${bp}`) : `Port ${bp}`;
    return { mac, port, ip: macToIp[mac] || '' };
  });
  entries.sort((a, b) => a.port.localeCompare(b.port, undefined, { numeric: true }));

  // Fallback: WLAN-Clients (LCOS LX) aus erweiterter Client-Tabelle
  if (entries.length === 0) {
    const [clientOut, extOut, arpOut2] = await Promise.all([
      runSnmpWalk(host, community, version, '1.3.6.1.4.1.2356.13.1.3.4.1.1'),  // Kanal
      runSnmpWalk(host, community, version, '1.3.6.1.4.1.2356.13.1.3.32.1'),   // SSID, Band, etc.
      runSnmpWalk(host, community, version, '1.3.6.1.2.1.4.22.1.2'),
    ]);
    const macToIp2 = {};
    arpOut2.split('\n').forEach(line => {
      const m = line.match(/4\.22\.1\.2\.\d+\.([\d.]+)\s*=\s*(?:Hex-STRING:\s*)?([\dA-Fa-f ]+)\s*$/);
      if (m && m[1].split('.').length === 4) {
        const mac = macFromHexStr(m[2].trim()); if (mac) macToIp2[mac] = m[1];
      }
    });
    const wlanClients = {};
    extOut.split('\n').forEach(line => {
      const m = line.match(/2356\.13\.1\.3\.32\.1\.(\d+)\.([\d.]+)\s*=\s*(.*)/);
      if (!m) return;
      const col = parseInt(m[1]), mac = macFromDecOid(m[2]);
      if (!mac) return;
      if (!wlanClients[mac]) wlanClients[mac] = { mac };
      const raw = m[3].trim();
      const str = raw.includes('STRING:') ? raw.replace(/^.*STRING:\s*"?/, '').replace(/"?\s*$/, '').trim() : '';
      const num = (raw.match(/-?\d+/) || [])[0];
      if (col === 2 && num) wlanClients[mac].band = num;
      if (col === 3 && str) wlanClients[mac].ssid = str;
    });
    clientOut.split('\n').forEach(line => {
      const m = line.match(/2356\.13\.1\.3\.4\.1\.1\.(\d+)\.([\d.]+)\s*=\s*(.*)/);
      if (!m) return;
      const col = parseInt(m[1]), mac = macFromDecOid(m[2]);
      if (!mac) return;
      if (!wlanClients[mac]) wlanClients[mac] = { mac };
      const n = (m[3].match(/(\d+)/) || [])[1];
      if (col === 2 && n) wlanClients[mac].channel = n;
    });
    Object.values(wlanClients).forEach(c => {
      const ssid = c.ssid || '';
      let port = ssid ? `WLAN: ${ssid}` : 'WLAN';
      if (c.band)    port += c.band === '1' ? ' (2.4G)' : c.band === '2' ? ' (5G)' : c.band === '3' ? ' (6G)' : '';
      if (c.channel) port += ` CH${c.channel}`;
      entries.push({ mac: c.mac, port, ip: macToIp2[c.mac] || '' });
    });
  }

  return { entries, count: entries.length };
}

// ── LLDP Nachbarn ─────────────────────────────────────────────────────────────

async function snmpLldp(host, community, version) {
  // LANCOM LCOS verwendet den IEEE-Pfad (1.0.8802.1.1.2), nicht den IANA-Pfad (1.3.6.1.2.1.111).
  // Beide OIDs werden parallel abgefragt; der erste mit Daten gewinnt.
  const [outIeee, outIana] = await Promise.all([
    runSnmpWalk(host, community, version, '1.0.8802.1.1.2.1.4.1.1'),
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.111.1.4.1.1'),
  ]);
  const out = outIeee.trim() ? outIeee : outIana;
  const useIeee = !!outIeee.trim();

  const neighbors = {};

  out.split('\n').forEach(line => {
    // IEEE OID: .1.0.8802.1.1.2.1.4.1.1.{col}.{timeMark}.{localPortNum}.{remIndex}
    // IANA OID: .1.3.6.1.2.1.111.1.4.1.1.{col}.{timeMark}.{localPortNum}.{remIndex}
    const m = line.match(/(?:8802\.1\.1\.2\.1\.4\.1\.1|111\.1\.4\.1\.1)\.(\d+)\.(\d+)\.(\d+)\.(\d+)\s*=\s*(.*)/);
    if (!m) return;
    const col = parseInt(m[1]);
    const key = `${m[3]}_${m[4]}`; // localPort_remIndex
    if (!neighbors[key]) neighbors[key] = { localPort: m[3] };
    const val = snmpVal(m[5]);
    switch (col) {
      case 4:  neighbors[key].remChassisSubtype = parseInt(val) || 0; break;
      case 5:  neighbors[key].remChassisIdRaw   = m[5].trim(); break; // raw for MAC parsing
      case 6:  neighbors[key].remPortIdSubtype  = parseInt(val) || 0; break;
      case 7:  neighbors[key].remPortId   = val; break;
      case 8:  neighbors[key].remPortDesc = val; break;
      case 9:  neighbors[key].remSysName  = val; break;
      case 10: neighbors[key].remSysDesc  = val; break;
      case 12: neighbors[key].remCaps     = val; break;
    }
  });

  // Lokale Port-Namen per ifName + LLDP Port-ID + Port-ID-Subtyp
  const lldpPortOid     = useIeee ? '1.0.8802.1.1.2.1.3.7.1.3' : '1.3.6.1.2.1.111.1.3.7.1.3';
  const lldpSubtypeOid  = useIeee ? '1.0.8802.1.1.2.1.3.7.1.2' : '1.3.6.1.2.1.111.1.3.7.1.2';
  const lldpCfgOid = useIeee ? '1.0.8802.1.1.2.1.1.6.1.1' : '1.3.6.1.2.1.111.1.1.6.1.1';
  const [ifNameOut, lldpPortOut, lldpSubtypeOut, lldpCfgOut] = await Promise.all([
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.31.1.1.1.1'),
    runSnmpWalk(host, community, version, lldpPortOid),
    runSnmpWalk(host, community, version, lldpSubtypeOid),
    runSnmpWalk(host, community, version, lldpCfgOid),
  ]);
  const lldpPortNames = {};
  lldpPortOut.split('\n').forEach(line => {
    const m = line.match(/(?:8802\.1\.1\.2\.1\.3\.7\.1\.3|111\.1\.3\.7\.1\.3)\.(\d+)\s*=\s*(.*)/);
    if (m) lldpPortNames[m[1]] = snmpVal(m[2]);
  });
  // lldpLocPortIdSubtype: 3=macAddress, 4=networkAddress → nicht als Port-Name brauchbar
  const lldpPortSubtypes = {};
  lldpSubtypeOut.split('\n').forEach(line => {
    const m = line.match(/(?:8802\.1\.1\.2\.1\.3\.7\.1\.2|111\.1\.3\.7\.1\.2)\.(\d+)\s*=\s*(.*)/);
    if (m) lldpPortSubtypes[m[1]] = parseInt(snmpVal(m[2])) || 0;
  });
  const ifNames = {};
  ifNameOut.split('\n').forEach(line => {
    const m = line.match(/31\.1\.1\.1\.1\.(\d+)\s*=\s*(?:STRING:\s*)?"?([^"\n]+?)"?\s*$/);
    if (m) ifNames[m[1]] = m[2].trim();
  });

  const entries = Object.values(neighbors).map(n => {
    // Chassis-ID als MAC extrahieren: Subtype 4 = macAddress (IEEE-Standard), 6 = interfaceName (LANCOM)
    let remMac = null;
    if (n.remChassisSubtype === 4 || n.remChassisSubtype === 6) {
      const hx = (n.remChassisIdRaw||'').match(/Hex-STRING:\s*([\da-fA-F ]+)/i);
      if (hx) remMac = macFromHexStr(hx[1].trim());
      // LCOS SX 4/5: chassis ID als STRING "00-A0-57-7E-04-45"
      if (!remMac) {
        const sm = (n.remChassisIdRaw||'').match(/STRING:\s*"?([0-9A-Fa-f]{2}[:\-][0-9A-Fa-f]{2}[:\-][0-9A-Fa-f]{2}[:\-][0-9A-Fa-f]{2}[:\-][0-9A-Fa-f]{2}[:\-][0-9A-Fa-f]{2})"?/i);
        if (sm) remMac = macFromHexStr(sm[1]);
      }
    }
    // Chassis-ID als IP extrahieren wenn Subtype=5 (networkAddress)
    let remChassisIp = null;
    if (n.remChassisSubtype === 5) {
      const ip4 = (n.remChassisIdRaw||'').match(/Hex-STRING:\s*01\s*((?:[\da-fA-F]{2}\s*){4})/i);
      if (ip4) remChassisIp = ip4[1].trim().split(/\s+/).map(b => parseInt(b,16)).join('.');
    }
    // Port-ID als MAC extrahieren wenn remPortIdSubtype = 3 (macAddress)
    // → manche Geräte (z.B. LCOS SX 5) senden MAC als Port-ID statt als Chassis-ID
    let remPortMac = null;
    if (n.remPortIdSubtype === 3) {
      const hx = (n.remPortId||'').match(/^((?:[\da-fA-F]{2}\s*){6})$/i)
              || (n.remPortId||'').match(/^((?:[\da-fA-F]{2}[:\- ]?){6})$/i);
      if (hx) remPortMac = macFromHexStr(hx[1].trim());
      if (!remPortMac) remPortMac = macFromHexStr(n.remPortId||'');
    }
    // Port-Name: bei Subtyp 3 (macAddress) oder 4 (networkAddress) ist die LLDP-Port-ID
    // eine MAC/IP-Adresse → stattdessen ifName verwenden
    const portSubtype = lldpPortSubtypes[n.localPort] || 0;
    const portIdUsable = portSubtype !== 3 && portSubtype !== 4;
    const localPortName = (portIdUsable && lldpPortNames[n.localPort])
      ? lldpPortNames[n.localPort]
      : ifNames[n.localPort] || `Port ${n.localPort}`;
    return { ...n, remMac, remPortMac, remChassisIp, localPortName };
  });
  entries.sort((a, b) => (a.localPortName || '').localeCompare(b.localPortName || '', undefined, { numeric: true }));

  // Port-Konfiguration (lldpPortConfigAdminStatus): 1=txOnly 2=rxOnly 3=txAndRx 4=disabled
  const portConfig = [];
  lldpCfgOut.split('\n').forEach(line => {
    const m = line.match(/(?:8802\.1\.1\.2\.1\.1\.6\.1\.1|111\.1\.1\.6\.1\.1)\.(\d+)\s*=\s*INTEGER:\s*(\d+)/);
    if (!m) return;
    const idx = m[1];
    portConfig.push({
      portIndex:   parseInt(idx),
      portName:    ifNames[idx] || lldpPortNames[idx] || `Port ${idx}`,
      adminStatus: parseInt(m[2]),
      cfgOid:      `${lldpCfgOid}.${idx}`,
    });
  });
  portConfig.sort((a, b) => a.portName.localeCompare(b.portName, undefined, { numeric: true }));

  return { entries, count: entries.length, portConfig, useIeee };
}

// ── WiFi Mesh / WDS (LCOS LX) ────────────────────────────────────────────────

// lcosLXSetupWLANWDSLinks config (1.3.6.1.4.1.2356.13.2.20.13.1)
function parseWdsConfig(raw) {
  const links = {};
  raw.split('\n').forEach(line => {
    const m = line.match(/2356\.13\.2\.20\.13\.1\.1\.(\d+)\.([\d.]+)\s*=\s*(.*)/)
           || line.match(/2356\.13\.2\.20\.13\.1\.(\d+)\.([\d.]+)\s*=\s*(.*)/);
    if (!m) return;
    const col = parseInt(m[1], 10);
    const [linkName] = decodeOidStr(m[2].split('.'), 0);
    if (!linkName) return;
    if (!links[linkName]) links[linkName] = { linkName };
    const val = m[3].trim().replace(/^(STRING|INTEGER):\s*/, '').replace(/^"(.*)"$/, '$1');
    if (col === 2) links[linkName].ssid   = val;
    if (col === 3) links[linkName].remote = parseInt(val, 10) === 1; // 1 = STA/remote side
    if (col === 4) links[linkName].radio  = parseInt(val, 10) || 0;
  });
  return links;
}

// lcosLXStatusWLANWDSLinks status (1.3.6.1.4.1.2356.13.1.3.101.1)
function parseWdsStatus(raw) {
  const entries = {};
  raw.split('\n').forEach(line => {
    const m = line.match(/2356\.13\.1\.3\.101\.1\.1\.(\d+)\.([\d.]+)\s*=\s*(.*)/)
           || line.match(/2356\.13\.1\.3\.101\.1\.(\d+)\.([\d.]+)\s*=\s*(.*)/);
    if (!m) return;
    const col = parseInt(m[1], 10);
    const idxParts = m[2].split('.');
    const [linkName, off2] = decodeOidStr(idxParts, 0);
    const [macRaw]         = decodeOidStr(idxParts, off2);
    const mac = macRaw.length === 6
      ? Array.from(macRaw).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join(':')
      : macRaw;
    const key = `${linkName}|${mac}`;
    if (!entries[key]) entries[key] = { linkName, mac };
    const rawVal = m[3].trim();
    const n = parseInt((rawVal.match(/:\s*(\d+)/) || rawVal.match(/(\d+)/) || [])[1], 10);
    if (col === 3)  entries[key].connected  = n === 1;
    if (col === 4)  entries[key].radio      = n;
    if (col === 5)  entries[key].signal     = n;
    if (col === 7)  entries[key].txRate     = n;
    if (col === 8)  entries[key].rxRate     = n;
    if (col === 13) entries[key].wpaVersion = n;
  });
  return Object.values(entries);
}

async function snmpWds(host, community, version) {
  const cfgRaw    = await runSnmpWalk(host, community, version, '1.3.6.1.4.1.2356.13.2.20.13.1');
  const configMap = parseWdsConfig(cfgRaw);
  if (!Object.keys(configMap).length) return { configured: false, links: [] };
  const staRaw        = await runSnmpWalk(host, community, version, '1.3.6.1.4.1.2356.13.1.3.101.1');
  const statusEntries = parseWdsStatus(staRaw);
  return { configured: true, configLinks: Object.values(configMap), statusEntries };
}

// ── L2TPv3 (LCOS LX) ─────────────────────────────────────────────────────────

// lcosLXSetupL2TPEndpoints config (1.3.6.1.4.1.2356.13.2.61.1)
function parseL2tpConfig(raw) {
  const endpoints = {};
  raw.split('\n').forEach(line => {
    const m = line.match(/2356\.13\.2\.61\.1\.1\.(\d+)\.([\d.]+)\s*=\s*(.*)/);
    if (!m) return;
    const col    = parseInt(m[1], 10);
    const [name] = decodeOidStr(m[2].split('.'), 0);
    if (!name) return;
    if (!endpoints[name]) endpoints[name] = { name };
    const val = snmpVal(m[3]);
    if (col === 2) endpoints[name].remoteIp  = val;
    if (col === 3) endpoints[name].port      = parseInt(val, 10) || 0;
    if (col === 4) endpoints[name].hostname  = val;
    if (col === 8) endpoints[name].operating = parseInt(val, 10);
  });
  return endpoints;
}

// lcosLXStatusL2TPEthernet status (1.3.6.1.4.1.2356.13.1.61.2)
function parseL2tpStatus(raw) {
  const entries = {};
  raw.split('\n').forEach(line => {
    const m = line.match(/2356\.13\.1\.61\.2\.1\.(\d+)\.([\d.]+)\s*=\s*(.*)/);
    if (!m) return;
    const col               = parseInt(m[1], 10);
    const idxParts          = m[2].split('.');
    const [remoteEnd, off2] = decodeOidStr(idxParts, 0);
    const [endpointName]    = decodeOidStr(idxParts, off2);
    const key = `${remoteEnd}|${endpointName}`;
    if (!entries[key]) entries[key] = { remoteEnd, endpointName };
    const val = snmpVal(m[3]);
    if (col === 3) entries[key].state         = val;
    if (col === 4) entries[key].iface         = val;
    if (col === 5) entries[key].bridgeAddr    = val;
    if (col === 7) entries[key].connStartTime = val;
  });
  return Object.values(entries);
}

async function snmpL2tp(host, community, version) {
  const cfgRaw    = await runSnmpWalk(host, community, version, '1.3.6.1.4.1.2356.13.2.61.1');
  const configMap = parseL2tpConfig(cfgRaw);
  if (!Object.keys(configMap).length) return { configured: false };
  const staRaw        = await runSnmpWalk(host, community, version, '1.3.6.1.4.1.2356.13.1.61.2');
  const statusEntries = parseL2tpStatus(staRaw);
  return { configured: true, configEndpoints: Object.values(configMap), statusEntries };
}

// ── WLAN Clients (LCOS LX) ────────────────────────────────────────────────────

async function snmpWlan(host, community, version) {
  const [clientOut, extOut, arpOut, radioBandOut, radioChanOut, radioNoiseOut, radioUtilOut] = await Promise.all([
    runSnmpWalk(host, community, version, '1.3.6.1.4.1.2356.13.1.3.4.1.1'),  // Kanal (col 2)
    runSnmpWalk(host, community, version, '1.3.6.1.4.1.2356.13.1.3.32.1'),   // Erweiterte Client-Infos
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.4.22.1.2'),           // ARP
    runSnmpWalk(host, community, version, '1.3.6.1.4.1.2356.13.1.3.57.1.2'), // Radio-Band (1=2.4G,2=5G,3=6G)
    runSnmpWalk(host, community, version, '1.3.6.1.4.1.2356.13.1.3.57.1.3'), // Radio-Kanal
    runSnmpWalk(host, community, version, '1.3.6.1.4.1.2356.13.1.3.57.1.4'), // Noise Floor (dBm)
    runSnmpWalk(host, community, version, '1.3.6.1.4.1.2356.13.1.3.57.1.6'), // Kanalauslastung (%)
  ]);

  const macToIp = {};
  arpOut.split('\n').forEach(line => {
    const m = line.match(/4\.22\.1\.2\.\d+\.([\d.]+)\s*=\s*(?:Hex-STRING:\s*)?([\dA-Fa-f ]+)\s*$/);
    if (m && m[1].split('.').length === 4) {
      const mac = macFromHexStr(m[2].trim()); if (mac) macToIp[mac] = m[1];
    }
  });

  const clients = {};

  // Erweiterte Client-Tabelle (.32.1): SSID (col 3), Band (col 2),
  // Kanalbreite (col 66), Hostname (col 80), RSSI dBm (col 97)
  extOut.split('\n').forEach(line => {
    const m = line.match(/2356\.13\.1\.3\.32\.1\.(\d+)\.([\d.]+)\s*=\s*(.*)/);
    if (!m) return;
    const col = parseInt(m[1]), mac = macFromDecOid(m[2]);
    if (!mac) return;
    if (!clients[mac]) clients[mac] = { mac };
    const raw = m[3].trim();
    const str = raw.includes('STRING:')
      ? raw.replace(/^.*STRING:\s*"?/, '').replace(/"?\s*$/, '').trim()
      : '';
    const num = (raw.match(/-?\d+/) || [])[0];
    if (col === 2  && num) clients[mac].band     = num;  // 1=2.4G, 2=5G, 3=6G
    if (col === 26 && num) clients[mac].snr      = num;  // SNR in dB (Gauge32, positiv)
    if (col === 66 && str) clients[mac].chanWidth = str;
    if (col === 80 && str) clients[mac].hostname  = str;
    if (col === 97 && num) clients[mac].signal   = num;  // RSSI dBm (INTEGER, negativ)
    if (col === 99 && str) clients[mac].ssid     = str;  // SSID-Name (col 99, nicht col 3)
  });

  // Basis-Client-Tabelle (.4.1.1): u. a. Sp. 2 — oft kein zuverlässiger RF-Kanal; Kanal kommt unten aus .57
  clientOut.split('\n').forEach(line => {
    const m = line.match(/2356\.13\.1\.3\.4\.1\.1\.(\d+)\.([\d.]+)\s*=\s*(.*)/);
    if (!m) return;
    const col = parseInt(m[1]), mac = macFromDecOid(m[2]);
    if (!mac) return;
    if (!clients[mac]) clients[mac] = { mac };
    const n = (m[3].match(/(\d+)/) || [])[1];
    if (col === 2 && n) clients[mac].channel = n;
  });

  // Radio-Tabelle (.57): col 2 = Band, col 3 = Kanal — maßgeblich für Client Explorer / WiFi-Analyse
  const radioByIface = {};
  radioBandOut.split('\n').forEach(line => {
    const m = line.match(/13\.1\.3\.57\.1\.2\.([\d.]+)\s*=\s*(?:INTEGER|Gauge32|Counter32|Unsigned32):\s*(\d+)/i);
    if (!m) return;
    const bandNum = m[2];
    const band = lcsBandFromEnum(bandNum);
    if (!band) return;
    if (!radioByIface[m[1]]) radioByIface[m[1]] = {};
    radioByIface[m[1]].band = band;
  });
  radioChanOut.split('\n').forEach(line => {
    const m = line.match(/13\.1\.3\.57\.1\.3\.([\d.]+)\s*=\s*(?:Gauge32|INTEGER|Counter32|Unsigned32):\s*(\d+)/i);
    if (!m) return;
    if (!radioByIface[m[1]]) radioByIface[m[1]] = {};
    radioByIface[m[1]].channel = parseInt(m[2], 10);
  });
  radioNoiseOut.split('\n').forEach(line => {
    const m = line.match(/13\.1\.3\.57\.1\.4\.([\d.]+)\s*=\s*INTEGER:\s*(-?\d+)/);
    if (!m) return;
    if (!radioByIface[m[1]]) radioByIface[m[1]] = {};
    radioByIface[m[1]].noise = parseInt(m[2], 10);
  });
  radioUtilOut.split('\n').forEach(line => {
    const m = line.match(/13\.1\.3\.57\.1\.6\.([\d.]+)\s*=\s*(?:Gauge32|INTEGER):\s*(\d+)/);
    if (!m) return;
    if (!radioByIface[m[1]]) radioByIface[m[1]] = {};
    radioByIface[m[1]].utilization = parseInt(m[2], 10);
  });

  /** Kanal nur aus Radio-Tabelle (.57); Wert aus .4.1.1 oft kein echter Funkkanal (z. B. „7“ obwohl AP auf 1/6/11) */
  function pickChannelFromRadios(c, bandLabel) {
    const radios = Object.values(radioByIface).filter(r =>
      r.band === bandLabel && r.channel != null && !isNaN(r.channel) && r.channel > 0,
    );
    if (!radios.length) return c.channel ? String(c.channel) : '';
    if (radios.length === 1) return String(radios[0].channel);
    const clientCh = parseInt(String(c.channel || ''), 10);
    if (clientCh) {
      const hit = radios.find(r => r.channel === clientCh);
      if (hit) return String(hit.channel);
    }
    // Client-MIB passt zu keinem Radio dieses Bands → nicht den falschen MIB-Wert anzeigen
    radios.sort((a, b) => a.channel - b.channel);
    return String(radios[0].channel);
  }

  const entries = Object.values(clients).map(c => {
    const bandLabel = c.band === '1' ? '2.4 GHz' : c.band === '2' ? '5 GHz' : c.band === '3' || c.band === '4' ? '6 GHz' : '';
    const channel = bandLabel ? pickChannelFromRadios(c, bandLabel) : (c.channel ? String(c.channel) : '');
    return {
      mac:      c.mac,
      ip:       macToIp[c.mac] || '',
      hostname: c.hostname || '',
      ssid:     c.ssid || '',
      band:     bandLabel,
      channel,
      chanWidth: c.chanWidth || '',
      signal:   c.signal || '',
      snr:      c.snr || '',
    };
  });
  entries.sort((a, b) => (a.ssid || '').localeCompare(b.ssid || ''));

  const radioChannels = Object.values(radioByIface)
    .filter(r => r.channel && r.band)
    .map(r => ({ channel: r.channel, band: r.band, noise: r.noise ?? null, utilization: r.utilization ?? null }));

  return { entries, count: entries.length, radioChannels };
}

// ── Nachbar-APs (LCOS LX) ─────────────────────────────────────────────────────
// OID .38.1.7/8: {b4.b3.b2.b1} = IP little-endian, {strLen}.{BSSID-ASCII} = BSSID
async function snmpNeighborAps(host, community, version) {
  const [ssidOut, chanOut] = await Promise.all([
    runSnmpWalk(host, community, version, '1.3.6.1.4.1.2356.13.1.3.38.1.7'),
    runSnmpWalk(host, community, version, '1.3.6.1.4.1.2356.13.1.3.38.1.8'),
  ]);

  function parseNeighborIdx(idx) {
    const parts = idx.split('.');
    if (parts.length < 6) return null;
    const ip = `${parts[3]}.${parts[2]}.${parts[1]}.${parts[0]}`;
    const strLen = parseInt(parts[4]);
    if (parts.length < 5 + strLen) return null;
    const bssid = parts.slice(5, 5 + strLen).map(n => String.fromCharCode(parseInt(n))).join('');
    return { ip, bssid };
  }

  const neighbors = {};
  ssidOut.split('\n').forEach(line => {
    const m = line.match(/38\.1\.7\.([\d.]+)\s*=\s*(?:STRING:\s*"?)([^"]*)"?/);
    if (!m) return;
    const parsed = parseNeighborIdx(m[1]);
    if (!parsed) return;
    const key = `${parsed.ip}|${parsed.bssid}`;
    if (!neighbors[key]) neighbors[key] = { ...parsed };
    neighbors[key].ssid = m[2].trim();
  });
  chanOut.split('\n').forEach(line => {
    const m = line.match(/38\.1\.8\.([\d.]+)\s*=\s*Gauge32:\s*(\d+)/);
    if (!m) return;
    const parsed = parseNeighborIdx(m[1]);
    if (!parsed) return;
    const key = `${parsed.ip}|${parsed.bssid}`;
    if (!neighbors[key]) neighbors[key] = { ...parsed };
    const ch = parseInt(m[2]);
    neighbors[key].channel = ch;
    neighbors[key].band = ch >= 1 && ch <= 13 ? '2.4 GHz' : ch >= 14 && ch <= 196 ? '5 GHz' : '6 GHz';
  });

  return { entries: Object.values(neighbors) };
}

// ── WLAN-Netzwerke Setup (LCOS LX) lcosLXSetupWLANNetworks 1.3.6.1.4.1.2356.13.2.20.1 ──

const LX_WLAN_NET_BASE = '1.3.6.1.4.1.2356.13.2.20.1';

function parseLxWlanNetworksSetup(raw) {
  const rows = {};
  raw.split('\n').forEach((line) => {
    const m = line.match(/2356\.13\.2\.20\.1\.1\.(\d+)\.([\d.]+)\s*=\s*(.*)/)
      || line.match(/2356\.13\.2\.20\.1\.(\d+)\.([\d.]+)\s*=\s*(.*)/);
    if (!m) return;
    const col = parseInt(m[1], 10);
    const suffixParts = m[2].split('.');
    const [networkName] = decodeOidStr(suffixParts, 0);
    if (!networkName) return;
    if (!rows[networkName]) rows[networkName] = { networkName };
    const rawVal = m[3].trim();
    let str = '';
    if (rawVal.includes('STRING:')) {
      str = rawVal.replace(/^.*STRING:\s*"?/, '').replace(/"?\s*$/, '').trim();
    }
    if (col === 2 && str) rows[networkName].ssid = str;
    if (col === 1 && str) rows[networkName].nameCol = str;
  });
  return Object.values(rows).sort((a, b) => a.networkName.localeCompare(b.networkName, undefined, { numeric: true }));
}

async function snmpLxWlanNetworksSetup(host, community, version) {
  const raw = await runSnmpWalk(host, community, version, LX_WLAN_NET_BASE, 20000);
  const networks = parseLxWlanNetworksSetup(raw);
  return { networks, count: networks.length };
}

function explainLxWlanSnmpSetError(err) {
  const raw = (err && err.message) ? err.message : String(err);
  // v2c: falsche/fehlende Schreib-Community oder SNMPv3 ohne Schreibrechte → oft noAccess / Authorization
  if (/noaccess|no access|authorization|not authorized|wrong digest|unknown engine|unknown user|usm/i.test(raw)) {
    return new Error(
      'SNMP-SET wurde abgelehnt (kein Schreibzugriff). '
      + 'Prüfen Sie die Schreib-Community unter Einstellungen → SNMP (und dass sie mit dem Gerät übereinstimmt). '
      + 'Die Community in der Geräteliste wird für Lesen genutzt; ohne separate Angabe fließt sie nun auch in SET ein. '
      + 'Bei SNMPv3: Security Name, Passwörter und MIB-Zugriffsrechte (VIEW) müssen Schreiben erlauben. '
      + `Technisch: ${raw}`,
    );
  }
  if (/notwritable|not writable|read.?only/i.test(raw)) {
    return new Error(
      'Das Gerät meldet NotWritable: Diese OID ist im SNMP-Agenten als schreibgeschützt markiert — '
      + 'das ist unabhängig davon, ob die Community „Schreibrechte“ hat. '
      + 'Bei vielen LCOS-LX-Versionen ist die Tabelle 2356.13.2.20.1 nur lesbar; die SSID lässt sich dann nur per Web-UI, CLI oder LMC ändern. '
      + `Technisch: ${raw}`,
    );
  }
  return err instanceof Error ? err : new Error(String(err));
}

async function snmpLxWlanSetSsid(host, community, version, networkName, ssid) {
  const n = String(networkName || '').trim();
  const s = String(ssid || '').trim();
  if (!n) throw new Error('Netzwerkname (Profil) fehlt');
  if (!s.length) throw new Error('SSID fehlt');
  if (s.length > 32) throw new Error('SSID max. 32 Zeichen');
  const enc = encodeOidStr(n);
  const oids = [
    `1.3.6.1.4.1.2356.13.2.20.1.1.2.${enc}`,
    `1.3.6.1.4.1.2356.13.2.20.1.2.${enc}`,
  ];
  let lastErr = null;
  for (const oid of oids) {
    try {
      await runSnmpSet(host, community, version, oid, 's', s);
      return { ok: true, oid };
    } catch (e) {
      lastErr = e;
    }
  }
  throw explainLxWlanSnmpSetError(lastErr || new Error('SNMP SET fehlgeschlagen'));
}

// ── WLAN Clients (LCOS) ───────────────────────────────────────────────────────
// OID-kodierten Interface-Namen entschlüsseln: "6.87.76.65.78.45.49" → "WLAN-1"
function decodeIfaceName(oidSuffix) {
  const parts = oidSuffix.split('.');
  const len = parseInt(parts[0]);
  if (isNaN(len) || parts.length < len + 1) return null;
  return parts.slice(1, len + 1).map(n => String.fromCharCode(parseInt(n))).join('');
}

/** lcsStatusWlanRadiosEntry RadioBand (LANCOM) — 4 u. a. bei 6E/Wi-Fi 7 */
function lcsBandFromEnum(bandNum) {
  const s = String(bandNum);
  if (s === '1') return '2.4 GHz';
  if (s === '2') return '5 GHz';
  if (s === '3' || s === '4') return '6 GHz';
  return '';
}

/** Funkband aus Kanalnummer (wie Nachbar-AP-Heuristik) */
function lcosBandFromChannelNum(ch) {
  const n = parseInt(String(ch), 10);
  if (isNaN(n) || n < 1) return '';
  if (n <= 13) return '2.4 GHz';
  if (n <= 196) return '5 GHz';
  return '6 GHz';
}

/**
 * Kanal/Band zum Client-Interface (WLAN-n):
 * Primär lcsStatusWlanRadiosEntry 1.3.6.1.4.1.2356.11.1.3.57 (.1.2 Band, .1.3 Kanal, …).
 * Fallback: .56.1.9 oder Heuristik nach Radio-Index, wenn OID-Suffix nicht decodierbar ist.
 */
function pickLcosClientChannelBand(ifaceNorm, radioToChannel, radioByIfaceName, radiosWithChan, radioByRaw) {
  const radioMatch = ifaceNorm.match(/^(WLAN-(\d+))/i);
  const radio = radioMatch ? `WLAN-${radioMatch[2]}` : ifaceNorm;
  const wlanNum = radioMatch ? parseInt(radioMatch[2], 10) : 0;
  const chanFrom56 = radioToChannel[radio] ?? radioToChannel[ifaceNorm] ?? 0;

  let rinfo = radioByIfaceName[radio] || radioByIfaceName[ifaceNorm] || null;

  // .57: gleiche Radio-Zeile per sortiertem Suffix zu WLAN-1..n, falls decodeIfaceName leer war
  if (!rinfo && radioByRaw && wlanNum > 0) {
    const sortedKeys = Object.keys(radioByRaw)
      .filter(k => radioByRaw[k].band && radioByRaw[k].channel)
      .sort((a, b) => {
        const na = decodeIfaceName(a);
        const nb = decodeIfaceName(b);
        if (na && nb) return na.localeCompare(nb, undefined, { numeric: true });
        return a.localeCompare(b, undefined, { numeric: true });
      });
    const rawKey = sortedKeys[wlanNum - 1];
    if (rawKey && radioByRaw[rawKey]) rinfo = radioByRaw[rawKey];
  }

  if (!rinfo && radiosWithChan.length === 1) rinfo = radiosWithChan[0];

  let chan = rinfo?.channel || 0;
  let band = rinfo?.band || '';
  if (chan && !band) band = lcosBandFromChannelNum(chan);

  if (!chan && radiosWithChan.length >= 2) {
    const n = wlanNum || 1;
    const r24 = radiosWithChan.find(r => r.band === '2.4 GHz' && r.channel);
    const r5  = radiosWithChan.find(r => r.band === '5 GHz' && r.channel);
    const r6  = radiosWithChan.find(r => r.band === '6 GHz' && r.channel);
    if (n === 1 && r24) { chan = r24.channel; band = r24.band; }
    else if (n === 2 && r5) { chan = r5.channel; band = r5.band; }
    else if (n === 3 && r6) { chan = r6.channel; band = r6.band; }
    else if (radiosWithChan[n - 1]?.channel) {
      chan = radiosWithChan[n - 1].channel;
      band = radiosWithChan[n - 1].band;
    }
  }

  // .56.1.9 nur, wenn .57 keinen Kanal geliefert hat
  if (!chan && chanFrom56 > 0) {
    chan = chanFrom56;
    band = band || lcosBandFromChannelNum(chan);
  }

  if (band === '5 GHz' && chan >= 1 && chan <= 14) {
    const alt = radiosWithChan.find(r => r.band === '5 GHz' && r.channel >= 36);
    if (alt) chan = alt.channel;
  }
  if (band === '2.4 GHz' && chan >= 36) {
    const alt = radiosWithChan.find(r => r.band === '2.4 GHz' && r.channel <= 14);
    if (alt) chan = alt.channel;
  }
  if (!band && chan > 0) band = lcosBandFromChannelNum(chan);

  // Noise Floor (dBm) derselben Radio-Zeile wie Kanal/Band — lcsStatusWlanRadiosEntryNoise (.57.1.5)
  let noise = null;
  if (band && chan) {
    const match = radiosWithChan.find(r => r.band === band && r.channel === chan);
    if (match && match.noise != null && !isNaN(match.noise)) noise = match.noise;
  }
  if (noise == null && rinfo && rinfo.noise != null && !isNaN(rinfo.noise)) noise = rinfo.noise;

  return { chan, band, noise };
}

/** Zeilen von lcsStatusWlanStationTable 1.3.6.1.4.1.2356.11.1.3.32.1 — u. a. .26 PhySignal (RSSI dBm), .15 Interface */
function parseLcosStation32Walk(stationOut) {
  const clients = {};
  stationOut.split('\n').forEach(line => {
    const m = line.match(/2356\.11\.1\.3\.32\.1\.(\d+)\.([\d.]+)\s*=\s*(.*)/);
    if (!m) return;
    const col = parseInt(m[1], 10);
    const idx = m[2];
    const raw = m[3].trim();
    if (!clients[idx]) clients[idx] = { idx };
    if (col === 4) {
      const mac = macFromHexStr(raw.replace(/^Hex-STRING:\s*/, '').trim());
      if (mac) clients[idx].mac = mac;
    }
    if (col === 9) {
      const str = raw.includes('STRING:')
        ? raw.replace(/^.*STRING:\s*"?/, '').replace(/"?\s*$/, '').trim()
        : '';
      if (str) clients[idx].hostname = str;
    }
    if (col === 15) {
      const s = raw.replace(/^STRING:\s*"?/, '').replace(/"?\s*$/, '').trim();
      if (s) clients[idx].iface = s;
    }
    if (col === 26) {
      const gm = raw.match(/(?:Gauge32|INTEGER|Counter32|Unsigned32):\s*(-?\d+)/i);
      if (gm) clients[idx].signal = parseInt(gm[1], 10);
    }
    if (col === 27) {
      const ipm = raw.match(/IpAddress:\s*([\d.]+)/i)
        || raw.match(/STRING:\s*"([^"]+)"/);
      const s = ipm ? ipm[1].trim() : raw.replace(/^STRING:\s*"?/, '').replace(/"?\s*$/, '').trim();
      if (s && /^\d{1,3}(?:\.\d{1,3}){3}$/.test(s)) clients[idx].ipFromSta = s;
    }
  });
  return clients;
}

async function snmpWlanLcos(host, community, version) {
  // LCOS: Stationen …11.1.3.32.1 | Networks …11.1.3.56.1 (lcsStatusWlanNetworksTable) | Radios …11.1.3.57
  // .31 nur Fallback wenn .32 leer
  const [
    networks56Out,
    client31Out,
    ext34Out,
    radioBandOut,
    radioChanOut,
    radioNoiseOut,
    radioUtilOut,
    station32Out,
    arpOut,
  ] = await Promise.all([
    runSnmpWalk(host, community, version, '1.3.6.1.4.1.2356.11.1.3.56.1'),
    runSnmpWalk(host, community, version, '1.3.6.1.4.1.2356.11.1.31.1.1'),
    runSnmpWalk(host, community, version, '1.3.6.1.4.1.2356.11.1.3.34'),
    runSnmpWalk(host, community, version, '1.3.6.1.4.1.2356.11.1.3.57.1.2'),
    runSnmpWalk(host, community, version, '1.3.6.1.4.1.2356.11.1.3.57.1.3'),
    runSnmpWalk(host, community, version, '1.3.6.1.4.1.2356.11.1.3.57.1.5'),
    runSnmpWalk(host, community, version, '1.3.6.1.4.1.2356.11.1.3.57.1.6'),
    runSnmpWalk(host, community, version, '1.3.6.1.4.1.2356.11.1.3.32.1'),
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.4.22.1.2'),
  ]);

  // lcsStatusWlanNetworksTable 1.3.6.1.4.1.2356.11.1.3.56.1 — Index = Interface; .3 NetworkName (SSID), .9 RadioMode (Kanal-Fallback)
  const ifToSsid = {};
  const radioToChannel = {};
  networks56Out.split('\n').forEach(line => {
    const m = line.match(/2356\.11\.1\.3\.56\.1\.(\d+)\.([\d.]+)\s*=\s*(.*)/);
    if (!m) return;
    const col = parseInt(m[1], 10);
    const suf = m[2];
    const raw = m[3].trim();
    const iface = decodeIfaceName(suf);
    if (!iface) return;
    if (col === 3) {
      const ssid = raw.includes('STRING:')
        ? raw.replace(/^.*STRING:\s*"?/, '').replace(/"?\s*$/, '').trim()
        : String(snmpVal(raw) || '').trim();
      if (ssid) ifToSsid[iface] = ssid;
    }
    if (col === 9) {
      const nm = raw.match(/(?:INTEGER|Gauge32|Counter32|Unsigned32):\s*(\d+)/i);
      const chan = nm ? parseInt(nm[1], 10) : parseInt(String(snmpVal(raw) || ''), 10);
      if (!isNaN(chan) && chan > 0) radioToChannel[iface] = chan;
    }
  });

  // Radio: Roh-OID-Suffix mergen (ältere Parser nutzten nur decodeIfaceName → bei manchen Geräten 0 Zeilen)
  const radioByRaw = {};
  function touchRadioRaw(suf) {
    if (!radioByRaw[suf]) radioByRaw[suf] = {};
    return radioByRaw[suf];
  }
  radioBandOut.split('\n').forEach(line => {
    const m = line.match(/2356\.11\.1\.3\.57\.1\.2\.([\d.]+)\s*=\s*(?:INTEGER|Gauge32|Counter32|Unsigned32):\s*(\d+)/i);
    if (!m) return;
    const band = lcsBandFromEnum(m[2]);
    if (!band) return;
    touchRadioRaw(m[1]).band = band;
  });
  radioChanOut.split('\n').forEach(line => {
    const m = line.match(/2356\.11\.1\.3\.57\.1\.3\.([\d.]+)\s*=\s*(?:Gauge32|INTEGER|Counter32|Unsigned32):\s*(\d+)/i);
    if (!m) return;
    const ch = parseInt(m[2], 10);
    if (ch > 0) touchRadioRaw(m[1]).channel = ch;
  });
  radioNoiseOut.split('\n').forEach(line => {
    const m = line.match(/2356\.11\.1\.3\.57\.1\.5\.([\d.]+)\s*=\s*(?:INTEGER|Gauge32):\s*(-?\d+)/i);
    if (!m) return;
    touchRadioRaw(m[1]).noise = parseInt(m[2], 10);
  });
  radioUtilOut.split('\n').forEach(line => {
    const m = line.match(/2356\.11\.1\.3\.57\.1\.6\.([\d.]+)\s*=\s*(?:Gauge32|INTEGER|Counter32|Unsigned32):\s*(\d+)/i);
    if (!m) return;
    touchRadioRaw(m[1]).utilization = parseInt(m[2], 10);
  });

  const radioByIfaceName = {};
  for (const [raw, r] of Object.entries(radioByRaw)) {
    const name = decodeIfaceName(raw);
    if (name) radioByIfaceName[name] = r;
  }
  const radiosWithChan = Object.keys(radioByRaw)
    .filter(k => radioByRaw[k].channel && radioByRaw[k].band)
    .sort((a, b) => {
      const na = decodeIfaceName(a);
      const nb = decodeIfaceName(b);
      if (na && nb) return na.localeCompare(nb, undefined, { numeric: true });
      return a.localeCompare(b, undefined, { numeric: true });
    })
    .map(k => radioByRaw[k]);

  const radioChannels = radiosWithChan.map(r => ({
    channel: r.channel,
    band: r.band,
    noise: r.noise ?? null,
    utilization: r.utilization ?? null,
  }));

  // ARP: MAC → IP
  const macToIp = {};
  arpOut.split('\n').forEach(line => {
    const m = line.match(/4\.22\.1\.2\.\d+\.([\d.]+)\s*=\s*(?:Hex-STRING:\s*)?([\dA-Fa-f ]+)\s*$/);
    if (m && m[1].split('.').length === 4) {
      const mac = macFromHexStr(m[2].trim()); if (mac) macToIp[mac] = m[1];
    }
  });

  // Hinweis: 2356.11.1.3.34 ist in aktuellen MIBs lcsStatusWlanScanResultsTable (Nachbar-Scan), nicht „Advanced Stations“.
  // Nur noch Hostname/Kanal aus MAC-Index-Zeilen — kein SNR aus .34 (Sp. 19 = Rate im Scan, nicht SNR).
  const macToExt = {};
  ext34Out.split('\n').forEach(line => {
    const m = line.match(/2356\.11\.1\.3\.34\.1\.(\d+)\.((?:\d+\.){5}\d+)(?:\.\d+)*\s*=\s*(.*)/);
    if (!m) return;
    const col = parseInt(m[1], 10);
    const mac = macFromDecOid(m[2]);
    if (!mac) return;
    if (!macToExt[mac]) macToExt[mac] = {};
    const raw = m[3].trim();
    const str = raw.includes('STRING:') ? raw.replace(/^.*STRING:\s*"?/, '').replace(/"?\s*$/, '').trim() : '';
    const num = parseInt((raw.match(/-?\d+/) || [])[0], 10);
    if (col === 2  && str)         macToExt[mac].hostname = str;
    if (col === 8  && !isNaN(num))  macToExt[mac].channel  = num;
  });

  function findExt(mac) {
    if (macToExt[mac]) return macToExt[mac];
    const pre = mac.substring(0, 14);
    for (const [k, v] of Object.entries(macToExt)) {
      if (k.substring(0, 14) === pre) return v;
    }
    return null;
  }

  /** SNR (ca.): RSSI − NoiseFloor — Noise aus derselben Radio-Zeile .57.1.5 */
  function lcosSnrFromRssiNoise(rssiDbm, noiseDbm) {
    if (rssiDbm == null || noiseDbm == null || isNaN(rssiDbm) || isNaN(noiseDbm)) return null;
    const snr = Math.round(rssiDbm - noiseDbm);
    return snr > 0 ? snr : null;
  }

  function pushEntriesFromStation32(clients32) {
    const out = [];
    Object.values(clients32).forEach(c => {
      if (!c.mac || !c.iface) return;
      const ifaceNorm = String(c.iface).trim().replace(/^wlan-/i, 'WLAN-');
      if (!/^WLAN-/i.test(ifaceNorm)) return;
      const radioMatch = ifaceNorm.match(/^(WLAN-\d+)/i);
      const radio = radioMatch ? radioMatch[1] : ifaceNorm;
      const ext = findExt(c.mac);
      const { chan, band, noise } = pickLcosClientChannelBand(ifaceNorm, radioToChannel, radioByIfaceName, radiosWithChan, radioByRaw);
      let chanFinal = chan > 0 ? chan : (ext?.channel > 0 ? ext.channel : 0);
      const chanDisplay = chanFinal >= 1 && chanFinal <= 233 ? String(chanFinal) : '';
      const bandFinal = band || lcosBandFromChannelNum(chanFinal);
      const ip = c.ipFromSta || macToIp[c.mac] || '';
      const sig = c.signal != null ? c.signal : ext?.signal;
      const snrVal = lcosSnrFromRssiNoise(typeof sig === 'number' ? sig : null, noise);
      out.push({
        mac:       c.mac,
        ip,
        hostname:  c.hostname || ext?.hostname || '',
        ssid:      ifToSsid[ifaceNorm] || ifToSsid[radio] || ifaceNorm,
        band:      bandFinal,
        channel:   chanDisplay,
        chanWidth: '',
        signal:    sig != null ? String(sig) : '',
        snr:       snrVal != null ? String(snrVal) : '',
      });
    });
    return out;
  }

  const clients32 = parseLcosStation32Walk(station32Out);
  let entries = pushEntriesFromStation32(clients32);

  // Fallback: lcsWlanClientTable .31 (nur wenn .32 keine Stationen)
  if (!entries.length) {
    const clients31 = {};
    client31Out.split('\n').forEach(line => {
      const m = line.match(/2356\.11\.1\.31\.1\.1\.(\d+)\.(\d+)\s*=\s*(.*)/);
      if (!m) return;
      const col = parseInt(m[1], 10);
      const idx = m[2];
      const raw = m[3].trim();
      if (!clients31[idx]) clients31[idx] = { idx };
      if (col === 2) { const n = (raw.match(/\d+/) || [])[0]; if (n) clients31[idx].dataRate = parseInt(n, 10); }
      if (col === 3) { const mac = macFromHexStr(raw.replace(/^Hex-STRING:\s*/, '').trim()); if (mac) clients31[idx].mac = mac; }
      if (col === 9) { const s = raw.replace(/^STRING:\s*"?/, '').replace(/"?\s*$/, '').trim(); if (s) clients31[idx].iface = s; }
    });

    Object.values(clients31).forEach(c => {
      if (!c.mac || !c.iface) return;
      const ifaceNorm = String(c.iface).trim().replace(/^wlan-/i, 'WLAN-');
      if (!ifaceNorm.startsWith('WLAN-')) return;
      const ext = findExt(c.mac);
      const radioMatch = ifaceNorm.match(/^(WLAN-\d+)/);
      const radio = radioMatch ? radioMatch[1] : ifaceNorm;
      const { chan, band, noise } = pickLcosClientChannelBand(ifaceNorm, radioToChannel, radioByIfaceName, radiosWithChan, radioByRaw);
      let chanFinal = ext?.channel || chan;
      const bandFinal = band || lcosBandFromChannelNum(chanFinal);
      const chanDisplay = chanFinal >= 1 && chanFinal <= 233 ? String(chanFinal) : '';
      const snrVal = lcosSnrFromRssiNoise(ext?.signal != null ? ext.signal : null, noise);
      entries.push({
        mac:       c.mac,
        ip:        macToIp[c.mac] || '',
        hostname:  ext?.hostname || '',
        ssid:      ifToSsid[ifaceNorm] || ifToSsid[radio] || ifaceNorm,
        band:      bandFinal,
        channel:   chanDisplay,
        chanWidth: '',
        signal:    ext?.signal != null ? String(ext.signal) : '',
        snr:       snrVal != null ? String(snrVal) : '',
      });
    });
  }

  entries.sort((a, b) => (a.ssid || '').localeCompare(b.ssid || ''));
  return { entries, count: entries.length, radioChannels };
}

// ── VLAN-Pfad-Tracer (Q-BRIDGE-MIB) ──────────────────────────────────────────

async function snmpVlanTrace(host, community, version, vlanId) {
  const vid = parseInt(vlanId) || 1;
  const [nameOut, egressOut, untaggedOut, pvidOut, bp2ifOut, ifNameOut] = await Promise.all([
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.17.7.1.4.3.1.1'), // dot1qVlanStaticName
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.17.7.1.4.3.1.2'), // dot1qVlanStaticEgressPorts
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.17.7.1.4.3.1.4'), // dot1qVlanStaticUntaggedPorts
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.17.7.1.4.5.1.1'), // dot1qPvid
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.17.1.4.1.2'),     // dot1dBasePortIfIndex
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.31.1.1.1.1'),     // ifName
  ]);

  // bridge port → ifIndex
  const bp2if = {};
  bp2ifOut.split('\n').forEach(line => {
    const m = line.match(/17\.1\.4\.1\.2\.(\d+)\s*=\s*INTEGER:\s*(\d+)/);
    if (m) bp2if[m[1]] = parseInt(m[2]);
  });
  // ifIndex → name
  const ifNames = {};
  ifNameOut.split('\n').forEach(line => {
    const m = line.match(/31\.1\.1\.1\.1\.(\d+)\s*=\s*(?:STRING:\s*)?"?([^"\n]+?)"?\s*$/);
    if (m) ifNames[m[1]] = m[2].trim();
  });
  // bridge port → PVID
  const pvidMap = {};
  pvidOut.split('\n').forEach(line => {
    const m = line.match(/17\.7\.1\.4\.5\.1\.1\.(\d+)\s*=\s*(?:Gauge32:|INTEGER:)?\s*(\d+)/);
    if (m) pvidMap[m[1]] = parseInt(m[2]);
  });
  // VLAN names
  const vlanNames = {};
  nameOut.split('\n').forEach(line => {
    const m = line.match(/17\.7\.1\.4\.3\.1\.1\.(\d+)\s*=\s*(?:STRING:\s*)?"?([^"\n]*?)"?\s*$/);
    if (m) vlanNames[m[1]] = m[2].trim();
  });
  // Egress + untagged bitmaps per VLAN
  const egressMap = {};
  egressOut.split('\n').forEach(line => {
    const m = line.match(/17\.7\.1\.4\.3\.1\.2\.(\d+)\s*=\s*Hex-STRING:\s*([\dA-Fa-f ]+)/);
    if (m) egressMap[m[1]] = parseBitmapPorts(m[2]);
  });
  const untaggedMap = {};
  untaggedOut.split('\n').forEach(line => {
    const m = line.match(/17\.7\.1\.4\.3\.1\.4\.(\d+)\s*=\s*Hex-STRING:\s*([\dA-Fa-f ]+)/);
    if (m) untaggedMap[m[1]] = parseBitmapPorts(m[2]);
  });

  const egress   = egressMap[String(vid)]   || new Set();
  const untagged = untaggedMap[String(vid)] || new Set();

  const ports = [];
  for (const bp of egress) {
    const ifIdx  = bp2if[String(bp)];
    const ifName = ifIdx ? (ifNames[String(ifIdx)] || `Port ${bp}`) : `Port ${bp}`;
    const pvid   = pvidMap[String(bp)] ?? null;
    ports.push({ bridgePort: bp, ifIndex: ifIdx || null, ifName,
      mode: untagged.has(bp) ? 'untagged' : 'tagged', pvid });
  }
  ports.sort((a, b) => a.bridgePort - b.bridgePort);

  const allVlans = Object.entries(vlanNames)
    .map(([id, name]) => ({ id: parseInt(id), name }))
    .sort((a, b) => a.id - b.id);

  return { vlanId: vid, vlanName: vlanNames[String(vid)] || '', ports, allVlans,
    found: egress.size > 0 };
}

// ── VLAN (Q-BRIDGE-MIB, IEEE 802.1Q) ─────────────────────────────────────────
// LCOS SX:   dot1qVlanStaticName (1.3.6.1.2.1.17.7.1.4.3.1.1) — vollständig unterstützt
// LCOS LX:   Q-BRIDGE-MIB unterstützt (802.1Q VLAN-Tagging per SSID/Bridge-Interface)
// LCOS/FX:   Q-BRIDGE-MIB ggf. teilweise unterstützt

async function snmpVlan(host, community, version, os, devType) {
  const [nameOut, statusOut] = await Promise.all([
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.17.7.1.4.3.1.1'), // dot1qVlanStaticName
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.17.7.1.4.3.1.5'), // dot1qVlanStaticRowStatus
  ]);

  const names = {};
  nameOut.split('\n').forEach(line => {
    const m = line.match(/17\.7\.1\.4\.3\.1\.1\.(\d+)\s*=\s*(.*)/);
    if (m) names[m[1]] = snmpVal(m[2]);
  });

  const statuses = {};
  statusOut.split('\n').forEach(line => {
    const m = line.match(/17\.7\.1\.4\.3\.1\.5\.(\d+)\s*=\s*(.*)/);
    if (m) statuses[m[1]] = snmpVal(m[2]);
  });

  const entries = Object.keys(names).map(id => {
    const st = statuses[id] || '';
    const active = st === '1' || st.startsWith('active');
    return { vlanId: parseInt(id), name: names[id] || '', active };
  });
  entries.sort((a, b) => a.vlanId - b.vlanId);
  return { entries, count: entries.length };
}

// ── Port-Einstellungen ────────────────────────────────────────────────────────

async function snmpPortSettings(host, community, version) {
  const [ifOut, ifxOut, pvidOut] = await Promise.all([
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.2.2.1'),
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.31.1.1.1'),
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.17.7.1.4.5.1.1'), // dot1qPvid
  ]);
  const ports = {};
  ifOut.split('\n').forEach(line => {
    const m = line.match(/\.2\.2\.1\.(\d+)\.(\d+)\s*=\s*(.*)/);
    if (!m) return;
    const col = parseInt(m[1]), idx = m[2], val = snmpVal(m[3]);
    if (!ports[idx]) ports[idx] = { idx };
    if (col === 2) ports[idx].descr       = val;
    if (col === 5) ports[idx].speed       = parseInt(val) || 0;
    if (col === 7) ports[idx].adminStatus = val;
    if (col === 8) ports[idx].operStatus  = val;
  });
  ifxOut.split('\n').forEach(line => {
    const m = line.match(/\.31\.1\.1\.1\.(\d+)\.(\d+)\s*=\s*(.*)/);
    if (!m) return;
    const col = parseInt(m[1]), idx = m[2], val = snmpVal(m[3]);
    if (!ports[idx]) ports[idx] = { idx };
    if (col === 1)  ports[idx].name      = val;
    if (col === 15) ports[idx].highSpeed = parseInt(val) || 0;
  });
  pvidOut.split('\n').forEach(line => {
    const m = line.match(/17\.7\.1\.4\.5\.1\.1\.(\d+)\s*=\s*(.*)/);
    if (m) { const idx = m[1]; if (!ports[idx]) ports[idx] = { idx }; ports[idx].pvid = parseInt(snmpVal(m[2])) || 0; }
  });
  const entries = Object.values(ports).filter(p => p.descr || p.name)
    .sort((a, b) => parseInt(a.idx) - parseInt(b.idx));
  return { entries };
}

// ── Sensors ───────────────────────────────────────────────────────────────────

async function snmpSensors(host, community, version) {
  const [uptimeOut, sx5SensOut, poeMainOut] = await Promise.all([
    runSnmpGet(host, community, version, ['1.3.6.1.2.1.1.3.0'], 3000),   // sysUpTime
    runSnmpGet(host, community, version, [
      '1.3.6.1.4.1.2356.16.1.7.1.1.0',  // SX5 fan status
      '1.3.6.1.4.1.2356.16.1.7.1.3.0',  // SX5 temperature (°C)
      '1.3.6.1.4.1.2356.16.1.7.1.5.0',  // SX5 fan speed (RPM)
      '1.3.6.1.4.1.2356.16.1.7.2.1.0',  // SX5 fan count
    ], 4000),
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.105.1.3.1.1'),    // RFC 3621 PoE Main PSE
  ]);

  // Uptime
  const uptimeM = uptimeOut.match(/Timeticks:\s*\((\d+)\)/i);
  const uptimeTicks = uptimeM ? parseInt(uptimeM[1]) : null;

  // SX5 environment sensors
  const sensors = {};
  const tempM   = sx5SensOut.match(/16\.1\.7\.1\.3\.0\s*=\s*(?:Gauge32|INTEGER):\s*(\d+)/);
  const fanSpdM = sx5SensOut.match(/16\.1\.7\.1\.5\.0\s*=\s*(?:Gauge32|INTEGER):\s*(\d+)/);
  const fanCntM = sx5SensOut.match(/16\.1\.7\.2\.1\.0\s*=\s*(?:Gauge32|INTEGER):\s*(\d+)/);
  if (tempM)   sensors.temperature = parseInt(tempM[1]);
  if (fanSpdM && parseInt(fanSpdM[1]) > 0) sensors.fanRpm = parseInt(fanSpdM[1]);
  if (fanCntM) sensors.fanCount = parseInt(fanCntM[1]);

  // RFC 3621 PoE Main PSE
  const poeGroups = {};
  poeMainOut.split('\n').forEach(line => {
    const m = line.match(/105\.1\.3\.1\.1\.(\d+)\.(\d+)\s*=\s*(?:Gauge32|INTEGER):\s*(\d+)/);
    if (!m) return;
    const [, col, grp, val] = [, m[1], m[2], parseInt(m[3])];
    if (!poeGroups[grp]) poeGroups[grp] = {};
    if (col === '2') poeGroups[grp].power       = val; // capacity in W
    if (col === '3') poeGroups[grp].status       = val; // 1=on 2=off
    if (col === '4') poeGroups[grp].consumption  = val; // current usage in W
    if (col === '5') poeGroups[grp].threshold    = val; // usage threshold %
  });
  const poe = Object.values(poeGroups).filter(g => g.power != null);

  return { uptimeTicks, sensors, poe };
}

// ── STP (IEEE 802.1D/RSTP) ────────────────────────────────────────────────────

async function snmpStpPrivate(host, community, version) {
  // LANCOM private MIB für LCOS SX 4+ (Vitesse-Chipset, kein Standard-dot1dStp)
  const PFX = '1.3.6.1.4.1.2356.14.2.18';
  const [globalOut, statusOut, portCfgOut, ifNameOut, ifOperOut, cistScalarOut] = await Promise.all([
    runSnmpWalk(host, community, version, `${PFX}.1`),           // global config
    runSnmpWalk(host, community, version, `${PFX}.2`),           // CIST status (own bridge MAC)
    runSnmpWalk(host, community, version, `${PFX}.5.10.1`),      // port config table
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.31.1.1.1.1'), // ifName
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.2.2.1.8'),    // ifOperStatus
    runSnmpGet(host, community, version, [
      `${PFX}.5.1.0`,  // CIST root port index (0 = this is root bridge)
      `${PFX}.5.2.0`,  // CIST root path cost
    ], 3000),
  ]);
  const STP_MODE = { '0':'Disabled', '1':'STP', '2':'RSTP', '3':'MSTP' };
  const global = {};
  globalOut.split('\n').forEach(line => {
    const m = line.match(/14\.2\.18\.1\.(\d+)\.0\s*=\s*(.*)/);
    if (!m) return;
    const v = snmpVal(m[2]);
    switch (parseInt(m[1])) {
      case 1:  global.mode      = v; global.modeLabel = STP_MODE[v]||v; break;
      case 2:  global.priority  = v; break;
      case 3:  global.fwdDelay  = v; break;  // fwdDelay (15s standard)
      case 4:  global.maxAge    = v; break;  // maxAge (20s standard)
      case 10: global.helloTime = v; break;  // helloTime (2s standard)
    }
  });
  statusOut.split('\n').forEach(line => {
    const m = line.match(/14\.2\.18\.2\.(\d+)\.0\s*=\s*(.*)/);
    if (!m) return;
    const v = snmpVal(m[2]);
    if (parseInt(m[1]) === 1) global.bridgeMac = v;  // own bridge MAC "00-a0-57-xx-xx-xx"
  });
  // CIST scalars: root port index (0 = this device IS root bridge) and root path cost
  const cistRootPortMatch = cistScalarOut.match(/18\.5\.1\.0\s*=\s*INTEGER:\s*(\d+)/);
  const cistRootCostMatch  = cistScalarOut.match(/18\.5\.2\.0\s*=\s*INTEGER:\s*(\d+)/);
  const cistRootPort = cistRootPortMatch ? parseInt(cistRootPortMatch[1]) : null;
  const cistRootCost = cistRootCostMatch ? parseInt(cistRootCostMatch[1]) : null;
  const isRoot = cistRootPort === 0;
  global.isRootBridge = isRoot;
  // Root cost 0 on non-root is a MIB reporting artifact — show as unknown
  global.rootCost = isRoot ? '0' : (cistRootCost !== null && cistRootCost > 0 ? String(cistRootCost) : '—');
  global.rootPort = isRoot ? '— (Root)' : (cistRootPort !== null ? String(cistRootPort) : '—');
  // Root bridge ID is not exposed by private MIB — show own bridge if root, else unknown
  if (isRoot && global.bridgeMac) {
    global.designatedRoot = `${global.priority || '?'} / ${global.bridgeMac}`;
  } else {
    global.designatedRoot = '— (nicht verfügbar)';
  }
  const ifNames = {};
  ifNameOut.split('\n').forEach(line => {
    const m = line.match(/31\.1\.1\.1\.1\.(\d+)\s*=\s*(?:STRING:\s*)?"?([^"\n]+?)"?\s*$/);
    if (m) ifNames[m[1]] = m[2].trim();
  });
  const ports = {};
  portCfgOut.split('\n').forEach(line => {
    // 18.5.10.1.{col}.{port}
    const m = line.match(/18\.5\.10\.1\.(\d+)\.(\d+)\s*=\s*(.*)/);
    if (!m) return;
    const col = parseInt(m[1]), port = m[2], v = snmpVal(m[3]);
    if (!ports[port]) ports[port] = { port };
    switch (col) {
      case 2: ports[port].portEnabled = (v === '1'); break; // 1=on 0=off
      case 3: ports[port].edgeAdmin   = v; break;           // 0=no 1=yes
      case 4: ports[port].priority    = v; break;           // 128 default
      case 5: ports[port].pathCost    = v === '0' ? 'Auto' : v; break; // 0=auto
    }
  });
  // ifOperStatus (1=up, 2=down) — use as STP state proxy since private MIB states are unreliable
  // Port state: root port + up → Forwarding(5), other up port → Forwarding(5), down → Disabled(1)
  const ifOperStatus = {};
  ifOperOut.split('\n').forEach(line => {
    const m = line.match(/2\.2\.1\.8\.(\d+)\s*=\s*INTEGER:\s*(\d+)/);
    if (m) ifOperStatus[m[1]] = parseInt(m[2]);
  });
  Object.values(ports).forEach(p => {
    const ifIdx = p.port; // private MIB port index matches ifIndex for physical ports
    const opStatus = ifOperStatus[ifIdx];
    if (opStatus === 1) {
      // Port is up: root port is always forwarding, others likely forwarding too (RSTP fast convergence)
      p.state = 5; // Forwarding
    } else {
      p.state = 1; // Disabled/not connected
    }
  });
  const portEntries = Object.values(ports).map(p => ({
    ...p,
    portName: ifNames[p.port] || 'Port ' + p.port,
  })).sort((a, b) => parseInt(a.port) - parseInt(b.port));
  return {
    global, portEntries,
    _meta: {
      mibType: 'private',
      oidBase: `${PFX}.5.10.1.2`, enableValue: 1, disableValue: 0,
      globalOid: `${PFX}.1.1.0`,
      modes: [
        { label: 'RSTP', value: 2 },
        { label: 'MSTP', value: 3 },
      ],
    },
  };
}

async function snmpStpSx5(host, community, version) {
  // LCOS SX 5 private MIB (OID-Prefix 2356.16.1.2)
  const PFX = '1.3.6.1.4.1.2356.16.1.2';
  const [globalOut, portCfgOut, ifNameOut, ifOperOut, bridgeMacOut] = await Promise.all([
    runSnmpWalk(host, community, version, `${PFX}.1`),           // global config
    runSnmpWalk(host, community, version, `${PFX}.2.3.1`),       // port table
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.31.1.1.1.1'), // ifName
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.2.2.1.8'),    // ifOperStatus
    runSnmpGet(host, community, version, ['1.3.6.1.2.1.17.1.1.0'], 3000), // dot1dBaseBridgeAddress
  ]);
  const STP_MODE = { '1':'RSTP', '2':'MSTP', '3':'STP' };
  const global = {};
  globalOut.split('\n').forEach(line => {
    const m = line.match(/16\.1\.2\.1\.(\d+)\.0\s*=\s*(.*)/);
    if (!m) return;
    const v = snmpVal(m[2]);
    switch (parseInt(m[1])) {
      case 2: global.mode = v; global.modeLabel = STP_MODE[v] || 'RSTP'; break;
      case 4: global.priority = v; break;
    }
  });
  // Root-Bridge-Erkennung: Root-Port-Index = 0 → dieses Gerät ist Root
  const rootPortM = globalOut.match(/16\.1\.2\.1\.3\.0\s*=\s*INTEGER:\s*(\d+)/);
  const cistRootPort = rootPortM ? parseInt(rootPortM[1]) : null;
  const isRoot = cistRootPort === 0;
  global.isRootBridge = isRoot;
  global.rootCost = isRoot ? '0' : '—';
  global.rootPort = isRoot ? '— (Root)' : (cistRootPort ? String(cistRootPort) : '—');
  global.designatedRoot = '— (nicht verfügbar)';
  // Bridge MAC from dot1dBaseBridgeAddress (needed for STP role inference in frontend)
  const ownMacMatch = bridgeMacOut.match(/Hex-STRING:\s*((?:[0-9A-Fa-f]{2}\s*){6})/);
  if (ownMacMatch) {
    global.bridgeMac = ownMacMatch[1].trim().split(/\s+/).map(b => b.padStart(2,'0')).join(':').toUpperCase();
  }

  const ifNames = {};
  ifNameOut.split('\n').forEach(line => {
    const m = line.match(/31\.1\.1\.1\.1\.(\d+)\s*=\s*(?:STRING:\s*)?"?([^"\n]+?)"?\s*$/);
    if (m) ifNames[m[1]] = m[2].trim();
  });
  const ifOperStatus = {};
  ifOperOut.split('\n').forEach(line => {
    const m = line.match(/2\.2\.1\.8\.(\d+)\s*=\s*INTEGER:\s*(\d+)/);
    if (m) ifOperStatus[m[1]] = parseInt(m[2]);
  });
  const ports = {};
  portCfgOut.split('\n').forEach(line => {
    const m = line.match(/16\.1\.2\.2\.3\.1\.(\d+)\.(\d+)\s*=\s*(.*)/);
    if (!m) return;
    const col = parseInt(m[1]), port = m[2], v = snmpVal(m[3]);
    if (!ports[port]) ports[port] = { port };
    if (col === 7) ports[port].portEnabled = (v === '1');
    if (col === 8) ports[port].pathCost = v === '0' ? 'Auto' : v;
  });
  Object.values(ports).forEach(p => {
    p.state = ifOperStatus[p.port] === 1 ? 5 : 1; // 5=Forwarding, 1=Disabled
  });
  const portEntries = Object.values(ports)
    .filter(p => ifNames[p.port])
    .map(p => ({ ...p, portName: ifNames[p.port] || 'Port ' + p.port }))
    .sort((a, b) => parseInt(a.port) - parseInt(b.port));
  return { global, portEntries, _meta: { mibType: 'private', oidBase: null } };
}

async function snmpStp(host, community, version) {
  // Prüfen ob Standard-Bridge-MIB verfügbar (LCOS SX 3, LCOS)
  const probe = await runSnmpGet(host, community, version, ['1.3.6.1.2.1.17.2.1.0'], 3000);
  if (!probe.includes('INTEGER') || probe.includes('No Such Object')) {
    // LCOS SX 5: private MIB unter 2356.16
    const sx5probe = await runSnmpGet(host, community, version, ['1.3.6.1.4.1.2356.16.1.2.1.2.0'], 2000);
    if (sx5probe.includes('INTEGER') && !sx5probe.includes('No Such Object')) {
      return await snmpStpSx5(host, community, version);
    }
    return await snmpStpPrivate(host, community, version);
  }
  const [globalOut, portOut, bpIfOut, ifNameOut, bridgeMacOut] = await Promise.all([
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.17.2'),
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.17.2.15.1'),
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.17.1.4.1.2'),
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.31.1.1.1.1'),
    runSnmpGet(host, community, version, ['1.3.6.1.2.1.17.1.1.0'], 3000), // dot1dBaseBridgeAddress
  ]);
  // Parse own bridge MAC from dot1dBaseBridgeAddress (reliable, 6 bytes)
  const ownMacMatch = bridgeMacOut.match(/Hex-STRING:\s*((?:[0-9A-Fa-f]{2}\s*){6})/);
  const ownMac = ownMacMatch
    ? ownMacMatch[1].trim().split(/\s+/).map(b => b.padStart(2,'0')).join(':').toUpperCase()
    : null;
  const global = {};
  globalOut.split('\n').forEach(line => {
    const m = line.match(/17\.2\.(\d+)\.0\s*=\s*(.*)/);
    if (!m) return;
    const v = snmpVal(m[2]);
    switch (parseInt(m[1])) {
      case 2:  global.priority   = v; break;
      case 3:  global.timeSince  = v; break;
      case 4:  global.topChanges = v; break;
      case 5: {
        // dot1dStpDesignatedRoot: 8-byte Hex (2 bytes priority + 6 bytes MAC)
        // Some LCOS SX 3 devices return truncated data — parse best-effort
        const hexBytes = (m[2].match(/Hex-STRING:\s*(.*)/)||[])[1];
        if (hexBytes) {
          const bytes = hexBytes.trim().split(/\s+/).map(b => parseInt(b, 16));
          if (bytes.length >= 8) {
            const prio = (bytes[0] << 8) | bytes[1];
            const mac  = bytes.slice(2, 8).map(b => b.toString(16).padStart(2,'0')).join(':').toUpperCase();
            global.designatedRoot = `${prio} / ${mac}`;
            global.designatedRootPriority = prio;
            global.designatedRootMac = mac;
          } else if (bytes.length >= 6 && ownMac) {
            // Truncated — priority bytes missing, use own priority
            const mac = bytes.slice(0, 6).map(b => b.toString(16).padStart(2,'0')).join(':').toUpperCase();
            global.designatedRoot = `${global.priority || '?'} / ${mac}`;
          }
        }
        break;
      }
      case 6:  global.rootCost   = v; break;
      case 7:  global.rootPort   = v; break;
      case 8:  global.maxAge     = v; break;
      case 9:  global.helloTime  = v; break;
      case 15: global.fwdDelay   = v; break;
    }
  });
  // If rootCost=0 and designatedRoot is missing/malformed, construct from own bridge
  if (String(global.rootCost) === '0' && !global.designatedRootMac && ownMac) {
    global.designatedRoot = `${global.priority || '?'} / ${ownMac}`;
  }
  if (ownMac) global.bridgeMac = ownMac;
  global.isRootBridge = String(global.rootCost) === '0';
  const bpToIf = {};
  bpIfOut.split('\n').forEach(line => {
    const m = line.match(/17\.1\.4\.1\.2\.(\d+)\s*=\s*INTEGER:\s*(\d+)/);
    if (m) bpToIf[m[1]] = m[2];
  });
  const ifNames = {};
  ifNameOut.split('\n').forEach(line => {
    const m = line.match(/31\.1\.1\.1\.1\.(\d+)\s*=\s*(?:STRING:\s*)?"?([^"\n]+?)"?\s*$/);
    if (m) ifNames[m[1]] = m[2].trim();
  });
  const ports = {};
  portOut.split('\n').forEach(line => {
    const m = line.match(/17\.2\.15\.1\.(\d+)\.(\d+)\s*=\s*(.*)/);
    if (!m) return;
    const col = parseInt(m[1]), port = m[2], v = snmpVal(m[3]);
    if (!ports[port]) ports[port] = { port };
    if (col === 2)  ports[port].priority   = v;
    if (col === 3)  ports[port].state      = v;
    if (col === 4)  ports[port].portEnabled = (v !== '2');  // 1=en, 2=dis
    if (col === 5)  ports[port].pathCost   = v;
    if (col === 10) ports[port].fwdTrans   = v;
  });
  const portEntries = Object.values(ports).map(p => {
    const ifIdx = bpToIf[p.port];
    return { ...p, portName: ifIdx ? (ifNames[ifIdx] || 'If'+ifIdx) : 'Port '+p.port };
  }).sort((a, b) => parseInt(a.port) - parseInt(b.port));

  // Fallback auf Private MIB wenn Standard-MIB keine Port-Einträge liefert (z.B. LCOS SX 5 / MSTP)
  if (!portEntries.length) {
    const priv = await snmpStpPrivate(host, community, version);
    if (priv.portEntries.length) {
      // Globale Werte aus Standard-MIB behalten (zuverlässiger), Port-Daten aus Private MIB
      priv.global = { ...priv.global, ...global };
      return priv;
    }
  }

  return {
    global, portEntries,
    _meta: { mibType: 'standard', oidBase: '1.3.6.1.2.1.17.2.15.1.4', enableValue: 1, disableValue: 2, globalOid: null, modes: [] },
  };
}

// ── PoE (POWER-ETHERNET-MIB, RFC 3621) ───────────────────────────────────────

async function snmpPoe(host, community, version) {
  const [portOut, mainRaw] = await Promise.all([
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.105.1.1.1'), // pethPsePortTable
    runSnmpGet(host, community, version, [                            // pethMainPseTable via GET
      '1.3.6.1.2.1.105.1.3.1.1.2.1',  // pethMainPsePower
      '1.3.6.1.2.1.105.1.3.1.1.3.1',  // pethMainPseOperStatus
      '1.3.6.1.2.1.105.1.3.1.1.4.1',  // pethMainPseConsumptionPower
    ], 5000),
  ]);
  const main = {};
  (mainRaw||'').split('\n').forEach(line => {
    const m = line.match(/105\.1\.3\.1\.1\.(\d+)\.(\d+)\s*=\s*(.*)/);
    if (!m) return;
    const v = snmpVal(m[3]);
    if (m[1] === '2') main.power       = parseInt(v) || 0;
    if (m[1] === '3') main.operStatus  = v;
    if (m[1] === '4') main.consumption = parseInt(v) || 0;
  });
  const ports = {};
  portOut.split('\n').forEach(line => {
    const m = line.match(/105\.1\.1\.1\.(\d+)\.(\d+)\.(\d+)\s*=\s*(.*)/);
    if (!m) return;
    const col = m[1], group = m[2], port = m[3], key = `${group}.${port}`;
    if (!ports[key]) ports[key] = { group: parseInt(group), port: parseInt(port) };
    const v = snmpVal(m[4]);
    if (col === '3') ports[key].adminEnable     = v;
    if (col === '6') ports[key].detectionStatus = v;
    if (col === '7') ports[key].powerClass      = v;
  });
  const portEntries = Object.values(ports).sort((a, b) =>
    a.group !== b.group ? a.group - b.group : a.port - b.port);
  return { main, portEntries };
}

// ── Port-Diagnose (IF-MIB + EtherLike-MIB) ───────────────────────────────────
async function snmpPortDiag(host, community, version) {
  const [ifOut, ifxOut, dot3Out] = await Promise.all([
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.2.2.1'),
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.31.1.1.1'),
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.10.7.2.1'),
  ]);
  const ports = {};
  ifOut.split('\n').forEach(line => {
    const m = line.match(/2\.2\.1\.(\d+)\.(\d+)\s*=\s*(.*)/);
    if (!m) return;
    const col = parseInt(m[1]), idx = m[2], v = snmpVal(m[3]);
    if (!ports[idx]) ports[idx] = { idx };
    if (col === 2)  ports[idx].descr      = v;
    if (col === 8)  ports[idx].operStatus = parseInt(v)||0;
    if (col === 10) ports[idx].speed      = parseInt(v)||0;
    if (col === 13) ports[idx].inDiscards  = parseInt(v)||0;
    if (col === 14) ports[idx].inErrors    = parseInt(v)||0;
    if (col === 19) ports[idx].outDiscards = parseInt(v)||0;
    if (col === 20) ports[idx].outErrors   = parseInt(v)||0;
  });
  ifxOut.split('\n').forEach(line => {
    const m = line.match(/31\.1\.1\.1\.(\d+)\.(\d+)\s*=\s*(.*)/);
    if (!m) return;
    const col = parseInt(m[1]), idx = m[2], v = snmpVal(m[3]);
    if (!ports[idx]) ports[idx] = { idx };
    if (col === 1)  ports[idx].name      = v;
    if (col === 15) ports[idx].highSpeed = parseInt(v)||0;
  });
  dot3Out.split('\n').forEach(line => {
    const m = line.match(/10\.7\.2\.1\.(\d+)\.(\d+)\s*=\s*(.*)/);
    if (!m) return;
    const col = parseInt(m[1]), idx = m[2], v = snmpVal(m[3]);
    if (!ports[idx]) ports[idx] = { idx };
    if (col === 2)  ports[idx].alignErrors  = parseInt(v)||0;
    if (col === 3)  ports[idx].fcsErrors    = parseInt(v)||0;
    if (col === 13) ports[idx].excessColl   = parseInt(v)||0;
    if (col === 18) ports[idx].symbolErrors = parseInt(v)||0;
  });
  const entries = Object.values(ports)
    .filter(p => {
      const name = (p.name || p.descr || '').toLowerCase();
      if (!name) return false;
      if (/loopback|tunnel|null|cpu|vlan\d|^lo\d*$|mgmt.*vl/i.test(name)) return false;
      return true;
    })
    .map(p => ({
      idx: p.idx,
      name:       p.name || p.descr || 'Port ' + p.idx,
      operStatus: p.operStatus || 0,
      speedMbps:  p.highSpeed  || Math.round((p.speed||0) / 1e6),
      inErrors:    p.inErrors    || 0,
      outErrors:   p.outErrors   || 0,
      inDiscards:  p.inDiscards  || 0,
      outDiscards: p.outDiscards || 0,
      fcsErrors:   p.fcsErrors   || 0,
      alignErrors: p.alignErrors || 0,
      symbolErrors:p.symbolErrors|| 0,
    }))
    .sort((a,b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return { entries };
}

// ── Loop-Protection (STP-Portzustände als Indikator) ─────────────────────────
// LCOS SX: Loop Protection via STP-Blocking (dot1dStpPortState) + RSTP port roles
// dot1dStpPortState: 1=disabled 2=blocking 3=listening 4=learning 5=forwarding 6=broken

async function snmpLoopProtection(host, community, version) {
  // Private LANCOM-MIB zuerst probieren (LCOS SX 3 + 4).
  // LCOS SX 4 antwortet zwar auch auf Standard-Bridge-MIB, liefert dort aber
  // state=2 (blocking) für alle Ports wenn STP deaktiviert ist → falsch.
  const PFX = '1.3.6.1.4.1.2356.14.2.18';
  const privateProbe = await runSnmpWalk(host, community, version, `${PFX}.5.10.1.2`);
  if (privateProbe.trim()) {
    // LCOS SX (3 oder 4): private MIB hat echte Loop-Protection-Zustände
    const enableOut = privateProbe;
    const [stateOut, ifNameOut] = await Promise.all([
      runSnmpWalk(host, community, version, `${PFX}.6.2.1.3.1`),
      runSnmpWalk(host, community, version, '1.3.6.1.2.1.31.1.1.1.1'),
    ]);
    const ifNames = {};
    ifNameOut.split('\n').forEach(line => {
      const m = line.match(/31\.1\.1\.1\.1\.(\d+)\s*=\s*(?:STRING:\s*)?"?([^"\n]+?)"?\s*$/);
      if (m) ifNames[m[1]] = m[2].trim();
    });
    const portMap = {};
    enableOut.split('\n').forEach(line => {
      const m = line.match(/18\.5\.10\.1\.2\.(\d+)\s*=\s*(.*)/);
      if (!m) return;
      const port = m[1];
      if (!portMap[port]) portMap[port] = { port };
      portMap[port].portEnabled = snmpVal(m[2]) === '1';
    });
    stateOut.split('\n').forEach(line => {
      const m = line.match(/18\.6\.2\.1\.3\.1\.(\d+)\s*=\s*(.*)/);
      if (!m) return;
      const port = m[1];
      if (!portMap[port]) portMap[port] = { port };
      const sv = snmpVal(m[2]);
      // 0=kein Loop (Normal/Forwarding), 1=Lernen, 2=Loop erkannt (Blocked)
      const stateMap = { '0':'5', '1':'4', '2':'2' };
      portMap[port].state = stateMap[sv] || '1';
    });
    const ports = Object.values(portMap).map(p => ({
      ...p, portName: ifNames[p.port] || 'Port ' + p.port,
    })).sort((a, b) => parseInt(a.port) - parseInt(b.port));
    return { ports, _meta: { oidBase: `${PFX}.5.10.1.2`, enableValue: 1, disableValue: 0 } };
  }

  // Standard-MIB (LCOS, LCOS FX) — Fallback wenn private MIB nicht antwortet
  const ifNameOut = await runSnmpWalk(host, community, version, '1.3.6.1.2.1.31.1.1.1.1');
  const ifNames = {};
  ifNameOut.split('\n').forEach(line => {
    const m = line.match(/31\.1\.1\.1\.1\.(\d+)\s*=\s*(?:STRING:\s*)?"?([^"\n]+?)"?\s*$/);
    if (m) ifNames[m[1]] = m[2].trim();
  });

  const [stpOut, enableOut, bpIfOut] = await Promise.all([
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.17.2.15.1.3'),
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.17.2.15.1.4'),
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.17.1.4.1.2'),
  ]);
  const bpToIf = {};
  bpIfOut.split('\n').forEach(line => {
    const m = line.match(/17\.1\.4\.1\.2\.(\d+)\s*=\s*INTEGER:\s*(\d+)/);
    if (m) bpToIf[m[1]] = m[2];
  });
  const portMap = {};
  stpOut.split('\n').forEach(line => {
    const m = line.match(/17\.2\.15\.1\.3\.(\d+)\s*=\s*(.*)/);
    if (!m) return;
    const port = m[1];
    if (!portMap[port]) portMap[port] = { port };
    portMap[port].state = snmpVal(m[2]);
  });
  enableOut.split('\n').forEach(line => {
    const m = line.match(/17\.2\.15\.1\.4\.(\d+)\s*=\s*(.*)/);
    if (!m) return;
    const port = m[1];
    if (!portMap[port]) portMap[port] = { port };
    portMap[port].portEnabled = snmpVal(m[2]) !== '2';
  });
  const ports = Object.values(portMap).map(p => {
    const ifIdx = bpToIf[p.port];
    return { ...p, portName: ifIdx ? (ifNames[ifIdx] || 'If'+ifIdx) : 'Port '+p.port };
  }).sort((a, b) => parseInt(a.port) - parseInt(b.port));
  return { ports, _meta: { oidBase: '1.3.6.1.2.1.17.2.15.1.4', enableValue: 1, disableValue: 2 } };
}


// ── Loop-Erkennung (netzwerkweit) ─────────────────────────────────────────────
// Liest STP-Topologie-Änderungen + blockierte Ports + FDB-Instabilität
async function snmpLoopDetect(host, community, version) {
  const [tcOut, tsOut, stpPortOut, bp2ifOut, ifNameOut, ifOperOut, ifAdminOut, stdEnableOut2] = await Promise.all([
    runSnmpGet(host, community, version, ['1.3.6.1.2.1.17.2.4.0'], 3000),
    runSnmpGet(host, community, version, ['1.3.6.1.2.1.17.2.3.0'], 3000),
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.17.2.15.1.3'),
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.17.1.4.1.2'),
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.31.1.1.1.1'),
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.2.2.1.8'),
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.2.2.1.7'),
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.17.2.15.1.4'),
  ]);

  const ifNames = {};
  ifNameOut.split('\n').forEach(line => {
    const m = line.match(/31\.1\.1\.1\.1\.(\d+)\s*=\s*(?:STRING:\s*)?"?([^"\n]+?)"?\s*$/);
    if (m) ifNames[m[1]] = m[2].trim();
  });
  const bp2if = {};
  bp2ifOut.split('\n').forEach(line => {
    const m = line.match(/17\.1\.4\.1\.2\.(\d+)\s*=\s*INTEGER:\s*(\d+)/);
    if (m) bp2if[m[1]] = m[2];
  });
  const ifOperStatus = {};
  ifOperOut.split('\n').forEach(line => {
    const m = line.match(/2\.2\.1\.8\.(\d+)\s*=\s*INTEGER:\s*(\d+)/);
    if (m) ifOperStatus[m[1]] = parseInt(m[2]);
  });

  const _ticksToStr = (ticks) => {
    if (ticks === null || ticks === undefined) return null;
    const s = Math.floor(ticks / 100);
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600),
          mi = Math.floor((s % 3600) / 60), sec = s % 60;
    return d > 0 ? `${d}d ${h}h ${mi}m` : h > 0 ? `${h}h ${mi}m ${sec}s` : `${mi}m ${sec}s`;
  };

  let stpActive = false;
  let topoChanges = null;
  let topoTimeStr = null;
  const blockingPorts = [], brokenPorts = [];
  let mibType = 'none'; // 'standard', 'sx4', 'sx5'

  const hasStdMib = stpPortOut.trim().length > 0 && !stpPortOut.includes('No Such');

  if (hasStdMib) {
    // ── Standard Bridge MIB (LCOS, LCOS SX 3) ──
    mibType = 'standard';
    stpActive = true;
    const tcMatch = tcOut.match(/Counter32:\s*(\d+)|INTEGER:\s*(\d+)/);
    topoChanges = tcMatch ? parseInt(tcMatch[1] || tcMatch[2]) : null;
    const tsMatch = tsOut.match(/\((\d+)\)/);
    topoTimeStr = tsMatch ? _ticksToStr(parseInt(tsMatch[1])) : null;

    stpPortOut.split('\n').forEach(line => {
      const m = line.match(/17\.2\.15\.1\.3\.(\d+)\s*=\s*INTEGER:\s*(\d+)/);
      if (!m) return;
      const bp = m[1], state = parseInt(m[2]);
      const ifIdx = bp2if[bp];
      const name = ifIdx ? (ifNames[ifIdx] || `Port ${bp}`) : `Port ${bp}`;
      if (state === 2 || state === 3) blockingPorts.push(name);
      if (state === 6)               brokenPorts.push(name);
    });
  } else {
    // ── Private MIBs: probe SX 5 first (.2356.16), then SX 4 (.2356.14) ──
    const sx5probe = await runSnmpGet(host, community, version,
      ['1.3.6.1.4.1.2356.16.1.2.1.2.0'], 2000);

    if (sx5probe.includes('INTEGER') && !sx5probe.includes('No Such')) {
      // ── LCOS SX 5 private MIB ──
      mibType = 'sx5';
      const SX5 = '1.3.6.1.4.1.2356.16.1.2';
      const [sx5global, sx5portState] = await Promise.all([
        runSnmpWalk(host, community, version, `${SX5}.1`),
        runSnmpWalk(host, community, version, `${SX5}.2.3.1.13`),
      ]);
      const sx5Mode = (sx5probe.match(/INTEGER:\s*(\d+)/) || [])[1];
      const tcM = sx5global.match(/16\.1\.2\.1\.6\.0\s*=\s*(?:Gauge32|INTEGER):\s*(\d+)/);
      topoChanges = tcM ? parseInt(tcM[1]) : 0;
      const tsM = sx5global.match(/16\.1\.2\.1\.7\.0\s*=\s*(?:Gauge32|INTEGER):\s*(\d+)/);
      topoTimeStr = tsM ? _ticksToStr(parseInt(tsM[1])) : null;

      // STP is only truly active if mode != 0 AND at least one port participates
      // Per-port STP admin: col 5 (1=enabled, 2=disabled)
      const sx5PortAdmin = await runSnmpWalk(host, community, version, `${SX5}.2.3.1.5`);
      const anyPortStpOn = sx5PortAdmin.split('\n').some(l => /INTEGER:\s*1\b/.test(l));
      stpActive = !!(sx5Mode && sx5Mode !== '0' && anyPortStpOn);

      // RSTP port states: 1=discarding 2=learning 3=forwarding
      sx5portState.split('\n').forEach(line => {
        const m = line.match(/16\.1\.2\.2\.3\.1\.13\.(\d+)\s*=\s*INTEGER:\s*(\d+)/);
        if (!m) return;
        const port = m[1], state = parseInt(m[2]);
        const name = ifNames[port] || `Port ${port}`;
        if (state === 1 && ifOperStatus[port] === 1) blockingPorts.push(name);
      });
    } else {
      // ── LCOS SX 4 private MIB (.2356.14.2.18) ──
      const SX4 = '1.3.6.1.4.1.2356.14.2.18';
      const sx4global = await runSnmpWalk(host, community, version, `${SX4}.1`);
      if (sx4global.trim().length > 0 && !sx4global.includes('No Such')) {
        mibType = 'sx4';
        const modeM = sx4global.match(/14\.2\.18\.1\.1\.0\s*=\s*INTEGER:\s*(\d+)/);
        // SX 4 STP modes: 0=Disabled, 1=STP, 2=RSTP, 3=MSTP
        const sx4Mode = modeM ? modeM[1] : '0';
        stpActive = sx4Mode !== '0';
        const tcM = sx4global.match(/14\.2\.18\.1\.7\.0\s*=\s*INTEGER:\s*(\d+)/);
        topoChanges = tcM ? parseInt(tcM[1]) : 0;
        const tsM = sx4global.match(/14\.2\.18\.1\.8\.0\s*=\s*INTEGER:\s*(\d+)/);
        topoTimeStr = tsM ? _ticksToStr(parseInt(tsM[1])) : null;
      }
    }
  }

  // dot1dStpPortEnable (1=enabled, 2=disabled) by bridge port
  const stdEnableMap = {};
  stdEnableOut2.split('\n').forEach(line => {
    const m = line.match(/17\.2\.15\.1\.4\.(\d+)\s*=\s*(.*)/);
    if (!m) return;
    stdEnableMap[m[1]] = snmpVal(m[2]) !== '2';
  });

  // ── Loop Protection Status ──────────────────────────────────────────────────
  const lpProtectedPorts = [];
  const lpDetectedPorts  = [];
  let stpLpConflictCount = 0;

  if (mibType === 'sx5') {
    // SX 5: LP under .16.1.2.3
    const SX5LP = '1.3.6.1.4.1.2356.16.1.2.3';
    const [sx5LpGlobal, sx5LpPortEnable, sx5LpPortState] = await Promise.all([
      runSnmpGet(host, community, version, [`${SX5LP}.1.0`], 2000),
      runSnmpWalk(host, community, version, `${SX5LP}.8.1.2`),
      runSnmpWalk(host, community, version, `${SX5LP}.8.1.3`),
    ]);
    const lpGlobalEnabled = sx5LpGlobal.includes('INTEGER: 1');
    if (lpGlobalEnabled) {
      const lpEnable = {};
      sx5LpPortEnable.split('\n').forEach(line => {
        const m = line.match(/3\.8\.1\.2\.(\d+)\s*=\s*INTEGER:\s*(\d+)/);
        if (m) lpEnable[m[1]] = m[2] === '1';
      });
      sx5LpPortState.split('\n').forEach(line => {
        const m = line.match(/3\.8\.1\.3\.(\d+)\s*=\s*INTEGER:\s*(\d+)/);
        if (!m) return;
        const port = m[1];
        const name = ifNames[port] || `Port ${port}`;
        if (lpEnable[port]) lpProtectedPorts.push(name);
        if (m[2] !== '0') lpDetectedPorts.push(name);
      });
      Object.keys(lpEnable).forEach(port => {
        if (!lpEnable[port]) return;
        if (ifOperStatus[port] === 1 && stpActive) stpLpConflictCount++;
      });
    }
  } else {
    // SX 3/4: LP under .14.2.18.5/.6
    const PFX = '1.3.6.1.4.1.2356.14.2.18';
    const [privEnableOut, privStateOut] = await Promise.all([
      runSnmpWalk(host, community, version, `${PFX}.5.10.1.2`),
      runSnmpWalk(host, community, version, `${PFX}.6.2.1.3.1`),
    ]);
    const usePriv = privEnableOut.trim().length > 0 && !privEnableOut.includes('No Such');
    if (usePriv) {
      const lpEnable = {};
      privEnableOut.split('\n').forEach(line => {
        const m = line.match(/18\.5\.10\.1\.2\.(\d+)\s*=\s*(.*)/);
        if (m) lpEnable[m[1]] = snmpVal(m[2]) === '1';
      });
      privStateOut.split('\n').forEach(line => {
        const m = line.match(/18\.6\.2\.1\.3\.1\.(\d+)\s*=\s*(.*)/);
        if (!m) return;
        const port = m[1], sv = snmpVal(m[2]);
        const ifIdx = bp2if[port] || port;
        const name = ifNames[ifIdx] || ifNames[port] || `Port ${port}`;
        if (lpEnable[port]) lpProtectedPorts.push(name);
        if (sv === '1') lpDetectedPorts.push(name);
      });
      Object.keys(lpEnable).forEach(port => {
        if (!lpEnable[port]) return;
        const ifIdx = bp2if[port] || String(port);
        if (ifOperStatus[ifIdx] === 1 && stdEnableMap[port]) stpLpConflictCount++;
      });
    } else if (hasStdMib) {
      stpPortOut.split('\n').forEach(line => {
        const m = line.match(/17\.2\.15\.1\.3\.(\d+)\s*=\s*INTEGER:\s*(\d+)/);
        if (!m) return;
        const bp = m[1], state = parseInt(m[2]);
        const ifIdx = bp2if[bp];
        const name = ifIdx ? (ifNames[ifIdx] || `Port ${bp}`) : `Port ${bp}`;
        if (state === 2 || state === 6) lpDetectedPorts.push(name);
      });
    }
  }

  // Risk assessment
  const warnings = [];
  let risk = 'ok';
  if (lpDetectedPorts.length > 0) {
    risk = 'danger';
    warnings.push(`Loop erkannt auf ${lpDetectedPorts.length} Port(s): ${lpDetectedPorts.slice(0,3).join(', ')}`);
  }
  if (brokenPorts.length > 0) {
    if (risk === 'ok') risk = 'danger';
    warnings.push(`${brokenPorts.length} Port(s) defekt: ${brokenPorts.slice(0,3).join(', ')}`);
  }
  if (topoChanges !== null && topoChanges > 50) {
    if (risk === 'ok') risk = 'danger';
    warnings.push(`${topoChanges} Topologie-Änderungen (STP-Instabilität)`);
  } else if (topoChanges !== null && topoChanges > 5) {
    if (risk === 'ok') risk = 'warning';
    warnings.push(`${topoChanges} Topologie-Änderungen`);
  }
  if (blockingPorts.length > 0) {
    if (risk === 'ok') risk = 'warning';
    warnings.push(`${blockingPorts.length} Port(s) blockiert: ${blockingPorts.slice(0,3).join(', ')}`);
  }
  if (stpLpConflictCount > 0) {
    if (risk === 'ok') risk = 'warning';
    warnings.push(`${stpLpConflictCount} Port(s) mit Loop Protection + STP gleichzeitig aktiv`);
  }

  return { stpActive, topoChanges, topoTimeStr, blockingPorts, brokenPorts, lpProtectedPorts, lpDetectedPorts, stpLpConflictCount, warnings, risk };
}

module.exports = {
  parseBitmapPorts,
  snmpSystem,
  snmpInterfaces,
  snmpMac,
  snmpLldp,
  parseWdsConfig,
  parseWdsStatus,
  snmpWds,
  parseL2tpConfig,
  parseL2tpStatus,
  snmpL2tp,
  snmpWlan,
  snmpNeighborAps,
  snmpLxWlanNetworksSetup,
  snmpLxWlanSetSsid,
  decodeIfaceName,
  snmpWlanLcos,
  snmpVlanTrace,
  snmpVlan,
  snmpPortSettings,
  snmpSensors,
  snmpStpPrivate,
  snmpStpSx5,
  snmpStp,
  snmpPoe,
  snmpPortDiag,
  snmpLoopProtection,
  snmpLoopDetect,
};
