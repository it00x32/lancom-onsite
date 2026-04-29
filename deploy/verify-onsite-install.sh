#!/usr/bin/env bash
# Schnellcheck: gleicher Ordner wie server.js, index.html, Node, optional Port.
#   bash deploy/verify-onsite-install.sh
#   PORT=3005 bash deploy/verify-onsite-install.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PORT="${PORT:-3004}"

cd "$ROOT"

echo "ROOT=$ROOT"
echo ""

ok=0
fail() { echo "  ✗ $1"; ok=1; }
pass() { echo "  ✓ $1"; }

[[ -f "$ROOT/server.js" ]]  && pass "server.js"  || fail "server.js fehlt"
[[ -f "$ROOT/index.html" ]] && pass "index.html" || fail "index.html fehlt (git pull / Build?)"
[[ -d "$ROOT/src" ]]        && pass "src/"       || fail "src/ fehlt"
[[ -f "$ROOT/package.json" ]] && pass "package.json" || fail "package.json fehlt"

if [[ -d "$ROOT/node_modules/express" ]]; then
  pass "node_modules (express vorhanden)"
else
  fail "node_modules fehlt oder unvollständig — im ROOT: npm install --omit=dev"
fi

if command -v node >/dev/null 2>&1; then
  echo "  node: $(command -v node) ($(node -v 2>/dev/null || echo '?'))"
else
  fail "node nicht im PATH (systemd ExecStart braucht denselben Pfad wie hier)"
fi

echo ""
echo "Test: Konfiguration laden (ohne HTTP zu starten)"
if node -e "require('./src/config'); console.log('  BASE_DIR ok');" 2>/tmp/onsite-verify-err.$$; then
  pass "require('./src/config')"
else
  fail "require('./src/config') — siehe /tmp/onsite-verify-err.$$"
  cat /tmp/onsite-verify-err.$$ 2>/dev/null || true
fi
rm -f /tmp/onsite-verify-err.$$ 2>/dev/null || true

echo ""
if command -v ss >/dev/null 2>&1; then
  echo "Port $PORT (LISTEN):"
  ss -tlnp "sport = :$PORT" 2>/dev/null || ss -tlnp | grep ":$PORT" || echo "  (nichts auf $PORT — gut, wenn OnSite noch nicht läuft)"
fi

echo ""
echo "=== systemd (Pfad muss zu DIESEM Projektverzeichnis passen: $ROOT)"
if command -v systemctl >/dev/null 2>&1 && systemctl cat onsite >/dev/null 2>&1; then
  if systemctl cat onsite 2>/dev/null | grep -q 'onsite-dev'; then
    echo "  ✗ Unit oder Drop-In enthält noch »onsite-dev« — der Dienst startet den falschen (evtl. gelöschten) Pfad."
    echo "    Reparatur (hier im Repo-Root ausführen, z. B. …/onsite):"
    echo "      cd \"$ROOT\" && sudo bash deploy/systemd/install-onsite-service.sh"
    echo "      sudo systemctl daemon-reload && sudo systemctl restart onsite"
    ok=1
  else
    echo "  ✓ In »systemctl cat onsite« kein »onsite-dev«"
  fi
  if [[ -d /etc/systemd/system/onsite.service.d ]] && grep -rq 'onsite-dev' /etc/systemd/system/onsite.service.d/ 2>/dev/null; then
    echo "  ✗ …/onsite.service.d/* verweist noch auf onsite-dev — Dateien dort anpassen oder entfernen."
    ok=1
  fi
  echo ""
  echo "  Ausschnitt »systemctl cat onsite«:"
  systemctl cat onsite 2>/dev/null | sed -n '1,40p' | sed 's/^/    /'
else
  echo "  (Unit »onsite« nicht gefunden oder systemctl nicht verfügbar — überspringen)"
fi

echo ""
if [[ "$ok" -ne 0 ]]; then
  echo "Es fehlen Dateien oder Abhängigkeiten — OnSite startet erst, wenn alles ✓ ist."
  exit 1
fi

echo "Manueller Kurzstart (Strg+C zum Beenden):"
echo "  cd \"$ROOT\" && PORT=$PORT node server.js"
exit 0
