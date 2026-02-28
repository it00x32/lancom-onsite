# LANCOM OnSite

Lokales SNMP-Dashboard für LANCOM-Netzwerkgeräte. Kein Cloud-Zugang erforderlich – alle Abfragen laufen direkt per SNMP gegen die Geräte im lokalen Netz. Optional: LMC-Import zum Befüllen der Geräteliste aus der LANCOM Management Cloud.

## Voraussetzungen

| Tool | Zweck | Paket |
|------|-------|-------|
| **Node.js** >= 18 | Web-Server (kein npm nötig) | siehe unten |
| **snmpwalk** / **snmpbulkwalk** / **snmpget** | SNMP-Abfragen gegen Geräte | `snmp` |

## Installation (Ubuntu / Debian)

```bash
# 1. Node.js installieren (via NodeSource, LTS)
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo bash -
sudo apt install -y nodejs

# Node.js-Version prüfen (muss >= 18 sein)
node -v

# 2. SNMP-Tools installieren
sudo apt install -y snmp snmp-mibs-downloader

# 3. Projekt klonen
git clone https://github.com/it00x32/lancom-onsite.git
cd lancom-onsite

# 4. Starten
node server.js          # Port 3000 (Standard)
node server.js 3002     # Alternativer Port
```

Die Web-Oberfläche ist dann erreichbar unter `http://<server-ip>:<port>`

## Autostart mit systemd (Ubuntu)

```bash
# 1. Service-Datei anlegen
sudo tee /etc/systemd/system/lancom-onsite.service > /dev/null <<EOF
[Unit]
Description=LANCOM OnSite SNMP Web Server
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/lancom-onsite
ExecStart=/usr/bin/node server.js 3002
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

# 2. Projektverzeichnis nach /opt kopieren (oder Pfad in der .service anpassen)
sudo cp -r lancom-onsite /opt/lancom-onsite
sudo chown -R www-data:www-data /opt/lancom-onsite

# 3. Dienst aktivieren und starten
sudo systemctl daemon-reload
sudo systemctl enable --now lancom-onsite

# Status prüfen
sudo systemctl status lancom-onsite
```

## Features

| Tab | Beschreibung |
|-----|-------------|
| **Geräte** | Zentrale Geräteliste mit Status (online/offline), LLDP-Nachbarn, WDS- und L2TPv3-Verbindungsanzahl, MAC-Adressen. Alle Sync-Aktionen (Daten Abrufen, Status, LLDP, WDS, L2TPv3, MAC) |
| **WiFi Mesh** | Flat-Liste aller WDS-Links über alle LX APs, RSSI-Farbkodierung (konfigurierbar), Filter nach Status/Suche |
| **L2TPv3** | Flat-Liste aller L2TP-Endpunkte über alle LX APs, UP/DOWN-Status, Filter nach Status/Suche |
| **Netzwerkplan** | Automatischer Topologie-Graph aus LLDP-, WDS- und L2TPv3-Daten. BFS-Baum-Layout, Zoom/Pan, Detail-Panel pro Gerät. Offline-Geräte werden bei L2TP-Verbindungen trotzdem angezeigt |
| **Scanner** | Subnetz oder IP-Bereich nach LANCOM-Geräten scannen, Ergebnisse direkt in die Geräteliste importieren |
| **LMC Import** | Geräte aus der LANCOM Management Cloud importieren (API-Key + Account-ID) |
| **Einstellungen** | SNMP Read/Write Community, SNMP-Version, RSSI-Schwellwerte – serverseitig persistent |
| **Gerät (Detail)** | System-Info, Interfaces, Verbundene Geräte (MAC+ARP), WLAN-Clients, LLDP-Nachbarn |

### Sync-Aktionen (Tab "Geräte")

| Button | Funktion |
|--------|---------|
| **Daten Abrufen** | Alle Phasen in Folge: Status → WDS → L2TPv3 → LLDP, danach Netzwerkplan aktualisieren |
| **Status** | Online/Offline-Status aller Geräte per SNMP-Ping aktualisieren |
| **LLDP** | LLDP-Nachbartabelle aller online Geräte abfragen |
| **WDS** | WDS-Verbindungen aller online LX Access Points abfragen |
| **L2TPv3** | L2TPv3-Endpunkte aller online LX Access Points abfragen |
| **MAC** | Interface-MAC-Adressen aller online Geräte abfragen |

## Unterstützte Geräte

| Gerät | Typ | SNMP-Features |
|-------|-----|---------------|
| LANCOM Router (LCOS) | Router | System, Interfaces, MAC/ARP, LLDP |
| LANCOM Switches (LCOS SX, GS-2xxx) | Switch | System, Interfaces, MAC/ARP, LLDP |
| LANCOM Access Points (LCOS LX) | LX AP | System, Interfaces, MAC/ARP, LLDP, WLAN-Clients, WiFi Mesh (WDS), L2TPv3 |
| LANCOM Access Points (LCOS) | LCOS AP | System, Interfaces, MAC/ARP, LLDP |
| LANCOM Firewalls (LCOS FX) | Firewall | System, Interfaces, MAC/ARP, LLDP |
| Andere SNMP-Geräte | Unknown | System, Interfaces, MAC/ARP, LLDP (MIB-II) |

## SNMP am LANCOM-Gerät aktivieren

| Betriebssystem | Pfad |
|----------------|------|
| **LCOS** | Gerätekonfiguration → Management → SNMP → SNMPv2 aktivieren, Community eintragen |
| **LCOS LX** | Gerätekonfiguration → Management → SNMP → SNMPv2 aktivieren, Read-Community eintragen |
| **LCOS SX** | Gerätekonfiguration → Management → SNMP → SNMPv2 aktivieren, Community eintragen |
| **LCOS FX** | Gerätekonfiguration → Verwaltung → SNMP aktivieren |

## LLDP-Hinweis

LANCOM-Geräte verwenden den **IEEE-802.1AB-Pfad** (`1.0.8802.1.1.2`) für LLDP, nicht den IANA-Pfad (`1.3.6.1.2.1.111`). Der Server fragt beide OIDs parallel ab und verwendet automatisch den richtigen.

## Datenpersistenz

Alle Daten liegen unter `data/` im Projektverzeichnis (werden nicht ins Git eingecheckt):

| Datei | Inhalt |
|-------|--------|
| `data/settings.json` | SNMP-Einstellungen, RSSI-Schwellwerte, letztes Scan-Subnetz |
| `data/devices.json` | Geräteliste mit Status, LLDP-, WDS- und L2TP-Daten |
