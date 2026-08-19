#!/bin/sh
set -eu

VIEWER_PORT="${VIEWER_PORT:-8092}"
WEB_PORT="${WEB_PORT:-8090}"
RESTART_DELAY="${PROCESS_RESTART_DELAY_SECONDS:-3}"

supervise() (
  set +e
  name="$1"
  shift
  child=""

  stop_child() {
    [ -n "$child" ] && kill "$child" 2>/dev/null || true
    [ -n "$child" ] && wait "$child" 2>/dev/null || true
    exit 0
  }
  trap stop_child INT TERM

  while :; do
    echo "[launcher] Start $name."
    "$@" &
    child=$!
    wait "$child"
    code=$?
    child=""
    echo "[launcher] $name stopte met code $code; automatische herstart over ${RESTART_DELAY}s."
    sleep "$RESTART_DELAY"
  done
)

cleanup() {
  echo "[launcher] Container stopt; processen netjes afsluiten."
  [ -n "${HOMEBASE_SUP_PID:-}" ] && kill "$HOMEBASE_SUP_PID" 2>/dev/null || true
  [ -n "${SECURITY_SUP_PID:-}" ] && kill "$SECURITY_SUP_PID" 2>/dev/null || true
  [ -n "${SUPERVISOR_SUP_PID:-}" ] && kill "$SUPERVISOR_SUP_PID" 2>/dev/null || true
  [ -n "${VIEWER_SUP_PID:-}" ] && kill "$VIEWER_SUP_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

# Alle onderdelen hebben nu hun eigen proces-supervisor. Als één Node-proces
# crasht terwijl de container zelf blijft draaien, wordt alleen dat onderdeel
# automatisch opnieuw gestart. De camera wordt hierdoor niet onnodig gewekt.
supervise "viewer" env WEB_PORT="$VIEWER_PORT" node src/server.mjs &
VIEWER_SUP_PID=$!

supervise "stream-supervisor" env VIEWER_PORT="$VIEWER_PORT" node src/stream-supervisor.mjs &
SUPERVISOR_SUP_PID=$!

supervise "security-monitor" env WEB_PORT="$WEB_PORT" VIEWER_PORT="$VIEWER_PORT" node src/security-monitor.mjs &
SECURITY_SUP_PID=$!

supervise "homebase-poller" env SECURITY_STATUS_URL="http://127.0.0.1:${WEB_PORT}/api/status" node src/homebase-poller.mjs &
HOMEBASE_SUP_PID=$!

echo "[launcher] Self-healing actief voor viewer, stream-supervisor, security-monitor en HomeBase-poller."

# De security-monitor is de publieke dashboard/API-service. Als zijn supervisor
# ooit onverwacht volledig stopt, laat Docker de container opnieuw starten.
wait "$SECURITY_SUP_PID"
