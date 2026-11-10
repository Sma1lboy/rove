"""Sound-alike correction: a run the recognizer wrote that *sounds* like a vocabulary term becomes the term.

`vocab.correct` fixes spelling (\"Graph, Q, L\", \"Decorfile\"); this fixes hearing: \"Cuban Eats\" for
Kubernetes, \"JitHub\" for GitHub, \"reserver\" for resolver. Both sides are reduced to a Metaphone key and
compared; a Chinese run is read as toneless pinyin first, so a transliteration (库伯内特斯) keys the same way.

Guards, each from a false hit in the bench: a run made only of dictionary words is never touched (\"Pot\"
stays a pot); the keys must start alike and be long enough to mean something; a Chinese run must match
more closely than English, because any two syllables key to *something*.
"""

from __future__ import annotations

import re
from functools import cache

import jellyfish
from pypinyin import lazy_pinyin

import vocab

ASCII_RATIO = 0.85
CJK_RATIO = 0.92
MIN_KEY = 3
CJK_RUN = re.compile(r"[\u4e00-\u9fff]{2,6}")


@cache
def key(text: str) -> str:
    if CJK_RUN.fullmatch(text):
        text = "".join(lazy_pinyin(text))
    return jellyfish.metaphone(re.sub(r"[^A-Za-z]", "", text))


def _best(heard: str, pool: list[tuple[str, str]], ratio: float) -> str | None:
    k = key(heard)
    if len(k) < MIN_KEY:
        return None
    best, score = None, ratio
    for term_key, term in pool:
        # A key much longer than the term's is a term plus a word that was said ("Redis TTL"): leave it.
        if term_key[0] != k[0] or not 0.75 <= len(term_key) / len(k) <= 1.34:
            continue
        s = jellyfish.jaro_winkler_similarity(k, term_key)
        if s >= score:
            best, score = term, s
    return best


def correct(text: str, terms: list[str]) -> str:
    """Replace sound-alike runs (up to two ASCII words, or one Chinese run) with the term they key to."""
    pool = [(key(t), t) for t in terms if t.isascii() and len(key(t)) >= MIN_KEY]
    if not pool:
        return text
    spelled = {t.lower() for t in terms}

    def ascii_runs(s: str) -> str:
        tokens = list(vocab.WORD.finditer(s))
        out, cursor, i = [], 0, 0
        while i < len(tokens):
            hit = None
            for n in (2, 1):
                run = tokens[i : i + n]
                if len(run) < n or any(s[a.end() : b.start()] != " " for a, b in zip(run, run[1:])):
                    continue
                words = [m.group() for m in run]
                if not all(w.isalpha() for w in words) or all(vocab.common(w) for w in words):
                    continue
                heard = s[run[0].start() : run[-1].end()]
                if heard.lower() in spelled:
                    break
                term = _best(heard, pool, ASCII_RATIO)
                if term:
                    hit = (run[0].start(), run[-1].end(), term, n)
                    break
            if hit:
                out.append(s[cursor : hit[0]] + hit[2])
                cursor = hit[1]
                i += hit[3]
            else:
                i += 1
        return "".join(out) + s[cursor:]

    def cjk_run(m: re.Match[str]) -> str:
        return _best(m.group(), pool, CJK_RATIO) or m.group()

    return CJK_RUN.sub(cjk_run, ascii_runs(text))
