#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "$#" -ne 1 ]]; then
  echo "Gebruik: bash scripts/analyze-eufy-once.sh motion_2026-10-31_23-41-18_eufy-original.mp4" >&2
  exit 2
fi

NAME="$1"
if [[ ! "$NAME" =~ ^motion_[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{2}-[0-9]{2}-[0-9]{2}_eufy-original[.]mp4$ ]]; then
  echo "Alleen één exacte HomeBase-video (motion_..._eufy-original.mp4) is toegestaan." >&2
  exit 2
fi

echo "Eenmalige Gemini-analyse aanvragen voor: $NAME"
echo "Hierbij worden maximaal de ingestelde videoframes naar Google Gemini verstuurd."
sudo docker exec deurbel-viewer node -e '
const fs=require("node:fs");
const name=process.argv[1];
if (!/^motion_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_eufy-original[.]mp4$/i.test(name)) process.exit(2);
const video="/recordings/"+name;
if (!fs.existsSync(video) || !fs.statSync(video).isFile() || fs.statSync(video).size===0) {
 console.error("Opname niet gevonden in /recordings: "+name);
 process.exit(1);
}
const request="/data/eufy-ai-manual-request.json";
const result="/data/eufy-ai-manual-result.json";
if (fs.existsSync(request)) {
 console.error("Er staat al een andere handmatige AI-aanvraag klaar.");
 process.exit(1);
}
const state=JSON.parse(fs.readFileSync("/data/eufy-ai.json","utf8"));
if (state.items?.[name]?.status==="done") {
 console.log("Deze video heeft al een Gemini-beschrijving: "+state.items[name].title);
 process.exit(0);
}
const date=new Date().toISOString().slice(0,10);
const used=state.apiCallsDay===date ? Number(state.apiCallsCount||0) : 0;
const max=Number(process.env.EUFY_AI_MAX_PER_DAY||5);
if (used>=max) {
 console.error("Gemini-daglimiet al bereikt ("+used+"/"+max+").");
 process.exit(1);
}
try { fs.unlinkSync(result); } catch(error) { if (error.code!=="ENOENT") throw error; }
fs.writeFileSync(request,JSON.stringify({file:name,requestedAt:new Date().toISOString()}),{
 flag:"wx",mode:0o600
});
console.log("Aanvraag opgeslagen. Verbruik huidige UTC-dag: "+used+"/"+max+".");
console.log("Bekijk de uitkomst met:");
console.log("  sudo docker exec deurbel-viewer cat /data/eufy-ai-manual-result.json");
' "$NAME"

echo "Bekijk daarna eventueel de Gemini-logs:"
echo "  sudo docker logs --since 5m deurbel-viewer 2>&1 | grep '\\[eufy-ai\\]' | tail -n 20"
