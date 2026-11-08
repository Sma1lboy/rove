"""Learning from the user's own fixes: what the recognizer wrote, against what was sent.

The phone bar remembers the draft as a take left it and which spans were dictated. When the message
goes out, the two are diffed word by word and each fix inside a dictated span that lands on a term
becomes a `spoken` form of that term in `vocab.json`, so the next take is rewritten before it shows.

Most edits are not lessons, so every gate here errs on learning nothing:
  - typography: punctuation, spaces and full-width forms never count ("中 GitHub，" = "中GitHub,");
  - casing: a case-only fix is learned only when it is a term's casing (github -> GitHub, ios -> iOS),
    never a capital at the start of a word (the -> The);
  - the fix must land on term-like words (vocab.term_like): "pipe line" -> "pipeline" is the user's
    style, not a mishearing;
  - a rewrite teaches nothing: past REWRITE_SHARE of the dictated words changed, or more than
    MAX_TERMS fixes, and the whole send is ignored.
"""

from __future__ import annotations

import difflib
import functools
import re
import threading
import time
import unicodedata
from dataclasses import dataclass
from typing import Any, Callable, TypeVar

import vocab

# A Latin word with its joiners (vocab.WORD, plus full-width forms), or one CJK character.
TOKEN = re.compile(r"[A-Za-z0-9\uff10-\uff19\uff21-\uff3a\uff41-\uff5a]+(?:[-_.][A-Za-z0-9]+)*|[\u3400-\u9fff]")
MAX_TERMS = 4
REWRITE_SHARE = 0.5
REWRITE_FLOOR = 2.0
MAX_HEARD_WORDS = 4
MAX_HEARD_CJK = 6
MAX_TERM_WORDS = 3


@dataclass(frozen=True)
class Token:
    text: str
    start: int
    end: int

    @property
    def cjk(self) -> bool:
        return not self.text.isascii()


def tokens(text: str) -> list[Token]:
    return [Token(unicodedata.normalize("NFKC", m.group()), m.start(), m.end()) for m in TOKEN.finditer(text)]


def _inside(token: Token, spans: list[tuple[int, int]]) -> bool:
    return any(start <= token.start and token.end <= end for start, end in spans)


def _term_casing(heard: str, sent: str) -> bool:
    """`sent` differs from `heard` only in case, and the difference is a term's casing: a capital past
    the first letter (GitHub, iOS) or an acronym (API). A word merely capitalized (The) is not."""
    if heard == sent or heard.lower() != sent.lower():
        return False
    return any(c.isupper() for c in sent[1:])


def _heard_fits(run: list[Token]) -> bool:
    cjk = sum(t.cjk for t in run)
    return 0 < len(run) and cjk <= MAX_HEARD_CJK and len(run) - cjk <= MAX_HEARD_WORDS


def _term_fits(run: list[Token]) -> bool:
    if not run or len(run) > MAX_TERM_WORDS or any(t.cjk for t in run):
        return False
    return any(vocab.term_like(t.text) for t in run)


def _words(run: list[Token]) -> float:
    """Length in words: a CJK character is about half of one."""
    return sum(0.5 if t.cjk else 1.0 for t in run)


def fixes(base: str, spans: list[tuple[int, int]], sent: str) -> list[dict[str, str]]:
    """The `{term, spoken}` pairs one send teaches: empty when nothing qualifies or it was a rewrite."""
    a, b = tokens(base), tokens(sent)
    dictated = [t for t in a if _inside(t, spans)]
    if not dictated:
        return []
    matcher = difflib.SequenceMatcher(None, [t.text.lower() for t in a], [t.text.lower() for t in b], autojunk=False)
    found: list[dict[str, str]] = []
    changed = 0.0
    for op, i1, i2, j1, j2 in matcher.get_opcodes():
        heard, said = a[i1:i2], b[j1:j2]
        if op == "equal":
            for x, y in zip(heard, said):
                if _inside(x, spans) and _term_casing(x.text, y.text):
                    changed += 1
                    found.append({"term": y.text, "spoken": x.text})
            continue
        if op == "insert":
            # Words typed into the middle of a take change it; words typed before or after it do not.
            if 0 < i1 < len(a) and _inside(a[i1 - 1], spans) and _inside(a[i1], spans):
                changed += _words(said)
            continue
        inside = [t for t in heard if _inside(t, spans)]
        if not inside:
            continue
        changed += max(_words(inside), _words(said))
        if op == "replace" and len(inside) == len(heard) and _heard_fits(heard) and _term_fits(said):
            found.append({"term": sent[said[0].start : said[-1].end], "spoken": base[heard[0].start : heard[-1].end]})
    # One or two words fixed in a short take is still a fix, not a rewrite.
    if changed > max(REWRITE_FLOOR, REWRITE_SHARE * _words(dictated)) or len(found) > MAX_TERMS:
        return []
    return found


_store = threading.Lock()
F = TypeVar("F", bound=Callable[..., Any])


def _locked(fn: F) -> F:
    """The sidecar serves requests on threads; two sends must not each write over the other's lesson."""

    @functools.wraps(fn)
    def run(*args: Any, **kwargs: Any) -> Any:
        with _store:
            return fn(*args, **kwargs)

    return run  # type: ignore[return-value]


@_locked
def remember(found: list[dict[str, str]]) -> list[dict[str, Any]]:
    """Adds each fix to `vocab.json`; returns what was added, in the shape `forget` takes back."""
    if not found:
        return []
    data = vocab.load()
    now = int(time.time() * 1000)
    added: list[dict[str, Any]] = []
    for fix in found:
        term, spoken = fix["term"], fix["spoken"]
        entry = next((e for e in data["terms"] if e["term"].lower() == term.lower()), None)
        created = entry is None
        if entry is None:
            entry = {"term": term, "spoken": [], "source": "edit", "at": now}
            data["terms"].append(entry)
        renamed = entry["term"] if entry["term"] != term else None
        forms = entry.setdefault("spoken", [])
        new_form = spoken not in forms
        if not new_form and renamed is None:
            continue
        # The newest spelling the user sent wins: Github stored, GitHub sent.
        entry["term"] = term
        if new_form:
            forms.append(spoken)
        entry["at"] = now
        item: dict[str, Any] = {"term": term, "spoken": spoken, "created": created, "newForm": new_form}
        if renamed:
            item["renamed"] = renamed
        added.append(item)
    vocab.save(data)
    return added


@_locked
def forget(added: list[dict[str, Any]]) -> int:
    """Undoes `remember`: a term it created goes; otherwise the spoken form it added, and its old spelling."""
    data = vocab.load()
    undone = 0
    for item in added:
        term, spoken = str(item.get("term") or ""), str(item.get("spoken") or "")
        entry = next((e for e in data["terms"] if e["term"] == term), None)
        if entry is None:
            continue
        undone += 1
        if item.get("created"):
            data["terms"].remove(entry)
            continue
        if item.get("newForm") and spoken in entry.get("spoken", []):
            entry["spoken"].remove(spoken)
        if item.get("renamed"):
            entry["term"] = str(item["renamed"])
    vocab.save(data)
    return undone
