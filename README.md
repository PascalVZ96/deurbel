# Deurbel Security

Eigen webviewer en lokaal beveiligingssysteem voor de **Eufy T8213 Video Doorbell Dual**.

Het project gebruikt een bestaande lokale `eufy-security-ws` verbinding. Home Assistant, go2rtc en VLC zijn niet nodig voor de webviewer.

## Functies

- livebeeld van hoofd- en pakketcamera op één webpagina;
- automatische watchdog wanneer de Eufy P2P-stream vastloopt;
- eigen bewegingsdetectie op het videobeeld, dus niet afhankelijk van Eufy's bewegingsmelding;
- beveiligingsmodus die de stream actief houdt en zelf beweging bewaakt;
- bij beweging: standaard 5 seconden vóór en 15 seconden na de detectie opslaan;
- MP4-opname plus JPEG-miniatuur;
- opnameoverzicht in de webpagina met afspelen en verwijderen;
- automatische verwijdering na standaard 14 dagen;
- lokale opslag in `./recordings`, later eenvoudig te verplaatsen naar een extra HDD;
- Eufy-wachtwoorden en tokens staan niet in deze repository.

## Vereisten

- Linux-server met Docker en Docker Compose;
- `eufy-security-ws` draait lokaal op poort `3000`;
- de T8213 is zichtbaar voor het account waarmee `eufy-security-ws` is ingelogd.

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

## Beveiligingsmodus

Klik op **Beveiliging inschakelen**. De interne viewer blijft dan actief en de beveiligingsmonitor analyseert het livebeeld op echte beeldverandering.

De eerste instellingen zijn bewust gevoelig om meer beweging te zien dan de standaard Eufy-detectie. In `.env` kun je dit later aanpassen:

```text
MOTION_THRESHOLD_PERCENT=1.5
MOTION_PIXEL_THRESHOLD=24
PRE_RECORD_SECONDS=5
POST_RECORD_SECONDS=15
RETENTION_DAYS=14
```

Een lager `MOTION_THRESHOLD_PERCENT` maakt de detectie gevoeliger.

## Opslag en later een extra HDD

Standaard komen video's in:

```text
./recordings
```

Docker ziet die map als `/recordings`.

Wanneer later een extra HDD is gemount, bijvoorbeeld op `/mnt/security`, hoeft alleen dit in `.env` te worden gezet:

```text
RECORDINGS_HOST_PATH=/mnt/security
```

Daarna:

```bash
sudo docker compose up -d
```

## Architectuur

De bewezen Eufy-viewer draait intern op poort `8092`. Het beveiligingsdashboard draait publiek op `8090`, stuurt de viewer aan, analyseert de MJPEG-beelden en maakt lokale H.264/MP4-opnames bij beweging.
