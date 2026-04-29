#!/usr/bin/env bash
# OnSite: systemd-Unit installieren und Dienst starten.
# Aufruf als root aus dem Repo-Root, z. B.:
#   cd /opt/onsite
#   sudo bash deploy/systemd/install-onsite-service.sh
#   sudo bash deploy/systemd/install-onsite-service.sh --unit-product
#
# Standard-Vorlage: onsite.service.var-www-html-claude.example (User root)
# --unit-product: onsite.service.example (User www-data)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
UNIT_DST="/etc/systemd/system/onsite.service"
EXAMPLE="$SCRIPT_DIR/onsite.service.var-www-html-claude.example"

for _arg in "$@"; do
  case "$_arg" in
    -h|--help)
      echo "Usage: $0 [--unit-product]"
      echo "  (ohne Flag)   Vorlage: onsite.service.var-www-html-claude.example (root)"
      echo "  --unit-product Vorlage: onsite.service.example (www-data)"
      exit 0
      ;;
    --unit-product)
      EXAMPLE="$SCRIPT_DIR/onsite.service.example"
      ;;
    *)
      echo "Unbekannte Option: $_arg (siehe $0 --help)" >&2
      exit 1
      ;;
  esac
done

if [[ "${EUID:-0}" -ne 0 ]]; then
  echo "Bitte als root ausführen: sudo $0" >&2
  exit 1
fi

if [[ ! -f "$EXAMPLE" ]]; then
  echo "Vorlage fehlt: $EXAMPLE" >&2
  exit 1
fi

if [[ ! -f "$REPO_ROOT/server.js" ]]; then
  echo "server.js nicht gefunden unter: $REPO_ROOT" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node nicht im PATH gefunden." >&2
  exit 1
fi
NODE_BIN="$(command -v node)"
if [[ ! -x "$NODE_BIN" ]]; then
  echo "node nicht ausführbar: $NODE_BIN" >&2
  exit 1
fi

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

# Vorlage: __ONSITE_INSTALL_ROOT__ und /usr/bin/node — durch echte Pfade ersetzen
sed -e "s|/usr/bin/node|${NODE_BIN//|/\\|}|g" \
    -e "s|__ONSITE_INSTALL_ROOT__|${REPO_ROOT//|/\\|}|g" \
    "$EXAMPLE" > "$TMP"

install -m 644 -o root -g root "$TMP" "$UNIT_DST"

systemctl daemon-reload
systemctl enable onsite
systemctl restart onsite

echo ""
echo "Installiert: $UNIT_DST"
echo "Vorlage:     $(basename "$EXAMPLE")"
echo "Projektverzeichnis: $REPO_ROOT"
echo "Node:        $NODE_BIN"
echo ""
if systemctl is-active --quiet onsite; then
  systemctl status onsite --no-pager -l
else
  echo "FEHLER: Dienst ist nicht active. Log:" >&2
  journalctl -u onsite -n 35 --no-pager >&2
  exit 1
fi
