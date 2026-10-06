# Rove Mobile ↔ TUI 功能对照

来源：`docs/TUI.md`、`docs/KEYBINDINGS.md`、`docs/API.md`。每行一项功能，状态三选一：

- **已有**：手机上能做，写明在哪。
- **缺失**：还没做。
- **不适用**：在手机上没有意义，写明理由。只用于按键手法、终端模拟器能力这类手机本来就没有的东西。

手机只经过 `rove-bridge` 说话；bridge 只调用 `rove api` 的 verb（`invokeVerb`）和 daemon 已有的 RPC，不改 daemon。

## 任务列表（Tasks 侧栏）

| # | 功能 | 状态 | 手机上 |
|---|---|---|---|
| T1 | 项目 → 任务 → tab 的树，全部展开 | 已有 | 列表按项目分组；任务详情里列出该任务的 tab |
| T2 | 选中 tab 打开那个会话 | 已有 | 详情页 tab 行，`[ codex ]` |
| T3 | 派生分组（needs you / ready to land / needs review / working / quiet） | 已有 | 每行的状态 tag，配色见 DESIGN 决定 |
| T4 | attention 排序（最需要人的在最前） | 已有 | 列表默认顺序 |
| T5 | 排序切换：default / recent / attention / name（`t`） | 已有 | 列表头排序图标；attention（默认）/ default（daemon 手动顺序，行字段 `order`）/ recent（`updatedAt`）/ name，选择记在手机上；置顶始终在前 |
| T6 | `/` 模糊搜索：标题、仓库、分支、tab 标题 | 已有 | 列表头放大镜：子序列模糊匹配标题 / 仓库 / 分支，按得分排序；不含 tab 标题（任务行不带 tab 标题） |
| T7 | 行标记 `▴` 置顶 | 已有 | 标题前 `▴`（行字段 `pinned`） |
| T8 | 行标记 `+N/−N` 改动文件数 | 已有 | 第二行 `+N/−N`；数据来自 daemon `worktree.changes` 推送（经 bridge 的 RemoteOrchestrator），不逐任务跑 git；读不了显示 `?` |
| T9 | 行标记 `↑N/↓N` 领先/落后 base 的提交数 | 已有 | 第二行 `↑N/↓N`，同一推送 |
| T10 | PR 标记 `≠/✗/✓`（冲突、失败、通过） | 已有 | 行上 `≠ ✗ ✓`（行字段 `prChip`，规则同 `row-chips.ts:prChip`；forge 不可达时变灰） |
| T11 | 插件 row token（带过期的短标签） | 已有 | 行上的小标签（行字段 `rowTokens`，`liveRowTokens` 过滤，手机按 `expiresAt` 再过滤） |
| T12 | 改任务标题（`r`） | 已有 | `…` 菜单 / 行长按 → rename（`task.rename`） |
| T13 | 改分支名 / 选本地分支（`b`） | 已有 | `…` 菜单 / 行长按 → branch…（`task.setBranch`，本地分支来自 `repo.branches`） |
| T14 | 换引擎（`v`，右键是选择器） | 已有 | `…` 菜单 / 行长按 → change engine…（`task.setCommand`，只接受 engine-list 里的 id） |
| T15 | 置顶/取消（`shift+p`） | 已有 | `…` 菜单 / 行长按 → pin / unpin（`task.pin`） |
| T16 | 重新排序（`shift+m`，tab/任务/项目三级） | 已有 | 菜单 → move up / down / to top（`task.move`，任务级；tab、项目级顺序不做） |
| T17 | 删除：按类型区分（忘掉项目 / 只删目录任务记录 / 删任务+worktree，脏 worktree 二次确认） | 已有 | 菜单 → delete：main 行 `project.forget`，dir 行只删记录，其余 `task.delete`；脏 worktree 被拒后第二次红色确认再 `force` |
| T18 | 设置状态（右键 Set status，六种） | 已有 | 菜单 → set status…（`task.setStatus`，六种标签） |
| T19 | 复制分支名 / 复制路径 | 已有 | 菜单 → copy branch / copy path（路径来自 `task.get`） |
| T20 | Run again：用原 brief 新建一个任务 | 已有 | 菜单 → run again（`task.get` 取原 prompt → `task.spawn`）；没存 prompt 时置灰 |
| T21 | Land into base branch（merge / squash） | 已有 | 详情页 `land`，确认后选策略 |
| T22 | 项目的 Field notes：查看、按条删除 | 已有 | 项目标题 `···` → field notes（`notes.list`），逐条 delete 后二次确认（`notes.delete`） |
| T23 | Remove project（忘掉项目） | 已有 | 项目标题 `···` → remove project，二次确认（`project.forget`） |
| T24 | 在编辑器里打开任务目录（`o`） | 不适用 | 编辑器开在 Mac 的屏幕上，拿着手机的人看不到；手机改为文件浏览（F1） |
| T25 | 没有任务时的欢迎面板：可用引擎（已装且已登录） | 已有 | 空列表显示欢迎面板和 `engines.list` 的引擎；`ready:false`（未装或未登录）置灰 |
| T26 | 侧栏宽度拖拽、折叠栏（fold）、zen 模式 | 不适用 | 终端里分配列宽的手段；手机一次只显示一屏 |

