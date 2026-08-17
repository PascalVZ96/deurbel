#!/bin/sh
set -eu

VIEWER_PORT="${VIEWER_PORT:-8092}"
WEB_PORT="${WEB_PORT:-8090}"

cleanup() {
  [ -n "${HOMEBASE_PID:-}" ] && kill "$HOMEBASE_PID" 2>/dev/null || true
  [ -n "${SECURITY_PID:-}" ] && kill "$SECURITY_PID" 2>/dev/null || true
  [ -n "${SUPERVISOR_PID:-}" ] && kill "$SUPERVISOR_PID" 2>/dev/null || true
  [ -n "${VIEWER_PID:-}" ] && kill "$VIEWER_PID" 2>/dev/null || true
}
trap cleanup INT TERM EXIT

# Interne Eufy-viewer blijft beschikbaar voor handmatig livebeeld en
# externe/PIR-triggers. Automatische HomeBase-import start hem niet.
WEB_PORT="$VIEWER_PORT" node src/server.mjs &
VIEWER_PID=$!

sleep 1

VIEWER_PORT="$VIEWER_PORT" node src/stream-supervisor.mjs &
SUPERVISOR_PID=$!

WEB_PORT="$WEB_PORT" VIEWER_PORT="$VIEWER_PORT" node src/security-monitor.mjs &
SECURITY_PID=$!

# Betrouwbare automatische route: vraag elke 10s de HomeBase-database op.
# Daardoor missen we geen opname als een Eufy push/motion-event niet aankomt.
# Nieuwe .zxvideo wordt gedownload en omgezet naar H264 MP4 + JPG.
sleep 1
SECURITY_STATUS_URL="http://127.0.0.1:${WEB_PORT}/api/status" node src/homebase-poller.mjs &
HOMEBASE_PID=$!

wait "$SECURITY_PID"
