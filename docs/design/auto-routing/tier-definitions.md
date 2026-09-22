# Auto routing：三档定义

这一份文本三处共用：标注指南、零样本基线的 prompt、用户侧 tooltip。改一处三处一起变。

**只回答一个问题：这件事需要多深的思考、多少信息才能开始动手。** 不看代码行数，不看改几个文件，不看用哪个模型。分类器的输入只有 new task 那一刻能看到的文本（标题 + 首条 prompt），没有仓库状态、没有对话历史。

---

## swift ——「看一眼就知道怎么做」

答案基本唯一。不需要读别的代码就能开始，做完了也不需要验证别的地方有没有被牵连。

**判据（满足即是）**
- 任务文本已经把改动说完了：改什么、改成什么。
- 不需要做选择。换一个人来做，结果一样。
- 纯读取类：解释、总结、找一个文件、回答一个事实。

**反例（不是 swift）**
- 「改一下 X」但 X 有多个调用方 → standard。文本没说要查，但做的人必须查。
- 「加一个 Y」但 Y 该放在哪、长什么样没定 → standard。

**真实样本**
- `print the numbers 1 to 400 separated by spaces, nothing else`
- `explain this repo in one sentence`
- `Read the README and tell me in one line what this package does.`
- `pull最新代码`
- `Add one test asserting the timeout rejects, then commit.`

---

## standard ——「路是清楚的，但要一边做一边核对」

知道从哪下手、知道做完是什么样，但中间要读代码、跑测试、确认没有漏掉同类的地方。仓库里已经有同类的东西可以照着做。

**判据（满足即是）**
- 有现成的模式可以跟：加一个和已有的同形状的东西（新引擎、新 CLI 动词、新字段、新页面）。
- 根因已知的 bug：知道错在哪，修法是「找到所有走这条路的地方，统一改」。
- 做完之后需要验证：跑测试、类型检查、真机看一眼。

**反例（不是 standard）**
- 文本里说了「修复」但没说错在哪，你得先找 → deep。
- 「优化」「重构」「有什么可以改的」这种没有终点的 → deep。
- 改的东西涉及钱、权限、并发、数据丢失 → deep，不管路多清楚。

**真实样本**
- `Add a 5s request timeout to createClient in src/client.ts, then commit it.`
- `Treat HTTP 429 as retryable in src/retry.ts and cover it in test/client.test.ts, then commit it.`
- `增加一个 在filepane 按a就是at 一个relative 路径吧 目录和文件都可以`
- `sidebar New Task做不的加号 放右边吧 … 然后优化kanbanitem的padding`
- `更多的vendor 在settinge里面的检测要做么`（已有 vendor 检测，照着加）

---

## deep ——「起点是几种可能，不是一条路」

动手之前得先搞清楚问题是什么，或者在几个方案之间做取舍。做错的代价高，或者做错了很难发现。

**判据（满足其一即是）**
- 根因未知：症状描述了，原因要靠假设-验证去找。
- 跨模块：牵涉两个以上子系统，一处改动会在另一处产生你现在还看不见的后果。
- 要做取舍：几个方案都行，得说清楚为什么选这个。
- 高代价：涉及钱、权限、并发、数据丢失、安全边界——错一次很贵，或者错了没人立刻发现。
- 没有终点的任务：「看看有什么可以优化」「换个架构有必要吗」——先要定义完成是什么。

**反例（不是 deep）**
- 文本长、要改的地方多，但每一步都是照着做 → standard。长不等于深。
- 「修一个 bug」但错误信息已经指到了那一行 → standard。

**真实样本**
- `在kobe启动后 iterm的tabname会变成node 我期待是kobe 怎么弄`（不知道谁写的标题、在哪一层被覆盖）
- `观察到 rove prod hook没办法立刻响应status更新？`（症状，根因未知）
- `如果以你现在的视角看这个仓库 换语言和技术架构有必要吗`（取舍，无终点）
- `你检查一下现在wisp线上版本的memory 感觉有点太多太杂了 根本搜不到有用信息`（问题本身要先定义）
- `调查下claudepeer是怎么去解决 模型和模型之间沟通并且不暴露在对方的聊天记录里面的`（跨系统，要读别人的设计再对照自己的）

---

## 拿不准的时候

- **swift 和 standard 之间**：问「做完要不要去看别处」。要 → standard。
- **standard 和 deep 之间**：问「现在能说出第一步改哪个文件吗」。能 → standard；得先查才知道 → deep。
- **两条都不确定**：往上一档。往下错的代价（想少了、做错了、换 tab 重来）大于往上错的代价（多想了一会儿）。

## 定义不管的事

- 用哪个引擎、哪个模型、什么 effort 值。那是映射表的事，定义里不出现 vendor 名。
- 任务要花多久。深不等于久，一个 swift 也可能跑很久。
- 任务重不重要。重要但清楚的活是 standard。
