#!/usr/bin/env python3
"""Configure Eufy and Pet Feeder Gemini safely in a local git-ignored env file."""
import getpass
import json
import os
from pathlib import Path
import shutil
import sys
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

PROJECT = Path(__file__).resolve().parent.parent
ENV_PATH = PROJECT / ".env.testports"
MODEL = "gemini-3.6-flash"

if not ENV_PATH.is_file():
    sys.exit("Gemini niet ingeschakeld: .env.testports ontbreekt.")

print("Gemini voor Eufy en Pet Feeder")
print("Let op: geselecteerde videoframes worden naar Google verzonden.")
print("Er geldt een limiet van 5 API-aanroepen per camera per UTC-dag.")
print("Bestaande opnames worden niet opnieuw geanalyseerd.")
key = getpass.getpass("Plak hier je Gemini API-sleutel (blijft verborgen): ").strip()
if len(key) < 16 or any(c.isspace() for c in key):
    sys.exit("Geen geldige API-sleutel ingevoerd; niets gewijzigd.")

print("Sleutel en model controleren bij Google...")
request = Request(
    "https://generativelanguage.googleapis.com/v1beta/models/" + MODEL,
    headers={"x-goog-api-key": key, "Accept": "application/json"},
)
try:
    with urlopen(request, timeout=20) as response:
        model = json.load(response)
        if model.get("name") != "models/" + MODEL:
            sys.exit("Gemini-model niet bevestigd; niets gewijzigd.")
except HTTPError as error:
    sys.exit(
        "Gemini-sleutel/model niet bruikbaar (HTTP " + str(error.code) +
        "). Controleer toegang en eventuele facturering in Google AI Studio. Niets gewijzigd."
    )
except (URLError, TimeoutError, OSError, ValueError) as error:
    sys.exit("Gemini niet bereikbaar of ongeldige respons; niets gewijzigd.")

settings = {
    "FRIGATE_GEMINI_API_KEY": key,
    "GEMINI_MODEL": MODEL,
    "FRIGATE_FALLBACK_MODEL": MODEL,
    "EUFY_AI_ENABLED": "1",
    "EUFY_AI_MAX_FRAMES": "3",
    "EUFY_AI_MAX_PER_DAY": "5",
    "FRIGATE_FALLBACK_ENABLED": "1",
    "FRIGATE_FALLBACK_PETFEEDER_ONLY": "1",
    "FRIGATE_FALLBACK_MAX_PER_DAY": "5",
    "FRIGATE_FALLBACK_MAX_AGE_MINUTES": "10",
}

original = ENV_PATH.read_text(encoding="utf-8").splitlines()
result = []
found = set()
for line in original:
    if "=" in line and not line.lstrip().startswith("#"):
        name = line.split("=", 1)[0].strip()
        if name in settings:
            if name not in found:
                result.append(name + "=" + settings[name])
            found.add(name)
            continue
    result.append(line)
for name, value in settings.items():
    if name not in found:
        result.append(name + "=" + value)

# Keep backup and active env local and private. The file is git-ignored.
backup = ENV_PATH.with_name(
    ".env.testports.backup-gemini-" +
    datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
)
shutil.copy2(ENV_PATH, backup)
backup.chmod(0o600)
temporary = ENV_PATH.with_name(".env.testports.gemini-tmp")
try:
    temporary.write_text("\n".join(result) + "\n", encoding="utf-8")
    temporary.chmod(0o600)
    os.replace(temporary, ENV_PATH)
except Exception:
    temporary.unlink(missing_ok=True)
    raise

print("Gemini-sleutel gecontroleerd en privé opgeslagen.")
print("Eufy AI: aan (maximaal 5 API-aanroepen per dag; alleen nieuwe opnames).")
print("Pet Feeder Gemini: aan (maximaal 5 API-aanroepen per dag; alleen nieuwe detecties).")
print("LSC Gemini: uit. ntfy-instellingen behouden.")
print("Start nu: cd ~/deurbel && bash scripts/update.sh")
