# FreeRADIUS mit OnSite

Die Datei `clients.conf` wird **von OnSite** aus **Sicherheit → FreeRADIUS** erzeugt (`data/freeradius.json` ist die Quelle; beim Speichern wird `docker/freeradius/clients.conf` geschrieben).

## Voraussetzungen

- Docker und Docker Compose (Image: **`freeradius/freeradius-server`** — auf Docker Hub; der Name `freeradius/freeradius` ist ungültig.)
- **OnSite-UI (FreeRADIUS):** Status, Start und Stopp rufen die Docker-CLI auf (`docker inspect`, `docker compose`). OnSite sucht die Binary u. a. unter `/usr/bin/docker`, falls der Server-Prozess ein **zu kurzes PATH** hat (sonst „Docker-CLI nicht gefunden“).
- Der **Betriebsbenutzer** des OnSite-Prozesses braucht Zugriff auf den Docker-Socket (z. B. Mitgliedschaft in der Gruppe `docker` unter Linux) — sonst erscheint ein Docker-Fehler (Permission denied o. Ä.).
- **AppArmor / LXC (Proxmox):** Wenn Docker meldet, dass das Profil `docker-default` nicht geladen werden kann („Access denied“), enthält `docker-compose.freeradius.yml` bereits `security_opt: apparmor:unconfined` für den FreeRADIUS-Container — damit startet der Dienst auf typischen LXC-Gast-Systemen.
- **Portkonflikt:** Der **eingebettete** RADIUS in OnSite und FreeRADIUS dürfen **nicht** gleichzeitig **1812/1813** auf demselben Host binden. Entweder eingebetteten RADIUS in OnSite deaktivieren oder in `docker-compose.freeradius.yml` andere **Host-Ports** verwenden, z. B.:

  ```yaml
  ports:
    - "11812:1812/udp"
    - "11813:1813/udp"
  ```

## Start

```bash
cd /pfad/zu/onsite
docker compose -f docker-compose.freeradius.yml up -d
```

## Nach Änderungen in OnSite

OnSite überschreibt `docker/freeradius/clients.conf`. Den Container **neu laden**, damit FreeRADIUS die Datei erneut einliest:

```bash
docker compose -f docker-compose.freeradius.yml restart freeradius
```

oder:

```bash
docker kill -s HUP onsite-freeradius
```

(Erfolg abhängig von Image und Version — bei Zweifeln `restart`.)

## Test

```bash
radtest USER PASSWORD 127.0.0.1 0 SECRET
```

(`radtest` im Paket `freeradius-utils` oder im Container.)

## EAP-TLS

Die von OnSite generierte Konfiguration betrifft zunächst **NAS-Clients** (`clients.conf`). Volles **EAP-TLS** erfordert zusätzliche FreeRADIUS-Module (`eap`), Zertifikate unter `raddb/certs/` und weitere Dateien im Image — das kann man manuell im Container ergänzen oder ein eigenes `raddb`-Verzeichnis mounten. Die **Zertifikatsablage** in OnSite (`data/nac-certs`) kann als Quelle dienen; Pfade müssen mit dem EAP-Modul übereinstimmen.

## Ohne Docker

Systempaket `freeradius` installieren und die von OnSite erzeugte `clients.conf` nach `/etc/freeradius/3.0/clients.conf` kopieren (Pfad je nach Distribution anpassen).
