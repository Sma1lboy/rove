"""Live dictation: a take streamed in chunks while the button is held, re-transcribed as it grows.

The page sends the audio recorded since its last chunk about once a second. Each chunk is appended
to the take's buffer; when there is enough new audio and the GPU is free, the whole buffer is decoded
again and the text so far goes back as a partial. The final chunk decodes the buffer once more,
through the same pipeline as a one-shot take, so a streamed take ends with the same text it would
have had without streaming.

Partials are a local recognizer's only: a cloud one is billed per request, so its takes are buffered
and decoded once, at the end. A partial never waits for the GPU; the final one does.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from typing import Any

import numpy as np

import engine

# Decoding again for less new audio than this changes little on screen and keeps the GPU busy.
PARTIAL_EVERY_SEC = 0.8
PARTIAL_MIN_SEC = 1.0
# A take whose page went away (a dropped socket, a closed tab) is forgotten after this.
IDLE_SEC = 120
MAX_SESSIONS = 8
MAX_SEC = 240


class Gap(Exception):
    """A chunk arrived out of order: the page should send the whole take instead."""


@dataclass
class Take:
    chunks: list[np.ndarray] = field(default_factory=list)
    samples: int = 0
    seq: int = 0
    decoded: int = 0
    conversation: str | None = None
    draft: str | None = None
    language: str | None = None
    touched: float = field(default_factory=time.monotonic)

    def pcm(self) -> np.ndarray:
        return np.concatenate(self.chunks) if self.chunks else np.zeros(0, dtype=np.float32)


_takes: dict[str, Take] = {}
_lock = threading.Lock()


def append(session: str, seq: int, pcm: np.ndarray, first: dict[str, Any]) -> Take:
    """Adds one chunk; the first chunk (`seq` 0) opens the take and brings its conversation and draft."""
    now = time.monotonic()
    with _lock:
        for key in [k for k, t in _takes.items() if now - t.touched > IDLE_SEC]:
            del _takes[key]
        take = _takes.get(session)
        if seq == 0:
            if take is None and len(_takes) >= MAX_SESSIONS:
                del _takes[min(_takes, key=lambda k: _takes[k].touched)]
            take = _takes[session] = Take(
                conversation=first.get("conversation"), draft=first.get("context"), language=first.get("language")
            )
        if take is None or seq != take.seq:
            _takes.pop(session, None)
            raise Gap(f"chunk {seq} of {session} out of order")
        if take.samples + len(pcm) > MAX_SEC * engine.SAMPLE_RATE:
            _takes.pop(session, None)
            raise Gap("take is longer than a dictation")
        if len(pcm):
            take.chunks.append(pcm)
            take.samples += len(pcm)
        take.seq += 1
        take.touched = now
        return take


def finish(session: str) -> Take | None:
    with _lock:
        return _takes.pop(session, None)


def due(take: Take, backend: engine.Backend) -> bool:
    """Whether this chunk earns a partial decode."""
    if not isinstance(backend, engine.LocalWhisper):
        return False
    new = (take.samples - take.decoded) / engine.SAMPLE_RATE
    return take.samples / engine.SAMPLE_RATE >= PARTIAL_MIN_SEC and new >= PARTIAL_EVERY_SEC
