#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["mlx-whisper", "numpy"]
# ///
"""The personal half of dictation: what your words are called, and how the model hears them.

Whisper cannot be given a trie of boostable terms the way a transducer can, so the dictionary works
two ways instead: the terms ride along in the prompt (spelling and casing), and whatever the model
still gets wrong comes back as a `spoken` form that `asr_server.py` rewrites after the decode.

Three verbs:
  seed    candidate terms from this machine's Rove tasks, branches and repos
  learn   say each term out loud locally and keep how the model transcribed it
  list    what is in the dictionary now

Nothing leaves the machine: `say` is macOS TTS and the recognizer is the local model.
"""

from __future__ import annotations

import argparse
import difflib
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

import numpy as np

HOME = Path(os.environ.get("ROVE_VOICE_HOME") or Path.home() / ".rove" / "voice")
ROVE_HOME = Path(os.environ.get("ROVE_HOME_DIR") or Path.home())
MODEL = os.environ.get("ROVE_VOICE_MODEL", "mlx-community/whisper-large-v3-mlx")
MAX_SPOKEN = 4
MAX_AUDIO_SEC = 8
CJK = re.compile(r"[\u3400-\u9fff]")
NOISE = re.compile(r"[\s\W_]+", re.UNICODE)

# Words this machine says every day that no general model spells the way we do.
CURATED = [
    "rove", "rove-web", "rove-bridge", "rove-daemon", "worktree", "daemon", "PTY", "xterm",
    "bun", "TypeScript", "WebSocket", "Cloudflare", "Tailscale", "kanban", "composer",
    "compaction", "subagent", "mlx-whisper", "sherpa-onnx", "Parakeet", "cuBLAS", "PyTorch",
    "DeepSeek", "LangGraph", "Playwright", "Safari", "iOS", "SwiftUI", "Kotlin", "Gradle",
]


def dictionary_path() -> Path:
    return HOME / "dictionary.json"


def load() -> dict[str, Any]:
    path = dictionary_path()
    if not path.exists():
        return {"terms": []}
    return json.loads(path.read_text())


def save(data: dict[str, Any]) -> None:
    HOME.mkdir(parents=True, exist_ok=True)
    dictionary_path().write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")


def normal(text: str) -> str:
    return NOISE.sub("", text).lower()


def term_like(term: str) -> bool:
    """Precision guard copied from what makes Wispr's suggestions tolerable: real terms only."""
    if not 2 <= len(term) <= 32:
        return False
    if term.lower() != term and any(c.isupper() for c in term):
        return True  # camelCase, PTY, iOS
    if CJK.search(term):
        return True
    return bool(re.search(r"[-_.0-9]", term)) and term.lower() == term


def plausible(term: str, spoken: str) -> bool:
    """A spoken form is a mishearing, not a different sentence: same script, similar shape.

    Without this, `say` + Whisper invent pairs like "LangGraph" ← "Florida Black", and the rewrite
    step would then replace real words inside a real dictation.
    """
    if not 2 <= len(spoken) <= 24:
        return False
    for char in spoken:
        if not (char.isascii() and char.isalnum()) and not CJK.search(char):
            return False
    return difflib.SequenceMatcher(None, normal(term), normal(spoken)).ratio() >= 0.55


def task_terms() -> set[str]:
    path = ROVE_HOME / ".rove" / "tasks.json"
    found: set[str] = set()
    if not path.exists():
        return found
    for task in json.loads(path.read_text()).get("tasks", []):
        repo = task.get("repo") or ""
        if repo:
            found.add(Path(repo).name)
        branch = (task.get("branch") or "").split("/")[-1]
        if branch:
            found.add(branch)
    return found


def seed(overwrite_spoken: bool) -> None:
    data = load()
    known = {entry["term"].lower(): entry for entry in data["terms"]}
    added = 0
    for term in sorted(set(CURATED) | task_terms()):
        if term.lower() in known or not term_like(term):
            continue
        data["terms"].append({"term": term, "spoken": [], "weight": 1})
        added += 1
    if overwrite_spoken:
        for entry in data["terms"]:
            entry["spoken"] = []
    save(data)
    print(f"seed: +{added} terms, {len(data['terms'])} total → {dictionary_path()}", file=sys.stderr)


