#!/usr/bin/env bash
set -euo pipefail

SERIAL="${1:-}"
PORT="${2:-8090}"

if [[ -z "$SERIAL" ]]; then
  read -r -p "Eufy serienummer: " SERIAL
fi

if [[ -z "$SERIAL" ]]; then
  echo "Geen serienummer opgegeven."
  exit 1
fi

mkdir -p recordings data

cat > .env <<EOF
EUFY_SERIAL=$SERIAL
EUFY_WS_URL=ws://127.0.0.1:3000
WEB_PORT=$PORT
VIEWER_PORT=8092
MJPEG_FPS=8
MJPEG_QUALITY=5
WATCHDOG_SECONDS=8
MOTION_FPS=2
MOTION_PIXEL_THRESHOLD=24
MOTION_THRESHOLD_PERCENT=1.5
MOTION_MIN_HITS=2
MOTION_WARMUP_SECONDS=3
PRE_RECORD_SECONDS=5
POST_RECORD_SECONDS=15
MAX_RECORD_SECONDS=300
RETENTION_DAYS=14
RECORDINGS_HOST_PATH=./recordings
EOF

echo "Docker-image bouwen en beveiligingsdashboard starten..."
sudo docker compose up -d --build

echo
IP="$(hostname -I | awk '{print $1}')"
echo "Klaar. Open: http://${IP}:${PORT}"
echo "Opnames staan voorlopig in: $(pwd)/recordings"
echo
if command -v ufw >/dev/null 2>&1; then
  echo "Als UFW actief is, sta het dashboard toe met:"
  echo "sudo ufw allow from 192.168.178.0/24 to any port ${PORT} proto tcp comment 'Deurbel Security'"
fi
