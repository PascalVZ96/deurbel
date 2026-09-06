# Security Center login

Het publieke Security Center op `WEB_PORT` loopt via `src/dashboard-auth-proxy.mjs`.
De bestaande dashboard/API-service draait intern op `127.0.0.1:DASHBOARD_INTERNAL_PORT` en is daardoor niet rechtstreeks vanaf het netwerk bereikbaar.

## Vereiste `.env`-waarden

```env
DASHBOARD_USERNAME=pascal
DASHBOARD_PASSWORD=kies-een-sterk-wachtwoord
DASHBOARD_SESSION_SECRET=plaats-hier-minimaal-32-willekeurige-tekens
DASHBOARD_SESSION_HOURS=336
```

Maak bij voorkeur een sessiegeheim met:

```bash
openssl rand -hex 32
```

Als gebruikersnaam, wachtwoord of een geldig sessiegeheim ontbreekt, blijft het publieke dashboard geblokkeerd en verschijnt een configuratiemelding.

## Beveiliging

- Alle dashboardpagina's, API-routes, camerastreams, thumbnails en opnames lopen door dezelfde loginlaag.
- De sessiecookie is `HttpOnly` en `SameSite=Lax`; bij HTTPS wordt ook `Secure` gebruikt.
- Na 8 mislukte inlogpogingen vanaf hetzelfde IP-adres wordt de login ongeveer 15 minuten geblokkeerd.
- De interne dashboardservice bindt alleen aan `127.0.0.1`.
- Wachtwoorden en sessiegeheimen horen uitsluitend in `.env` en niet in GitHub.

## Online publiceren

Gebruik voor toegang via internet altijd HTTPS via een reverse proxy of tunnel en stuur die naar `127.0.0.1:8090`. Zorg dat de proxy `X-Forwarded-Proto: https` doorgeeft, zodat de sessiecookie als `Secure` wordt gezet.
