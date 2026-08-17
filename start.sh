#!/bin/sh
set -eu

VIEWER_PORT="${VIEWER_PORT:-8092}"
WEB_PORT="${WEB_PORT:-8090}"

cleanup() {
  [ -n "${MOTION_PID:-}" ] && kill "$MOTION_PID" 2>/dev/null || true
  [ -n "${SECURITY_PID:-}" ] && kill "$SECURITY_PID" 2>/dev/null || true
  [ -n "${SUPERVISOR_PID:-}" ] && kill "$SUPERVISOR_PID" 2>/dev/null || true
  [ -n "${VIEWER_PID:-}" ] && kill "$VIEWER_PID" 2>/dev/null || true
}
trap cleanup INT TERM EXIT

# Interne Eufy-viewer. Deze forceert nu zelf Low / Low Encoding vóór iedere
# streamstart, zodat dezelfde WebSocket die de videodata ontvangt ook het
# H265-herstel kan uitvoeren.
WEB_PORT="$VIEWER_PORT" node src/server.mjs &
VIEWER_PID=$!

sleep 1

# Extra watchdog voor gevallen met videodata maar geen decodeerbare frames.
VIEWER_PORT="$VIEWER_PORT" node src/stream-supervisor.mjs &
SUPERVISOR_PID=$!

# Publiek beveiligingsdashboard en opnamebeheer.
WEB_PORT="$WEB_PORT" VIEWER_PORT="$VIEWER_PORT" node src/security-monitor.mjs &
SECURITY_PID=$!

# Geef het dashboard even tijd om de trigger-endpoint te openen en luister
# daarna continu naar Eufy motion/person-events. De livestream blijft hierbij
# uit totdat daadwerkelijk een trigger binnenkomt.
sleep 1
SECURITY_TRIGGER_URL="http://127.0.0.1:${WEB_PORT}/api/trigger" node src/motion-monitor.mjs &
MOTION_PID=$!

wait "$SECURITY_PID"
