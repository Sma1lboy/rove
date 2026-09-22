"""The Jev head: same rubric, no weights, no training — one HTTPS call.

This is the fourth entry on the try-it page and the reason it is worth having:
the three checkpoints are 6469 synthetic rows of fine-tuning, this one reads the
annotator handbook at request time. It exists so the page answers "do we even
need to train this" with a number instead of an opinion.

The shape that won on core-94 (72.7%, deep recall 17/20): a Choice over the
three tiers, each option carrying the rubric's own section text plus the
boundary rule that separates it from its neighbour, with 24 labelled examples in
the state. The examples come from golden's synth-50 half, which jackson
reviewed and which shares no row with core-94, so the score has no leakage.

Config picked on a held-out dev slice of data/train/synth-v4.jsonl; core-94 was
only ever evaluated. Adding `context` (repo/topic) to the state cost 5-9 points
on dev in all eight configurations tried, so state is the task text alone.
"""
import json
import os
import pathlib
import urllib.request

URL = "https://api.typesafe.ai/v1/systemone"
MODEL = os.environ.get("TYPESAFE_MODEL", "jev-latest")
LABELS = ["swift", "standard", "deep"]
ROOT = pathlib.Path(__file__).resolve().parent.parent

CRITERION = ("只有一个判据：用户的指令里，有多少流程需要模型自己推理出来。"
             "不看工作量，不看难度，不看文本长短，不看语言。三档没有目标比例。")
BOUNDARY = {
    "swift": "和 standard 的分界：用户有没有告诉模型改哪、怎么改，"
             "或者现象是不是具体到打开就能看见？有 → swift。"
             "**直接提问也算 swift**：问「你是什么模型」「这个文件在哪」「X 是什么意思」，"
             "或者打个招呼、道个谢——这些话本身已经完整，答它不需要先想清楚做成什么样，"
             "没有任何流程要模型去推。没有要做的事 ≠ 目标要模型自己找。",
    "standard": "和 swift 的分界：用户没说改哪、怎么改 → 不是 swift。"
                "和 deep 的分界：用户说了要做成什么（哪怕只是猜了个原因）→ standard。",
    "deep": "和 standard 的分界：用户有没有说要做成什么？没有 → deep。"
            "但 deep 说的是「要先调查才知道做成什么样」，不是「这句话里没有活」。"
            "一句已经完整、可以直接回答的话不是 deep，是 swift。",
}


def _rubric_sections(path=None):
    """The three tier bodies, read from the annotator handbook itself.

    Read rather than copied so the page cannot drift from prompts/ silently:
    edit the rubric, redeploy, and the live model changes with it.
    """
    text = (path or ROOT / "prompts/rubric-annotator-v5.md").read_text()
    return {t: text.split(f"## {t} ")[1].split("\n## ")[0].split("\n", 1)[1].strip()
            for t in LABELS}


def build_question(shots_path=None, rubric_path=None):
    sections = _rubric_sections(rubric_path)
    shots = json.loads((shots_path or ROOT / "data/jev-shots.json").read_text())
    question = {
        "verdict": {
            "type": "choice",
            "criteria": {t: {"what": sections[t], "边界": BOUNDARY[t]} for t in LABELS},
            "instructions": {"role": "你在给一条「用户新建 coding task 时写的第一句话」打深度档。",
                             "criterion": CRITERION},
        },
    }
    return question, {"labelled_examples": shots}


def classify(text, api_key=None, timeout=20, question=None, examples=None):
    """One Choice over the three tiers. Returns the page's model-entry shape."""
    import time
    key = api_key or os.environ.get("TYPESAFE_API_KEY")
    if not key:
        raise RuntimeError("TYPESAFE_API_KEY is not set")
    if question is None:
        question, examples = build_question()
    body = json.dumps({"model": MODEL,
                       "state": {"task_text": text[:1200], **(examples or {})},
                       "questions": question}).encode()
    req = urllib.request.Request(URL, data=body, method="POST",
                                 headers={"Authorization": f"Bearer {key}",
                                          "Content-Type": "application/json"})
    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=timeout) as response:
        out = json.loads(response.read())
    a = out["answers"]["verdict"]
    result = {"probs": {t: a["probabilities"][t] for t in LABELS},
              "label": a["choice"],
              "confidence": a["confidence"],
              "ms": round((time.perf_counter() - t0) * 1000)}
    return result


if __name__ == "__main__":
    import sys
    print(json.dumps(classify(sys.argv[1]), ensure_ascii=False, indent=1))
