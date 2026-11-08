"""Key-term bench for the sidecar's own pipeline: 11 Chinese-English code-switched clips, 82 terms.

Clips come from `bench/clips.json` (`[term|other spelling]` marks a key term), spoken by macOS
`say` at dictation speed and cached under ~/.cache/rove-voice-bench. They are synthetic speech:
real recordings go in a directory of `<id>.wav` (16 kHz mono) + `<id>.txt` (same markup) passed
with --recordings, and are scored the same way.

Run each through `uv run --project scripts/voice --extra local scripts/voice/bench.py …`:

  bench.py                                  # default local model, no context
  bench.py --model mlx-community/whisper-large-v3-turbo
  bench.py --context all                    # conversation holds every clip's text
  bench.py --phonetic off                   # without the sound-alike step
  bench.py --backend cloud --model microsoft/mai-transcribe-2
  bench.py --learn                          # take, fix it to the reference, take again
  bench.py --edits                          # learn.py's gates on bench/edits.json; no audio

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
import learn  # noqa: E402
import live  # noqa: E402
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


def edits() -> None:
    """Each labelled edit against what learn.py takes from it: a wrong lesson costs every later take."""
    right = 0
    rows = json.loads((HERE / "bench" / "edits.json").read_text())
    for case in rows:
        spans = [tuple(s) for s in case.get("spans", [[0, len(case["base"])]])]
        got = [[f["term"], f["spoken"]] for f in learn.fixes(case["base"], spans, case["sent"])]
        ok = got == case["learns"]
        right += ok
        print(f"{'ok ' if ok else 'BAD'} {case['id']:<16} {got}" + ("" if ok else f"  want {case['learns']}"))
    print(f"\nedits: {right}/{len(rows)}")


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
    parser.add_argument("--phonetic", choices=["on", "off"], help="sound-alike correction (phonetic.py)")
    parser.add_argument("--language")
    parser.add_argument("--recordings", type=Path)
    parser.add_argument("--out", type=Path, help="append one JSON line per clip")
    parser.add_argument("--learn", action="store_true", help="fix each take to the reference, then take again")
    parser.add_argument("--edits", action="store_true", help="learn.py's gates on bench/edits.json, no audio")
    parser.add_argument("--live", action="store_true", help="stream each clip in 1 s chunks as a held take does")
    args = parser.parse_args()
    if args.edits:
        return edits()

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
    if args.phonetic:
        config["phonetic"] = args.phonetic == "on"
    if args.common:
        vocab.common_words = lambda: frozenset()  # type: ignore[assignment]
    backend = engine.backend(config)
    rows = cases(args.recordings)
    every = "\n".join(spoken(c["text"]) for c in rows)

    if isinstance(backend, engine.LocalWhisper):
        backend.transcribe(np.zeros(engine.SAMPLE_RATE, dtype=np.float32), [], "en")
    flags = (" common" if args.common else "") + (" exact" if args.no_fuzzy else "")
    flags += f" prompt-context={args.prompt_context}" if args.prompt_context else ""
    flags += f" phonetic={args.phonetic}" if args.phonetic else ""
    label = f"{backend.name} context={args.context}{flags}"

    def take_all(tag: str) -> list[str]:
        got = total = before = 0
        latency: list[float] = []
        audio = 0.0
        texts: list[str] = []
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
            texts.append(out["text"])
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
                row = {"label": label + tag, "id": case["id"], "hits": sum(mark), "of": len(mark)}
                row |= {"secs": round(took, 3), "text": out["text"], "raw": out["raw"]}
                with args.out.open("a") as f:
                    f.write(json.dumps(row, ensure_ascii=False) + "\n")
        voices = "  ".join(f"{v.split(' ')[0]} {a}/{b}" for v, (a, b) in by_voice.items())
        print(
            f"\n{label}{tag}: {got}/{total} (recognizer alone {before})  ({voices})  "
            f"p50 {statistics.median(latency):.2f}s  RTF {sum(latency) / audio:.3f}\n"
        )
        return texts

    if args.live:
        return live_takes(backend, rows, config, args.language)
    texts = take_all("")
    if not args.learn:
        return
    # The user fixes each take to what they said and sends it; the next take of the same words is the test.
    taught = 0
    for case, text in zip(rows, texts):
        added = learn.remember(learn.fixes(text, [(0, len(text))], spoken(case["text"])))
        taught += len(added)
        if added:
            print(f"{case['id']:<10} learned {', '.join(a['spoken'] + ' -> ' + a['term'] for a in added)}")
    print(f"\nlearned {taught} from {len(rows)} fixed takes\n")
    take_all(" after-learning")


def live_takes(backend: engine.Backend, rows: list[dict], config: dict, language: str | None) -> None:
    """Each clip as a held take: a chunk per second of recording, sent only once the last one answered
    (as the page does), then the final. Partials are what the user watches; the final must match a one-shot take."""
    step = engine.SAMPLE_RATE
    waits: list[float] = []
    lags: list[float] = []
    firsts: list[float] = []
    finals: list[float] = []
    got = same = total = 0
    for case in rows:
        samples = pcm(case["wav"])
        clock = sent = seq = 0.0
        session = case["id"]
        first = None
        while sent < len(samples):
            clock += 1.0  # the page's next tick
            upto = min(len(samples), int(clock * step))
            take = live.append(session, int(seq), samples[int(sent) : upto], {"language": language})
            seq, sent = seq + 1, upto
            if not live.due(take, backend):
                continue
            started = time.monotonic()
            take.decoded = take.samples
            asr_server.dictate(
                backend, take.pcm(), conversation=None, draft=None, language=language, config=config, final=False
            )
            took = time.monotonic() - started
            waits.append(took)
            clock += took  # nothing more goes out until this answered
            lags.append(clock - take.samples / step)  # how far the shown text trails what was said
            first = first if first is not None else clock
        live.finish(session)
        started = time.monotonic()
        out = asr_server.dictate(backend, samples, conversation=None, draft=None, language=language, config=config)
        finals.append(time.monotonic() - started)
        one_shot = asr_server.dictate(backend, samples, conversation=None, draft=None, language=language, config=config)
        firsts.append(first or 0.0)
        terms = keywords(case["text"])
        got += sum(hits(terms, out["text"]))
        total += len(terms)
        same += out["text"] == one_shot["text"]
        print(
            f"{case['id']:<10} {len(samples) / step:4.1f}s audio  first partial {first or 0:4.1f}s  "
            f"final {finals[-1]:.2f}s"
        )
    q = statistics.quantiles
    print(
        f"\n{backend.name} live: {len(waits)} partials, decode p50 {statistics.median(waits):.2f}s "
        f"p90 {q(waits, n=10)[-1]:.2f}s; text trails speech p50 {statistics.median(lags):.2f}s "
        f"p90 {q(lags, n=10)[-1]:.2f}s; first partial p50 {statistics.median(firsts):.1f}s; "
        f"final p50 {statistics.median(finals):.2f}s; final = one-shot on {same}/{len(rows)} clips; {got}/{total} terms"
    )


if __name__ == "__main__":
    sample = "改 github-actions 的 decision,layers 顺序"
    assert hits([["GitHub Actions"], ["CI"], ["layer"]], sample) == [True, False, True]
    main()
