#!/usr/bin/env bash
set -euo pipefail

SECURITY_PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SECURITY_PROJECT_DIR"

if [[ "$(git branch --show-current)" != "main" ]]; then
  echo 'Update gestopt: deze installatie staat niet op de branch main.' >&2
  exit 1
fi
if [[ ! -f .env ]]; then
  echo 'Update gestopt: de lokale .env ontbreekt. Gebruik setup.sh voor een nieuwe installatie.' >&2
  exit 1
fi

# Frigate kan zijn eigen gemounte configuratie aanpassen. Een lokale wijziging
# daarin mag blijven staan; Git stopt zelf als een inkomende update ermee botst.
if ! git diff --quiet -- . ':(exclude)frigate/config.yml' ||
   ! git diff --cached --quiet -- .; then
  echo 'Update gestopt: er staan lokale codewijzigingen die eerst naar GitHub moeten.' >&2
  git diff --name-only -- . ':(exclude)frigate/config.yml'
  git diff --cached --name-only
  exit 1
fi
SECURITY_UNTRACKED="$(git ls-files --others --exclude-standard -- src public scripts start.sh Dockerfile docker-compose.yml)"
if [[ -n "$SECURITY_UNTRACKED" ]]; then
  echo 'Update gestopt: er staan nog nieuwe codebestanden buiten GitHub:' >&2
  printf '%s\n' "$SECURITY_UNTRACKED" >&2
  exit 1
fi

SECURITY_DOCKER=(docker)
if ! docker info >/dev/null 2>&1; then
  SECURITY_DOCKER=(sudo docker)
  "${SECURITY_DOCKER[@]}" info >/dev/null
fi
if ! mountpoint -q /mnt/security; then
  echo 'Update gestopt: de opnameschijf is niet op /mnt/security gemount.' >&2
  exit 1
fi

SECURITY_PREVIOUS_REVISION="$(git rev-parse --short HEAD)"
echo 'Security Center ophalen uit GitHub…'
git fetch origin main
git merge --ff-only origin/main

"${SECURITY_DOCKER[@]}" compose config --quiet
echo 'Nieuwe viewer bouwen en JavaScript controleren…'
# Eerst bouwen: bij een bouwfout blijft de huidige container draaien.
"${SECURITY_DOCKER[@]}" compose build deurbel-viewer
"${SECURITY_DOCKER[@]}" compose up -d --no-deps --no-build deurbel-viewer

echo 'Controleren of de website bereikbaar is…'
SECURITY_WEB_READY=false
for ((SECURITY_ATTEMPT=1; SECURITY_ATTEMPT<=15; SECURITY_ATTEMPT++)); do
  if "${SECURITY_DOCKER[@]}" compose exec -T deurbel-viewer node -e "fetch('http://127.0.0.1:'+(process.env.WEB_PORT||'8090')+'/',{signal:AbortSignal.timeout(3000)}).then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.text()}).then(t=>process.exit(t.includes('security-center-navigation')?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    SECURITY_WEB_READY=true
    break
  fi
  sleep 2
done
if [[ "$SECURITY_WEB_READY" != true ]]; then
  echo 'De viewer is bijgewerkt, maar de website reageert nog niet. Controleer: sudo docker compose logs --tail=50 deurbel-viewer' >&2
  exit 1
fi

printf 'Website bijgewerkt: %s → %s\n' "$SECURITY_PREVIOUS_REVISION" "$(git rev-parse --short HEAD)"
echo 'Website bereikbaar. De camera- en opslagstatus vind je onder Systeem en opslag.'
