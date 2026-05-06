#!/usr/bin/env bash
# OnSite smoke: erwartet laufenden Server. BASE_URL überschreiben, z. B. BASE_URL=http://127.0.0.1:3004
set -euo pipefail
PORT="${ONSITE_SMOKE_PORT:-3004}"
BASE_URL="${BASE_URL:-http://127.0.0.1:${PORT}}"
if [[ "${BASE_URL}" == https:* ]]; then
  CURL=(curl -sfk)
else
  CURL=(curl -sf)
fi
"${CURL[@]}" "${BASE_URL}/api/health" | node -e "
  const j = JSON.parse(require('fs').readFileSync(0, 'utf8'));
  if (!j.ok || j.service !== 'onsite') {
    console.error('unexpected /api/health:', j);
    process.exit(1);
  }
  console.log('GET /api/health ok', j.version || '');
"
"${CURL[@]}" -o /dev/null "${BASE_URL}/"
echo "GET / ok — smoke passed (${BASE_URL})"
