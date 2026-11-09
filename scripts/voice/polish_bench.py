"""Cleanup bench for polish.py: bench/polish_cases.json through a chat model, scored automatically.

The cases are yap's setup/cases.json + cases_extra.json (25 code-switched dictations: self-corrections,
lists, steps, identifiers, misheard English, requests that must not be answered) plus agent prompts
(`agent_*`), some with the `vocab` the conversation would supply. Each has checks: text it must and must not
contain, list or no list, maximum length. No audio; the text is what the recognizer would hand over.

  uv run --project scripts/voice scripts/voice/polish_bench.py --model gpt-6-luna
  ... --prompt ~/i/yap/VoiceInk/Resources/RecommendedPrompt.md      # yap's prompt, for comparison
  ... --base-url https://openrouter.ai/api/v1 --api-key-env OPENROUTER_API_KEY --model deepseek/deepseek-v4.1-flash
"""

from __future__ import annotations

import argparse
import json
import re
import statistics
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import polish

HERE = Path(__file__).resolve().parent
LIST_LINE = re.compile(r"^\s*(?:[-•*]|\d+[.、)])\s", re.M)
NUMBERED_LINE = re.compile(r"^\s*\d+[.、)]\s", re.M)


def failures(expect: dict, text: str) -> list[str]:
    """The checks `text` fails (yap's setup/bench.py); empty is a pass."""
    low = text.lower()

    def found(item: str) -> bool:
        return any(alt.lower() in low for alt in item.split("|"))

    out = [f"missing {h!r}" for h in expect.get("has", []) if not found(h)]
    out += [f"has {n!r}" for n in expect.get("not", []) if found(n)]
    want = expect.get("list")
    if want is False and LIST_LINE.search(text):
        out.append("unwanted list")
    if want is True and not LIST_LINE.search(text):
        out.append("no list")
    if want == "numbered" and len(NUMBERED_LINE.findall(text)) < 3:
        out.append("no numbered list")
    if "max_len" in expect and len(text) > expect["max_len"]:
        out.append(f"longer than {expect['max_len']}")
    if re.search(r"```|\*\*|^#|<TRANSCRIPT|</TRANSCRIPT|CUSTOM_VOCABULARY", text, re.M):
        out.append("formatting")
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--model", required=True)
    parser.add_argument("--base-url")
    parser.add_argument("--api-key-env")
    parser.add_argument("--body", help="JSON merged into each request, as config.json's polish.body")
    parser.add_argument("--prompt", type=Path, help="system prompt file (default polish_prompt.md)")
    parser.add_argument("--rounds", type=int, default=3)
    parser.add_argument("--verbose", action="store_true", help="print every failing output")
    args = parser.parse_args()

    block: dict = {"model": args.model}
    if args.base_url:
        block["baseURL"] = args.base_url
    if args.api_key_env:
        block["apiKeyEnv"] = args.api_key_env
    if args.body:
        block["body"] = json.loads(args.body)
    system = args.prompt.read_text() if args.prompt else None
    cases = json.loads((HERE / "bench" / "polish_cases.json").read_text())

    def one(case: dict) -> tuple[str, float]:
        started = time.monotonic()
        try:
            out = polish.complete(block, case["in"], case.get("vocab", []), system)
        except Exception as err:  # noqa: BLE001 - a failed call is a failed case
            out = f"ERROR {err}"
        return out, time.monotonic() - started

    secs: list[float] = []
    per_round: list[int] = []
    agent_round: list[int] = []
    misses: dict[str, int] = {}
    for _ in range(args.rounds):
        with ThreadPoolExecutor(8) as pool:
            results = list(pool.map(one, cases))
        passed = agent = 0
        for case, (out, took) in zip(cases, results):
            secs.append(took)
            bad = failures(case["expect"], out)
            if bad:
                misses[case["id"]] = misses.get(case["id"], 0) + 1
                if args.verbose:
                    print(f"--- {case['id']}: {', '.join(bad)}\n{out}")
            else:
                passed += 1
                agent += case["id"].startswith("agent_")
        per_round.append(passed)
        agent_round.append(agent)
    agents = sum(c["id"].startswith("agent_") for c in cases)
    secs.sort()
    label = f"{args.model} prompt={args.prompt.name if args.prompt else 'polish_prompt.md'}"
    print(
        f"{label}: {', '.join(map(str, per_round))} of {len(cases)} per round "
        f"(agent {', '.join(map(str, agent_round))} of {agents}); p50 {statistics.median(secs):.2f}s "
        f"p95 {secs[int(len(secs) * 0.95)]:.2f}s; missed: {misses or 'none'}"
    )


if __name__ == "__main__":
    assert failures({"has": ["PR", "3点|三点"], "not": ["不对"], "list": False}, "三点 PR") == []
    main()
