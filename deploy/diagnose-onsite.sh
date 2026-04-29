#!/usr/bin/env bash
# Diagnose: welcher Pfad hat index.html, systemd, Port.
#   bash deploy/diagnose-onsite.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PARENT="$(dirname "$REPO_ROOT")"
ONSITE_SIBLING="${PARENT}/onsite"
PORT="${PORT:-3004}"

echo "=== Dieses Repo ==="
echo "REPO_ROOT=$REPO_ROOT"
echo "index.html: $([ -f "$REPO_ROOT/index.html" ] && echo ja || echo NEIN)"
echo ""

echo "=== Parallelordner onsite (gleiches Elternverzeichnis wie dieses Repo) ==="
for d in "$ONSITE_SIBLING"; do
  echo "--- $d"
  if [[ ! -e "$d" ]]; then
    echo "  (existiert nicht)"
  elif [[ -L "$d" ]]; then
    echo "  Symlink -> $(readlink -f "$d" 2>/dev/null || readlink "$d")"
  else
    echo "  Ordner; index.html: $([ -f "$d/index.html" ] && echo ja || echo NEIN)"
  fi
done
echo ""

echo "=== systemd: onsite ==="
if command -v systemctl >/dev/null 2>&1; then
  systemctl cat onsite 2>/dev/null | sed -n '1,45p' || true
fi
grep -rsnE '/onsite/|__ONSITE_INSTALL_ROOT__' /etc/systemd/system/*.service 2>/dev/null | head -25 || true
echo ""

echo "=== Port $PORT ==="
if command -v ss >/dev/null 2>&1; then
  ss -tlnp "sport = :$PORT" 2>/dev/null || ss -tlnp | grep ":$PORT" || true
fi
echo ""

echo "=== Node mit onsite im Pfad ==="
ps aux 2>/dev/null | grep -E '[n]ode.*/onsite/' || echo "(keine Treffer)"
