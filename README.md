# LANCOM OnSite

Lokales SNMP-Dashboard für LANCOM-Geräte. Kein Cloud-Zugang erforderlich – alle Abfragen laufen direkt per SNMP gegen das Gerät. Optional: LMC-Import zum Befüllen der Geräteliste aus der LANCOM Management Cloud.

## Voraussetzungen

- **Node.js** >= 16
- **snmp-utils** (snmpwalk / snmpbulkwalk / snmpget)

```bash
# Ubuntu / Debian
apt install snmp

# Fedora / RHEL
dnf install net-snmp-utils
```

## Installation

```bash
git clone https://github.com/it00x32/lancom-onsite.git
cd lancom-onsite
node server.js        # Port 3000 (Standard)
node server.js 3002   # Alternativer Port
```

Die Web-Oberfläche ist dann erreichbar unter: `http://<server-ip>:<port>`

## Autostart mit systemd

```bash
# Service-Datei anlegen
cat > /etc/systemd/system/lancom-onsite.service <<EOF
[Unit]
Description=LANCOM OnSite SNMP Web Server
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/lancom-onsite
ExecStart=/usr/bin/node server.js 3000
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now lancom-onsite
```

Persistente Daten (Geräteliste, Einstellungen) werden unter `data/` im Arbeitsverzeichnis gespeichert.

## Features

| Tab | Inhalt |
|-----|--------|
| **WiFi Mesh** | Flat-Liste aller WDS-Links über alle LX APs, RSSI-Farbkodierung (konfigurierbar), Filter (Status/Suche), Sync-alle + Einzel-Sync (nur LCOS LX) |
| **L2TPv3** | Flat-Liste aller L2TP-Endpunkte über alle LX APs, UP/DOWN-Status, Filter (Status/Suche), Sync-alle + Einzel-Sync (nur LCOS LX) |
| **Geräte** | Serverseitige Geräteliste (multi-browser), Filter nach Typ (LX AP, LCOS AP, Switch, Router, Firewall), Quellen: Scanner + LMC Import |
| **Scanner** | Subnetz/IP-Bereich nach LANCOM-Geräten durchsuchen, Ergebnisse in Geräteliste speichern, Community/Version aus Einstellungen |
| **LMC Import** | LANCOM Management Cloud API, Account-/Projekt-Auswahl, Geräte-Sync in lokale Geräteliste (API-Token nur im Browser) |
| **Einstellungen** | SNMP Read/Write Community, SNMP-Version, RSSI-Schwellwerte (grün/gelb/orange) – serverseitig persistent |
| **Gerät (Detail)** | System, Interfaces, Verbundene Geräte (MAC+ARP), WLAN-Clients, LLDP-Nachbarn – Sub-Tabs pro Gerät |

## Unterstützte Geräte

| Typ | Erkannt als | SNMP-Features |
|-----|-------------|---------------|
| LANCOM Router (LCOS) | Router | System, Interfaces, MAC/ARP, LLDP |
| LANCOM Switches (LCOS SX) | Switch | System, Interfaces, MAC/ARP, LLDP |
| LANCOM Access Points (LCOS LX) | LX AP | System, Interfaces, MAC/ARP, LLDP, **WLAN-Clients, WiFi Mesh, L2TPv3** |
| LANCOM Access Points (LCOS) | LCOS AP | System, Interfaces, MAC/ARP, LLDP |
| LANCOM Firewalls (LCOS FX) | Firewall | System, Interfaces, MAC/ARP, LLDP |
| Andere SNMP-Geräte | Unknown | System, Interfaces, MAC/ARP, LLDP (MIB-II) |

## SNMP-Voraussetzungen am Gerät

Am abzufragenden LANCOM-Gerät muss SNMP aktiviert und die verwendete Community erlaubt sein:

- **LCOS**: Gerätekonfiguration → Management → SNMP → SNMPv2 aktivieren, Community eintragen
- **LCOS LX**: Gerätekonfiguration → Management → SNMP → SNMPv2 aktivieren, Read-Community eintragen

## Datenpersistenz

Alle serverseitigen Daten liegen unter `data/` im Projektverzeichnis:

| Datei | Inhalt |
|-------|--------|
| `data/settings.json` | SNMP-Einstellungen, RSSI-Schwellwerte, letztes Scan-Subnetz |
| `data/devices.json` | Geräteliste (IP, Name, Typ, OS, Community, Quelle) |
