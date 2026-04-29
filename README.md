# OnSite

Lokales SNMP-Dashboard für Netzwerkgeräte. Kein Cloud-Zugang erforderlich – alle Abfragen laufen direkt per SNMP gegen die Geräte im lokalen Netz.

Optional: Geräte-Import aus der LANCOM Management Cloud (LMC).

**Deployment, getrennte Daten, Updates:** [`docs/PRODUKT-DEPLOY-CHECKLISTE.md`](docs/PRODUKT-DEPLOY-CHECKLISTE.md) — optional Umgebungsvariable **`ONSITE_DATA_DIR`** (absolute Pfadangabe), damit die App aktualisiert werden kann, ohne `./data` im Installationsordner zu überschreiben.

**GitHub:** Repository-URL ist **`https://github.com/it00x32/onsite`**. Umbenennung auf GitHub & Remote anpassen: [`docs/GITHUB-REPO-UMBENENNUNG.md`](docs/GITHUB-REPO-UMBENENNUNG.md).

---

## Voraussetzungen

| Tool | Zweck | Paket |
|------|-------|-------|
| **Node.js** >= 18 | Web-Server (kein npm nötig) | NodeSource (siehe unten) |
| **snmpget / snmpwalk / snmpbulkwalk** | SNMP-Abfragen | `snmp` (apt) |
| **curl** | NodeSource-Setup-Skript herunterladen | `curl` (apt) |
| **git** | Quellcode / Versionsverwaltung | `git` (apt) |

---

## Installation (Ubuntu / Debian)

### 1. System aktualisieren

```bash
sudo apt update && sudo apt upgrade -y
```

### 2. Hilfspakete installieren

`curl` wird für das NodeSource-Installationsskript benötigt, `git` für den Zugriff auf das Repository.

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

### 5. Quellcode holen (git)

Empfohlener Ordnername (einheitlich mit systemd-Vorlage): **`onsite`**.

```bash
git clone https://github.com/it00x32/onsite.git onsite
cd onsite
npm install --omit=dev
```

*(Remote-URL anpassen: `git remote set-url origin https://github.com/it00x32/onsite.git` — siehe auch `docs/GITHUB-REPO-UMBENENNUNG.md`.)*

### 6. Starten

```bash
node server.js          # Port 3004 (Standard)
node server.js 8080     # Alternativer Port
```

Die Web-Oberfläche ist dann erreichbar unter `http://<server-ip>:<port>`

### 7. Firewall-Freigabe (falls ufw aktiv)

```bash
# Prüfen ob ufw aktiv ist
sudo ufw status

# Port 3004 freigeben (oder den gewählten Port)
sudo ufw allow 3004/tcp
sudo ufw reload
```

---

## Autostart mit systemd (empfohlen)

**systemd:** Das Install-Skript setzt `WorkingDirectory` und `ExecStart` auf das **Projektverzeichnis (Repo-Root)**, aus dem es aufgerufen wird — also genau den Ordner, in dem ihr entwickelt und `server.js` liegt (kein fester Pfad im Code — Vorlage nutzt Platzhalter `__ONSITE_INSTALL_ROOT__`).

```bash
cd /pfad/zum/projektverzeichnis   # Repo-Root: dieselbe Stelle, in der auch server.js liegt
sudo bash deploy/systemd/install-onsite-service.sh
sudo systemctl restart onsite
```

### systemd-Unit aus dem Projektverzeichnis neu setzen

Der Arbeitsordner soll kanonisch **`onsite`** heißen (Ordnername). Unit und Pfade neu schreiben:

```bash
sudo systemctl stop onsite
cd /pfad/zum/projektverzeichnis   # Repo-Root mit server.js und index.html
sudo bash deploy/rename-to-onsite.sh
```

---

Vorlage **`deploy/systemd/onsite.service.example`** (User **`www-data`**, Platzhalter `__ONSITE_INSTALL_ROOT__`) — Installation aus dem Projektverzeichnis:

```bash
# 1. App nach /opt/onsite (o. ä.) legen
sudo cp -r onsite /opt/onsite
cd /opt/onsite && npm install --omit=dev
sudo chown -R www-data:www-data /opt/onsite

# 2. Unit erzeugen (Pfade + node automatisch) und Dienst starten
sudo bash deploy/systemd/install-onsite-service.sh --unit-product
```

### Logs & Fehlersuche

**Dienst startet nicht:** Zuerst aus dem Projektroot **`bash deploy/verify-onsite-install.sh`** — prüft `index.html`, `node_modules`, Node-Pfad. Dann **`sudo journalctl -u onsite -n 100 --no-pager`** (Fehlermeldung meist `ENOENT` bei fehlender `index.html`, **`EADDRINUSE`** bei belegtem Port, oder **falscher `ExecStart`**/`WorkingDirectory` in der Unit).

