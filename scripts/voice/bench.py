#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["mlx-whisper", "numpy", "opencc-python-reimplemented"]
# ///
"""Key-term bench for the sidecar's own pipeline: 11 Chinese-English code-switched clips, 82 terms.

Clips come from `bench/clips.json` (`[term|other spelling]` marks a key term), spoken by macOS
`say` at dictation speed and cached under ~/.cache/rove-voice-bench. They are synthetic speech:
real recordings go in a directory of `<id>.wav` (16 kHz mono) + `<id>.txt` (same markup) passed
with --recordings, and are scored the same way.

  scripts/voice/bench.py                                  # default local model, no context
  scripts/voice/bench.py --model mlx-community/whisper-large-v3-mlx
  scripts/voice/bench.py --context all                    # conversation holds every clip's text
  scripts/voice/bench.py --backend cloud --model microsoft/mai-transcribe-2

`--context all` is the case the vocabulary exists for: the user dictates terms the conversation
already shows. `--context others` leaves the clip's own sentence out, so every boosted term is a
distractor; it must not score below `none`.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import statistics
import subprocess
import sys
import tempfile
import time
import wave
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
# The bench never reads or writes the user's own vocabulary.
os.environ["ROVE_VOICE_HOME"] = tempfile.mkdtemp(prefix="rove-voice-bench-")

import asr_server  # noqa: E402 - after the HOME override
import engine  # noqa: E402
import vocab  # noqa: E402

CACHE = Path.home() / ".cache" / "rove-voice-bench"
RATE = "230"  # words per minute; faster than the default, as people dictate


def keywords(text: str) -> list[list[str]]:
    return [t.split("|") for t in re.findall(r"\[([^\]]+)\]", text)]


def spoken(text: str) -> str:
    return re.sub(r"\[([^\]|]+)[^\]]*\]", r"\1", text)


def hits(terms: list[list[str]], text: str) -> list[bool]:
    """A term counts when any spelling appears as whole words; case, spaces/hyphens/dots and a plural s don't matter."""

    def pattern(alt: str) -> str:
        chars = [re.escape(ch) for ch in re.sub(r"[\s\-_.]", "", alt.lower())]
        return r"(?<![a-z0-9])" + r"[\s\-_.]?".join(chars) + r"s?(?![a-z0-9])"

    low = text.lower()
    return [any(re.search(pattern(alt), low) for alt in kw) for kw in terms]


def synth(case: dict[str, str]) -> Path:
    text = spoken(case["text"])
    key = hashlib.sha1(f"{case['voice']}|{RATE}|{text}".encode()).hexdigest()[:12]
    path = CACHE / f"{case['id']}-{key}.wav"
    if not path.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        env = {k: v for k, v in os.environ.items() if not k.startswith("DYLD_")}
        subprocess.run(
            ["/usr/bin/say", "-v", case["voice"], "-r", RATE, "-o", str(path), "--data-format=LEI16@16000", text],
            check=True,
            env=env,
        )
    return path


def cases(recordings: Path | None) -> list[dict]:
    rows = [{**c, "wav": synth(c)} for c in json.loads((HERE / "bench" / "clips.json").read_text())]
    if recordings:
        for wav in sorted(recordings.glob("*.wav")):
            text = wav.with_suffix(".txt").read_text().strip()
            rows.append({"id": wav.stem, "voice": "recorded", "text": text, "wav": wav})
    return rows


def pcm(path: Path) -> np.ndarray:
    with wave.open(str(path)) as w:
        if w.getframerate() != engine.SAMPLE_RATE or w.getnchannels() != 1:
            sys.exit(f"{path}: need 16 kHz mono WAV")
        return np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float32) / 32768.0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--backend", choices=["local", "cloud"], default="local")
    parser.add_argument("--model")
    parser.add_argument("--base-url")
    parser.add_argument("--api-key-env", help="env var holding the cloud key (default OPENROUTER_API_KEY)")
    parser.add_argument("--context", choices=["none", "all", "others"], default="none")
    parser.add_argument("--common", action="store_true", help="boost plain English words too")
    parser.add_argument("--no-fuzzy", action="store_true", help="exact term snapping only")
    parser.add_argument("--prompt-context", choices=["on", "off"], help="conversation terms in the prompt too")
    parser.add_argument("--language")
    parser.add_argument("--recordings", type=Path)
    parser.add_argument("--out", type=Path, help="append one JSON line per clip")
    args = parser.parse_args()

    config: dict = {"backend": args.backend}
    if args.model:
        config["model"] = args.model
    if args.base_url:
        config["baseURL"] = args.base_url
    if args.api_key_env:
        config["apiKeyEnv"] = args.api_key_env
    if args.no_fuzzy:
        config["fuzzy"] = False
    if args.prompt_context:
        config["promptContext"] = args.prompt_context == "on"
    if args.common:
        vocab.common_words = lambda: frozenset()  # type: ignore[assignment]
    backend = engine.backend(config)
    rows = cases(args.recordings)
    every = "\n".join(spoken(c["text"]) for c in rows)

    if isinstance(backend, engine.LocalWhisper):
        backend.transcribe(np.zeros(engine.SAMPLE_RATE, dtype=np.float32), [], "en")
    flags = (" common" if args.common else "") + (" exact" if args.no_fuzzy else "")
    flags += f" prompt-context={args.prompt_context}" if args.prompt_context else ""
    label = f"{backend.name} context={args.context}{flags}"
    got = total = before = 0
    latency: list[float] = []
    audio = 0.0
    by_voice: dict[str, list[int]] = {}
    for case in rows:
        conversation = {
            "none": None,
            "all": every,
            "others": "\n".join(spoken(c["text"]) for c in rows if c is not case),
        }[args.context]
        samples = pcm(case["wav"])
        started = time.monotonic()
        out = asr_server.dictate(
            backend, samples, conversation=conversation, draft=None, language=args.language, config=config
        )
        took = time.monotonic() - started
        terms = keywords(case["text"])
        mark = hits(terms, out["text"])
        got += sum(mark)
        # The recognizer's own text in Simplified script: what the vocabulary fixes adds on top.
        before += sum(hits(terms, engine.simplified(out["raw"])))
        total += len(mark)
        voice = by_voice.setdefault(case["voice"], [0, 0])
        voice[0] += sum(mark)
        voice[1] += len(mark)
        latency.append(took)
        audio += len(samples) / engine.SAMPLE_RATE
        missed = [kw[0] for kw, ok in zip(terms, mark) if not ok]
        print(f"{case['id']:<10} {sum(mark):>2}/{len(mark):<2} {took:5.2f}s  {out['text']}")
        if missed:
            print(f"{'':<10} missed: {', '.join(missed)}")
        if args.out:
            with args.out.open("a") as f:
                f.write(
                    json.dumps(
                        {
                            "label": label,
                            "id": case["id"],
                            "hits": sum(mark),
                            "of": len(mark),
                            "secs": round(took, 3),
                            "text": out["text"],
                            "raw": out["raw"],
                        },
                        ensure_ascii=False,
                    )
                    + "\n"
                )
    voices = "  ".join(f"{v.split(' ')[0]} {a}/{b}" for v, (a, b) in by_voice.items())
    print(
        f"\n{label}: {got}/{total} (recognizer alone {before})  ({voices})  p50 {statistics.median(latency):.2f}s  "
        f"RTF {sum(latency) / audio:.3f}"
    )


if __name__ == "__main__":
    sample = "改 github-actions 的 decision,layers 顺序"
    assert hits([["GitHub Actions"], ["CI"], ["layer"]], sample) == [True, False, True]
    main()
