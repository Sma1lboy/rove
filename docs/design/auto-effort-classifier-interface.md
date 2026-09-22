# 接手指南：怎么调 System One，以及我们已经调通了什么

配套 [`auto-effort-classifier.md`](./auto-effort-classifier.md)（那份定的是**要不要做**，
这份写的是**怎么做**）。目标是让接手的人不用重新趟一遍。

代码和判据的快照在 [`auto-effort/`](./auto-effort/) —— 看可以，改要改原仓库。

分类器本身的原料、数据和评测记录不在本仓库：它是一个独立的本地 git 仓库，
挂在 `packages/auto-effort/`，被 [`.gitignore`](../../.gitignore) 排除
（rove 是公开仓库，而 golden 是手工标注）。**它目前没有 remote，接手前先给它建一个。**

## 一、请求长什么样

```
POST https://api.typesafe.ai/v1/systemone
Authorization: Bearer $TYPESAFE_API_KEY
Content-Type: application/json
```

```jsonc
{
  "model": "jev-latest",        // 或钉死版本，例如 jev-1.13.0
  "state":     { /* 任意 JSON。程序状态，不是对话 */ },
  "questions": { "<自定义名字>": { /* 见下 */ } }
}
```

`state` 是自由 JSON，字段名就是模型看到的名字，所以**字段起名本身是 prompt 的一部分**。
`questions` 的 key 只给你的代码用，不发给模型——**问题的全部含义必须写在 instructions 里**。

响应：

```jsonc
{
  "model": "jev-1.13.0",
  "answers": { "<同样的名字>": { /* 见下 */ } },
  "usage": { "input_tokens": 772, "output_tokens": 113 }
}
```

一次请求可以问很多道题，它们**并行作答、互相看不见对方的答案**。
单次前向，所以多问几道几乎不加时间——但每道题的前提必须自己写全。

## 二、三种原语

### Choice —— 从一组具名选项里选一个

```jsonc
// 请求
{ "type": "choice",
  "criteria": { "swift": "……", "standard": "……", "deep": "……" },
  "instructions": { "role": "……", "criterion": "……" } }   // 字符串或结构化对象都行

// 响应
{ "type": "choice", "choice": "standard",
  "probabilities": { "swift": 0.12, "standard": 0.74, "deep": 0.14 },
  "confidence": 0.71 }
```

2–255 个选项。`confidence` 是分布集中度，不是"答案对的概率"。

### Noul —— 一个是非题的「是」的概率

```jsonc
{ "type": "noul", "instructions": "这条指令有没有说清楚要改哪个文件？" }
→ { "type": "noul", "noul": 0.83 }
```

**没有 `confidence` 字段。** 0.5 附近表示"是和否差不多可能"，不是"中等程度"。

### Score —— 在一组有序等级上定位

```jsonc
// criteria 是有序数组，不是对象
{ "type": "score",
  "criteria": ["安全开阔", "很快会有障碍", "立刻会撞上"],
  "instructions": "当前处境有多危险？" }

→ { "type": "score", "score": 1.3, "confidence": 0.54,
    "legend": { "0": "安全开阔", … },
    "probabilities": { "0": 0.0, "1": 0.7, "2": 0.3 } }
```

2–10 级。每一级必须写成**具体情形且独立可判**——不能写"中等严重"，
也不能写"比上一级更糟"。

## 三、我们在用的那一套

代码在 `packages/auto-effort/scripts/jev_head.py`（约 90 行，只用标准库，无 SDK 依赖）。
一道 Choice，三档取自 `prompts/rubric-annotator-v5.md`，state 里带 24 条标注样例。

```
state:     { task_text: "<用户写的第一句话，截 1200 字>",
             labelled_examples: [ {task, tier} × 24 ] }
questions: { verdict: { type: choice,
                        criteria: { swift|standard|deep: { what: <rubric 该节原文>,
                                                           边界: <该档与邻档的分界规则> } },
                        instructions: { role, criterion } } }
```

三件不显然但都是量出来的：

1. **rubric 是请求时现读文件的**，不是写死在代码里。改 `prompts/rubric-annotator-v5.md`
   重新部署，线上模型就跟着变——避免文档和线上行为静默分叉。
2. **每个选项里附上"它和邻档的分界规则"**，而不是把分界规则统一塞进 instructions。
   单这一项 +3.2 个点。
