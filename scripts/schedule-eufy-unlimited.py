#!/usr/bin/env python3
"""Schedule unlimited Gemini for NEW Eufy recordings starting Nov 7 Dutch time."""
from datetime import datetime, timezone
from pathlib import Path
import os
import shutil
import sys

root = Path(__file__).resolve().parent.parent
config = root / ".env.testports"
start = "2026-11-07T00:00:00+01:00"

if not config.is_file():
    sys.exit("FOUT: .env.testports ontbreekt; niets aangepast.")

text = config.read_text(encoding="utf-8")
lines = text.splitlines()
updated = []
found = False
for line in lines:
    if line.startswith("EUFY_AI_UNLIMITED_NEW_FROM="):
        if not found:
            updated.append("EUFY_AI_UNLIMITED_NEW_FROM=" + start)
            found = True
        continue
    updated.append(line)
if not found:
    updated.append("EUFY_AI_UNLIMITED_NEW_FROM=" + start)

if updated == lines:
    print("De Eufy-omschakeling staat al ingesteld op 7 november 2026, 00:00.")
    sys.exit(0)

backup = config.with_name(".env.testports.bak-eufy-schedule-" +
    datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S"))
shutil.copy2(config, backup)
backup.chmod(0o600)

temp = config.with_name(".env.testports.schedule-tmp")
try:
    temp.write_text("\n".join(updated)+"\n", encoding="utf-8")
    temp.chmod(0o600)
    os.replace(temp, config)
except Exception:
    temp.unlink(missing_ok=True)
    raise

print("Eufy Gemini-omschakeling ingesteld: zaterdag 7 november 2026, 00:00 Nederlandse tijd.")
print("Vandaag: huidige max 10 Eufy API-aanroepen/dag, waarvan max 5 archief.")
print("Vanaf morgen: geen lokale daglimiet voor nieuwe Eufy-opnames vanaf 7 november.")
print("Oude opnames blijven bewaard maar de automatische archief-inhaalactie wordt gepauzeerd.")
print("De bestaande wachttijd tussen API-aanroepen blijft gelden; Google kan eigen quota/kosten hanteren.")
print("Nu uitvoeren: cd ~/deurbel && bash scripts/update.sh")
