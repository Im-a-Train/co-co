# Promo-Video (Deutsch, mit Sprecher)

Ein ca. 3½-minütiges Video als Geschichte: J+S-Coach **Falk** begleitet das Winterlager «Auf in die Berge» –
vom ersten Überblick über Rückmeldungen in eCamp, Ausbildungen aus MiData und den Selbstcheck des Teams
bis zu den Fristen im Kalender. Bewusst in einfacher Sprache, ohne Technik-Begriffe. Die App läuft im
Mock-Modus (`?mock=1`, erfundene Daten).

| Datei | Zweck |
| --- | --- |
| `story.mjs` | Kapitel, Untertitel (kicker / title / sub) und Sprechertext pro Beat |
| `tts.py` | Sprachausgabe offline: Piper (neuronale Stimme, empfohlen) oder Windows-Stimme (SAPI) |
| `record.mjs` | Spielt die Geschichte in Edge ab, wartet pro Beat auf die Sprechdauer, nimmt 1920x1080 auf, schreibt `timeline.json` |
| `mix.mjs` | Legt die Sprachclips zeitgenau unter das Video → `co-co-promo.mp4` und `co-co-promo.webm` |

## Ablauf (Windows)

```bash
npm install
npx playwright-core install ffmpeg                      # einmalig, Encoder für die Aufnahme

# 1. Sprecher (offline). Piper + deutsche Stimme «Thorsten» (ca. 115 MB)
python -m pip install piper-tts
python -m piper.download_voices --download-dir promo-out/voices de_DE-thorsten-high
node -e "import('./tools/promo-video/story.mjs').then(m=>require('fs').writeFileSync('promo-out/narration.json',JSON.stringify(m.BEATS.map(b=>({id:b.id,voice:b.voice})))))"
python tools/promo-video/tts.py promo-out/narration.json promo-out/voice --model promo-out/voices/de_DE-thorsten-high.onnx --speed 1.05

# 2. Aufnahme (startet Vite selbst auf PROMO_PORT, Standard 1437)
node tools/promo-video/record.mjs                       # -> promo-out/co-co-promo.silent.webm + timeline.json

# 3. Mischen (volles ffmpeg mit x264/aac/opus nötig, z. B. npm i ffmpeg-static)
FFMPEG=/pfad/zu/ffmpeg node tools/promo-video/mix.mjs   # -> promo-out/co-co-promo.mp4 / .webm
```

- Texte ändern: nur `story.mjs` anpassen, dann Schritte 1–3 erneut ausführen.
- Andere Stimme: jede Piper-Stimme (`de_DE-thorsten-medium`, `de_DE-kerstin-low`, …) oder ein Cloud-Dienst wie
  Azure Speech (`de-CH-LeniNeural`) – wichtig ist nur: eine WAV-Datei pro Beat plus `durations.json`.
- Eigene Aufnahme: pro Beat `<id>.wav` einsprechen, `durations.json` mit den Längen erstellen, Schritte 2–3.
- Fehlt `durations.json`, schätzt `record.mjs` die Dauer aus der Textlänge (Video ohne Ton).
