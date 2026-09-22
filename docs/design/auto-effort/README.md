# auto-effort 分类器 —— 代码与规范快照

这里是 [`../auto-effort-classifier-interface.md`](../auto-effort-classifier-interface.md)
引用到的东西，**照搬一份放在这里，让接手的人不用先拿到那个私有仓库**。

## ⚠ 这是快照，不是运行中的那一份

线上服务读的是 `packages/auto-effort/prompts/rubric-annotator-v5.md`
（一个独立的本地 git 仓库，在 rove 的 `.gitignore` 里）。
**改这里的副本不会改变任何线上行为。**

这一点值得说清楚，因为它正是这套设计特意避开的坑：规范是**请求时现读文件**的，
就为了让「改规范」和「改模型行为」是同一个动作。多一份副本就多一次分叉的机会。

所以：
- 想**看**判据长什么样、想 review → 读这里。
- 想**改**判据 → 改那个仓库里的，然后重新部署。改完把这里同步一次。
- 长期正解是给那个仓库建 remote，这里只留链接。**它现在没有 remote。**

## 有什么

| 文件 | 是什么 |
| --- | --- |
| `jev-head.py` | 调 System One 的那一层，96 行，只用标准库。线上就是这个文件 |
| `rubric-annotator-v5.md` | 当前判据。三档正文被 `jev-head.py` 在请求时读进 criteria |
| `tier-definitions.md` | 给人看的三档定义（比 rubric 长，用来理解，不进请求） |
| `annotation-guideline.md` | 人工标注手册。要扩 golden 的话先读这个 |
| `jev-shots.json` | 请求里带的 24 条样例，取自 golden 中和测试集不相交的那半边 |

## 没有什么，以及为什么

| 没放 | 原因 |
| --- | --- |
| `data/golden/**`（144 条真人标注） | rove 是公开仓库；这些是从真实 GitHub issue 和本机转录里挑出来、逐条手标的 |
| `data/train/**`（6469 条合成训练数据） | 体量大，且只对训练 encoder 那条路线有用 |
| `runs/**`、`verdicts/**` | 评测记录和每轮校准，留在原仓库 |
| `rubric-annotator-v1..v4.md` | 已被 v5 取代。演进过程记在原仓库的 `runs/RESULTS.md` |

## 跑一下

```sh
export TYPESAFE_API_KEY=...          # console.typesafe.ai/keys，绝不提交
python3 jev-head.py "深色模式下代码块的背景和正文一个色，改一下"
```

```jsonc
{ "probs": { "swift": 1.0, "standard": 0.0, "deep": 0.0 },
  "label": "swift", "confidence": 0.99, "ms": 416 }
```

注意它默认按 `__file__` 的上两级去找 `prompts/` 和 `data/`，
在这个目录里直接跑要把两个路径传进 `build_question()`，或者把文件放回原仓库结构里。
