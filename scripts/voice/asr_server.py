"""Dictation endpoint for rove's web client.

The phone records 16 kHz mono PCM, rove-bridge POSTs the WAV here with the text of the
conversation being dictated into, and this process returns the transcript. The recognizer is
local Whisper unless `~/.rove/voice/config.json` names a cloud endpoint (`engine.py`); the
vocabulary is `vocab.py`, sound-alike fixes `phonetic.py`. Everything this process keeps lives
under `~/.rove/voice`.

Run: `uv run --project scripts/voice --extra local scripts/voice/asr_server.py` (or Settings → Voice).
Binds 127.0.0.1 only; the bridge is the one public surface.

  POST /transcribe {wav: hex, conversation?, context?, language?} -> {text, raw, language, ...}
  GET  /health
"""

from __future__ import annotations

import io
import json
import os
import secrets
import sys
import threading
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import numpy as np

import engine
import learn
import phonetic
import vocab

PORT = int(os.environ.get("ROVE_VOICE_PORT", "8791"))
MIN_AUDIO_SEC = 0.25
SILENCE_RMS = 0.004  # 16-bit speech sits far above this; fan noise and dead mics do not.
MAX_AUDIO_SEC = 240

_ready = threading.Event()
_warm_ms: float | None = None
_error: str | None = None
_backend: engine.Backend | None = None
_config: dict[str, Any] = {}


def read_token() -> str:
    """One shared secret so a stray local process cannot drive the microphone path."""
    path = engine.HOME / "token"
    engine.HOME.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_text(secrets.token_hex(24))
        path.chmod(0o600)
    return path.read_text().strip()


def decode_wav(data: bytes) -> np.ndarray:
    with wave.open(io.BytesIO(data)) as wav:
        if wav.getnchannels() != 1:
            raise ValueError("expected mono audio")
        width = wav.getsampwidth()
        rate = wav.getframerate()
        frames = wav.readframes(wav.getnframes())
    if width != 2:
        raise ValueError(f"expected 16-bit samples, got {width * 8}-bit")
    if rate != engine.SAMPLE_RATE:
        raise ValueError(f"expected {engine.SAMPLE_RATE} Hz, got {rate}")
    return np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0


def dictate(
    backend: engine.Backend,
    pcm: np.ndarray,
    *,
    conversation: str | None,
    draft: str | None,
    language: str | None,
    config: dict[str, Any],
) -> dict[str, Any]:
    """One dictation: rank the vocabulary, recognize, normalize the script, then fix the English:
    stored mishearings first, then whatever lands close to a term the recognizer was given."""
    stored = vocab.load()["terms"]
    terms = vocab.rank(conversation, draft, stored, backend.max_terms)
    # Measured on large-v3: terms in the prompt cost a term when they were not said (68 -> 67 with the
    # conversation's, 68 -> 64 with 15 learned ones) and gain less (70) than using them only to correct
    # (72, and 68 when not said). Cloud recognizers take the prompt without that cost, so they get it by default.
    in_prompt = config.get("promptContext", not isinstance(backend, engine.LocalWhisper))
    hinted = terms if in_prompt else vocab.rank(None, draft, stored, backend.max_terms, rest=False)
    raw, detected = backend.transcribe(pcm, hinted, language)
    text = engine.simplified(raw) if config.get("simplified", True) else raw
    text = vocab.correct(vocab.apply_spoken(text, stored), terms, fuzzy=config.get("fuzzy", True))
    # Bench: +1 to +3 terms when the conversation holds them, no change otherwise (phonetic.py).
    if config.get("phonetic", True):
        text = phonetic.correct(text, terms)
    return {"text": text, "raw": raw, "language": detected, "terms": len(terms)}


def warm() -> None:
    """A cold graph costs seconds; pay it at boot, not on the first press."""
    global _warm_ms, _error, _backend, _config
    started = time.monotonic()
    try:
        _config = engine.load_config()
        _backend = engine.backend(_config)
        if isinstance(_backend, engine.LocalWhisper):
            _backend.transcribe(np.zeros(engine.SAMPLE_RATE, dtype=np.float32), [], "en")
        engine.simplified("說")
    except Exception as err:  # noqa: BLE001 - surfaced on /health, the server stays up
        _error = str(err)
        sys.stderr.write(f"voice: backend failed: {err}\n")
        return
    _warm_ms = round((time.monotonic() - started) * 1000)
    _ready.set()


