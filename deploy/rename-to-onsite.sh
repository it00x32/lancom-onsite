#!/usr/bin/env bash
# Kanonischer Ordnername: .../onsite (kein Symlink). Setzt die systemd-Unit aus diesem Repo neu.
#
#   sudo bash deploy/rename-to-onsite.sh
#
set -euo pipefail

if [[ "${EUID:-0}" -ne 0 ]]; then
  echo "Als root: sudo $0" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"

has_index() { [[ -f "$1/index.html" && -f "$1/server.js" ]]; }

if [[ "$(basename "$REPO")" != "onsite" ]]; then
  echo "Abbruch: Erwarteter Ordnername ist onsite (aktuell: $(basename "$REPO"))." >&2
  exit 1
fi

if ! has_index "$REPO"; then
  echo "Abbruch: $REPO — index.html oder server.js fehlt." >&2
  exit 1
fi

systemctl stop onsite 2>/dev/null || true
cd "$REPO"
bash deploy/systemd/install-onsite-service.sh
echo "Fertig. Projektroot: $REPO"
