# Wijzigingen

## 2026.09.06.1 — Security Center

- De website heet voortaan Security Center, met Overzicht, Camera’s, AI-meldingen, Opnames en Systeem en opslag als aparte weergaven.
- Het overzicht toont de camerastatus en maximaal vijf recente meldingen.
- AI-meldingen hebben zoeken, camerafilters, een filter voor lokale auto-detectie, een periodekeuze en maximaal twaalf meldingen per pagina. De selectie omvat de maximaal 100 meest recente meldingen die de bestaande API teruggeeft; dit is geen volledig historisch archief.
- Een mislukte verversing behoudt de laatst geladen meldingen en vermeldt wanneer die gegevens zijn opgehaald.
- Ontbrekende AI-zekerheid verschijnt niet meer als 0%; ontbrekende dreigingsinformatie krijgt geen beoordeling. Lokale auto-events zijn herkenbaar als lokale detectie.
- De bediening voor Eufy-bewaking is expliciet gelabeld als deurbelbediening. De opnamepagina biedt ook toegang tot het bestaande Frigate-archief voor LSC en Pet Feeder.
- Browser-livestreams laden alleen in de cameraweergave als het browsertabblad zichtbaar is. Hiervoor worden uitsluitend de beeldverbindingen in de browser geopend en gesloten.
- De Docker-build controleert de JavaScript-syntaxis voordat een nieuwe viewer kan worden gestart.
- `bash scripts/update.sh` haalt updates uit GitHub, bouwt de viewer en controleert of de website bereikbaar is. Lokale codewijzigingen worden niet automatisch gestasht of overschreven. Frigate wordt door dit script niet herstart.
