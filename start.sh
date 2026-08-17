#!/bin/sh
set -eu

VIEWER_PORT="${VIEWER_PORT:-8092}"
WEB_PORT="${WEB_PORT:-8090}"

cleanup() {
  [ -n "${SECURITY_PID:-}" ] && kill "$SECURITY_PID" 2>/dev/null || true
  [ -n "${QUALITY_PID:-}" ] && kill "$QUALITY_PID" 2>/dev/null || true
  [ -n "${SUPERVISOR_PID:-}" ] && kill "$SUPERVISOR_PID" 2>/dev/null || true
  [ -n "${VIEWER_PID:-}" ] && kill "$VIEWER_PID" 2>/dev/null || true
}
trap cleanup INT TERM EXIT

# Interne Eufy-viewer.
WEB_PORT="$VIEWER_PORT" node src/server.mjs &
VIEWER_PID=$!

sleep 1

# Houd de T8213 op Low / Low Encoding. Als Eufy toch H265 levert,
# zet deze guard de instelling opnieuw en laat hij de viewer herstellen.
node src/stream-quality-guard.mjs &
QUALITY_PID=$!

# Extra watchdog voor gevallen met videodata maar geen decodeerbare frames.
VIEWER_PORT="$VIEWER_PORT" node src/stream-supervisor.mjs &
SUPERVISOR_PID=$!

# Publiek beveiligingsdashboard.
WEB_PORT="$WEB_PORT" VIEWER_PORT="$VIEWER_PORT" node src/security-monitor.mjs &
SECURITY_PID=$!

wait "$SECURITY_PID"
