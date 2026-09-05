# Eufy Mega automatische herstelservice

Sinds de overgang van Eufy naar de nieuwe Mega/v6-backend kan `eufy-security-ws` 4.1.0 in een toestand terechtkomen waarin de cloudverbinding `connected: true` meldt, maar `stations: []` en `devices: []` teruggeeft. De deurbelviewer krijgt dan onder andere `station_not_found` en `device_not_found`.

Dit project bevat een tijdelijke herstelservice voor die upstream-bug. De service controleert elke vijf minuten de bestaande dashboardstatus en grijpt alleen in wanneer de bekende fout wordt gezien.

## Installeren

Vanuit de repository:

```bash
sudo bash scripts/install-eufy-autofix.sh
```

Standaard verwacht de service:

- Eufy-container: `eufy-security-ws`
- Eufy persistent data: `/opt/eufy-security-ws/data`
- Deurbel-dashboardstatus: `http://127.0.0.1:8090/api/status`

De installer neemt automatisch het huidige repositorypad over voor het herstarten van `deurbel-viewer`.

## Werking

Bij een gezonde verbinding doet de service niets en logt hij alleen:

```text
[eufy-autofix] ... Eufy is gezond.
```

Wanneer `station_not_found` of `device_not_found` wordt gezien:

1. wordt `eufy-security-ws` volledig gestopt;
2. wordt eerst een backup van `persistent.json` gemaakt;
3. wordt alleen de top-level legacy `login_hash` ongeldig gemaakt;
4. blijft de nested `megaApi`-sessie onaangeraakt;
5. wordt `eufy-security-ws` opnieuw gestart zodat een verse Mega-login wordt afgedwongen;
6. wordt daarna `deurbel-viewer` opnieuw gestart;
7. blijven de laatste tien automatische backups bewaard.

De LSC/Tuya-camera wordt door deze routine niet gewijzigd.

## Status bekijken

```bash
sudo systemctl status eufy-mega-autofix.timer --no-pager
sudo journalctl -u eufy-mega-autofix.service -n 50 --no-pager
```

## Handmatig testen

```bash
sudo systemctl start eufy-mega-autofix.service
sudo journalctl -u eufy-mega-autofix.service -n 30 --no-pager
```

## Tijdelijke workaround

Dit is bewust een workaround en geen vervanging voor een officiële fix in `eufy-security-ws` / `eufy-security-client`. De upstream-bug wordt gevolgd in:

- https://github.com/bropat/eufy-security-ws/issues/595

Wanneer upstream de Mega/v6-sessie correct persistent hergebruikt, kan deze herstelservice waarschijnlijk weer worden verwijderd.