3. **24 条样例取自 golden 的 synth-50 那半边**，和 94 条测试集零重合。
   规范文字给不出"具体到打开就能看见"的实际下限，只能靠例子校准：
   加样例后 swift 召回 32% → 62%。

`context`（repo/topic）**不要**加进 state：dev 上八个配置无一例外掉 5–9 点。

### 量到的数

core-94（94 条真人标注，地板 48.9%），每个配置跑 3 次报均值：

| 配置 | core-94 | deep 召回 |
| --- | ---: | ---: |
| 零样本，分界规则在 instructions | 64.5% | 14/20 |
| + 24 条样例 | 70.6% | 15/20 |
| + 分界规则写进选项 | 67.7% | 15/20 |
| **两者都要（线上这版）** | **73.0%** | **17/20 = 85%** |

对照：Haiku 4.5 读同一份规范 60.4%；在 6469 条合成数据上微调的 e5-large
三种子集成 61.7%；decider-2b 零样本 53.2%。

延迟 p50 283ms。core-94 全跑一次 107,840 input tokens ≈ $0.0045
（$0.042/MTok 输入，输出免费）。跑间跨度只有 2.1 点，单次结果基本可信——
这点和微调轨很不一样，那边同配置跨批次能差 6 点。

**级联不成立**：Jev 和 encoder 分歧 31 条，Jev 对 20、encoder 对 9，
任何阈值下把一部分交给 encoder 都比 Jev 单跑差。

## 四、答案回来必须校验

类型安全保证的是接口形状，不是内容可信。Choice 至少验四项：

```
choice 在本次提供的枚举里          ← 最重要，越界 id 绝不执行
probabilities 的键集合 == 枚举集合
每个数 ∈ [0,1] 且有限
probabilities[choice] 是最大值
```

**概率和留容差，但绝不重新归一化。** `jev-1.13.0` 会返回分位到分的值，
总和是 0.99 或 1.01。自己 normalize 一遍等于把模型报的数改掉，
之后所有阈值判断都建立在改过的数上。容差取 ±0.02 即可。

## 五、坑

- **`confidence` 只有 Choice 和 Score 有，Noul 没有。** 想给 Noul 做置信门，
  只能用它和 0.5 的距离，那和 Choice 的 confidence 不是一回事，别混用阈值。
- **问题 key 不发给模型。** 叫 `is_urgent` 不会让模型知道你在问紧急程度。
- **32k 的请求上限**（state + questions 合计）。超了要分批，而每批都得重发完整 state
  才能让它看到全局——这两件事会互相挤压，预算要提前算。
- **429 是上游共享池限流，不一定是你的额度用完了。** 读 `retry-after` 退避。
- **过期的决策不要重试。** 重试拿回来的是对旧状态的答案；要重的是"观察 + 提问"，
  不是那个答案。
- **模型说"完成了"不是完成的证据。** 我们的 DONE 由独立检查器验。

## 六、接手清单

1. `packages/auto-effort/` **建 remote**（现在没有，机器挂了就没了）。
   依赖清单已冻结在它的 `requirements.txt`（uv venv，61 个包）。
2. key 从环境读，`TYPESAFE_API_KEY`。控制台 `console.typesafe.ai/keys`。
   **绝不写进源码，绝不提交。**
3. 想改判据：改 `prompts/rubric-annotator-v5.md`，用
   `.scratch/jev/bench.py` 在 core-94 上跑 3 次看均值。
   **不要对着那 94 条调参**——调参用 golden 的 synth-50 那半边，core-94 只考。
4. 已知 rubric 自身有一处打架：`local-0073`（给了 SKILL.md 链接 + "用这个 skill"）
   同时命中 swift 的"给了参考实现"和 standard 的"给了链接说照这个做"。
   73.0% 里有一部分不是模型的错。
5. 产品侧的决定见 [`auto-effort-classifier.md`](./auto-effort-classifier.md)：
   建议做成可插拔的 `autoEffort.classifier = off | jev | <url>`，默认关，
   带置信度门（0.5：覆盖 53%、覆盖内 84%），失败静默退回人工选档。

## 七、参考

- 官方文档索引 `https://docs.typesafe.ai/llms.txt`；页面路径加 `.md` 取 Markdown。
- 我们从社区项目里整理的构建规则（40 条，八类）和九个项目的机制拆解，
  链接问 jackson 要。
