#!/bin/sh
set -eu

VIEWER_PORT="${VIEWER_PORT:-8092}"
WEB_PORT="${WEB_PORT:-8090}"

cleanup() {
  [ -n "${SECURITY_PID:-}" ] && kill "$SECURITY_PID" 2>/dev/null || true
  [ -n "${VIEWER_PID:-}" ] && kill "$VIEWER_PID" 2>/dev/null || true
}
trap cleanup INT TERM EXIT

# De bestaande, bewezen Eufy-viewer draait alleen intern.
WEB_PORT="$VIEWER_PORT" node src/server.mjs &
VIEWER_PID=$!

sleep 1

# Het beveiligingsdashboard is publiek op poort 8090.
WEB_PORT="$WEB_PORT" VIEWER_PORT="$VIEWER_PORT" node src/security-monitor.mjs &
SECURITY_PID=$!

wait "$SECURITY_PID"
