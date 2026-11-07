#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["mlx-whisper", "numpy"]
# ///
"""Local dictation endpoint for rove's web client.

The phone records 16 kHz mono PCM, rove-bridge POSTs the WAV here, this process
decodes with Whisper on the Mac's GPU and returns text. Nothing leaves the
machine: the model, the dictionary and the pairing log all live under
`~/.rove/voice`.

Run: `scripts/voice/asr_server.py` (uv resolves the environment from the block
above). Binds 127.0.0.1 only; the bridge is the one public surface.
"""

from __future__ import annotations

import io
import json
import os
import re
import secrets
import sys
import threading
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import numpy as np

HOME = Path(os.environ.get("ROVE_VOICE_HOME") or Path.home() / ".rove" / "voice")
# Turbo drops the code-switched case this exists for: "把 rove-web 的 composer 改成 voice first"
# came back "Barov with the composer…" on turbo and verbatim on large-v3, for ~1.7 s per 15 s audio.
MODEL = os.environ.get("ROVE_VOICE_MODEL", "mlx-community/whisper-large-v3-mlx")
PORT = int(os.environ.get("ROVE_VOICE_PORT", "8791"))
SAMPLE_RATE = 16_000
MIN_AUDIO_SEC = 0.25
SILENCE_RMS = 0.004  # 16-bit speech sits far above this; fan noise and dead mics do not.
MAX_AUDIO_SEC = 240
MAX_PROMPT_TERMS = 60
# Without this hint large-v3 answers Mandarin in Traditional script; English is unaffected.
ZH_GUARD = "以下是普通话的句子。"

_whisper: Any = None
_ready = threading.Event()
_warm_ms: float | None = None


def read_token() -> str:
    """One shared secret so a stray local process cannot drive the microphone path."""
    path = HOME / "token"
    HOME.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_text(secrets.token_hex(24))
        path.chmod(0o600)
    return path.read_text().strip()


def load_dictionary() -> dict[str, Any]:
    """`~/.rove/voice/dictionary.json`: `{terms: [{term, spoken: [...], weight?}]}`.

    A spoken form is how the model actually transcribes the term ("demon" for
    "daemon"); `dictionary.py` mines them with macOS `say`.
    """
    path = HOME / "dictionary.json"
    if not path.exists():
        path.write_text(json.dumps({"terms": []}, indent=2) + "\n")
        return {"terms": []}
    return json.loads(path.read_text())


def decode_wav(data: bytes) -> np.ndarray:
    with wave.open(io.BytesIO(data)) as wav:
        if wav.getnchannels() != 1:
            raise ValueError("expected mono audio")
        width = wav.getsampwidth()
        rate = wav.getframerate()
        frames = wav.readframes(wav.getnframes())
    if width != 2:
        raise ValueError(f"expected 16-bit samples, got {width * 8}-bit")
    pcm = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0
    if rate != SAMPLE_RATE:
        raise ValueError(f"expected {SAMPLE_RATE} Hz, got {rate}")
    return pcm


def build_prompt(context: str | None, terms: list[dict[str, Any]]) -> str:
    """Whisper reads at most 224 tokens, and a list of spelled-right terms is the best use of them:
    with the dictionary in the prompt every clip decoded "rove-daemon", "composer", "log"; the same
    clips without it gave "Roveweb", "Demon", "Vlog".

    A free-text context line looks like more signal and is not — shell words injected into the prompt
    bled into the transcript ("da composer", "da log"). Context only ranks terms, so the ones the
    shell is looking at survive the cap once the dictionary outgrows it.
    """
    haystack = (context or "").lower()
    ranked = sorted(
        terms,
        key=lambda t: -(
            int(t.get("weight") or 0) + (100 if haystack and str(t.get("term", "")).lower() in haystack else 0)
        ),
    )
    names = [str(t["term"]) for t in ranked[:MAX_PROMPT_TERMS] if t.get("term")]
    return "\n".join([ZH_GUARD, ", ".join(names)]) if names else ZH_GUARD