| Zweck | Befehl |
|--------|--------|
| Live-Log (systemd) | `sudo journalctl -u onsite -f` |
| Letzte Zeilen | `sudo journalctl -u onsite -n 150 --no-pager` |
| Nur eine Instanz? | `ss -tlnp \| grep 3004` — zweiter Prozess → oft **EADDRINUSE**, Dienst beendet sich |
| OOM (Speicher) | `journalctl -k -b \| grep -i oom` oder `dmesg \| tail` |

**Stacktrace / Log nennt `…/onsite-dev/index.html` und `…/onsite-dev/server.js`:** Der laufende Prozess kommt noch von der **alten Installation**. Häufig: ein **Drop-In** unter `/etc/systemd/system/onsite.service.d/*.conf` überschreibt `WorkingDirectory` oder `ExecStart` weiter mit `onsite-dev` — **`install-onsite-service.sh` allein** ändert nur die Hauptdatei `onsite.service`, die Drop-Ins bleiben und mergen sich **danach** wieder „falsch“ ein. Der aktuelle Code im Repo hat `sendStatic` **nicht** in Zeile 43 — ein Stack mit Zeile 43 ist **veraltete `server.js`** plus falscher Pfad.

**Behebung (empfohlen):** Im **Repo-Root, in dem ihr entwickelt** (z. B. `cd /var/www/html/claude/onsite`), **`sudo bash deploy/force-onsite-path.sh`** ausführen — ersetzt `onsite-dev` in Unit **und** Drop-Ins, sichert vorher, schreibt die Unit neu, `daemon-reload` + `restart`. Alternativ manuell: Drop-Ins prüfen (`ls /etc/systemd/system/onsite.service.d/`), alle Zeilen mit `onsite-dev` auf `…/onsite` korrigieren, dann **`sudo bash deploy/systemd/install-onsite-service.sh`** und **`sudo systemctl daemon-reload && sudo systemctl restart onsite`**. Prüfen: **`systemctl cat onsite`** — nirgends `onsite-dev`. **`pgrep -af 'node.*onsite'`** — kein Prozess mit `onsite-dev` im Pfad. Optional: **`bash deploy/verify-onsite-install.sh`**.

**`ENOENT` … `index.html`:** `WorkingDirectory`/`ExecStart` in der Unit müssen auf **dieselbe** Installation zeigen wie die Dateien (`index.html` im selben Ordner wie `server.js`). Aus dem Projektroot: **`sudo bash deploy/systemd/install-onsite-service.sh`** und **`sudo systemctl daemon-reload && sudo systemctl restart onsite`**. Beispiel: `WorkingDirectory=/opt/onsite`, `ExecStart=/usr/bin/node /opt/onsite/server.js` (Node-Pfad ggf. anpassen). Prüfen: `systemctl cat onsite`, `grep -rE '/onsite/|__ONSITE_INSTALL_ROOT__' /etc/systemd/system/ 2>/dev/null`.

**Stacktrace zeigt noch eine alte `server.js`:** Zwei Kopien der App oder ein **unvollständiges Projektverzeichnis** — Diagnose: **`bash deploy/diagnose-onsite.sh`**. Lösung: **eine** gültige Installation (`index.html` + `server.js` im selben Ordner), Unit neu installieren, Dienst neu starten.

**`sendStatic`-Fehler mit falschem Pfad zu `index.html`:** Oft **veraltete** `server.js` **oder** fehlende **`index.html`** im Ordner von `server.js`. Vorgehen: `ls index.html` im Installationsverzeichnis — fehlt die Datei → `git checkout -- index.html app.js styles.css` bzw. **`git pull`**. Danach **`sudo systemctl restart onsite`**. Nur **einen** aktiven Installationsordner nutzen (Unit-`ExecStart` = dieser Ordner).

- Vorlage **/opt/onsite:** `deploy/systemd/onsite.service.example`
- Vorlage **beliebiges Repo-Root (Platzhalter in der Datei):** `deploy/systemd/onsite.service.var-www-html-claude.example`

> **Hinweis:** `WorkingDirectory` und `ExecStart` in der Unit-Datei müssen zum **absoluten** Installationspfad passen (`/opt/onsite` ist nur ein Beispiel).

> **`scripte/`** und das **Datenverzeichnis** müssen für den Dienstbenutzer beschreibbar sein: Standard `./data` im Projektordner — bei **`ONSITE_DATA_DIR`** stattdessen diesen Pfad anlegen und `chown` setzen, z. B. `sudo chown -R www-data:www-data scripte/ data/` bzw. `… /var/lib/onsite/data`.

### Manuell mit Logdatei (ohne systemd)

```bash
chmod +x scripte/start-onsite.sh
./scripte/start-onsite.sh
# Ausgabe in log/onsite.log
```

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

MIT – siehe [LICENSE](LICENSE)

> Die Software wird ohne jegliche Gewährleistung bereitgestellt. Der Autor übernimmt keine Haftung für Schäden, die durch die Nutzung entstehen. Produktnamen wie LCOS, LCOS LX, LCOS SX, LCOS FX sind Eigentum der jeweiligen Hersteller. Der Autor steht in keiner Verbindung zu LANCOM Systems GmbH.
