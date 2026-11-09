"""
Local German text-to-speech for the promo video (offline, no account).

Reads a JSON list [{"id": "...", "voice": "text"}] and writes <out>/<id>.wav plus <out>/durations.json.

Engines:
  piper (default, recommended): neural voice, e.g. de_DE-thorsten-high
      pip install piper-tts
      python -m piper.download_voices --download-dir voices de_DE-thorsten-high
      python tts.py narration.json outDir --model voices/de_DE-thorsten-high.onnx [--speed 1.0] [--pause 0.45]
  sapi (Windows only): built-in Windows voice, e.g. "Microsoft Karsten" (de-CH), sounds robotic
      pip install comtypes
      python tts.py narration.json outDir --engine sapi --voice Karsten [--rate 0]
"""
import argparse
import json
import os
import wave


ONECORE = r"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Speech_OneCore\Voices"
CLASSIC = r"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Speech\Voices"
SSFM_CREATE_FOR_WRITE = 3
SAFT_24KHZ_16BIT_MONO = 34


def find_voice(name):
    import comtypes.client

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
    ap.add_argument("--engine", choices=["piper", "sapi"], default="piper")
    ap.add_argument("--model", help="piper: path to the .onnx voice")
    ap.add_argument("--speed", type=float, default=1.0, help="piper: 1.1 = 10%% faster")
    ap.add_argument("--pause", type=float, default=0.45, help="piper: extra silence between sentences (s)")
    ap.add_argument("--voice", default="Karsten", help="sapi: part of the voice name")
    ap.add_argument("--rate", type=int, default=0, help="-10..10")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    with open(a.narration, encoding="utf-8") as f:
        items = json.load(f)

    speak = piper_speaker(a) if a.engine == "piper" else sapi_speaker(a)
    durations = {}
    for it in items:
        path = os.path.abspath(os.path.join(a.out, f"{it['id']}.wav"))
        speak(it["voice"], path)
        with wave.open(path) as w:
            durations[it["id"]] = round(w.getnframes() / w.getframerate(), 3)
        print(f"{it['id']}: {durations[it['id']]} s")
    with open(os.path.join(a.out, "durations.json"), "w", encoding="utf-8") as f:
        json.dump(durations, f, indent=2)


def piper_speaker(a):
    from piper import PiperVoice, SynthesisConfig

    if not a.model:
        raise SystemExit("--model path/to/voice.onnx is required for piper")
    voice = PiperVoice.load(a.model)
    cfg = SynthesisConfig(length_scale=1.0 / a.speed)

    def speak(text, path):
        # Piper yields one chunk per sentence; put a short silence between sentences.
        chunks = list(voice.synthesize(text, syn_config=cfg))
        first = chunks[0]
        gap = bytes(int(first.sample_rate * a.pause) * first.sample_width * first.sample_channels)
        with wave.open(path, "wb") as wf:
            wf.setframerate(first.sample_rate)
            wf.setsampwidth(first.sample_width)
            wf.setnchannels(first.sample_channels)
            for i, c in enumerate(chunks):
                if i:
                    wf.writeframes(gap)
                wf.writeframes(c.audio_int16_bytes)

    return speak


def sapi_speaker(a):
    import comtypes.client

    voice = comtypes.client.CreateObject("SAPI.SpVoice")
    voice.Voice = find_voice(a.voice)
    voice.Rate = a.rate

    def speak(text, path):
        fmt = comtypes.client.CreateObject("SAPI.SpAudioFormat")
        fmt.Type = SAFT_24KHZ_16BIT_MONO
        stream = comtypes.client.CreateObject("SAPI.SpFileStream")
        stream.Format = fmt
        stream.Open(path, SSFM_CREATE_FOR_WRITE, False)
        voice.AudioOutputStream = stream
        voice.Speak(text)
        stream.Close()

    return speak


if __name__ == "__main__":
    main()
