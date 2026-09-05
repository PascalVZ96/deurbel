# Deurbel Security

Eigen webviewer en lokaal beveiligingssysteem voor de **Eufy T8213 Video Doorbell Dual**, uitgebreid met een **LSC Smart Connect 1080P IP Indoor Mini** via de Tuya RTSP Bridge.

Het project gebruikt een bestaande lokale `eufy-security-ws` verbinding voor de Eufy-deurbel. Home Assistant, go2rtc en VLC zijn niet nodig voor de webviewer. De LSC-camera gebruikt een aparte lokale RTSP-bron en wordt door de viewer omgezet naar browservriendelijke MJPEG.

## Functies

- livebeeld van de hoofd- en pakketcamera van de Eufy-deurbel op één webpagina;
- derde camerategel voor de LSC Smart Connect-camera;
- automatische watchdog wanneer de Eufy P2P-stream vastloopt;
- eigen bewegingsdetectie op het videobeeld, dus niet afhankelijk van Eufy's bewegingsmelding;
- beveiligingsmodus die de stream actief houdt en zelf beweging bewaakt;
- bij beweging: standaard 5 seconden vóór en 15 seconden na de detectie opslaan;
- MP4-opname plus JPEG-miniatuur;
- opnameoverzicht in de webpagina met afspelen en verwijderen;
- automatische verwijdering na standaard 14 dagen;
- opslag op een aparte HDD via `/mnt/security/deurbel`;
- optionele automatische workaround voor de Eufy Mega/v6 `station_not_found` / `device_not_found` bug;
- Eufy-wachtwoorden en tokens staan niet in deze repository.

## Vereisten

- Linux-server met Docker en Docker Compose;
- `eufy-security-ws` draait lokaal op poort `3000`;
- de T8213 is zichtbaar voor het account waarmee `eufy-security-ws` is ingelogd;
- voor de LSC-camera: een werkende lokale RTSP-bron, bijvoorbeeld via `tuya-rtsp-bridge`.

## Installeren

```bash
git clone https://github.com/PascalVZ96/deurbel.git
cd deurbel
bash setup.sh T8213XXXXXXXXXXXX
```

Open daarna:

```text
http://SERVER-IP:8090
```

## Bestaande installatie bijwerken

```bash
cd ~/deurbel
git pull
sudo docker compose up -d --build
```

## LSC Smart Connect-camera

De LSC-camera wordt door `src/lsc-proxy.mjs` van RTSP naar MJPEG omgezet. De proxy draait standaard op poort `8093` en start FFmpeg alleen wanneer er een kijker verbonden is.

Voor de huidige Tuya RTSP Bridge-opstelling:

```env
LSC_RTSP_URL=rtsp://127.0.0.1:8556/LSC_Smart_Connect_1080P_IP_Indoor_Mini/hd
LSC_PROXY_PORT=8093
LSC_MJPEG_FPS=8
LSC_MJPEG_QUALITY=5
LSC_IDLE_STOP_SECONDS=10
LSC_RESTART_DELAY_MS=2000
```

De losse LSC-testpagina is beschikbaar op:

```text
http://SERVER-IP:8093/
```

Meer informatie staat in [`docs/lsc-camera.md`](docs/lsc-camera.md).

## Eufy Mega/v6 automatische herstelservice

Bij de huidige Mega/v6-overgang kan `eufy-security-ws` soms wel `connected: true` melden, terwijl de stations- en apparatenlijst leeg is. Het dashboard ziet dan bijvoorbeeld `station_not_found` en `device_not_found`.

Installeer de tijdelijke automatische herstelservice met:

```bash
sudo bash scripts/install-eufy-autofix.sh
```

De systemd-timer controleert elke vijf minuten. Bij een gezonde verbinding doet hij niets. Alleen bij de bekende Mega-fout wordt eerst een backup van `persistent.json` gemaakt en daarna een verse Mega-login afgedwongen.

Status bekijken:

```bash
sudo systemctl status eufy-mega-autofix.timer --no-pager
sudo journalctl -u eufy-mega-autofix.service -n 50 --no-pager
```

Zie [`docs/eufy-mega-autofix.md`](docs/eufy-mega-autofix.md) voor details.

## Beveiligingsmodus

Klik op **Beveiliging inschakelen**. De interne Eufy-viewer blijft dan actief en de beveiligingsmonitor analyseert het livebeeld op echte beeldverandering.

De eerste instellingen zijn bewust gevoelig om meer beweging te zien dan de standaard Eufy-detectie. In `.env` kun je dit later aanpassen:

```text
MOTION_THRESHOLD_PERCENT=1.5
MOTION_PIXEL_THRESHOLD=24
PRE_RECORD_SECONDS=5
POST_RECORD_SECONDS=15
RETENTION_DAYS=14
```

Een lager `MOTION_THRESHOLD_PERCENT` maakt de detectie gevoeliger.

## Opslag

De Docker-container gebruikt `/recordings` voor deurbelopnames. In de huidige Compose-configuratie is deze gekoppeld aan:

```text
/mnt/security/deurbel
```

Zorg daarom dat de security-HDD vóór het starten van de container correct op `/mnt/security` is gemount en dat `/mnt/security/deurbel` bestaat.

## Architectuur

- `8090`: publiek Security Center / dashboard;
- `8092`: interne Eufy-viewer;
- `8093`: LSC RTSP → MJPEG proxy;
- `3000`: bestaande `eufy-security-ws` WebSocket-service;
- `8556`: huidige lokale Tuya RTSP Bridge-poort voor de LSC-camera.

Het dashboard stuurt de Eufy-viewer aan, toont de LSC-camera naast de twee Eufy-lenzen en beheert lokale opnames op de security-HDD.
