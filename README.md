# LANCOM OnSite

Lokales SNMP-Dashboard für LANCOM-Netzwerkgeräte. Kein Cloud-Zugang erforderlich – alle Abfragen laufen direkt per SNMP gegen die Geräte im lokalen Netz.

Optional: Geräte-Import aus der LANCOM Management Cloud (LMC).

---

## Voraussetzungen

| Tool | Zweck | Paket |
|------|-------|-------|
| **Node.js** >= 18 | Web-Server (kein npm nötig) | siehe unten |
| **snmpget / snmpwalk / snmpbulkwalk** | SNMP-Abfragen | `snmp` (apt) |

---

## Installation (Ubuntu / Debian)

### 1. Node.js installieren

```bash
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo bash -
sudo apt install -y nodejs

# Version prüfen (muss >= 18 sein)
node -v
```

### 2. SNMP-Tools installieren

```bash
sudo apt install -y snmp snmp-mibs-downloader
```

### 3. Projekt klonen

```bash
git clone https://github.com/it00x32/lancom-onsite.git
cd lancom-onsite
```

### 4. Starten

```bash
node server.js          # Port 3002 (Standard)
node server.js 8080     # Alternativer Port
```

Die Web-Oberfläche ist dann erreichbar unter `http://<server-ip>:<port>`

---

## Autostart mit systemd (empfohlen)

```bash
# 1. Projektverzeichnis einrichten
sudo cp -r lancom-onsite /opt/lancom-onsite
sudo chown -R www-data:www-data /opt/lancom-onsite

# 2. systemd-Service anlegen
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

# 3. Dienst aktivieren und starten
sudo systemctl daemon-reload
sudo systemctl enable --now lancom-onsite

# Status prüfen
sudo systemctl status lancom-onsite
```

> **Hinweis:** Den Pfad in `WorkingDirectory` und `ExecStart` an den tatsächlichen Ablageort des Projekts anpassen.

---

## Features

### Tabs

| Tab | Beschreibung |
|-----|-------------|
| **Geräte** | Zentrale Geräteliste mit Online/Offline-Status, LLDP-Nachbarn, WDS- und L2TPv3-Verbindungsanzahl, MAC-Adressen. Alle Sync-Aktionen über Buttons steuerbar. |
| **WiFi Mesh** | Alle WDS-Links über alle LX Access Points – RSSI-Farbkodierung (konfigurierbar), Filter nach Status/Suche. |
| **L2TPv3** | Alle L2TP-Endpunkte über alle LX Access Points – UP/DOWN-Status, Filter nach Status/Suche. |
| **Netzwerkplan** | Automatischer Topologie-Graph aus LLDP-, WDS- und L2TPv3-Daten. BFS-Baum-Layout mit Zoom/Pan/Drag. Detail-Panel pro Gerät. |
| **Scanner** | Subnetz oder IP-Bereich (z. B. `192.168.1.0/24` oder `192.168.1.1-254`) nach LANCOM-Geräten scannen und direkt importieren. |
| **LMC Import** | Geräteliste aus der LANCOM Management Cloud per API importieren (API-Key + Account-ID). |
| **Einstellungen** | SNMP Read/Write Community, SNMP-Version (v1/v2c), RSSI-Schwellwerte – serverseitig persistent. |
| **Gerät (Detail)** | System-Info, Interfaces, MAC/ARP-Tabelle, WLAN-Clients, LLDP-Nachbarn. |

### Sync-Aktionen (Tab „Geräte")

| Button | Funktion |
|--------|---------|
| **Alle Daten abrufen** | Führt Status → WDS → L2TPv3 → LLDP nacheinander aus und aktualisiert den Netzwerkplan. |
| **Status** | Online/Offline-Prüfung aller Geräte per SNMP-Ping. |
| **LLDP** | LLDP-Nachbartabelle aller online Geräte abfragen. |
| **WDS** | WDS-Verbindungen aller online LX Access Points abfragen. |
| **L2TPv3** | L2TPv3-Endpunkte aller online LX Access Points abfragen. |
| **MAC** | Interface-MAC-Adressen aller online Geräte abfragen. |

### Design & Bedienung

- **Tag/Nacht-Modus:** Umschalter (☀️ / 🌙) in der Kopfzeile – Einstellung wird lokal gespeichert.
  - **Hell:** LANCOM Corporate Design (Navy, DM Sans, LANCOM-Blau)
  - **Dunkel:** LANCOM Corporate Dark (Deep Navy, helle Texte, gleiche Schriften)
- **Responsive:** Optimiert für Desktop-Browser.

---

## Unterstützte Geräte

| Gerät | OS | SNMP-Features |
|-------|----|---------------|
| LANCOM Router | LCOS | System, Interfaces, MAC/ARP, LLDP |
| LANCOM Switches (GS-2xxx) | LCOS SX | System, Interfaces, MAC/ARP, LLDP |
| LANCOM Access Points | LCOS LX | System, Interfaces, MAC/ARP, LLDP, WLAN-Clients, WiFi Mesh (WDS), L2TPv3 |
| LANCOM Access Points | LCOS | System, Interfaces, MAC/ARP, LLDP |
| LANCOM Firewalls | LCOS FX | System, Interfaces, MAC/ARP, LLDP |
| Andere SNMP-Geräte | MIB-II | System, Interfaces, MAC/ARP, LLDP |

---

## SNMP am LANCOM-Gerät aktivieren

| Betriebssystem | Pfad |
|----------------|------|
| **LCOS** | Gerätekonfiguration → Management → SNMP → SNMPv2 aktivieren, Read-Community eintragen |
| **LCOS LX** | Gerätekonfiguration → Management → SNMP → SNMPv2 aktivieren, Read-Community eintragen |
| **LCOS SX** | Gerätekonfiguration → Management → SNMP → SNMPv2 aktivieren, Read-Community eintragen |
| **LCOS FX** | Gerätekonfiguration → Verwaltung → SNMP aktivieren |

---

## Technische Details

### LLDP

LANCOM-Geräte verwenden den **IEEE-802.1AB-Pfad** (`1.0.8802.1.1.2`) für LLDP, nicht den IANA-Pfad (`1.3.6.1.2.1.111`). Der Server fragt beide OIDs parallel ab und wählt automatisch den richtigen.

### Netzwerk-Scanner

Der Scanner nutzt **Server-Sent Events (SSE)** für Echtzeit-Rückmeldung. Es werden bis zu 20 Hosts gleichzeitig per SNMP geprüft (2 Sekunden Timeout pro Host). Nur Geräte, die als LANCOM erkannt werden (anhand `sysDescr` / `sysObjectID`), erscheinen in der Ergebnisliste.

### Datenpersistenz

Alle Daten liegen unter `data/` im Projektverzeichnis (nicht im Git-Repository):

| Datei | Inhalt |
|-------|--------|
| `data/settings.json` | SNMP-Einstellungen, RSSI-Schwellwerte, letztes Scan-Subnetz |
| `data/devices.json` | Geräteliste mit Status, LLDP-, WDS- und L2TP-Daten |

### Architektur

- **server.js** – Node.js HTTP-Server ohne externe Abhängigkeiten (nur Built-in-Module)
- **index.html** – Single-Page-App (HTML + CSS + JavaScript, kein Build-Schritt)
- Kein npm, kein Webpack, kein Framework

---

## Lizenz

MIT
