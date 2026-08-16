# Deurbel Viewer

Een eenvoudige webviewer voor een Eufy T8213 Video Doorbell Dual.

Doel van dit project:

- eigen webpagina voor livebeeld van de voordeur;
- geen Home Assistant nodig voor het bekijken van de stream;
- gebruikt een bestaande `eufy-security-ws`-verbinding;
- filtert de bruikbare HEVC basislaag (`layer_id 0`) uit de multi-layer stream van de T8213;
- zet die met FFmpeg om naar browser-vriendelijke H.264/HLS;
- start de batterijdeurbel alleen wanneer je op **Live bekijken** drukt.

> Dit project bevat geen Eufy-wachtwoorden of tokens. De viewer praat met een lokaal draaiende `eufy-security-ws` server.

## Status

Eerste versie in ontwikkeling.
