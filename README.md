# LANCOM OnSite

Lokales SNMP-Dashboard für LANCOM-Geräte. Kein Cloud-Zugang erforderlich – alle Abfragen laufen direkt per SNMP gegen das Gerät.

## Voraussetzungen

- **Node.js** >= 16
- **snmp-utils** (snmpwalk / snmpbulkwalk)

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

## Nutzung

1. IP-Adresse oder Hostname des Geräts eingeben
2. SNMP-Community eingeben (Standard: `public`)
3. SNMP-Version wählen (Standard: SNMPv2c)
4. Auf **Abfragen** klicken (oder Enter drücken)

**URL-Parameter** für direkte Verlinkung:
```
http://server:3000/?host=192.168.1.1&community=public
```

## Features

| Tab | Inhalt |
|-----|--------|
| Gerät | Gerätename, Beschreibung, Uptime, Standort, Kontakt |
| Interfaces | Status (UP/DOWN), Geschwindigkeit, RX/TX-Traffic |
| Verbundene Geräte | MAC-Adresstabelle (FDB) + ARP-Tabelle mit IP-Zuordnung |
| WLAN-Clients | Verbundene WLAN-Clients (LANCOM LCOS LX Access Points) |
| LLDP-Nachbarn | Benachbarte Geräte via LLDP |
| WiFi Mesh | WDS-Links mit Band, Status, Signal, Peer-MAC, Tx/Rx, WPA (nur LCOS LX) |
| L2TPv3 | L2TP-Endpunkte mit Gegenstelle, Remote-IP, Port, Status, Interface, Verbindungszeit (nur LCOS LX) |
| Scanner | Subnetz/IP-Bereich nach LANCOM-Geräten durchsuchen, direkt auswählen und abfragen |

## Unterstützte Geräte

- LANCOM Router und Switches (LCOS)
- LANCOM Access Points (LCOS LX) – inkl. WLAN-Client-Tabelle
- Alle anderen SNMP-fähigen Geräte (MIB-II Standard)

## SNMP-Voraussetzungen am Gerät

Am abzufragenden LANCOM-Gerät muss SNMP aktiviert und die verwendete Community erlaubt sein:

- **LCOS**: Gerätekonfiguration → Management → SNMP → SNMPv2 aktivieren, Community eintragen
- **LCOS LX**: Gerätekonfiguration → Management → SNMP → SNMPv2 aktivieren, Read-Community eintragen
