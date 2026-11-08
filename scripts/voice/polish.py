"""Optional cleanup of a finished take by a chat model: fillers out, self-corrections applied, numbers,
spacing and lists as written text. Off unless `config.json` has a `polish` block:

  {"polish": {"model": "gpt-6-luna"}}                                      # OpenAI, key in OPENAI_API_KEY
  {"polish": {"baseURL": "https://openrouter.ai/api/v1", "model": "deepseek/deepseek-v4.1-flash",
              "apiKeyEnv": "OPENROUTER_API_KEY",
              "body": {"reasoning": {"effort": "none"}, "provider": {"sort": "throughput"}}}}

Any OpenAI-compatible `/chat/completions` works; `body` is merged into the request for the fields one
provider needs (gpt-6-luna is fastest with `"reasoning_effort": "none"`, which other models may reject).

`polish_prompt.md` is yap's VoiceInk/Resources/RecommendedPrompt.md (00bbde00) as written. What makes it fit
messages to a coding agent is its input: <CUSTOM_VOCABULARY> is the take's ranked vocabulary, the
conversation's identifiers first. Rewording it for agents scored lower on polish_bench.py (gpt-4.1-mini 157-160
of 192 against 168; even on gpt-6-luna), so the text stays yap's. A polish that fails or runs late returns
the take as the recognizer left it: cleanup is never worth losing what was said.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from functools import cache
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
TIMEOUT_S = 8
MAX_VOCAB = 60


@cache
def prompt() -> str:
    return (HERE / "polish_prompt.md").read_text()


def enabled(config: dict[str, Any]) -> bool:
    block = config.get("polish")
    return isinstance(block, dict) and bool(block.get("model")) and block.get("enabled", True) is not False


def messages(text: str, terms: list[str], system: str | None = None) -> list[dict[str, str]]:
    vocabulary = f"\n<CUSTOM_VOCABULARY>\n{', '.join(terms[:MAX_VOCAB])}\n</CUSTOM_VOCABULARY>" if terms else ""
    return [
        {"role": "system", "content": system or prompt()},
        {"role": "user", "content": f"{vocabulary}\n<TRANSCRIPT>\n{text}\n</TRANSCRIPT>"},
    ]


def request(block: dict[str, Any], text: str, terms: list[str], system: str | None = None) -> urllib.request.Request:
    base = str(block.get("baseURL") or "https://api.openai.com/v1").rstrip("/")
    key = block.get("apiKey") or os.environ.get(str(block.get("apiKeyEnv") or "OPENAI_API_KEY"))
    if not key:
        raise RuntimeError("polish has no API key: set apiKey or apiKeyEnv in config.json")
    body: dict[str, Any] = {"model": block["model"], "messages": messages(text, terms, system)}
    extra = block.get("body")
    if isinstance(extra, dict):
        body.update(extra)
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    return urllib.request.Request(f"{base}/chat/completions", json.dumps(body).encode(), headers)


def complete(block: dict[str, Any], text: str, terms: list[str], system: str | None = None) -> str:
    try:
        with urllib.request.urlopen(request(block, text, terms, system), timeout=TIMEOUT_S) as res:
            reply = json.loads(res.read())
    except urllib.error.HTTPError as err:
        raise RuntimeError(f"polish answered {err.code}: {err.read()[:200]!r}") from err
    out = str(reply["choices"][0]["message"]["content"] or "").strip()
    if not out:
        raise RuntimeError("polish answered with no text")
    return out


def polish(text: str, terms: list[str], config: dict[str, Any]) -> tuple[str, str | None]:
    """The cleaned take, or the take unchanged and why."""
    if not text.strip() or not enabled(config):
        return text, None
    try:
        return complete(config["polish"], text, terms), None
    except Exception as err:  # noqa: BLE001 - any failure keeps the recognizer's text
        return text, str(err)
