#!/usr/bin/env bash
# Wenn Logs noch »…/onsite-dev/…« zeigen, obwohl der Ordner weg ist:
# meist verweisen die Haupt-Unit ODER ein Drop-In unter onsite.service.d/ noch auf onsite-dev.
#
#   cd /pfad/zum/projektverzeichnis     # Repo-Root, z. B. …/claude/onsite
#   sudo bash deploy/force-onsite-path.sh
#   sudo bash deploy/force-onsite-path.sh --unit-product
#
set -euo pipefail

if [[ "${EUID:-0}" -ne 0 ]]; then
  echo "Als root: sudo $0" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ ! -f "$REPO/server.js" ]] || [[ ! -f "$REPO/index.html" ]]; then
  echo "Abbruch: $REPO — server.js oder index.html fehlt." >&2
  exit 1
fi

REAL="$(cd "$REPO" && pwd -P)"
echo "[force-onsite-path] Projektverzeichnis (Repo-Root): $REAL"
echo ""

UNIT_MAIN="/etc/systemd/system/onsite.service"
DROP_DIR="/etc/systemd/system/onsite.service.d"

shopt -s nullglob
FILES=("$UNIT_MAIN")
if [[ -d "$DROP_DIR" ]]; then
  for f in "$DROP_DIR"/*.conf; do FILES+=("$f"); done
fi

FOUND=0
for f in "${FILES[@]}"; do
  if [[ -f "$f" ]] && grep -q 'onsite-dev' "$f" 2>/dev/null; then
    echo "[force-onsite-path] Treffer: $f"
    grep -n 'onsite-dev' "$f" || true
    FOUND=1
    echo ""
  fi
done

BAK="/root/onsite-systemd-backup-$(date +%Y%m%d%H%M%S).tgz"
echo "[force-onsite-path] Backup nach $BAK"
TAR_ARGS=(etc/systemd/system/onsite.service)
[[ -d "$DROP_DIR" ]] && TAR_ARGS+=(etc/systemd/system/onsite.service.d)
tar czf "$BAK" -C / "${TAR_ARGS[@]}" 2>/dev/null || echo "  (Backup-Hinweis: einzelne Pfade fehlen — ok)"
echo ""

if [[ "$FOUND" -eq 1 ]]; then
  echo "[force-onsite-path] Ersetze »onsite-dev« durch »onsite« in Unit/Drop-Ins (Pfadsegmente) …"
  for f in "${FILES[@]}"; do
    if [[ -f "$f" ]] && grep -q 'onsite-dev' "$f" 2>/dev/null; then
      cp -a "$f" "${f}.bak-force-$(date +%s)"
      # Nur Pfad-/Namenssegment: …/onsite-dev/… → …/onsite/…
      sed -i 's|onsite-dev|onsite|g' "$f"
      echo "  angepasst: $f"
    fi
  done
  echo ""
fi

echo "[force-onsite-path] Schreibe Haupt-Unit aus $REAL neu …"
cd "$REPO"
bash deploy/systemd/install-onsite-service.sh "$@"

systemctl daemon-reload
systemctl restart onsite

echo ""
echo "[force-onsite-path] Fertig. Es darf kein »onsite-dev« mehr vorkommen:"
if systemctl cat onsite 2>/dev/null | grep -q 'onsite-dev'; then
  echo "  ✗ WARNUNG: systemctl cat onsite enthält noch onsite-dev — Ausgabe:"
  systemctl cat onsite | grep -n 'onsite-dev' || true
  exit 1
fi
echo "  ✓ ok"
echo ""
systemctl cat onsite 2>/dev/null | sed -n '1,45p' || true
