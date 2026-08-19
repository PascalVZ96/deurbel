#!/bin/sh
set -u

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR" || exit 1

echo "=== Voordeur AI / Frigate Check ==="
echo

printf '%-24s' 'Intel render device:'
if [ -e /dev/dri/renderD128 ]; then
  echo 'OK (/dev/dri/renderD128)'
  ls -l /dev/dri/renderD128 2>/dev/null || true
else
  echo 'NIET GEVONDEN'
fi

echo
printf '%-24s' '24/7 instelling:'
if [ -r .env ] && grep -Eq '^CONTINUOUS_STREAM_ENABLED=(1|true|yes|on)$' .env; then
  echo 'AAN'
else
  echo 'UIT (veilig zolang deurbel niet permanent gevoed wordt)'
fi

echo
printf '%-24s' 'Viewer status:'
if STATUS=$(curl -fsS --max-time 5 http://127.0.0.1:8092/api/status 2>/dev/null); then
  printf '%s' "$STATUS" | python3 -c '
import sys,json
x=json.load(sys.stdin)
print("active=%s healthy=%s codec=%s %sx%s fps=%s" % (
    x.get("active"), x.get("streamHealthy"), x.get("codec"),
    x.get("width"), x.get("height"), x.get("fps")))
'
else
  echo 'NIET BEREIKBAAR'
fi

echo
printf '%-24s' 'Frigate profiel:'
if sudo docker ps -a --format '{{.Names}} {{.Status}}' 2>/dev/null | grep -q '^frigate '; then
  sudo docker ps -a --format '{{.Names}} -> {{.Status}}' | grep '^frigate ' || true
else
  echo 'nog niet gestart'
fi

echo
printf '%-24s' 'Frigate config:'
if [ -r frigate/config.yml ]; then
  echo 'aanwezig'
else
  echo 'ONTBREEKT'
fi

echo
printf '%-24s' 'AI opslagmap:'
if [ -d /mnt/security/frigate ]; then
  echo 'aanwezig'
  df -h /mnt/security/frigate 2>/dev/null | tail -1 || true
else
  echo 'nog niet aangemaakt'
fi

echo
if sudo docker ps --format '{{.Names}}' 2>/dev/null | grep -qx frigate; then
  echo 'Recente Frigate-log:'
  sudo docker logs --since 2m frigate 2>&1 | tail -40 || true
else
  echo 'Frigate is bewust nog niet actief. Start hem pas wanneer de deurbel permanent stroom krijgt.'
fi
