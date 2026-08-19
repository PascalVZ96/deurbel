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

wait_for_dashboard() {
  attempt=0
  while [ "$attempt" -lt 30 ]; do
    if node -e "fetch('http://127.0.0.1:${WEB_PORT}/api/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
      echo "[launcher] Dashboard/API is gereed; HomeBase-poller en batterijmonitor mogen starten."
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 1
  done
  echo "[launcher] Dashboard/API na 30s nog niet gereed; monitors starten toch en herstellen zelf."
  return 0
}

cleanup() {
  echo "[launcher] Container stopt; processen netjes afsluiten."
  [ -n "${BATTERY_SUP_PID:-}" ] && kill "$BATTERY_SUP_PID" 2>/dev/null || true
  [ -n "${HOMEBASE_SUP_PID:-}" ] && kill "$HOMEBASE_SUP_PID" 2>/dev/null || true
  [ -n "${SECURITY_SUP_PID:-}" ] && kill "$SECURITY_SUP_PID" 2>/dev/null || true
  [ -n "${CONTINUOUS_SUP_PID:-}" ] && kill "$CONTINUOUS_SUP_PID" 2>/dev/null || true
  [ -n "${SUPERVISOR_SUP_PID:-}" ] && kill "$SUPERVISOR_SUP_PID" 2>/dev/null || true
  [ -n "${VIEWER_SUP_PID:-}" ] && kill "$VIEWER_SUP_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

# Elk onderdeel heeft een eigen proces-supervisor. Als één Node-proces crasht,
# wordt alleen dat onderdeel opnieuw gestart en blijft de camera zo veel mogelijk slapen.
supervise "viewer" env WEB_PORT="$VIEWER_PORT" node src/server.mjs &
VIEWER_SUP_PID=$!

supervise "stream-supervisor" env VIEWER_PORT="$VIEWER_PORT" node src/stream-supervisor.mjs &
SUPERVISOR_SUP_PID=$!

# 24/7 is bewust opt-in. Zolang de deurbel niet permanent gevoed wordt blijft deze
# monitor uit en behoudt het systeem de huidige batterijzuinige slaapstand.
case "${CONTINUOUS_STREAM_ENABLED:-0}" in
  1|true|TRUE|yes|YES|on|ON)
    supervise "continuous-stream" env VIEWER_PORT="$VIEWER_PORT" node src/continuous-stream.mjs &
    CONTINUOUS_SUP_PID=$!
    echo "[launcher] 24/7-streammodus AAN; viewer wordt automatisch actief gehouden."
    ;;
  *)
    echo "[launcher] 24/7-streammodus UIT; klaar voor later wanneer de deurbel permanent stroom krijgt."
    ;;
esac

supervise "security-monitor" env WEB_PORT="$WEB_PORT" VIEWER_PORT="$VIEWER_PORT" node src/security-monitor.mjs &
SECURITY_SUP_PID=$!

# Bij een server-/containerstart wachten we eerst tot de lokale dashboard/API-service
# antwoordt. Hierdoor probeert de HomeBase-poller niet te vroeg de beveiligingsstatus
# op te vragen. Na 30 seconden starten de monitors alsnog; eigen reconnect blijft fallback.
wait_for_dashboard

supervise "homebase-poller" env SECURITY_STATUS_URL="http://127.0.0.1:${WEB_PORT}/api/status" node src/homebase-poller.mjs &
HOMEBASE_SUP_PID=$!

# De batterijmonitor gebruikt directe HomeBase P2P-camera-info als primaire bron,
# houdt lokale geschiedenis bij en wordt zelfstandig opnieuw gestart.
supervise "battery-monitor" node src/battery-monitor.mjs &
BATTERY_SUP_PID=$!

echo "[launcher] Self-healing actief voor viewer, stream-supervisor, security-monitor, HomeBase-poller en batterijmonitor${CONTINUOUS_SUP_PID:+, plus 24/7-streammonitor}."

# De security-monitor is de publieke dashboard/API-service. Als zijn supervisor
# ooit onverwacht volledig stopt, laat Docker de container opnieuw starten.
wait "$SECURITY_SUP_PID"