def say_pcm(term: str) -> np.ndarray | None:
    voice = "Tingting" if CJK.search(term) else "Samantha"
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        path = Path(tmp.name)
    try:
        subprocess.run(
            ["/usr/bin/say", "-v", voice, "--data-format=LEI16@16000", "-o", str(path), term],
            check=True,
            capture_output=True,
            timeout=30,
        )
        import wave

        with wave.open(str(path)) as wav:
            return np.frombuffer(wav.readframes(wav.getnframes()), dtype="<i2").astype(np.float32) / 32768.0
    except Exception as err:  # noqa: BLE001 - a voice the machine lacks must not stop the batch
        print(f"  say failed for {term!r}: {err}", file=sys.stderr)
        return None
    finally:
        path.unlink(missing_ok=True)


def middle(full: str, heard: str) -> str:
    """What the model wrote where the carrier sentence had the term: the prefix/suffix trim from
    Wispr's edit alignment, in miniature."""
    want, got = normal(full), normal(heard)
    head = 0
    while head < min(len(want), len(got)) and want[head] == got[head]:
        head += 1
    tail = 0
    while tail < min(len(want), len(got)) - head and want[-1 - tail] == got[-1 - tail]:
        tail += 1
    return got[head : len(got) - tail]


def probe(term: str) -> str | None:
    """Ask the model how it hears the term in a sentence, not on its own.

    Bare words round-trip clean — Whisper spells "daemon" right when it is the whole utterance and
    "Demon" the moment it sits inside one. So the term rides a carrier and the carrier's own words
    are trimmed off, which is what actually produces a spoken form like "rove web".
    """
    import mlx_whisper

    carriers = [
        f"帮我把 {term} 弄一下",
        f"看一下 {term} 的日志",
        f"please restart the {term} now",
    ]
    for carrier in carriers:
        pcm = say_pcm(carrier)
        if pcm is None or len(pcm) == 0 or len(pcm) / 16000 > MAX_AUDIO_SEC:
            continue
        heard = mlx_whisper.transcribe(
            pcm,
            path_or_hf_repo=MODEL,
            initial_prompt="以下是普通话的句子。",
            language=None,
            word_timestamps=False,
            condition_on_previous_text=False,
            verbose=None,
        )
        got = middle(carrier, str(heard.get("text") or ""))
        # A carrier the model rewrote wholesale says nothing about the term.
        if plausible(term, got) and got != normal(term):
            return got
    return None


def learn(limit: int) -> None:
    data = load()
    pending = [entry for entry in data["terms"] if not entry.get("spoken")]
    pending.sort(key=lambda e: -int(e.get("weight") or 0))
    changed = 0
    for entry in pending[:limit]:
        term = entry["term"]
        started = time.monotonic()
        spoken = probe(term)
        if spoken and all(s != spoken for s in entry.get("spoken") or []):
            entry["spoken"] = ([spoken] + list(entry.get("spoken") or []))[:MAX_SPOKEN]
            changed += 1
            print(f"  {term!r} ← {spoken!r} ({time.monotonic() - started:.2f}s)")
    save(data)
    print(f"learn: {changed} of {min(limit, len(pending))} probed got a spoken form", file=sys.stderr)


def show() -> None:
    data = load()
    print(f"{len(data['terms'])} terms in {dictionary_path()}")
    for entry in data["terms"]:
        spoken = ", ".join(entry.get("spoken") or [])
        print(f"  {entry['term']:<28} {'← ' + spoken if spoken else ''}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("verb", choices=["seed", "learn", "list"])
    parser.add_argument("--limit", type=int, default=200, help="terms to probe in one `learn` run")
    parser.add_argument("--reset-spoken", action="store_true", help="drop learned forms on seed")
    args = parser.parse_args()
    if args.verb == "seed":
        seed(args.reset_spoken)
    elif args.verb == "learn":
        learn(args.limit)
    else:
        show()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
