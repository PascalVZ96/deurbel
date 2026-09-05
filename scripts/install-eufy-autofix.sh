#!/bin/bash
set -euo pipefail

if [ "${EUID:-$(id -u)}" -ne 0 ]; then
    exec sudo "$0" "$@"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SOURCE="$SCRIPT_DIR/eufy-mega-autofix.sh"
TARGET=/usr/local/sbin/eufy-mega-autofix.sh
SERVICE=/etc/systemd/system/eufy-mega-autofix.service
TIMER=/etc/systemd/system/eufy-mega-autofix.timer
EUFY_DATA_DIR="${EUFY_DATA_DIR:-/opt/eufy-security-ws/data}"

if [ ! -f "$SOURCE" ]; then
    echo "FOUT: $SOURCE niet gevonden."
    exit 1
fi

for cmd in docker curl python3 flock systemctl; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
        echo "FOUT: vereist commando ontbreekt: $cmd"
        exit 1
    fi
done

install -m 0755 "$SOURCE" "$TARGET"

cat > "$SERVICE" <<EOF
[Unit]
Description=Automatisch herstel Eufy Mega login bug
After=docker.service network-online.target
Requires=docker.service

[Service]
Type=oneshot
Environment="DEURBEL_DIR=$REPO_DIR"
Environment="EUFY_DATA_DIR=$EUFY_DATA_DIR"
Environment="EUFY_CONTAINER=eufy-security-ws"
ExecStart=$TARGET
EOF

cat > "$TIMER" <<'EOF'
[Unit]
Description=Controleer Eufy Mega verbinding elke 5 minuten

[Timer]
OnBootSec=3min
OnUnitActiveSec=5min
AccuracySec=30s
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now eufy-mega-autofix.timer

echo
echo "Eufy Mega-autofix is geïnstalleerd."
echo "Repository: $REPO_DIR"
echo "Data:       $EUFY_DATA_DIR"
echo
systemctl list-timers eufy-mega-autofix.timer --no-pager
