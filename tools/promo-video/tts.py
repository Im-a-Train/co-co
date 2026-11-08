"""
Local German text-to-speech for the promo video (Windows only, no network).

Uses the Windows speech API (SAPI 5 via COM) with a OneCore voice, e.g. "Microsoft Karsten" (de-CH).
Reads a JSON list [{"id": "...", "voice": "text"}] and writes <out>/<id>.wav (24 kHz, 16 bit, mono)
plus <out>/durations.json {"id": seconds}.

    python tts.py narration.json outDir [--voice Karsten] [--rate 0]

Requires: pip install comtypes
"""
import argparse
import json
import os
import wave

import comtypes.client

ONECORE = r"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Speech_OneCore\Voices"
CLASSIC = r"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Speech\Voices"
SSFM_CREATE_FOR_WRITE = 3
SAFT_24KHZ_16BIT_MONO = 34


def find_voice(name):
    for cat_id in (ONECORE, CLASSIC):
        cat = comtypes.client.CreateObject("SAPI.SpObjectTokenCategory")
        try:
            cat.SetId(cat_id, False)
        except Exception:
            continue
        tokens = cat.EnumerateTokens()
        for i in range(tokens.Count):
            tok = tokens.Item(i)
            if name.lower() in tok.GetDescription().lower():
                return tok
    raise SystemExit(f"voice '{name}' not found")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("narration")
    ap.add_argument("out")
    ap.add_argument("--voice", default="Karsten")
    ap.add_argument("--rate", type=int, default=0, help="-10..10")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    with open(a.narration, encoding="utf-8") as f:
        items = json.load(f)

    voice = comtypes.client.CreateObject("SAPI.SpVoice")
    voice.Voice = find_voice(a.voice)
    voice.Rate = a.rate
    durations = {}
    for it in items:
        path = os.path.abspath(os.path.join(a.out, f"{it['id']}.wav"))
        fmt = comtypes.client.CreateObject("SAPI.SpAudioFormat")
        fmt.Type = SAFT_24KHZ_16BIT_MONO
        stream = comtypes.client.CreateObject("SAPI.SpFileStream")
        stream.Format = fmt
        stream.Open(path, SSFM_CREATE_FOR_WRITE, False)
        voice.AudioOutputStream = stream
        voice.Speak(it["voice"])
        stream.Close()
        with wave.open(path) as w:
            durations[it["id"]] = round(w.getnframes() / w.getframerate(), 3)
        print(f"{it['id']}: {durations[it['id']]} s")
    with open(os.path.join(a.out, "durations.json"), "w", encoding="utf-8") as f:
        json.dump(durations, f, indent=2)


if __name__ == "__main__":
    main()
