#!/usr/bin/env bash
# OnSite dauerhaft im Hintergrund starten (nohup), alte Instanz gleichen Ports beenden.
# Nutzung: bash scripts/onsite-daemon.sh [PORT]
#   oder:  cd /var/www/html/claude/onsite && npm run daemon
set -euo pipefail

ONSITE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${1:-${PORT:-3004}}"
PIDFILE="${ONSITE_PIDFILE:-/tmp/onsite-node-${PORT}.pid}"
LOG="${ONSITE_LOG:-/tmp/onsite-server.log}"

stop_old() {
  if [[ -f "$PIDFILE" ]]; then
    local p
    p=$(cat "$PIDFILE" 2>/dev/null || true)
    if [[ -n "${p:-}" ]] && kill -0 "$p" 2>/dev/null; then
      kill "$p" 2>/dev/null || true
      sleep 1
    fi
    rm -f "$PIDFILE"
  fi
  for proc in /proc/[0-9]*; do
    [[ -r "$proc/cmdline" ]] || continue
    local pid="${proc#/proc/}"
    [[ "$pid" =~ ^[0-9]+$ ]] || continue
    local cwd
    cwd="$(readlink -f "$proc/cwd" 2>/dev/null)" || continue
    [[ "$cwd" == "$ONSITE_DIR" ]] || continue
    local cmd
    cmd="$(tr '\0' ' ' <"$proc/cmdline" 2>/dev/null || true)"
    [[ "$cmd" == *node* ]] && [[ "$cmd" == *server.js* ]] || continue
    kill "$pid" 2>/dev/null || true
  done
  sleep 1
}

stop_old
cd "$ONSITE_DIR"
nohup node server.js "$PORT" >>"$LOG" 2>&1 &
echo $! >"$PIDFILE"
echo "OnSite PID=$(cat "$PIDFILE") Port=$PORT Log=$LOG"
