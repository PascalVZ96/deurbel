#!/bin/sh
set -eu

VIEWER_PORT="${VIEWER_PORT:-8092}"
WEB_PORT="${WEB_PORT:-8090}"

cleanup() {
  if [ -n "${VIEWER_PID:-}" ]; then
    kill "$VIEWER_PID" 2>/dev/null || true
  fi
}
trap cleanup INT TERM EXIT

# De bestaande, bewezen Eufy-viewer draait alleen intern.
WEB_PORT="$VIEWER_PORT" node src/server.mjs &
VIEWER_PID=$!

# Geef de interne viewer kort tijd om te luisteren.
sleep 1

# Het beveiligingsdashboard is het publieke proces op poort 8090.
WEB_PORT="$WEB_PORT" VIEWER_PORT="$VIEWER_PORT" node src/security-monitor.mjs
