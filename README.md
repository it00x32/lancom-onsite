# OnSite

Lokales SNMP-Dashboard für Netzwerkgeräte. Kein Cloud-Zugang erforderlich – alle Abfragen laufen direkt per SNMP gegen die Geräte im lokalen Netz.

Optional: Geräte-Import aus der LANCOM Management Cloud (LMC).

---

## Voraussetzungen

| Tool | Zweck | Paket |
|------|-------|-------|
| **Node.js** >= 18 | Web-Server (kein npm nötig) | NodeSource (siehe unten) |
| **snmpget / snmpwalk / snmpbulkwalk** | SNMP-Abfragen | `snmp` (apt) |
| **curl** | NodeSource-Setup-Skript herunterladen | `curl` (apt) |
| **git** | Repository klonen | `git` (apt) |

---

## Installation (Ubuntu / Debian)

### 1. System aktualisieren

```bash
sudo apt update && sudo apt upgrade -y
```

### 2. Hilfspakete installieren

`curl` wird für das NodeSource-Installationsskript benötigt, `git` zum Klonen des Repositories.

```bash
sudo apt install -y curl git
```

### 3. Node.js installieren

Node.js ist in den Standard-Ubuntu-Paketquellen oft veraltet. Über NodeSource wird die aktuelle LTS-Version installiert:

```bash
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo bash -
sudo apt install -y nodejs

# Version prüfen (muss >= 18 sein)
node -v
```

### 4. SNMP-Tools installieren

Das Paket `snmp` enthält `snmpget`, `snmpwalk` und `snmpbulkwalk`, die der Server intern für alle Abfragen nutzt. `snmp-mibs-downloader` lädt die Standard-MIB-Dateien nach (empfohlen, aber optional).

```bash
sudo apt install -y snmp snmp-mibs-downloader
```

Nach der Installation die MIB-Nutzung in der SNMP-Konfiguration aktivieren:

```bash
# Zeile "mibs :" auskommentieren, damit alle MIBs geladen werden
sudo sed -i 's/^mibs :$/# mibs :/' /etc/snmp/snmp.conf
```

### 5. Projekt klonen

```bash
git clone https://github.com/it00x32/lancom-onsite.git
cd lancom-onsite
```

### 6. Starten

```bash
node server.js          # Port 3002 (Standard)
node server.js 8080     # Alternativer Port
```

Die Web-Oberfläche ist dann erreichbar unter `http://<server-ip>:<port>`

### 7. Firewall-Freigabe (falls ufw aktiv)

```bash
# Prüfen ob ufw aktiv ist
sudo ufw status

# Port 3002 freigeben (oder den gewählten Port)
sudo ufw allow 3002/tcp
sudo ufw reload
```

---

## Autostart mit systemd (empfohlen)

```bash
# 1. Projektverzeichnis einrichten
sudo cp -r lancom-onsite /opt/onsite
sudo chown -R www-data:www-data /opt/onsite

# 2. systemd-Service anlegen
sudo tee /etc/systemd/system/onsite.service > /dev/null <<EOF
[Unit]
Description=OnSite SNMP Web Server
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/onsite
ExecStart=/usr/bin/node server.js 3002
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

# 3. Dienst aktivieren und starten
sudo systemctl daemon-reload
sudo systemctl enable --now onsite

# Status prüfen
sudo systemctl status onsite
```

> **Hinweis:** Den Pfad in `WorkingDirectory` und `ExecStart` an den tatsächlichen Ablageort des Projekts anpassen.

---

## Features

### Tabs

| Tab | Beschreibung |
|-----|-------------|
| **Geräte** | Zentrale Geräteliste mit Online/Offline-Status, Standort, LLDP-Nachbarn, WDS- und L2TPv3-Verbindungsanzahl, MAC-Adressen. Filter nach Status und Standort. |
| **WiFi Mesh** | Alle WDS-Links über alle LX Access Points – RSSI-Farbkodierung, Standort-Spalte, Filter nach Status und Standort. |
| **L2TPv3** | Alle L2TP-Endpunkte über alle LX Access Points – UP/DOWN-Status, Standort-Spalte, Filter nach Status und Standort. |
| **Netzwerkplan** | Automatischer Topologie-Graph aus LLDP-, WDS- und L2TPv3-Daten. BFS-Baum-Layout mit Zoom/Pan/Drag. Standort-Filter und Standort-Anzeige auf jedem Node. |
| **Scanner** | Subnetz oder IP-Bereich scannen und direkt importieren. Standort kann beim Import zugewiesen werden (vorhandener Standort wählen oder neuen eingeben). |
| **LMC Import** | Geräteliste aus der LANCOM Management Cloud importieren – liest automatisch den Standort (`siteName`) aus. |
| **Einstellungen** | SNMP Read/Write Community, SNMP-Version (v1/v2c), RSSI-Schwellwerte – serverseitig persistent. |
| **Gerät (Detail)** | System-Info, Interfaces, MAC/ARP-Tabelle, WLAN-Clients, LLDP-Nachbarn. |

### Sync-Aktionen (Tab „Geräte")

| Button | Funktion |
|--------|---------|
| **Alle Daten abrufen** | Führt Status → WDS → L2TPv3 → LLDP → MAC nacheinander aus und aktualisiert den Netzwerkplan. |
| **Status** | Online/Offline-Prüfung per SNMP-Ping. |
| **LLDP** | LLDP-Nachbartabelle abfragen. |
| **WDS** | WDS-Verbindungen der LX Access Points abfragen. |
| **L2TPv3** | L2TPv3-Endpunkte der LX Access Points abfragen. |
| **MAC** | Interface-MAC-Adressen abfragen. |

> **Standort-Filter:** Wenn unter „Geräte" ein Standort ausgewählt ist, werden alle Sync-Aktionen nur auf Geräte dieses Standorts angewendet.

### Standort-Verwaltung

- **LMC Import:** Standort (`siteName`) wird automatisch aus der LMC API übernommen.
- **Scanner:** Standort kann beim Scan frei eingegeben oder aus vorhandenen Standorten gewählt werden.
- **Filter:** Jeder Tab (Geräte, WiFi Mesh, L2TPv3, Netzwerkplan) hat einen Standort-Dropdown.
- **Netzwerkplan:** Standort wird auf jedem Node-Karte angezeigt (📍). Filter blendet alle Geräte anderer Standorte aus.

### Design & Bedienung

- **Tag/Nacht-Modus:** Umschalter (☀️ / 🌙) in der Kopfzeile – Einstellung wird lokal gespeichert.

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

## SNMP am Gerät aktivieren

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

Der Scanner nutzt **Server-Sent Events (SSE)** für Echtzeit-Rückmeldung. Es werden bis zu 20 Hosts gleichzeitig per SNMP geprüft (2 Sekunden Timeout pro Host). Nur unterstützte Geräte (anhand `sysDescr` / `sysObjectID`) erscheinen in der Ergebnisliste.

### Datenpersistenz

Alle Daten liegen unter `data/` im Projektverzeichnis (nicht im Git-Repository):

| Datei | Inhalt |
|-------|--------|
| `data/settings.json` | SNMP-Einstellungen, RSSI-Schwellwerte, letztes Scan-Subnetz |
| `data/devices.json` | Geräteliste mit Status, LLDP-, WDS-, L2TP-Daten und Standorten |

### Architektur

- **server.js** – Node.js HTTP-Server ohne externe Abhängigkeiten (nur Built-in-Module)
- **index.html** – Single-Page-App (HTML + CSS + JavaScript, kein Build-Schritt)
- Kein npm, kein Webpack, kein Framework

---

## Lizenz

MIT
