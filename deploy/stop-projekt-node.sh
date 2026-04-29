#!/usr/bin/env bash
# Stoppt »onsite« (systemd) und alle Node-Prozesse unter …/onsite/ oder …/onsite-dev/
# (laut /proc/PID/cmdline). Cursor/VS-Code-Server (.cursor-server etc.) wird übersprungen.
#
#   sudo bash deploy/stop-projekt-node.sh
# Danach: sudo systemctl start onsite

set -euo pipefail

if [[ "${EUID:-0}" -ne 0 ]]; then
  echo "Bitte als root: sudo $0" >&2
  exit 1
fi

systemctl stop onsite 2>/dev/null || true

match_proj() {
  local cmd="$1" cwd="$2"
  case "$cmd" in
    *cursor-server*|*cursor-remote*|*/.cursor/*|*"Cursor"*|*"Code -"*) return 1 ;;
  esac
  if [[ "$cmd" == *'/claude/onsite/'* ]] || [[ "$cmd" == *'/claude/onsite-dev/'* ]] \
     || [[ "$cmd" == *'/onsite/server.js'* ]] || [[ "$cmd" == *'/onsite-dev/server.js'* ]]; then
    return 0
  fi
  if [[ "$cwd" == *'/claude/onsite' ]] || [[ "$cwd" == *'/claude/onsite-dev' ]] \
     || [[ "$cwd" == */onsite ]] || [[ "$cwd" == */onsite-dev ]]; then
    [[ "$cmd" == *node* ]] && [[ "$cmd" == *server.js* ]] && return 0
  fi
  return 1
}

killed=0
for pid in $(pgrep -x node 2>/dev/null || true); do
  cmd=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)
  cwd=$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)
  [[ -n "$cmd" ]] || continue
  if match_proj "$cmd" "$cwd"; then
    echo "kill $pid (cwd=$cwd): ${cmd:0:120}"
    kill "$pid" 2>/dev/null || true
    killed=1
  fi
done

if [[ "$killed" -eq 1 ]]; then
  sleep 1
  for pid in $(pgrep -x node 2>/dev/null || true); do
    cmd=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)
    cwd=$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)
    match_proj "$cmd" "$cwd" || continue
    kill -9 "$pid" 2>/dev/null || true
  done
fi

echo "Fertig. Dienst neu starten: sudo systemctl start onsite"
