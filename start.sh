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

# Interne Eufy-viewer. Deze blijft beschikbaar voor handmatig livebeeld en
# externe/PIR-triggers, maar automatische Eufy-beweging start hem niet meer.
WEB_PORT="$VIEWER_PORT" node src/server.mjs &
VIEWER_PID=$!

sleep 1

# Extra watchdog voor gevallen met videodata maar geen decodeerbare frames.
VIEWER_PORT="$VIEWER_PORT" node src/stream-supervisor.mjs &
SUPERVISOR_PID=$!

# Publiek beveiligingsdashboard en opnamebeheer.
WEB_PORT="$WEB_PORT" VIEWER_PORT="$VIEWER_PORT" node src/security-monitor.mjs &
SECURITY_PID=$!

# Automatische Eufy-beweging: zoek na het event de originele HomeBase-opname,
# download H265/AAC en zet deze om naar browser-vriendelijke H264 MP4 + JPG.
# De livestream blijft tijdens deze automatische route uit.
sleep 1
SECURITY_STATUS_URL="http://127.0.0.1:${WEB_PORT}/api/status" node src/homebase-monitor.mjs &
HOMEBASE_PID=$!

wait "$SECURITY_PID"