## Inbox / 通知

| # | 功能 | 状态 | 手机上 |
|---|---|---|---|
| I1 | ATTENTION：待处理项，被阻塞的排前面，同组内最老的在前 | 缺失 | 现在有一个系统样式的列表，没有排序和分组 |
| I2 | rate limit 项显示自动恢复时间 | 缺失 | |
| I3 | `enter` 打开目标任务和那个 tab，并清掉该项 | 缺失 | 现在只打开任务，不定位 tab |
| I4 | `d` 不跳转直接清掉 | 已有 | 左滑 Dismiss（样式待改） |
| I5 | RECENT：最近访问的 tab，运行中的带 spinner | 缺失 | |
| I6 | `F7` 跳到下一个待处理项（跨项目，可循环） | 缺失 | |
| I7 | 任务进入 waiting-on-you / 跑完时通知 | 已有 | 本地通知（App 在前台或刚切后台时） |
| I8 | `rove api notify` 的 toast | 缺失 | |

## 终端与 tab

| # | 功能 | 状态 | 手机上 |
|---|---|---|---|
| S1 | 新开引擎 tab（`ctrl+t`） | 已有 | `+ tab`，选引擎 + 首条消息 |
| S2 | 新会话对话框：引擎 / shell / 插件面板 | 缺失 | 只有引擎 |
| S3 | 目标切换：本 worktree 新 tab ⇄ fork 子任务（新 worktree，从当前分支切） | 缺失 | |
| S4 | 上下文切换：全新会话 ⇄ 接着这段对话（continue / handoff） | 缺失 | |
| S5 | Attempts：同一 prompt 扇出 N 个兄弟任务 | 缺失 | |
| S6 | 切换 tab（`ctrl+[ ]`、`ctrl+1..9`） | 已有 | 点 tab |
| S7 | 重命名 tab（`F2`） | 缺失 | |
| S8 | 关闭 tab（`ctrl+w`，关掉最后一个后任务保留） | 已有 | … 菜单 |
| S9 | 关掉所有 tab 后重新打开同类会话 | 缺失 | |
| S10 | tab 状态图标：spinner / `!` / `●` / `○`，以及 `◷ † ?` | 缺失 | 只有 `exited` |
| S11 | 终端分屏（`ctrl+\`、`ctrl+=`、`F3`） | 不适用 | 手机一屏放不下两个可用的终端；一个 tab 一个会话，tab 已覆盖并行 |
| S12 | 滚动回看（`ctrl+pageup/down`、滚轮、first/latest） | 缺失 | |
| S13 | 选中复制（拖选、`ctrl+c` 有选区时复制） | 缺失 | |
| S14 | 回看搜索（`ctrl+a /`，上下走匹配） | 缺失 | |
| S15 | 重置终端（`F5`） | 缺失 | |
| S16 | 打字直达终端、Esc/Tab/方向键/Ctrl/Enter | 已有 | 键盘 + 按键条 |
| S17 | 整行发送（bracketed paste，多行不提前提交） | 缺失 | composer 现在逐字发 + Enter |
| S18 | 附件：图片/PDF 以路径粘进引擎输入框（不提交） | 缺失 | |
| S19 | Fit / Watch 尺寸模式 | 已有 | 详情页 `fit · watch` |
| S20 | 中断当前 turn（`rove api interrupt`） | 缺失 | 现在只能按 esc / ctrl+c |
| S21 | 横向 tab 条显示策略（总是/多 tab/隐藏） | 不适用 | TUI 外观设置；手机的 tab 行始终显示 |

## 文件与 diff

| # | 功能 | 状态 | 手机上 |
|---|---|---|---|
| F1 | Files · All：worktree 文件树，打开只读预览 | 缺失 | |
| F2 | Files · Changes：未提交 / 分支对 base，`b` 切换，标题写明范围 | 已有 | diff 列表分两段（样式待改） |
| F3 | 单文件 diff：重命名、二进制、仅权限变化、空文件都写明 | 缺失 | 现在只渲染 diff 文本 |
| F4 | 合并 diff：目录 / 整个 worktree 一次看 | 缺失 | |
| F5 | diff review：选行/选区写批注、删批注、一次发给引擎 | 缺失 | |
| F6 | `a` 把 `@path` 粘进引擎输入框 | 缺失 | |
| F7 | `r` 刷新 / git 报错原样显示并可重试 | 缺失 | |
| F8 | `o` 用系统应用打开音视频/PDF | 不适用 | 文件在 Mac 上，系统应用也在 Mac 上 |
| F9 | 用终端编辑器打开（vim diff 模式） | 不适用 | 需要在 Mac 的终端里交互 |

## 任务创建

| # | 功能 | 状态 | 手机上 |
|---|---|---|---|
| C1 | For Existing：选仓库 + 从哪个 ref 切 | 已有 | 新建任务 → existing，base 分支条（`repo.branches` → `--base-branch`） |
| C2 | 打开项目本身（project-main）而不是新 worktree | 已有 | 新建任务 → open project（`task.openMain`） |
| C3 | For New Repo：clone URL 到父目录再建任务 | 已有 | 新建任务 → clone（`repo.clone`，只允许 https/ssh/git/scp 形式的 URL），完成后接着建任务 |
| C4 | Adopt Worktree：导入已有 worktree（可多选） | 已有 | 新建任务 → adopt（`worktree.adoptable` / `worktree.adopt`，多选逐个导入） |
| C5 | 选引擎 | 已有 | 新建任务页 |
| C6 | 首条 prompt | 已有 | |
| C7 | 指定分支名 / model / effort | 已有 | 新建任务 → + options：branch、model（引擎 `models` 作建议）、effort（引擎 `effortLevels`） |
| C8 | count / 混合引擎扇出（`--count`、`--agents`） | 已有 | + options：count 1–5 的 chip，或 agents 混合编队（总数 ≤10，API 上限）；需要 prompt |
| C9 | 记住上次的仓库和引擎 | 缺失 | |
| C10 | 让引擎开 PR（`ctrl+a p`，读 `.rove/pr-instructions.md`） | 缺失 | |
| C11 | PR 状态：lifecycle、check、review | 已有 | `…` 菜单 → info：lifecycle / check / review / mergeable / base |

## 页面

| # | 功能 | 状态 | 手机上 |
|---|---|---|---|
| P1 | Kanban：按项目、四列（Backlog/In progress/Parked/Done） | 缺失 | |
| P2 | 卡片带关联任务的派生分组，需要人的置顶并计数 | 缺失 | |
| P3 | 新建 / 编辑标题与描述 / 改状态 / 删除 story | 缺失 | |
| P4 | 从卡片开会话：选引擎、在哪跑、跟过去还是留在看板 | 缺失 | |
| P5 | 关联任务的 EVENTS 快照 | 缺失 | |
| P6 | Routines：列表（仓库、cron、下次运行）+ prompt、precheck、最近运行 | 缺失 | |
| P7 | 新建 / 暂停恢复 / 立即运行 / 删除 / 打开最近一次运行的任务 | 缺失 | |
| P8 | GitHub Issues：按仓库，只看分给我的，刷新 | 缺失 | |
| P9 | 从 issue 开任务；已有任务的直接打开 | 缺失 | |
| P10 | Worktrees 页：审计所有非 main worktree（脏、远端、PR、年龄），land，受保护的删除 | 缺失 | |

## 设置与杂项

| # | 功能 | 状态 | 手机上 |
|---|---|---|---|
| G1 | 深浅色 | 已有 | 跟随系统 |
| G2 | 语言 | 缺失 | |
| G3 | 通知开关 | 缺失 | |
| G4 | 用量（quota）：每个窗口百分比和重置时间，75%/95% 变色 | 缺失 | |
| G5 | Engines：列表、检测到的路径、登录状态、上报方式 | 缺失 | |
| G6 | Engines：开关、改命令、改名、重置/删除、设默认 | 缺失 | |
| G7 | Plugins：启用/停用、改 manifest 声明的设置 | 缺失 | |
| G8 | Marketplace：浏览并安装插件 | 缺失 | |
| G9 | Feedback：发 GitHub Discussion | 缺失 | |
| G10 | 配对、断开、重连、忘掉配对 | 已有 | 设置页 |
| G11 | 透明度、焦点/分屏样式、键盘提示、zen 启动、编辑器选择、scrollback 长度 | 不适用 | 只影响 TUI 自己怎么画 |
| G12 | Keybindings 设置、F1 键位表、按住 ctrl 的提示 | 不适用 | 手机没有组合键 |
| G13 | Dev：重置 UI 状态、重启 backend | 缺失 | |
| G14 | What's New、Update 页、自更新 | 不适用 | 更新的是 Mac 上的 rove，命令在 Mac 的 shell 里跑；App 自己走 TestFlight |
| G15 | DAEMON OUT OF DATE 提示 | 缺失 | |
| G16 | 窄终端布局（<70 列） | 不适用 | 这是给手机 SSH 用的 TUI 布局；本 App 就是它的替代 |

## `rove api` 中 TUI 没覆盖到的

| # | verb | 状态 | 手机上 |
|---|---|---|---|
| A1 | `context` / `collect`：每个任务的改动、提交、死 tab 的退出原因 | 已有 | `…` 菜单 → info：未提交 / 提交差异、running、每个 tab 的退出原因和输出尾部（`task.info` ← `collect`） |
| A2 | `read-output`：引擎结构化历史 | 缺失 | |
| A3 | `digest`：仓库近期工作汇总 | 缺失 | |
| A4 | `agent-turns`：每轮 token / 耗时 | 缺失 | |
| A5 | `set-model` / `set-effort` / `set-command` | 已有 | 菜单 → model & effort… / change engine…（`task.setModel` / `task.setEffort` / `task.setCommand`） |
| A6 | `ensure-worktree` / `remove-worktree` | 已有 | 菜单 → create worktree / remove worktree（后者二次确认，脏时再确认 force，保留任务和分支） |
| A7 | `schema`、`inspect`、`pty-list`、`engine-report`、`pane-*`、`prompt`、`dispatch`、`watch`、`set-active` | 不适用 | 给脚本、插件或已连接的 TUI 用的接口，没有人在手机上直接操作它们 |

## 进度

已有 15 / 需要做的 104（不含不适用 15 项）。
