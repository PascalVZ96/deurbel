#!/usr/bin/env python3
"""Opt in to queued Gemini descriptions + one ntfy alert for each Eufy recording."""
from datetime import datetime, timezone
from pathlib import Path
import json
import os
import re
import shutil
import sys

root = Path(__file__).resolve().parent.parent
env = root / ".env.testports"
if not env.is_file():
    sys.exit("FOUT: .env.testports ontbreekt; niets aangepast.")

def read_values(p):
    values = {}
    if p.is_file():
        for line in p.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                key, value = line.split("=", 1)
                values[key.strip()] = value.strip().strip('"').strip("'")
    return values

values = read_values(root / ".env")
values.update(read_values(env))
if not values.get("FRIGATE_GEMINI_API_KEY"):
    sys.exit("FOUT: Stel eerst een Gemini API-sleutel in. Niets aangepast.")
if not re.fullmatch(r"[A-Za-z0-9_-]{16,64}", values.get("NTFY_TOPIC", "")):
    sys.exit("FOUT: ntfy-onderwerp ontbreekt of is ongeldig. Niets aangepast.")

activation = values.get("EUFY_NOTIFY_START_AT") or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
if not re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", activation):
    sys.exit("FOUT: bestaande EUFY_NOTIFY_START_AT is ongeldig; niets aangepast.")

settings = {
    "EUFY_AI_ENABLED": "1",
    "EUFY_AI_BACKFILL_EXISTING": "1",
    "EUFY_AI_MAX_PER_DAY": "10",
    "EUFY_AI_BACKFILL_MAX_PER_DAY": "5",
    "EUFY_AI_NOTIFY_BACKFILL": "1",
    "EUFY_AI_MIN_INTERVAL_SECONDS": "60",
    "NOTIFY_ENABLED": "1",
    "NOTIFY_EUFY": "1",
    "EUFY_NOTIFY_START_AT": activation,
}

lines = env.read_text().splitlines()
updated, seen = [], set()
for line in lines:
    if "=" in line and not line.lstrip().startswith("#"):
        key = line.split("=", 1)[0].strip()
        if key in settings:
            if key not in seen:
                updated.append(key + "=" + settings[key])
            seen.add(key)
            continue
    updated.append(line)
for key, value in settings.items():
    if key not in seen:
        updated.append(key + "=" + value)

backup = env.with_name(".env.testports.backup-eufy-" +
    datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S"))
shutil.copy2(env, backup)
backup.chmod(0o600)
tmp = env.with_name(".env.testports.eufy-tmp")
try:
    tmp.write_text("\n".join(updated) + "\n")
    tmp.chmod(0o600)
    os.replace(tmp, env)
except Exception:
    tmp.unlink(missing_ok=True)
    raise

status = {}
try:
    status = json.loads((root / "data-test" / "eufy-ai.json").read_text())
except (OSError, ValueError):
    pass

clips = list(Path("/mnt/security/deurbel-test").glob("*_eufy-original.mp4"))
done = sum(1 for f in clips if status.get("items", {}).get(f.name, {}).get("status") == "done")
print("Configuratie lokaal opgeslagen; privéback-up gemaakt.")
print("Eufy HomeBase-opnames aanwezig:", len(clips))
print("Al geanalyseerd:", done)
print("Voor automatische verwerking:", len(clips)-done)
print("Gemini: alle nieuwe + bestaande Eufy-opnames, maximaal 10 API-aanroepen per UTC-dag.")
print("Van die 10 maximaal 5 archiefvideo's; nieuwe opnames krijgen voorrang.")
print("ntfy: één melding per nieuwe én ingelopen archiefanalyse (archiefmeldingen gemarkeerd).")
print("Pet Feeder, LSC, opnames en bewaartermijn zijn niet gewijzigd.")
print("Start nu: cd ~/deurbel && bash scripts/update.sh")
