# auto-routing 判据 —— 产品发出去的那一份

这里的三个文件是 `rove api add --tier auto` 真正发给分类器的文本的**唯一来源**。
不是副本，不是示意。产品侧那份 TypeScript 是从这里生成的：

```text
rubric-annotator-v5.md  ─┐
jev-shots.json          ─┼→ scripts/build-tier-rubric.ts →  src/engine/tier-rubric.generated.ts
jev-head.py             ─┘                                   （提交进仓库，随包发布）
```

```sh
cd packages/kobe && bun run build:rubric     # 改完这里就跑它，并把生成结果一起提交
```

忘了跑 `test/engine/tier-rubric-generated.test.ts` 会红——它把生成器在同样的源文件上
重跑一遍，和提交进来的那份比。**不要手改 `tier-rubric.generated.ts`**，下一次生成会盖掉。

## 为什么要有生成器，而不是直接把文本抄进 `.ts`

因为抄过一次，抄丢了。第一版实现（[#1076](https://github.com/Sma1lboy/rove/pull/1076)）
按设计文档的描述用英文重写了一份判据，**和这里的 24 条样例零重合**——请求发得出去、
分类器答得回来、测试全绿，只是设计文档里那些数字（73.0%、deep 召回 17/20、
边界规则进选项 +3.2、swift 召回 32%→62%）一条都不再描述它发出去的文本。
一份靠人维护的副本迟早会分叉，而这种分叉在运行时是看不见的。

上游（`jev-head.py`）解决同一个问题的办法是**请求时现读文件**。产品里不能这么做：
`dist/` 不含 `docs/`，而且同一个 Rove 版本的两次运行不该对同一句话给出不同判断。
所以改成生成——判据钉在版本上，改它是一次要过 review 的 diff。

## 每个文件是什么

| 文件 | 是什么 | 进请求的哪里 |
| --- | --- | --- |
| `rubric-annotator-v5.md` | 人工标注手册的判据正文 | 三档各自的 `what` |
| `jev-head.py` | 上游调 System One 的那一层，96 行，只用标准库 | `role`、`criterion`、三档各自的 `边界` |
| `jev-shots.json` | 24 条标注样例 | `state.labelled_examples` |
| `tier-definitions.md` | 给人读的三档定义（比判据长） | 不进请求 |
| `annotation-guideline.md` | 人工标注手册全文。要扩标注集先读它 | 不进请求 |

`jev-head.py` 里的 `CRITERION` / `BOUNDARY` / `role` 是 Python 字面量，不在 rubric 里——
rubric 只提供三节 `what`。生成器**解析**这些字面量而不是转录它们，理由同上。
它不认识的写法会直接抛错，不会生成一份缺了内容的判据。

`边界` 这个键名是上游的，**故意保留中文**：`criteria` 是序列化进请求的，字段名就是模型
读到的词，改成 `boundary` 等于在一个没人会去找行为变化的地方改了 prompt。

## 没有放进来的，以及为什么

| 没放 | 原因 |
| --- | --- |
| `data/golden/**`（144 条真人标注） | rove 是公开仓库；这些是从真实 GitHub issue 和本机转录里逐条手标出来的 |
| `data/train/**`（6469 条合成训练数据） | 体量大，且只对训练 encoder 那条路线有用 |
| `runs/**`、`verdicts/**` | 评测记录和每轮校准 |
| `rubric-annotator-v1..v4.md` | 已被 v5 取代 |

这些留在一个独立的本地 git 仓库（rove 的 `.gitignore` 排除 `packages/auto-effort/`），
**它目前没有 remote**，见 issue #25。后果不是挡实现，是挡长期维护：`jev-latest` 会在
脚下变，没有标注集就无法发现静默退化；判据进了发版流程之后，没有基准就是盲改。
缓解手段有一个——`autoRouting.classifierModel` 可以把模型钉死在一个版本上。

## 直接跑一下上游那份

```sh
export TYPESAFE_API_KEY=...          # console.typesafe.ai/keys，绝不提交
cd docs/design/auto-routing
python3 -c "
import importlib.util, json, pathlib
spec = importlib.util.spec_from_file_location('jev_head', 'jev-head.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
q, s = m.build_question(shots_path='jev-shots.json', rubric_path='rubric-annotator-v5.md')
print(json.dumps(m.classify('深色模式下代码块的背景和正文一个色，改一下', question=q, examples=s), ensure_ascii=False))
"
```

`jev-head.py` 默认按 `__file__` 的上两级去找 `prompts/` 和 `data/`（原仓库的目录结构），
所以在这里跑要把两个路径传进 `build_question()`，就像上面那样。这个文件除了上面这一行
说明之外**一个字节没改**，因为它是量出那些数字的那一份。

`jev-shots.json` 的内容也没改，只是被仓库的 formatter 重排了缩进——生成器读的是解析后的
JSON，空白怎么排都一样。

## 相关

- [`../auto-routing-classifier.md`](../auto-routing-classifier.md) —— 为什么接入口而不自带模型（量化对比）
- [`../auto-routing-classifier-interface.md`](../auto-routing-classifier-interface.md) —— System One 的三种原语、我们量到的数、坑
- [`../../CONFIGURATION.md`](../../CONFIGURATION.md) —— 用户怎么打开它，以及提示词去了哪里
