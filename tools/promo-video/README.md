# Promo-Video (Deutsch, mit Sprecher)

Ein ca. 4-minütiges Video als Geschichte: J+S-Coach **Falk** begleitet ein Sommerlager – Grobprogramm (GP)
und Detailprogramm (DP), passende Regeln, Rückmeldungen in eCamp, Ausbildungen aus MiData, Anmeldung und
Personen-Abgleich mit der NDS, Selbstcheck des Teams und Fristen im Kalender. Bewusst in einfacher Sprache.

Die App läuft im Mock-Modus mit dem Promo-Szenario `?mock=1&scenario=promo` (erfundenes, abwechslungsreiches
Lager, nur in Entwicklungs-Builds, siehe `apps/desktop/src/dev/`).

| Datei | Zweck |
| --- | --- |
| `story.mjs` | Drehbuch: Kapitel, Untertitel (kicker / title / sub) und Sprechertext pro Beat, in normaler Schreibweise |
| `pronounce.mjs` | Aussprache-Tabelle: J+S → «I und Ess», co-co → «Ko-Ko», GP → «Ge-Pe», NDS → «En-De-Es», englische Begriffe … |
| `narration.mjs` | Erzeugt `narration.json` (Sprechertext mit Aussprache-Tabelle) für `tts.py` |
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
node tools/promo-video/narration.mjs                    # -> promo-out/narration.json
python tools/promo-video/tts.py promo-out/narration.json promo-out/voice --model promo-out/voices/de_DE-thorsten-high.onnx --speed 1.05 --pause 0.45

# 2. Aufnahme (startet Vite selbst auf PROMO_PORT, Standard 1437)
node tools/promo-video/record.mjs                       # -> promo-out/co-co-promo.silent.webm + timeline.json

# 3. Mischen (volles ffmpeg mit x264/aac/opus nötig, z. B. npm i ffmpeg-static)
FFMPEG=/pfad/zu/ffmpeg node tools/promo-video/mix.mjs   # -> promo-out/co-co-promo.mp4 / .webm
```

- Texte ändern: `story.mjs` anpassen, dann Schritte 1–3 erneut ausführen.
- Ein Wort klingt falsch: eine Zeile in `pronounce.mjs` ergänzen. Prüfen, wie Piper es spricht:
  `python -c "from piper import PiperVoice; v=PiperVoice.load('promo-out/voices/de_DE-thorsten-high.onnx'); print(v.phonemize('Ge-Pe'))"`
- Andere Stimme: jede Piper-Stimme oder ein Cloud-Dienst (z. B. Azure `de-CH-LeniNeural`) – nötig ist nur eine
  WAV-Datei pro Beat plus `durations.json`. Eigene Aufnahme geht genauso.
- `PROMO_SCENARIO=` (leer) nimmt das normale Testlager statt des Promo-Lagers.
