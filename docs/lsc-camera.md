# LSC Smart Connect camera

De LSC Smart Connect 1080P IP-camera wordt lokaal ontsloten via de Tuya RTSP Bridge die op dezelfde Ubuntu-server draait.

## Huidige RTSP-bron

```text
rtsp://127.0.0.1:8556/LSC_Smart_Connect_1080P_IP_Indoor_Mini/hd
```

Omdat `deurbel-viewer` met `network_mode: host` draait, verwijst `127.0.0.1` vanuit de container naar dezelfde Ubuntu-host.

## .env

Voeg dit toe aan `.env`:

```text
LSC_RTSP_URL=rtsp://127.0.0.1:8556/LSC_Smart_Connect_1080P_IP_Indoor_Mini/hd
LSC_PROXY_PORT=8093
LSC_MJPEG_FPS=8
LSC_MJPEG_QUALITY=5
LSC_IDLE_STOP_SECONDS=10
LSC_RESTART_DELAY_MS=2000
```

Daarna opnieuw bouwen:

```bash
docker compose up -d --build
```

## Testen

Open:

```text
http://SERVER-IP:8093/
```

De proxy biedt daarnaast:

```text
http://SERVER-IP:8093/stream.mjpg
http://SERVER-IP:8093/snapshot.jpg
http://SERVER-IP:8093/api/status
```

FFmpeg opent de RTSP-bron pas wanneer er minstens één kijker is. Nadat de laatste kijker weg is, stopt FFmpeg standaard na 10 seconden. Als de RTSP-verbinding wegvalt terwijl er kijkers zijn, probeert de proxy automatisch opnieuw te verbinden.

Als UFW actief is en de testpagina vanaf een andere computer niet bereikbaar is:

```bash
sudo ufw allow 8093/tcp
```

## Security Center

De LSC-camera wordt als derde camerategel in het bestaande Security Center op poort `8090` getoond. De LSC-stream werkt onafhankelijk van de Eufy start/stop-knoppen: de batterijgevoede Eufy-deurbel kan blijven slapen terwijl de netgevoede LSC-camera live blijft.

Het dashboard gebruikt de interne LSC-proxy/statusroutes zodat de gebruiker voor normaal gebruik alleen `http://SERVER-IP:8090/` hoeft te openen.
