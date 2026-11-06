#!/usr/bin/env python3
"""Read-only progress report for Eufy archive Gemini and ntfy delivery."""
from pathlib import Path
from datetime import datetime, timezone
import json

root=Path(__file__).resolve().parent.parent
recordings=Path("/mnt/security/deurbel-test")
data=root/"data-test"
def load(name):
    try:
        return json.loads((data/name).read_text())
    except (OSError, ValueError):
        return {}
ai=load("eufy-ai.json")
notify=load("notification-state.json")
clips=sorted(recordings.glob("*_eufy-original.mp4"))
items=ai.get("items",{})
counts={"done":0,"pending":0,"in_progress":0,"retrying":0,"blocked":0}
for clip in clips:
    item=items.get(clip.name,{})
    status=item.get("status")
    if status=="done":
        counts["done"]+=1
    elif status=="processing":
        counts["in_progress"]+=1
    elif status=="rate-limited" or (status=="error" and int(item.get("attempts") or 0)<3):
        counts["retrying"]+=1
    elif status=="error":
        counts["blocked"]+=1
    else:
        counts["pending"]+=1
day=datetime.now(timezone.utc).date().isoformat()
used=int(ai.get("apiCallsCount") or 0) if ai.get("apiCallsDay")==day else 0
print("Eufy-video's in Security Center:",len(clips))
print("Gemini klaar:",counts["done"])
print("Nog in wachtrij:",counts["pending"])
print("Bezig:",counts["in_progress"])
print("Wacht op nieuwe poging:",counts["retrying"])
print("Handmatige controle nodig:",counts["blocked"])
print("Gemini API-aanroepen vandaag (UTC):",used)
print("Afzonderlijk bevestigde ntfy-berichten:",len(notify.get("seenEufy",{})))
print("Laatste Gemini-fout:",ai.get("lastError") or "geen")
print("Laatste ntfy-fout:",notify.get("lastError") or "geen")

# Show what will actually be processed once the scheduled unlimited mode starts.
env = root / ".env.testports"
if env.exists():
    for line in env.read_text(encoding="utf-8").splitlines():
        if line.startswith("EUFY_AI_UNLIMITED_NEW_FROM="):
            value = line.split("=",1)[1].strip()
            try:
                from datetime import datetime
                scheduled = datetime.fromisoformat(value)
                live = datetime.now(timezone.utc) >= scheduled.astimezone(timezone.utc)
                cutoff = value[:10]
                waiting_new = sum(1 for clip in clips
                    if clip.name.startswith("motion_") and clip.name[7:17] >= cutoff
                    and items.get(clip.name,{}).get("status") != "done")
                waiting_old = sum(1 for clip in clips
                    if clip.name.startswith("motion_") and clip.name[7:17] < cutoff
                    and items.get(clip.name,{}).get("status") != "done")
                print("Eufy onbeperkt (alleen nieuw) vanaf:", value)
                print("Omschakeling actief:", "ja" if live else "nee")
                print("Nieuwe video's vanaf deze datum nog te analyseren:", waiting_new)
                print("Oude video's die na omschakeling gepauzeerd worden:", waiting_old)
            except ValueError:
                print("Eufy-onbeperkt: ongeldige plandatum")
            break

