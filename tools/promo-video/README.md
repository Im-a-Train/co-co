# Promo-Video (Deutsch)

`record.mjs` nimmt ein Werbevideo von co-co auf: die App im Mock-Modus (`?mock=1`, keine echten Daten)
und die öffentliche Anmeldeseite der MiData-Testumgebung der PBS (`https://pbs.puzzle.ch`, ohne Login).
Titelkarten, deutsche Untertitel, Cursor und Hervorhebungen zeichnet ein Overlay direkt in die Seite,
das Video braucht also keinen Schnitt.

```bash
npm install
npx playwright-core install ffmpeg      # einmalig, Encoder für die Aufnahme
node tools/promo-video/record.mjs        # -> promo-out/co-co-promo.webm (1920x1080, VP9, ca. 2:45)
```

- Startet bei Bedarf selbst Vite auf `PROMO_PORT` (Standard 1437) und nutzt das installierte Microsoft Edge.
- `PROMO_MIDATA_URL` überschreibt die MiData-Seite, `PROMO_FFMPEG` den ffmpeg-Pfad.
- Ablauf und Texte stehen als Szenen in `record.mjs` (Meine Lager, Cockpit, Raster, Befunde durchgehen,
  «Warum?», Feedback + Kommentar-Sync, MiData, Selbstcheck, Fristen-Radar).
- Kein Ton: Untertitel statt Sprecher. Für eine Tonspur das WebM in einem Schnittprogramm vertonen.