def apply_dictionary(text: str, terms: list[dict[str, Any]]) -> str:
    """The real 中英混杂 fix: the decode is fuzzy, the user's spelling is not.

    A spoken form is how the model writes the term ("rove with" for "rove-web", mined by
    `dictionary.py learn`). Three-char floor and ASCII word boundaries keep a short form from
    rewriting the inside of unrelated words; CJK has no word boundaries to respect.
    """
    for entry in sorted(terms, key=lambda t: -len(str(t.get("term") or ""))):
        term = str(entry.get("term") or "")
        if not term:
            continue
        for spoken in entry.get("spoken") or []:
            spoken = str(spoken)
            if len(spoken) < 3 or spoken == term or spoken not in text:
                continue
            if spoken.isascii():
                text = re.sub(
                    rf"(?<![A-Za-z0-9]){re.escape(spoken)}(?![A-Za-z0-9])", term, text, flags=re.IGNORECASE
                )
            else:
                text = text.replace(spoken, term)
    return text


def transcribe(pcm: np.ndarray, prompt: str | None, language: str | None) -> tuple[str, str | None]:
    import mlx_whisper

    result = mlx_whisper.transcribe(
        pcm,
        path_or_hf_repo=MODEL,
        initial_prompt=prompt,
        language=language or None,
        word_timestamps=False,
        condition_on_previous_text=False,
        verbose=None,
    )
    return str(result.get("text") or "").strip(), result.get("language")


def warm() -> None:
    """A cold graph costs seconds; pay it at boot, not on the first press."""
    global _warm_ms
    started = time.monotonic()
    transcribe(np.zeros(SAMPLE_RATE, dtype=np.float32), None, "en")
    _warm_ms = round((time.monotonic() - started) * 1000)
    _ready.set()


class Handler(BaseHTTPRequestHandler):
    token = ""

    def log_message(self, fmt: str, *args: Any) -> None:  # noqa: A003 - stdlib signature
        sys.stderr.write("voice %s\n" % (fmt % args))

    def reply(self, code: int, body: dict[str, Any]) -> None:
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def authorized(self) -> bool:
        # /health stays open: the bridge probes it before the user says anything.
        if self.path == "/health":
            return True
        return self.headers.get("x-voice-token", "") == self.token

    def do_GET(self) -> None:  # noqa: N802 - stdlib signature
        if self.path != "/health":
            self.reply(404, {"error": "not_found"})
            return
        self.reply(
            200,
            {"ready": _ready.is_set(), "model": MODEL, "warm_ms": _warm_ms, "home": str(HOME)},
        )

    def do_POST(self) -> None:  # noqa: N802 - stdlib signature
        if self.path != "/transcribe":
            self.reply(404, {"error": "not_found"})
            return
        if not self.authorized():
            self.reply(401, {"error": "bad_token"})
            return
        length = int(self.headers.get("content-length") or 0)
        if length <= 0 or length > 32 * 1024 * 1024:
            self.reply(400, {"error": "bad_size"})
            return
        try:
            request = json.loads(self.rfile.read(length))
            pcm = decode_wav(bytes.fromhex(request["wav"]))
        except Exception as err:  # noqa: BLE001 - every failure is the caller's audio
            self.reply(400, {"error": f"bad_audio: {err}"})
            return

        seconds = len(pcm) / SAMPLE_RATE
        if seconds < MIN_AUDIO_SEC:
            self.reply(200, {"text": "", "reason": "too_short", "seconds": round(seconds, 2)})
            return
        if seconds > MAX_AUDIO_SEC:
            self.reply(200, {"text": "", "reason": "too_long", "seconds": round(seconds, 2)})
            return
        if float(np.sqrt(np.mean(np.square(pcm)))) < SILENCE_RMS:
            self.reply(200, {"text": "", "reason": "silent", "seconds": round(seconds, 2)})
            return

        started = time.monotonic()
        dictionary = load_dictionary()
        terms = dictionary.get("terms") or []
        try:
            raw, language = transcribe(pcm, build_prompt(request.get("context"), terms), request.get("language"))
        except Exception as err:  # noqa: BLE001 - report, never take the server down
            self.reply(500, {"error": f"transcribe: {err}"})
            return
        self.reply(
            200,
            {
                "text": apply_dictionary(raw, terms),
                "raw": raw,
                "language": language,
                "seconds": round(seconds, 2),
                "ms": round((time.monotonic() - started) * 1000),
            },
        )


def main() -> None:
    Handler.token = read_token()
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    threading.Thread(target=warm, daemon=True).start()
    sys.stderr.write(f"voice listening on http://127.0.0.1:{PORT} (model {MODEL})\n")
    server.serve_forever()


if __name__ == "__main__":
    main()
