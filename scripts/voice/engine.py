"""The recognizer behind the sidecar: local Whisper by default, or any OpenAI-compatible
`/audio/transcriptions` endpoint when `~/.rove/voice/config.json` names one.

config.json, all keys optional:
  {"backend": "local", "model": "mlx-community/whisper-large-v3-turbo"}   # faster, see LOCAL_MODEL
  {"backend": "cloud", "baseURL": "https://openrouter.ai/api/v1", "model": "microsoft/mai-transcribe-2",
   "apiKeyEnv": "OPENROUTER_API_KEY"}            # or "apiKey": "..."; the key never leaves this Mac
  {"simplified": false}                         # keep Traditional characters as recognized
"""

from __future__ import annotations

import base64
import io
import json
import os
import urllib.error
import urllib.request
import uuid
import wave
from functools import cache
from pathlib import Path
from typing import Any, Protocol

import numpy as np

HOME = Path(os.environ.get("ROVE_VOICE_HOME") or Path.home() / ".rove" / "voice")
SAMPLE_RATE = 16_000
# Code-switch bench (bench.py, 82 terms): large-v3 68, 74 with the conversation's terms, p50 1.8 s;
# turbo 63, 69 at best, p50 1.0 s. Turbo is the faster pick in config.json; it loses most when context is thin.
LOCAL_MODEL = "mlx-community/whisper-large-v3-mlx"
# Without this hint large-v3 often answers Mandarin in Traditional script; English is unaffected.
ZH_GUARD = "以下是普通话的句子。"
CLOUD_TIMEOUT_S = 30


class Backend(Protocol):
    name: str
    max_terms: int

    def transcribe(self, pcm: np.ndarray, terms: list[str], language: str | None) -> tuple[str, str | None]: ...


def load_config() -> dict[str, Any]:
    path = HOME / "config.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text())


class LocalWhisper:
    """mlx-whisper on the Mac's GPU. The terms ride in the prompt, which Whisper reads as preceding
    text: spelled-right terms there are the cheapest bias a decoder without a boost list accepts."""

    max_terms = 60

    def __init__(self, model: str) -> None:
        self.model = model
        self.name = f"local:{model}"

    def transcribe(self, pcm: np.ndarray, terms: list[str], language: str | None) -> tuple[str, str | None]:
        import mlx_whisper

        prompt = "\n".join([ZH_GUARD, ", ".join(terms)]) if terms else ZH_GUARD
        result = mlx_whisper.transcribe(
            pcm,
            path_or_hf_repo=self.model,
            initial_prompt=prompt,
            language=language or None,
            word_timestamps=False,
            condition_on_previous_text=False,
            verbose=None,
        )
        return str(result.get("text") or "").strip(), result.get("language")


def provider_options(model: str, terms: list[str]) -> dict[str, Any] | None:
    """OpenRouter routes one body to many providers, and each reads the vocabulary from its own field:
    mai-transcribe-2 ignores `prompt` and goes 59 → 68 of 82 terms with `azure.phraseList`."""
    if model.startswith("microsoft/mai-transcribe"):
        return {"azure": {"phraseList": {"phrases": terms}}}
    if model.startswith("openai/gpt-4o"):
        return {"openai": {"prompt": ", ".join(terms)}}
    if model == "openai/whisper-large-v3":
        return {slug: {"prompt": ", ".join(terms)} for slug in ("groq", "deepinfra/us", "together")}
    return None  # gemini rejects a prompt outright


def wav_bytes(pcm: np.ndarray) -> bytes:
    out = io.BytesIO()
    with wave.open(out, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(SAMPLE_RATE)
        wav.writeframes((np.clip(pcm, -1, 1) * 32767).astype("<i2").tobytes())
    return out.getvalue()


class CloudASR:
    """One OpenAI-compatible transcription endpoint. OpenRouter gets its JSON body so the
    vocabulary reaches the provider's own field; everything else gets the standard multipart
    form with the vocabulary as `prompt`."""

    max_terms = 100

    def __init__(self, config: dict[str, Any]) -> None:
        self.base = str(config.get("baseURL") or "https://openrouter.ai/api/v1").rstrip("/")
        self.model = str(config.get("model") or "microsoft/mai-transcribe-2")
        key = config.get("apiKey") or os.environ.get(str(config.get("apiKeyEnv") or "OPENROUTER_API_KEY"))
        if not key:
            raise RuntimeError("cloud backend has no API key: set apiKey or apiKeyEnv in config.json")
        self.key = str(key)
        self.name = f"cloud:{self.model}"

    def request(self, audio: bytes, terms: list[str], language: str | None) -> urllib.request.Request:
        url = f"{self.base}/audio/transcriptions"
        auth = {"Authorization": f"Bearer {self.key}"}
        if "openrouter.ai" in self.base:
            body: dict[str, Any] = {
                "model": self.model,
                "input_audio": {"data": base64.b64encode(audio).decode(), "format": "wav"},
            }
            if language:
                body["language"] = language
            options = provider_options(self.model, terms) if terms else None
            if options:
                body["provider"] = {"options": options}
            return urllib.request.Request(url, json.dumps(body).encode(), {**auth, "Content-Type": "application/json"})
        fields = {"model": self.model, **({"language": language} if language else {})}
        if terms:
            fields["prompt"] = ", ".join(terms)
        boundary = uuid.uuid4().hex
        parts = [
            f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.wav"\r\n'
            "Content-Type: audio/wav\r\n\r\n".encode()
            + audio
            + b"\r\n"
        ]
        for name, value in fields.items():
            parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
        parts.append(f"--{boundary}--\r\n".encode())
        headers = {**auth, "Content-Type": f"multipart/form-data; boundary={boundary}"}
        return urllib.request.Request(url, b"".join(parts), headers)

    def transcribe(self, pcm: np.ndarray, terms: list[str], language: str | None) -> tuple[str, str | None]:
        try:
            with urllib.request.urlopen(self.request(wav_bytes(pcm), terms, language), timeout=CLOUD_TIMEOUT_S) as res:
                body = json.loads(res.read())
        except urllib.error.HTTPError as err:
            raise RuntimeError(f"{self.name} answered {err.code}: {err.read()[:200]!r}") from err
        return str(body.get("text") or "").strip(), body.get("language")


def backend(config: dict[str, Any]) -> Backend:
    if config.get("backend") == "cloud":
        return CloudASR(config)
    return LocalWhisper(os.environ.get("ROVE_VOICE_MODEL") or str(config.get("model") or LOCAL_MODEL))


@cache
def _t2s() -> Any:
    from opencc import OpenCC

    return OpenCC("t2s")


def simplified(text: str) -> str:
    """Whisper drifts into Traditional characters on some Mandarin clips; English passes through."""
    return _t2s().convert(text) if any("一" <= c <= "鿿" for c in text) else text
