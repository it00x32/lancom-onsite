#!/usr/bin/env bash
# OnSite manuell starten mit Logdatei (ohne systemd).
# Nutzung:
#   ./scripte/start-onsite.sh
#   PORT=3005 ./scripte/start-onsite.sh
# Logs: tail -f log/onsite.log

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export NODE_ENV="${NODE_ENV:-production}"
export PORT="${PORT:-3004}"

LOGDIR="${LOGDIR:-$ROOT/log}"
mkdir -p "$LOGDIR"
LOGFILE="${LOGFILE:-$LOGDIR/onsite.log}"

echo "[$(date -Iseconds)] OnSite start (PORT=$PORT, ROOT=$ROOT) → $LOGFILE" | tee -a "$LOGFILE"
exec >>"$LOGFILE" 2>&1
exec node server.js
