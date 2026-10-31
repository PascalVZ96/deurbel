#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

MINUTE="$1"
if [[ ! "$MINUTE" =~ ^[0-9]{12}$ ]]; then
  echo "Gebruik: bash scripts/recover-homebase-minute.sh 202610312341" >&2
  echo "Notatie: JJJJMMDDUUMM in de lokale Eufy/HomeBase-tijd." >&2
  exit 2
fi
echo "Controleren of Deurbelbewaking ingeschakeld is..."
curl -fsS http://127.0.0.1:8191/api/status | python3 -c '
import json,sys
d=json.load(sys.stdin)
if not d.get("security",{}).get("securityEnabled"):
    sys.exit("FOUT: Deurbelbewaking staat uit. Zet eerst Deurbel bewaken aan.")
if not d.get("homebase",{}).get("healthy"):
    sys.exit("FOUT: HomeBase is niet gezond. Controleer de status voor herstel.")
print("Beveiliging aan en HomeBase gezond.")
'

echo "Gericht herstel voor $MINUTE aanvragen..."
sudo docker exec deurbel-viewer node -e '
const fs = require("node:fs");
const minute = process.argv[1];
if (!/^[0-9]{12}$/.test(minute)) process.exit(2);
const req="/data/homebase-recovery-request.json";
const result="/data/homebase-recovery-result.json";
if (fs.existsSync(req)) {
 console.error("Er staat al een herstelopdracht klaar. Wacht eerst op het resultaat.");
 process.exit(1);
}
try { fs.unlinkSync(result); } catch(e) { if (e.code !== "ENOENT") throw e; }
fs.writeFileSync(req, JSON.stringify({minute,requestedAt:new Date().toISOString()}),
 {flag:"wx",mode:0o600});
console.log("Opdracht opgeslagen. De HomeBase-poller verwerkt deze bij de eerstvolgende controle.");
' "$MINUTE"

echo "Controleer de voortgang met:"
echo "  sudo docker logs --since 5m deurbel-viewer 2>&1 | grep -E '\\[homebase\\].*(herstel|Herstel|Opgeslagen|Download)' | tail -n 30"
echo "En lees daarna het resultaat met:"
echo "  sudo docker exec deurbel-viewer cat /data/homebase-recovery-result.json"
