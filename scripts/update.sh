#!/usr/bin/env bash
set -euo pipefail

# Werk uitsluitend de huidige Security Center bij (poort 8090 of 8190).
# De oude Snap-Docker-containers, Frigate en Amazon-scanner blijven ongemoeid.
cd "$(dirname "$0")/.."
die() { echo "UPDATE GESTOPT: $*" >&2; exit 1; }

[[ "$(git branch --show-current)" == main ]] || die "Schakel eerst terug naar de branch main."
[[ -f .env && -f .env.testports && -f docker-compose.test.yml ]] ||
  die "Lokale testconfiguratie ontbreekt (.env, .env.testports of docker-compose.test.yml)."
command -v python3 >/dev/null || die "Python 3 ontbreekt."
mountpoint -q /mnt/security || die "De beveiligingsschijf is niet gemount."
[[ -d /mnt/security/deurbel-test && -d data-test ]] ||
  die "Opname- of testdatamap ontbreekt."

# Geen automatische stash, reset of overschrijving van lokale code.
if ! git diff --quiet -- . ':(exclude)frigate/config.yml' ||
   ! git diff --cached --quiet; then
  git status --short
  die "Er zijn lokale codewijzigingen; bewaar die eerst."
fi
UNTRACKED="$(git ls-files --others --exclude-standard -- src public scripts start.sh Dockerfile docker-compose.yml docker-compose.test.yml docker-compose.petfeeder-record.yml)"
[[ -z "$UNTRACKED" ]] || die "Nieuwe codebestanden buiten Git: $UNTRACKED"

# Gebruik de normale Ubuntu Docker; voorkom een verwisseling met Snap Docker.
ROOT="$(sudo docker info --format '{{.DockerRootDir}}')" ||
  die "Docker is niet bereikbaar."
[[ "$ROOT" == /var/lib/docker ]] || die "Onverwachte Docker-opslag: $ROOT"

compose() {
  sudo docker compose --env-file .env --env-file .env.testports \
    -f docker-compose.yml -f docker-compose.test.yml "$@"
}

echo "GitHub ophalen..."
git fetch origin main
git merge-base --is-ancestor HEAD origin/main ||
  die "Lokale Git-geschiedenis wijkt af van GitHub; geen merge gedaan."
BEFORE="$(git rev-parse --short HEAD)"
git merge --ff-only origin/main

# Controleer dat we niet per ongeluk de oude installatie of data raken.
compose config --format json | python3 -c '
import json, os, re, sys
try:
    c=json.load(sys.stdin)["services"]["deurbel-viewer"]
    e=c["environment"]
    required={"DASHBOARD_INTERNAL_PORT":"8191",
      "VIEWER_PORT":"8192", "LSC_PROXY_PORT":"8193",
      "PETFEEDER_PROXY_PORT":"8194"}
    web=str(e.get("WEB_PORT"))
    if web not in ("8090","8190"):
        raise ValueError("WEB_PORT moet 8090 of 8190 zijn")
    for key,expected in required.items():
        if str(e.get(key))!=expected:
            raise ValueError(key+" moet "+expected+" zijn")
    for setting in ("EUFY_AI_ENABLED","FRIGATE_FALLBACK_ENABLED"):
        flag=str(e.get(setting,"0"))
        if flag not in ("0","1"):
            raise ValueError(setting+" moet 0 of 1 zijn")
    ai_enabled=(str(e.get("EUFY_AI_ENABLED"))=="1" or
                str(e.get("FRIGATE_FALLBACK_ENABLED"))=="1")
    if ai_enabled:
        key=str(e.get("GEMINI_API_KEY") or "").strip()
        if not key:
            raise ValueError("Gemini API-sleutel ontbreekt")
        if key != str(e.get("GEMINI_API_KEY") or ""):
            raise ValueError("Gemini API-sleutel bevat spaties")
        if str(e.get("FRIGATE_FALLBACK_ENABLED"))=="1":
            if str(e.get("FRIGATE_FALLBACK_PETFEEDER_ONLY"))!="1":
                raise ValueError("Eerst alleen Pet Feeder Gemini-fallback inschakelen")
        for num in ("EUFY_AI_MAX_PER_DAY","FRIGATE_FALLBACK_MAX_PER_DAY"):
            try:
                v=int(str(e.get(num,"")))
            except ValueError:
                raise ValueError(num+" ontbreekt of is ongeldig")
            if not 1 <= v <= 10:
                raise ValueError(num+" moet tussen 1 en 10 liggen")
    notify=str(e.get("NOTIFY_ENABLED","0"))
    if notify not in ("0","1"):
        raise ValueError("NOTIFY_ENABLED moet 0 of 1 zijn")
    if notify=="1":
        topic=str(e.get("NTFY_TOPIC") or "").strip()
        if not re.fullmatch(r"[A-Za-z0-9_-]{16,64}",topic):
            raise ValueError("Stel eerst een moeilijk te raden NTFY_TOPIC in (16-64 tekens)")
    mounts={v["target"]:v["source"] for v in c["volumes"]}
    if mounts.get("/recordings")!="/mnt/security/deurbel-test":
        raise ValueError("Verkeerde opname-map")
    if mounts.get("/data")!=os.path.join(os.getcwd(),"data-test"):
        raise ValueError("Verkeerde data-map")
    if c.get("network_mode")!="host":
        raise ValueError("Verkeerde netwerkmodus")
    print("Veiligheidscontrole geslaagd: poort "+web+" en aparte opslag.")
except (KeyError,TypeError,ValueError) as ex:
    sys.exit("UPDATE GESTOPT: "+str(ex))
'

echo "Viewer bouwen en JavaScript controleren..."
compose build deurbel-viewer
echo "Alleen de Security Center-viewer herstarten..."
compose up -d --no-deps --no-build --force-recreate deurbel-viewer

READY=0
for ((i=1;i<=15;i++)); do
  if compose exec -T deurbel-viewer node -e '
    Promise.all([
      fetch("http://127.0.0.1:8191/",{signal:AbortSignal.timeout(4000)}),
      fetch("http://127.0.0.1:8191/api/petfeeder/status",{signal:AbortSignal.timeout(4000)})
    ]).then(async ([page,status])=>{
      const html=await page.text();
      if(!page.ok || !html.includes("security-center-navigation") || !status.ok)
        throw new Error("Dashboard/API niet gereed");
    }).then(()=>process.exit(0)).catch(()=>process.exit(1));
  ' >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 2
done

[[ "$READY" == 1 ]] ||
  die "Controle mislukt. Bekijk: sudo docker logs --tail=80 deurbel-viewer"
echo "Klaar: $BEFORE -> $(git rev-parse --short HEAD)"
echo "Security Center: http://192.168.178.97:$(grep -m1 '^WEB_PORT=' .env.testports | cut -d= -f2)"
