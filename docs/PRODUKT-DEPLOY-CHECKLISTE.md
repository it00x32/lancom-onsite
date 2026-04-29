# OnSite – Produkt-Deploy & Update (Checkliste, repo-spezifisch)

Diese Liste bezieht sich auf das OnSite-Projekt (**`onsite/`**): wo Daten liegen, was bei Installation/Update zu beachten ist, und wie ihr Kunden eine reproduzierbare Umgebung gebt.

---

## 1. Zwei Schichten: Programm vs. Daten

| Schicht | Inhalt | Bei Update typischerweise |
|--------|--------|---------------------------|
| **Installation (`BASE_DIR`)** | `server.js`, `src/`, `app.js`, `index.html`, `styles.css`, `package.json`, `addins/`, `node_modules`, `docker/` (Compose-Pfade), `scripte/` (Rollout-Vorlagen, wird beim Start ergänzt) | **ersetzt** (neuer Stand aus Release/Git) |
| **Daten (`DATA_DIR`)** | JSON-Dateien, Zertifikate, Logs, Syslog-Puffer, Config-Backups | **behalten** |

**Standard:** `DATA_DIR = <BASE_DIR>/data`  
**Optional (empfohlen für Produkt):** Umgebungsvariable **`ONSITE_DATA_DIR`** auf einen absoluten Pfad setzen (z. B. `/var/lib/onsite/data`). Dann können App und Daten physisch getrennt sein; ein Update ersetzt nur den App-Ordner.

Implementierung im Repo **`onsite/`**: `src/config.js` (alle Pfade unter `DATA_*` hängen daran).

---

## 2. Dateien unter `DATA_DIR` (Persistenz)

Alles, was ihr bei Migration/Backup mitnehmen müsst (Auszug; einzelne Module können weitere Dateien anlegen):

| Bereich | Datei / Ordner |
|--------|-----------------|
| Kern | `settings.json`, `devices.json`, `criteria.json`, `sdn.json`, `vars.json` |
| Lizenz | `license.json`, `trial.json` |
| NAC / RADIUS | `nac.json`, `nac-certs/`, `nac-radius-log.jsonl`, `freeradius.json` |
| Monitoring | `traps.json`, `syslog.json`, `alert-log.json`, `uptime.json` |
| Features | `roaming.json`, `roaming-state.json`, `topo-state.json`, `topo-changes.json`, `wifi-history.json` |
| Backups (Gerätekonfiguration) | `backups/<ip>/` (siehe `src/config-backup.js`, nutzt `DATA_DIR/backups`) |

**Nicht** unter `DATA_DIR`: **`addins/`** – liegt unter `BASE_DIR`; Custom-Add-ins gehen bei „frischem“ Deploy verloren, wenn ihr sie nicht separat sichert oder ins Release packt.

---

## 3. Installierbarkeit auf fremden Servern

- [ ] **Node-Version** dokumentieren (README: ≥ 18).
- [ ] **System-Abhängigkeiten**: `snmpget`/`snmpwalk`/`snmpbulkwalk` (Paket `snmp`), ggf. MIBs.
- [ ] **Ein Startbefehl**: `node server.js` oder systemd (Vorlage `deploy/systemd/onsite.service.example`).
- [ ] **Port & Bindung**: `PORT` per Env (siehe `src/config.js`); UDP-Ports für Traps/Syslog/RADIUS in Doku erwähnen (Kommentar in der systemd-Beispieldatei).
- [ ] **Produktions-Frontend**: `npm run build` vor Release, damit `app.js` aktuell ist (oder Build in CI).
- [ ] **`ONSITE_DATA_DIR`**: für Kunden anlegen, z. B. `sudo mkdir -p /var/lib/onsite/data && sudo chown www-data:www-data /var/lib/onsite/data` und in der Service-Unit setzen.

---

## 4. Updates ohne Datenverlust

- [ ] Update-Prozess **nur** App-Verzeichnis ersetzen (oder neues Image ziehen), **`DATA_DIR` unverändert lassen**.
- [ ] **Nie** `rm -rf data/` oder `ONSITE_DATA_DIR` im Update-Skript.
- [ ] Vor größeren Versionssprüngen: **Backup** von `DATA_DIR` (Tar oder eingebautes Config-Backup – das sichert Gerätekonfigurationen, nicht zwingend alle JSON-Dateien).
- [ ] **Schema-Änderungen**: neue Felder in JSON möglichst mit Defaults im Lesecode abfangen; bei Breaking Changes kurze Migrationsnotiz im Changelog.
- [ ] Version sichtbar machen: `APP_VERSION` in `src/config.js`, API `GET /api/version` (falls vorhanden) – für Support und „welche Version läuft?“.

---

## 5. Docker (falls ihr das anbietet)

- [ ] **Volume** nur für Daten mounten: z. B. `-v onsite-data:/data` und `Environment=ONSITE_DATA_DIR=/data`.
- [ ] App-Code im Image; bei `docker compose pull && up` bleibt das Volume erhalten.
- [ ] `FREERADIUS_DIR` liegt unter `BASE_DIR/docker/...` – bei reinem Daten-Volume ggf. Compose-Pfade oder Docs prüfen (FreeRADIUS-Integration).

---

## 6. systemd (aktuell im Repo)

- [ ] Unit aus Vorlage erzeugen: `sudo bash deploy/systemd/install-onsite-service.sh` (root) bzw. `… --unit-product` (www-data) — ersetzt `__ONSITE_INSTALL_ROOT__` und den `node`-Pfad.
- [ ] `WorkingDirectory` = App-Root (`BASE_DIR`) entspricht dem Repo-Root beim Installationslauf.
- [ ] Optional: `Environment=ONSITE_DATA_DIR=/var/lib/onsite/data`.
- [ ] User/Group mit Schreibrechten auf `ONSITE_DATA_DIR` und bei `--unit-product` auf den App-Ordner.
- [ ] Keine zweite Instanz auf demselben Port (siehe README / Traps).

---

## 7. Bekannte Stolpersteine (kurz)

- **`git pull` im gleichen Ordner wie produktive `data/`**: funktional möglich, aber fehleranfällig (Merge-Konflikte, versehentlich `data/` committed). Besser: Release-Archiv oder getrennter Datenpfad mit `ONSITE_DATA_DIR`.
- **`config-backup`**: nutzt `DATA_DIR/backups` (konsistent mit `ONSITE_DATA_DIR`).
- **pkg / Binary** (`process.pkg`): `BASE_DIR` = Verzeichnis der Binary; `ONSITE_DATA_DIR` ist dann besonders sinnvoll.

---

## 8. Minimal-„Produkt“-Ablauf (Beispiel)

1. Server: `/opt/onsite` = nur App, `/var/lib/onsite/data` = Daten.  
2. Service: `Environment=ONSITE_DATA_DIR=/var/lib/onsite/data`.  
3. Update: neues Release nach `/opt/onsite` entpacken, `npm ci --omit=dev`, `npm run build`, `systemctl restart onsite`.  
4. Daten unter `/var/lib/onsite/data` bleiben unangetastet.

---

*Stand: passend zu `src/config.js` mit Unterstützung für `ONSITE_DATA_DIR`.*
