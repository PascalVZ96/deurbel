#!/bin/bash
set -u

LOCK=/run/eufy-mega-autofix.lock
exec 9>"$LOCK"
flock -n 9 || exit 0

EUFY_CONTAINER="${EUFY_CONTAINER:-eufy-security-ws}"
DEURBEL_DIR="${DEURBEL_DIR:-/home/pascal/deurbel}"
DATA_DIR="${EUFY_DATA_DIR:-/opt/eufy-security-ws/data}"
STATUS_URL="${DEURBEL_STATUS_URL:-http://127.0.0.1:8090/api/status}"

log() {
    echo "[eufy-autofix] $(date '+%Y-%m-%d %H:%M:%S') $*"
}

STATUS="$(curl -fsS --max-time 8 "$STATUS_URL" 2>/dev/null || true)"

if [ -z "$STATUS" ]; then
    log "Dashboard niet bereikbaar; niets gewijzigd."
    exit 0
fi

RESULT="$(printf '%s' "$STATUS" | python3 -c '
import sys,json
try:
    d=json.load(sys.stdin)
    h=str(d.get("homebase",{}).get("lastError") or "")
    b=str(d.get("battery",{}).get("lastError") or "")
    healthy=bool(d.get("homebase",{}).get("healthy"))
    available=bool(d.get("battery",{}).get("available"))
    if healthy and available:
        print("OK")
    elif "station_not_found" in h or "device_not_found" in b:
        print("MEGA_BUG")
    else:
        print("OTHER")
except Exception:
    print("INVALID")
')"

case "$RESULT" in
    OK)
        log "Eufy is gezond."
        exit 0
        ;;
    MEGA_BUG)
        log "Eufy Mega-probleem gedetecteerd. Herstel wordt uitgevoerd."
        ;;
    *)
        log "Geen bekende Mega-fout ($RESULT); niets gewijzigd."
        exit 0
        ;;
esac

if ! docker inspect "$EUFY_CONTAINER" >/dev/null 2>&1; then
    log "Container $EUFY_CONTAINER bestaat niet."
    exit 1
fi

PERSIST="$(find "$DATA_DIR" -maxdepth 5 -type f -name persistent.json -print -quit 2>/dev/null || true)"

if [ -z "$PERSIST" ]; then
    log "persistent.json niet gevonden in $DATA_DIR; herstel afgebroken."
    exit 1
fi

log "Eufy-container stoppen..."
docker stop "$EUFY_CONTAINER" >/dev/null

for _ in $(seq 1 20); do
    RUNNING="$(docker inspect -f '{{.State.Running}}' "$EUFY_CONTAINER" 2>/dev/null || echo false)"
    [ "$RUNNING" = "false" ] && break
    sleep 1
done

BACKUP="${PERSIST}.autofix-backup-$(date +%Y%m%d-%H%M%S)"
cp -a "$PERSIST" "$BACKUP"
log "Backup gemaakt: $BACKUP"

python3 - "$PERSIST" <<'PY'
import json
import os
import sys
import time

path = sys.argv[1]
with open(path, "r", encoding="utf-8") as f:
    data = json.load(f)

# Alleen de legacy/top-level login_hash wijzigen.
# De nested megaApi.login_hash blijft bewust onaangeraakt.
data["login_hash"] = "invalidated-autofix-" + str(int(time.time()))

tmp = path + ".autofix.tmp"
with open(tmp, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2)
os.replace(tmp, path)
PY

log "Legacy login_hash ongeldig gemaakt."
docker start "$EUFY_CONTAINER" >/dev/null
log "Eufy opnieuw gestart; 30 seconden wachten..."
sleep 30

if [ -f "$DEURBEL_DIR/docker-compose.yml" ]; then
    cd "$DEURBEL_DIR"
    docker compose restart deurbel-viewer >/dev/null 2>&1 || true
    log "Deurbel-viewer opnieuw gestart."
fi

find "$DATA_DIR" -maxdepth 5 -type f \
    -name 'persistent.json.autofix-backup-*' \
    -printf '%T@ %p\n' 2>/dev/null \
    | sort -rn \
    | tail -n +11 \
    | cut -d' ' -f2- \
    | xargs -r rm -f

log "Herstelprocedure afgerond."
