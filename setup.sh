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

cat > .env <<EOF
EUFY_SERIAL=$SERIAL
EUFY_WS_URL=ws://127.0.0.1:3000
WEB_PORT=$PORT
MJPEG_FPS=8
MJPEG_QUALITY=5
WATCHDOG_SECONDS=8
EOF

echo "Docker-image bouwen en viewer starten..."
sudo docker compose up -d --build

echo
IP="$(hostname -I | awk '{print $1}')"
echo "Klaar. Open: http://${IP}:${PORT}"
echo
if command -v ufw >/dev/null 2>&1; then
  echo "Als UFW actief is, sta de viewer toe met:"
  echo "sudo ufw allow from 192.168.178.0/24 to any port ${PORT} proto tcp comment 'Deurbel Viewer'"
fi
