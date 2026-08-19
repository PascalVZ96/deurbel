#!/bin/sh
set -u

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR" || exit 1

echo "=== Voordeur Security Check ==="
echo

printf '%-20s' 'HDD mount:'
if mountpoint -q /mnt/security; then
  echo 'OK'
  findmnt -no SOURCE,FSTYPE,SIZE,AVAIL,TARGET /mnt/security 2>/dev/null || true
else
  echo 'FOUT - /mnt/security is geen mountpoint'
fi

echo
printf '%-20s\n' 'Docker containers:'
sudo docker ps -a --format 'table {{.Names}}\t{{.Status}}' | grep -E 'NAMES|eufy-security-ws|deurbel-viewer' || true

echo
printf '%-20s\n' 'Restart policies:'
for name in eufy-security-ws deurbel-viewer; do
  if sudo docker inspect "$name" >/dev/null 2>&1; then
    sudo docker inspect -f '{{.Name}} -> {{.HostConfig.RestartPolicy.Name}}' "$name"
  else
    echo "/$name -> NIET GEVONDEN"
  fi
done

echo
printf '%-20s\n' 'Dashboard status:'
if STATUS=$(curl -fsS --max-time 8 http://127.0.0.1:8090/api/status 2>/dev/null); then
  printf '%s' "$STATUS" | python3 -c '
import sys,json
x=json.load(sys.stdin)
h=x.get("homebase") or {}
s=(x.get("security") or {}).get("storage") or {}
sec=x.get("security") or {}
print("Eufy WS        :", x.get("wsConnected"))
print("HomeBase       :", h.get("healthy"))
print("HomeBase fase  :", h.get("phase"))
print("Checks OK      :", h.get("successfulChecks"))
print("Recoveries     :", h.get("recoveryCount"))
print("Laatste fout   :", h.get("lastError"))
print("Beveiliging    :", sec.get("securityEnabled"))
print("HDD veilig     :", s.get("ok"))
print("HDD gebruikt   : %.2f GiB" % (float(s.get("usedBytes") or 0)/1024**3))
print("ext4 reserve   : %.2f GiB" % (float(s.get("reservedBytes") or 0)/1024**3))
print("Opnames        : %.2f MiB" % (float(s.get("recordingsBytes") or 0)/1024**2))
print("Aantal videos  :", sec.get("recordingsCount"))
'
else
  echo 'FOUT - dashboard/API op poort 8090 reageert niet'
fi

echo
printf '%-20s\n' 'Nieuwste opnames:'
ls -lht /mnt/security/deurbel/*.mp4 2>/dev/null | head -5 || echo 'Geen MP4-opnames gevonden.'

echo
printf '%-20s\n' 'Recente herstel-log:'
sudo docker logs --since 5m deurbel-viewer 2>&1 | grep -E '\[launcher\]|\[homebase\]|\[storage\]' | tail -30 || true
