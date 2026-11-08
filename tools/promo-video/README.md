# Promo-Video (Deutsch, mit Sprecher)

Ein ca. 4-minütiges Video als Geschichte: J+S-Coach **Falk** coacht das Winterlager «Auf in die Berge» –
vom ersten Überblick über Befunde, Feedback in eCamp, MiData-Qualifikationen und Selbstcheck bis zu den
Fristen im Kalender. Die App läuft im Mock-Modus (`?mock=1`, erfundene Daten); für MiData wird die
öffentliche Anmeldeseite der PBS-Testumgebung (`https://pbs.puzzle.ch`) gezeigt, ohne Login.

| Datei | Zweck |
| --- | --- |
| `story.mjs` | Kapitel, Untertitel (kicker / title / sub) und Sprechertext pro Beat |
| `tts.py` | Lokale Sprachausgabe über Windows (SAPI, Stimme «Microsoft Karsten», de-CH), schreibt WAV + `durations.json` |
| `record.mjs` | Spielt die Geschichte in Edge ab, wartet pro Beat auf die Sprechdauer, nimmt 1920x1080 auf, schreibt `timeline.json` |
| `mix.mjs` | Legt die Sprachclips zeitgenau unter das Video → `co-co-promo.mp4` und `co-co-promo.webm` |

## Ablauf (Windows)

```bash
npm install
npx playwright-core install ffmpeg                      # einmalig, Encoder für die Aufnahme

# 1. Sprecher (lokal, kein Netz). Braucht Python + comtypes und die Windows-Stimme Karsten (de-CH).
python -m pip install comtypes
node -e "import('./tools/promo-video/story.mjs').then(m=>require('fs').writeFileSync('promo-out/narration.json',JSON.stringify(m.BEATS.map(b=>({id:b.id,voice:b.voice})))))"
python tools/promo-video/tts.py promo-out/narration.json promo-out/voice --rate 1

# 2. Aufnahme (startet Vite selbst auf PROMO_PORT, Standard 1437)
node tools/promo-video/record.mjs                       # -> promo-out/co-co-promo.silent.webm + timeline.json

# 3. Mischen (volles ffmpeg mit x264/aac/opus nötig)
FFMPEG=/pfad/zu/ffmpeg node tools/promo-video/mix.mjs   # -> promo-out/co-co-promo.mp4 / .webm
```

- Fehlt `durations.json`, schätzt `record.mjs` die Dauer aus der Textlänge (Video ohne Ton).
- Andere Stimme: `tts.py --voice <Name>` (z. B. eine installierte de-DE-Stimme). Für natürlichere Stimmen
  kann `tts.py` durch einen Cloud-Dienst ersetzt werden (z. B. Azure Speech `de-CH-LeniNeural`) – das
  Format (WAV pro Beat + `durations.json`) bleibt gleich.
- Texte ändern: nur `story.mjs` anpassen, dann Schritte 1–3 erneut ausführen.
