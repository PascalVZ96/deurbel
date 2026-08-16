# Deurbel Viewer

Een eenvoudige eigen webviewer voor de **Eufy T8213 Video Doorbell Dual**.

De viewer is bedoeld voor de situatie waarin de officiële Eufy-app wel werkt, maar je de deurbel ook gewoon via een browser op je eigen netwerk wilt bekijken zonder Home Assistant als videospeler.

## Wat het project doet

- eigen webpagina met **Live bekijken** en **Stop**;
- gebruikt een bestaande lokale `eufy-security-ws` verbinding;
- filtert automatisch alleen de geldige HEVC-basislaag (`layer_id 0`) uit de multi-layer videostream van de T8213;
- zet die laag rechtstreeks met FFmpeg om naar MJPEG dat iedere normale browser kan tonen;
- geen go2rtc, WebRTC-kaart, VLC of Home Assistant nodig voor het beeld;
- stopt de livestream standaard na 120 seconden om de batterij te sparen;
- bevat geen Eufy-wachtwoorden of tokens.

## Vereisten

- Linux-server met Docker en Docker Compose;
- `eufy-security-ws` draait lokaal en luistert op poort `3000`;
- je T8213 is zichtbaar voor het Eufy-account waarmee `eufy-security-ws` is ingelogd.

## Installeren

Clone de repository:

```bash
git clone https://github.com/PascalVZ96/deurbel.git
cd deurbel
```

Start de setup met het serienummer van je deurbel:

```bash
bash setup.sh T8213XXXXXXXXXXXX
```

De setup maakt lokaal een `.env` aan en bouwt de Docker-container. `.env` staat in `.gitignore` en wordt dus niet naar GitHub gestuurd.

Standaard is de viewer daarna bereikbaar op:

```text
http://SERVER-IP:8090
```

Als UFW actief is, open poort 8090 alleen voor je thuisnetwerk:

```bash
sudo ufw allow from 192.168.178.0/24 to any port 8090 proto tcp comment 'Deurbel Viewer'
```

## Bediening

Open de webpagina en druk op **Live bekijken**. De backend vraagt de Eufy P2P-livestream aan, haalt alleen `layer_id 0` uit de multi-layer HEVC-data en geeft het resultaat via FFmpeg als MJPEG aan de browser.

Met **Stop** wordt de Eufy-livestream weer beëindigd. Zonder handmatig stoppen gebeurt dit standaard automatisch na twee minuten.

## Instellingen

Zie `.env.example` voor de beschikbare instellingen:

- `EUFY_SERIAL` – serienummer van de deurbel;
- `EUFY_WS_URL` – standaard `ws://127.0.0.1:3000`;
- `WEB_PORT` – standaard `8090`;
- `AUTO_STOP_SECONDS` – standaard `120`;
- `MJPEG_FPS` – standaard `8`;
- `MJPEG_QUALITY` – FFmpeg JPEG-kwaliteit, standaard `5`.

## Opmerking over de T8213

De T8213 levert via de P2P-interface een multi-layer HEVC-stream. In tests bleek `layer_id 0` zelfstandig een geldige HEVC-video van **1024×1472 op 15 fps** te bevatten. Deze viewer filtert die laag vóór FFmpeg, zodat FFmpeg niet meer tegen de multi-layer HEVC-parserfout aanloopt.
