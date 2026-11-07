"""Which words the recognizer should be told about, and how to fix the ones it still gets wrong.

Two sources feed one ranked list per dictation:
  - the conversation the user is talking to: identifiers, file names and commands the agent and the
    user just wrote (handed over by the bridge, never stored);
  - `~/.rove/voice/vocab.json`: terms kept across sessions, each with the `spoken` forms the
    recognizer wrote instead ("cottling" for "Kotlin"), which are rewritten after the decode.

Only term-like words are boosted. A plain English word the model already spells ("pipeline") gains
nothing from the prompt and can only be inserted where it was not said.
"""

from __future__ import annotations

import difflib
import json
import os
import re
import time
from collections import Counter
from functools import cache
from pathlib import Path
from typing import Any

HOME = Path(os.environ.get("ROVE_VOICE_HOME") or Path.home() / ".rove" / "voice")
# An identifier with its joiners kept: rove-web, use_effect, v1.30, React.Query.
WORD = re.compile(r"[A-Za-z0-9]+(?:[-_.][A-Za-z0-9]+)*")
# Between the pieces of one term the recognizer split: "Graph QL", "Graph, Q, L", "crash loop".
SPLIT = re.compile(r"[ ,]*")
CONTEXT_CHARS = 20_000
FUZZY_RATIO = 0.7


@cache
def common_words() -> frozenset[str]:
    """Lower-case entries of the system word list: words any recognizer already spells."""
    try:
        lines = Path("/usr/share/dict/words").read_text().split()
    except OSError:
        return frozenset()
    return frozenset(w for w in lines if w.islower())


def common(word: str) -> bool:
    low = word.lower()
    words = common_words()
    return low in words or (low.endswith("s") and low[:-1] in words)


def term_like(word: str) -> bool:
    """A word worth boosting: its spelling is not something the model would guess."""
    if not 2 <= len(word) <= 40 or word.isdigit():
        return False
    if re.search(r"[A-Za-z]", word) is None:
        return False
    if re.search(r"[-_.]|\d", word):
        return True  # rove-web, use_effect, P99, A100, 1.30-ish versions
    if any(c.isupper() for c in word[1:]):
        return True  # GraphQL, iOS, PTY, useEffect
    return not common(word)  # Kubernetes, Redis, Figma; not "Pipeline" or "Actions"


def context_terms(text: str | None, limit: int) -> list[str]:
    """Term-like words of the conversation: the most repeated first, the most recent breaking ties.
    Each keeps the spelling it was last written with."""
    text = (text or "")[-CONTEXT_CHARS:]
    last: dict[str, int] = {}
    spelled: dict[str, str] = {}
    counts: Counter[str] = Counter()
    for index, match in enumerate(WORD.finditer(text)):
        word = match.group()
        if not term_like(word):
            continue
        key = word.lower()
        counts[key] += 1
        last[key] = index
        spelled[key] = word
    ranked = sorted(last, key=lambda k: (-counts[k], -last[k]))
    return [spelled[k] for k in ranked[:limit]]


def store_path() -> Path:
    return HOME / "vocab.json"


def load() -> dict[str, Any]:
    """`vocab.json`, created from the old `dictionary.json` the first time it is read."""
    path = store_path()
    if path.exists():
        return json.loads(path.read_text())
    data: dict[str, Any] = {"version": 1, "terms": []}
    legacy = HOME / "dictionary.json"
    if legacy.exists():
        for entry in json.loads(legacy.read_text()).get("terms") or []:
            term = str(entry.get("term") or "").strip()
            if term:
                spoken = [str(s) for s in entry.get("spoken") or [] if s]
                data["terms"].append({"term": term, "spoken": spoken, "source": "dictionary", "at": 0})
    save(data)
    return data


def save(data: dict[str, Any]) -> None:
    HOME.mkdir(parents=True, exist_ok=True)
    tmp = store_path().with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    tmp.replace(store_path())


def add(term: str, spoken: str | None, source: str) -> dict[str, Any]:
    """Keep a term (and one way it was misheard); an existing term only gains the spoken form."""
    data = load()
    for entry in data["terms"]:
        if entry["term"] == term:
            if spoken and spoken not in entry["spoken"]:
                entry["spoken"].append(spoken)
            break
    else:
        entry = {"term": term, "spoken": [spoken] if spoken else [], "source": source, "at": int(time.time())}
        data["terms"].append(entry)
    save(data)
    return entry


