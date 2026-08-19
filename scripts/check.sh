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
printf '%-20s\n' 'Deurbel accu:'
if [ -r data/battery-status.json ]; then
  python3 - <<'PY'
import json,datetime
try:
    with open('data/battery-status.json','r',encoding='utf-8') as f:
        b=json.load(f)
    pct=b.get('batteryPercent')
    temp=b.get('batteryTemperature')
    charging=b.get('chargingStatus')
    wifi=b.get('wifiSignalLevel')
    health=b.get('health') or 'unknown'
    read=b.get('lastReadAt')
    trend=b.get('trend24h')
    samples=b.get('samples',0)
    err=b.get('lastError')
    connected=b.get('connected')
    listening=b.get('listening')
    age='-'
    if read:
        dt=datetime.datetime.fromisoformat(read.replace('Z','+00:00'))
        sec=max(0,int((datetime.datetime.now(datetime.timezone.utc)-dt).total_seconds()))
        age=f'{sec}s' if sec<60 else (f'{sec//60}m' if sec<3600 else f'{sec//3600}u')
    print('Accu           :', f'{pct}%' if pct is not None else 'nog niet beschikbaar')
    print('Accustatus     :', health)
    print('Temperatuur    :', f'{temp} °C' if temp is not None else '-')
    print('Laadstatus raw :', charging if charging is not None else '-')
    print('WiFi niveau    :', wifi if wifi is not None else '-')
    print('Laatste meting :', f'{read or "-"} ({age} geleden)')
    print('Trend 24 uur   :', f'{trend:+.1f} procentpunt' if isinstance(trend,(int,float)) else 'nog onvoldoende historie')
    print('Historie       :', f'{samples} samples')
    print('Monitor        :', 'verbonden' if connected and listening else 'niet volledig verbonden')
    print('Accufout       :', err or 'None')
except Exception as e:
    print('FOUT - battery-status.json niet leesbaar:', e)
PY
else
  echo 'Nog geen batterijstatus. Wacht na deploy ongeveer 15 seconden.'
fi

echo
printf '%-20s\n' 'Nieuwste opnames:'
ls -lht /mnt/security/deurbel/*.mp4 2>/dev/null | head -5 || echo 'Geen MP4-opnames gevonden.'

echo
printf '%-20s\n' 'Recente herstel-log:'
sudo docker logs --since 5m deurbel-viewer 2>&1 | grep -E '\[launcher\]|\[homebase\]|\[battery\]|\[storage\]' | tail -40 || true
