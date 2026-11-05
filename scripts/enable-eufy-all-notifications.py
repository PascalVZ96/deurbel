#!/usr/bin/env python3
"""Enable Gemini for all locally available Eufy clips and ntfy for new ones."""
from datetime import datetime, timezone
from pathlib import Path
import shutil
import sys

root = Path(__file__).resolve().parent.parent
env_path = root / ".env.testports"

if not env_path.is_file():
    sys.exit("Geen .env.testports gevonden; niets aangepast.")

lines = env_path.read_text(encoding="utf-8").splitlines()

def get(key):
    for line in reversed(lines):
        if line.startswith(key+"="):
            return line.split("=",1)[1].strip().strip('"').strip("'")
    return ""

# Existing working notifications and Gemini should not be reconfigured with
# missing credentials. Never print either secret.
if not get("NTFY_TOPIC"):
    sys.exit("NTFY_TOPIC ontbreekt in .env.testports; niets gewijzigd.")
if not get("FRIGATE_GEMINI_API_KEY"):
    sys.exit("FRIGATE_GEMINI_API_KEY ontbreekt in .env.testports; niets gewijzigd.")

previous_start = get("EUFY_NOTIFY_START_AT")
started = previous_start or datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00","Z")
settings = {
    "NOTIFY_ENABLED": "1",
    "NOTIFY_EUFY": "1",
    "EUFY_AI_ENABLED": "1",
    "EUFY_AI_BACKFILL_EXISTING": "1",
    "EUFY_AI_MAX_PER_DAY": "5",
    "EUFY_AI_MIN_INTERVAL_SECONDS": "60",
    "EUFY_NOTIFY_START_AT": started,
}

updated, seen = [], set()
for line in lines:
    name = line.split("=",1)[0].strip()
    if name in settings and not line.lstrip().startswith("#"):
        if name not in seen:
            updated.append(name+"="+settings[name])
        seen.add(name)
    else:
        updated.append(line)

for key, value in settings.items():
    if key not in seen:
        updated.append(key+"="+value)

backup = env_path.with_name(
    ".env.testports.bak-eufy-" +
    datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
)
shutil.copy2(env_path,backup)
backup.chmod(0o600)

temp = env_path.with_name(".env.testports.eufy-tmp")
try:
    temp.write_text("\n".join(updated)+"\n",encoding="utf-8")
    temp.chmod(0o600)
    temp.replace(env_path)
except Exception:
    temp.unlink(missing_ok=True)
    raise

print("Eufy AI: alle beschikbare HomeBase-video's in wachtrij.")
print("Nieuwe Eufy AI-beschrijvingen: ntfy aan.")
print("Historische archiefanalyses: geen terugwerkende pushmeldingen.")
print("Gemini-limiet Eufy: 5 API-aanroepen per UTC-dag, minstens 60 seconden ertussen.")
print("Bestaande Pet Feeder, ntfy-topic, API-sleutel en opnames zijn behouden.")
print("Volgende stap: cd ~/deurbel && bash scripts/update.sh")