class Handler(BaseHTTPRequestHandler):
    token = ""

    def log_message(self, fmt: str, *args: Any) -> None:  # noqa: A003 - stdlib signature
        sys.stderr.write("voice %s\n" % (fmt % args))

    def reply(self, code: int, body: dict[str, Any]) -> None:
        data = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:  # noqa: N802 - stdlib signature
        # /health stays open: the bridge probes it before the user says anything.
        if self.path != "/health":
            self.reply(404, {"error": "not_found"})
            return
        name = _backend.name if _backend else None
        body = {"ready": _ready.is_set(), "model": name, "warm_ms": _warm_ms, "error": _error}
        # Which copy answers: two bridges (release and a checkout) may each have started one.
        self.reply(200, {**body, "pid": os.getpid(), "code": str(Path(__file__).resolve().parent)})

    def body(self) -> dict[str, Any] | None:
        if self.headers.get("x-voice-token", "") != self.token:
            self.reply(401, {"error": "bad_token"})
            return None
        length = int(self.headers.get("content-length") or 0)
        if length <= 0 or length > 32 * 1024 * 1024:
            self.reply(400, {"error": "bad_size"})
            return None
        try:
            return json.loads(self.rfile.read(length))
        except ValueError:
            self.reply(400, {"error": "bad_json"})
            return None

    def do_POST(self) -> None:  # noqa: N802 - stdlib signature
        routes = {"/transcribe": self.transcribe, "/learn": self.learn_edit, "/unlearn": self.unlearn_edit}
        route = routes.get(self.path)
        if route is None:
            self.reply(404, {"error": "not_found"})
            return
        request = self.body()
        if request is not None:
            route(request)

    def transcribe(self, request: dict[str, Any]) -> None:
        try:
            pcm = decode_wav(bytes.fromhex(request["wav"]))
        except Exception as err:  # noqa: BLE001 - every failure is the caller's audio
            self.reply(400, {"error": f"bad_audio: {err}"})
            return
        seconds = round(len(pcm) / engine.SAMPLE_RATE, 2)
        if seconds < MIN_AUDIO_SEC:
            self.reply(200, {"text": "", "reason": "too_short", "seconds": seconds})
            return
        if seconds > MAX_AUDIO_SEC:
            self.reply(200, {"text": "", "reason": "too_long", "seconds": seconds})
            return
        if float(np.sqrt(np.mean(np.square(pcm)))) < SILENCE_RMS:
            self.reply(200, {"text": "", "reason": "silent", "seconds": seconds})
            return
        if _backend is None or not _ready.is_set():
            self.reply(503, {"error": _error or "warming up"})
            return
        started = time.monotonic()
        try:
            out = dictate(
                _backend,
                pcm,
                conversation=request.get("conversation"),
                draft=request.get("context"),
                language=request.get("language"),
                config=_config,
            )
        except Exception as err:  # noqa: BLE001 - report, never take the server down
            self.reply(500, {"error": f"transcribe: {err}"})
            return
        ms = round((time.monotonic() - started) * 1000)
        # Counts only, never the words: enough to see the conversation arrived and what a take cost.
        heard = len(request.get("conversation") or "")
        terms = out["terms"]
        sys.stderr.write(f"voice: {seconds}s audio, {heard} chars of conversation, {terms} terms, {ms} ms\n")
        self.reply(200, {**out, "seconds": seconds, "ms": ms})

    def learn_edit(self, request: dict[str, Any]) -> None:
        """A sent message against the draft its takes left: the fixes inside them join the vocabulary."""
        base, sent, spans = request.get("base"), request.get("sent"), request.get("spans")
        if not isinstance(base, str) or not isinstance(sent, str) or not isinstance(spans, list):
            self.reply(400, {"error": "bad_args"})
            return
        if not _config.get("learn", True):
            self.reply(200, {"learned": []})
            return
        pairs = [(int(s[0]), int(s[1])) for s in spans if isinstance(s, list) and len(s) == 2]
        added = learn.remember(learn.fixes(base, pairs, sent))
        sys.stderr.write(f"voice: learned {len(added)} from an edit\n")
        self.reply(200, {"learned": added})

    def unlearn_edit(self, request: dict[str, Any]) -> None:
        learned = request.get("learned")
        if not isinstance(learned, list):
            self.reply(400, {"error": "bad_args"})
            return
        self.reply(200, {"undone": learn.forget([x for x in learned if isinstance(x, dict)])})


def main() -> None:
    Handler.token = read_token()
    try:
        server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    except OSError as err:
        # Another sidecar already answers here; it serves every bridge on this machine.
        sys.stderr.write(f"voice: port {PORT} is taken ({err}); leaving it to that process\n")
        raise SystemExit(0) from err
    pidfile = engine.HOME / "sidecar.pid"
    pidfile.write_text(str(os.getpid()))
    threading.Thread(target=warm, daemon=True).start()
    sys.stderr.write(f"voice listening on http://127.0.0.1:{PORT}\n")
    try:
        server.serve_forever()
    finally:
        if pidfile.exists() and pidfile.read_text().strip() == str(os.getpid()):
            pidfile.unlink()


if __name__ == "__main__":
    main()