def remove(term: str, spoken: str | None) -> bool:
    """Undo for `add`: drop the spoken form, or the whole term when none is named."""
    data = load()
    for entry in data["terms"]:
        if entry["term"] != term:
            continue
        if spoken:
            if spoken not in entry["spoken"]:
                return False
            entry["spoken"].remove(spoken)
        else:
            data["terms"].remove(entry)
        save(data)
        return True
    return False


def rank(conversation: str | None, draft: str | None, stored: list[dict[str, Any]], limit: int) -> list[str]:
    """One list for the recognizer: stored terms the user is looking at, then the conversation's own
    terms, then the rest of the store, newest first. Case-insensitive duplicates keep the first."""
    haystack = f"{conversation or ''}\n{draft or ''}".lower()
    seen: set[str] = set()
    out: list[str] = []

    def push(term: str) -> None:
        if term and term.lower() not in seen:
            seen.add(term.lower())
            out.append(term)

    newest = sorted(stored, key=lambda e: -int(e.get("at") or 0))
    for entry in newest:
        if entry["term"].lower() in haystack:
            push(entry["term"])
    for term in context_terms(f"{conversation or ''}\n{draft or ''}", limit):
        push(term)
    for entry in newest:
        push(entry["term"])
    return out[:limit]


def apply_spoken(text: str, stored: list[dict[str, Any]]) -> str:
    """Rewrite each stored mishearing to its term. ASCII forms match whole words only, so a short
    form cannot rewrite the inside of another word; CJK has no word boundaries to respect."""
    for entry in sorted(stored, key=lambda e: -len(e["term"])):
        term = entry["term"]
        for spoken in entry.get("spoken") or []:
            if len(spoken) < 2 or spoken == term or spoken.lower() not in text.lower():
                continue
            if spoken.isascii():
                pattern = rf"(?<![A-Za-z0-9]){re.escape(spoken)}(?![A-Za-z0-9])"
                text = re.sub(pattern, term, text, flags=re.IGNORECASE)
            else:
                text = text.replace(spoken, term)
    return text


def _key(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.lower())


def correct(text: str, terms: list[str], fuzzy: bool = True) -> str:
    """Snap the recognizer's English back onto the terms it was given.

    Exact: a run of up to four ASCII words that spells a term once spaces, commas and case are
    dropped ("Graph, Q, L", "HTTPonly", "config map") becomes the term's spelling. Fuzzy: one
    non-dictionary word close to a term with the same first letter ("Decorfile" -> "Dockerfile",
    "Outh" -> "OAuth"); a real English word is never rewritten.
    """
    exact = {_key(t): t for t in terms if len(_key(t)) >= 2}
    # Fuzzy is letters only: "iOS17" is near "iOS", and snapping it would drop the version.
    pool = [(k, t) for k, t in exact.items() if len(k) >= 3 and k.isalpha()]
    tokens = list(WORD.finditer(text))
    out: list[str] = []
    cursor = 0
    i = 0
    while i < len(tokens):
        done = False
        for n in (4, 3, 2, 1):
            run = tokens[i : i + n]
            if len(run) < n or any(not SPLIT.fullmatch(text[a.end() : b.start()]) for a, b in zip(run, run[1:])):
                continue
            start, end = run[0].start(), run[-1].end()
            key = _key(text[start:end])
            term = exact.get(key)
            fuzzy_ok = fuzzy and n == 1 and len(key) >= 3 and key.isalpha() and not common(text[start:end])
            if term is None and fuzzy_ok:
                scored = [
                    (difflib.SequenceMatcher(None, key, k).ratio(), t) for k, t in pool if k[0] == key[0] and k != key
                ]
                best = max(scored, default=(0.0, ""))
                term = best[1] if best[0] >= FUZZY_RATIO else None
            if term is not None:
                out.append(text[cursor:start] + term)
                cursor = end
                i += n
                done = True
                break
        if not done:
            i += 1
    return "".join(out) + text[cursor:]
