#!/bin/sh
set -eu

VIEWER_PORT="${VIEWER_PORT:-8092}"
WEB_PORT="${WEB_PORT:-8090}"
DASHBOARD_INTERNAL_PORT="${DASHBOARD_INTERNAL_PORT:-8091}"
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
    if node -e "fetch('http://127.0.0.1:${DASHBOARD_INTERNAL_PORT}/api/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
      echo "[launcher] Interne dashboard/API is gereed; HomeBase-poller en batterijmonitor mogen starten."
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 1
  done
  echo "[launcher] Interne dashboard/API na 30s nog niet gereed; monitors starten toch en herstellen zelf."
  return 0
}

cleanup() {
  echo "[launcher] Container stopt; processen netjes afsluiten."
  [ -n "${AUTH_SUP_PID:-}" ] && kill "$AUTH_SUP_PID" 2>/dev/null || true
  [ -n "${NOTIFY_SUP_PID:-}" ] && kill "$NOTIFY_SUP_PID" 2>/dev/null || true
  [ -n "${GENAI_FALLBACK_SUP_PID:-}" ] && kill "$GENAI_FALLBACK_SUP_PID" 2>/dev/null || true
  [ -n "${BATTERY_SUP_PID:-}" ] && kill "$BATTERY_SUP_PID" 2>/dev/null || true
  [ -n "${HOMEBASE_SUP_PID:-}" ] && kill "$HOMEBASE_SUP_PID" 2>/dev/null || true
  [ -n "${EUFY_AI_SUP_PID:-}" ] && kill "$EUFY_AI_SUP_PID" 2>/dev/null || true
  [ -n "${LSC_SUP_PID:-}" ] && kill "$LSC_SUP_PID" 2>/dev/null || true
  [ -n "${PETFEEDER_SUP_PID:-}" ] && kill "$PETFEEDER_SUP_PID" 2>/dev/null || true
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

# De echte Security Center-service luistert alleen intern op localhost. De aparte
# auth-proxy is de enige publieke ingang op WEB_PORT.
supervise "security-monitor" env WEB_PORT="$DASHBOARD_INTERNAL_PORT" VIEWER_PORT="$VIEWER_PORT" node src/security-internal.mjs &
SECURITY_SUP_PID=$!

supervise "dashboard-auth" env WEB_PORT="$WEB_PORT" DASHBOARD_INTERNAL_PORT="$DASHBOARD_INTERNAL_PORT" node src/dashboard-auth-proxy.mjs &
AUTH_SUP_PID=$!

# De LSC-camera is netgevoed en komt via de lokale Tuya RTSP Bridge binnen.
# De proxy start alleen als LSC_RTSP_URL is ingesteld en zet RTSP pas om naar
# MJPEG zodra er daadwerkelijk een browser kijkt.
if [ -n "${LSC_RTSP_URL:-}" ]; then
  supervise "lsc-proxy" env LSC_PROXY_PORT="${LSC_PROXY_PORT:-8093}" node src/lsc-proxy.mjs &
  LSC_SUP_PID=$!
  echo "[launcher] LSC-camera proxy AAN op poort ${LSC_PROXY_PORT:-8093}."
else
  echo "[launcher] LSC-camera proxy UIT; LSC_RTSP_URL is niet ingesteld."
fi

# Pet Feeder-camera via dezelfde lokale Tuya RTSP Bridge.
# De MJPEG-conversie draait alleen zolang het dashboard live meekijkt.
if [ -n "${PETFEEDER_RTSP_URL:-}" ]; then
  supervise "petfeeder-proxy" env PETFEEDER_PROXY_PORT="${PETFEEDER_PROXY_PORT:-8094}" node src/petfeeder-proxy.mjs &
  PETFEEDER_SUP_PID=$!
  echo "[launcher] Pet Feeder proxy AAN op poort ${PETFEEDER_PROXY_PORT:-8094}."
else
  echo "[launcher] Pet Feeder proxy UIT; PETFEEDER_RTSP_URL is niet ingesteld."
fi

# Bij een server-/containerstart wachten we eerst tot de lokale dashboard/API-service
# antwoordt. Hierdoor probeert de HomeBase-poller niet te vroeg de beveiligingsstatus
# op te vragen. Na 30 seconden starten de monitors alsnog; eigen reconnect blijft fallback.
wait_for_dashboard

supervise "homebase-poller" env SECURITY_STATUS_URL="http://127.0.0.1:${DASHBOARD_INTERNAL_PORT}/api/status" node src/homebase-poller.mjs &
HOMEBASE_SUP_PID=$!

case "${EUFY_AI_ENABLED:-1}" in
  1|true|TRUE|yes|YES|on|ON)
    supervise "eufy-homebase-ai" node src/eufy-ai.mjs &
    EUFY_AI_SUP_PID=$!
    echo "[launcher] Eufy HomeBase AI-analyse AAN."
    ;;
  *)
    echo "[launcher] Eufy HomeBase AI-analyse UIT."
    ;;
esac

case "${NOTIFY_ENABLED:-1}" in
  1|true|TRUE|yes|YES|on|ON)
    supervise "notification-monitor" env DASHBOARD_INTERNAL_URL="http://127.0.0.1:${DASHBOARD_INTERNAL_PORT}" node src/notification-monitor.mjs &
    NOTIFY_SUP_PID=$!

    supervise "local-car-monitor" node src/local-car-monitor.mjs &
    echo "[launcher] Lokale auto aankomst/vertrek detectie AAN."
    echo "[launcher] AI-pushmeldingen AAN."
    ;;
  *)
    echo "[launcher] AI-pushmeldingen UIT."
    ;;
esac

case "${FRIGATE_FALLBACK_ENABLED:-1}" in
  1|true|TRUE|yes|YES|on|ON)
    supervise "frigate-genai-fallback" node src/frigate-genai-fallback.mjs &
    GENAI_FALLBACK_SUP_PID=$!
    echo "[launcher] Frigate GenAI-fallback AAN."
    ;;
  *)
    echo "[launcher] Frigate GenAI-fallback UIT."
    ;;
esac

# De batterijmonitor gebruikt directe HomeBase P2P-camera-info als primaire bron,
# houdt lokale geschiedenis bij en wordt zelfstandig opnieuw gestart.
supervise "battery-monitor" node src/battery-monitor.mjs &
BATTERY_SUP_PID=$!

echo "[launcher] Self-healing actief voor viewer, beveiligd dashboard, security-monitor, HomeBase-poller en batterijmonitor${CONTINUOUS_SUP_PID:+, plus 24/7-streammonitor}${LSC_SUP_PID:+, plus LSC-camera proxy}."

# De interne security-monitor is de kernservice. Als zijn supervisor ooit onverwacht
# volledig stopt, laat Docker de container opnieuw starten.
wait "$SECURITY_SUP_PID"
