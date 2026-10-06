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
| T6 | `/` 模糊搜索：标题、仓库、分支、tab 标题 | 已有 | 列表头放大镜：子序列模糊匹配标题 / 仓库 / 分支 / tab 标题，按得分排序；打开搜索时并发读一次各任务的 `task.tabs` 拿 tab 标题 |
| T7 | 行标记 `▴` 置顶 | 已有 | 标题前 `▴`（行字段 `pinned`） |
| T8 | 行标记 `+N/−N` 改动文件数 | 已有 | 第二行 `+N/−N`；数据来自 daemon `worktree.changes` 推送（经 bridge 的 RemoteOrchestrator），不逐任务跑 git；读不了显示 `?` |
| T9 | 行标记 `↑N/↓N` 领先/落后 base 的提交数 | 已有 | 第二行 `↑N/↓N`，同一推送 |
| T10 | PR 标记 `≠/✗/✓`（冲突、失败、通过） | 已有 | 行上 `≠ ✗ ✓`（行字段 `prChip`，规则同 `row-chips.ts:prChip`；forge 不可达时变灰） |
| T11 | 插件 row token（带过期的短标签） | 已有 | 行上的小标签（行字段 `rowTokens`，`liveRowTokens` 过滤，手机按 `expiresAt` 再过滤） |
| T12 | 改任务标题（`r`） | 已有 | `…` 菜单 / 行长按 → rename（`task.rename`） |
| T13 | 改分支名 / 选本地分支（`b`） | 已有 | `…` 菜单 / 行长按 → branch…（`task.setBranch`，本地分支来自 `repo.branches`） |
| T14 | 换引擎（`v`，右键是选择器） | 已有 | `…` 菜单 / 行长按 → change engine…（`task.setCommand`，只接受 engine-list 里的 id） |
| T15 | 置顶/取消（`shift+p`） | 已有 | `…` 菜单 / 行长按 → pin / unpin（`task.pin`） |
| T16 | 重新排序（`shift+m`，任务/项目） | 已有 | 任务行 `…` → move up / down / to top；项目标题 `···` → 项目上移 / 下移 / 到顶（移动该项目的 main 任务，和 TUI 一样，default 排序下生效）（`task.move`） |
| T16b | 重新排序 tab（同一任务内） | 缺失 | tab 顺序只存在 TUI 的 state.json 里，daemon 没有移动 tab 的接口；bridge 直接写 state.json 会被已连接的 TUI 覆盖（kv 只在启动时读一次）。已提需（rove issue #121） |
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
| I1 | ATTENTION：待处理项，被阻塞的排前面，同组内最老的在前 | 已有 | 铃铛 → Inbox，排序同 `sortAttentionInbox` |
| I2 | rate limit 项显示自动恢复时间 | 已有 | `resumes 3:14 PM`，来自任务的 `quotaResume`（附加字段 `resumeAt`） |
| I3 | `enter` 打开目标任务和那个 tab，并清掉该项 | 已有 | 点行打开精确 tab 并清除；打开任何 tab 也会清掉对应项 |
| I4 | `d` 不跳转直接清掉 | 已有 | 行右侧 `dismiss` |
| I5 | RECENT：最近访问的 tab，运行中的带 spinner | 已有 | 手机本地访问记录（任务+tab），运行中的带 spinner |
| I6 | `F7` 跳到下一个待处理项（跨项目，可循环） | 已有 | Inbox 右上 `next pending`；详情页 `…` → Next waiting item，重复按会往后走 |
| I7 | 任务进入 waiting-on-you / 跑完时通知 | 已有 | 本地通知（App 在前台或刚切后台时） |
| I8 | `rove api notify` 的 toast | 已有 | 桥新增 `notice` 推送（过期和重复丢弃），App 顶部 toast，点开对应任务 |

## 终端与 tab

| # | 功能 | 状态 | 手机上 |
|---|---|---|---|
| S1 | 新开引擎 tab（`ctrl+t`） | 已有 | `+ tab`，选引擎 + 首条消息 |
| S2 | 新会话对话框：引擎 / 插件面板 | 已有 | `+ tab` / `…` → New session…：选引擎。插件面板不适用（`pane-open` 只广播给已挂载的 TUI，没有 TUI 就是空操作） |
| S2b | 新会话对话框里的 shell / 右键 New shell | 缺失 | 没有无头的公开接口：`send --tab new` 必须带 prompt 且只开引擎 tab，`pane-open` 要已连接的 TUI。已提需（rove issue #120） |
| S3 | 目标切换：本 worktree 新 tab ⇄ fork 子任务（新 worktree，从当前分支切） | 已有 | 新会话 sheet 的 `where`；子任务用 `add --base-branch <本任务分支>`；单个 attempt 会跳进子任务 |
| S4 | 上下文切换：全新会话 ⇄ 接着这段对话（continue / handoff） | 已有 | 新会话 sheet 的 `conversation`。无头环境没有原生 fork，同引擎也走 transcript handoff，界面里写明 |
| S5 | Attempts：同一 prompt 扇出 N 个兄弟任务 | 已有 | fork 模式下 `attempts` 1–5（`add --count`），多个时留在原任务并弹 toast |
| S6 | 切换 tab（`ctrl+[ ]`、`ctrl+1..9`） | 已有 | 点 tab |
| S7 | 重命名 tab（`F2`） | 已有 | `…` → Rename tab（`rename --tab`，无 TUI 时也写入快照） |
| S8 | 关闭 tab（`ctrl+w`，关掉最后一个后任务保留） | 已有 | … 菜单 |
| S9 | 关掉所有 tab 后重新打开同类会话 | 已有 | 无 tab 时出现 `reopen session`，可选接着上一段对话（只能开引擎 tab，没有 prompt 的空 tab 开不了：`send --tab new` 要求 prompt） |
| S10 | tab 状态图标：spinner / `!` / `●` / `○`，以及 `◷ † ?` | 已有 | tab 条每个 tab 前的符号，来自 `tab.states`；`●` 在手机上打开该 tab 后变 `○`（已读记在手机本地） |
| S11 | 终端分屏（`ctrl+\`、`ctrl+=`、`F3`） | 不适用 | 手机一屏放不下两个可用的终端；一个 tab 一个会话，tab 已覆盖并行 |
| S12 | 滚动回看（`ctrl+pageup/down`、滚轮、first/latest） | 已有 | 拖动滚动；终端右上 `⋯`：Top / Page up / Page down；滚上去后出现 `latest ↓` |
| S13 | 选中复制（拖选、`ctrl+c` 有选区时复制） | 已有 | 长按选中，左下出现 `copy` |
| S14 | 回看搜索（`ctrl+a /`，上下走匹配） | 已有 | `⋯` → Find in scrollback，`‹ ›` 走匹配并显示 n/总数；全屏应用（alternate screen）占着缓冲区时只能搜到当前屏，界面会写明 |
| S15 | 重置终端（`F5`） | 已有 | `⋯` → Reset terminal…，确认后清本地屏和回看，再错一列 resize 让应用重画 |
| S16 | 打字直达终端、Esc/Tab/方向键/Ctrl/Enter | 已有 | 键盘 + 按键条 |
| S17 | 整行发送（bracketed paste，多行不提前提交） | 已有 | composer 多行（`↵` 换行）整段 bracketed paste，150ms 后 Enter |
| S18 | 附件：图片/PDF 以路径粘进引擎输入框（不提交） | 已有 | composer 左侧 `+`：相册或文件 → `attachment.put` → 粘 `images[0]: /path`（png/jpeg/gif/webp/pdf，≤5 MB，HEIC 转 JPEG） |
| S19 | Fit / Watch 尺寸模式 | 已有 | 详情页 `fit · watch` |
| S20 | 中断当前 turn（`rove api interrupt`） | 已有 | 按键条 `interrupt`；`…` → Interrupt turn |
| S21 | 横向 tab 条显示策略（总是/多 tab/隐藏） | 不适用 | TUI 外观设置；手机的 tab 行始终显示 |

## 文件与 diff

| # | 功能 | 状态 | 手机上 |
|---|---|---|---|
| F1 | Files · All：worktree 文件树，打开只读预览 | 已有 | 任务页 `diff` → files → `all`：按目录浏览（面包屑）、路径搜索；点文件走 `diff.file` working 范围，未改动的文件得到 `code` 只读预览。新 op `files.list`（超过 5 万个文件时截断并提示） |
| F2 | Files · Changes：未提交 / 分支对 base，`b` 切换，标题写明范围 | 已有 | files → `changes`：`uncommitted` / `branch vs <base>` 两个 tile 切换，下面一行写明范围含义，base 点名；按目录分组，加减行用成功绿/错误红 |
| F3 | 单文件 diff：重命名、二进制、仅权限变化、空文件都写明 | 已有 | 单文件页按 `diff.file` 的结果种类渲染：重命名（`renamed from` + `+N −M`；纯重命名写 `+0 −0`）、二进制/图片（含大小）、仅权限变化（`100644 → 100755`）、空文件新增/删除、读取失败、git 报错原样显示，均带 `retry` |
| F4 | 合并 diff：目录 / 整个 worktree 一次看 | 已有 | changes 里 `whole worktree` 与每个目录行，All 里目录行的 `diff`：直接用 `diff.file` 的目录/`.` 路径让 git 出合并 diff（和 TUI 同一条路径），只读，可切范围。只含已跟踪文件的改动（未跟踪文件在 changes 列表里单列） |
| F5 | diff review：选行/选区写批注、删批注、一次发给引擎 | 已有 | 单文件 diff 里点一行、再点另一行成区间 → `note`；批注挂在行下，`notes n/m` 打开列表，`drop`（二次确认）删除、`send` 一次把所有未发送批注作为一条消息发给引擎，只有 `send` 动词确认送达才标记 `sentAt`。新 ops `review.list/add/remove/send`，存储在 `state.json` 的 `diffComments.<taskId>`，与 TUI 同一份。注意：已经在运行的 TUI 只在重启后才看得到手机写入的批注（TUI 的 kv 只在启动时读一次） |
| F6 | `a` 把 `@path` 粘进引擎输入框 | 已有 | 单文件页头部 `@`：把 `@<相对路径>`（与 TUI 同格式，不提交）记下，退回任务页，终端重新附着并回放完之后，经现有 `term.input` 写进当前引擎的输入框 |
| F7 | `r` 刷新 / git 报错原样显示并可重试 | 已有 | files、单文件、合并 diff、Worktrees 页都有刷新键和下拉刷新；git/桥接报错原样显示，带 `retry` |
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
| C9 | 记住上次的仓库和引擎 | 已有 | 新建任务页记住这台手机上次用的仓库和引擎（`@AppStorage`） |
| C10 | 让引擎开 PR（`ctrl+a p`，读 `.rove/pr-instructions.md`） | 已有 | 详情页 `…` → Ask the engine for a PR…，确认后发送 `buildPRPrompt` |
| C11 | PR 状态：lifecycle、check、review | 已有 | `…` 菜单 → info：lifecycle / check / review / mergeable / base |

## 页面

| # | 功能 | 状态 | 手机上 |
|---|---|---|---|
| P1 | Kanban：按项目、四列（Backlog/In progress/Parked/Done） | 已有 | 页面菜单 → board：按项目切换，四列用 tile 切换（带计数），5 秒自动刷新；Parked/Done 超过 20 张显示 `+N more` |
| P2 | 卡片带关联任务的派生分组，需要人的置顶并计数 | 已有 | 关联卡片显示任务的分组 tag 和引擎名；需要人的卡片置顶，标题栏 `N need you`；Parked 不置顶 |
| P3 | 新建 / 编辑标题与描述 / 改状态 / 删除 story | 已有 | 右上 `+` 新建；点卡片开抽屉：改标题/描述、STATUS open·doing·hold·done、删除（只删记录，二次确认）。描述清空会存成一个空格（verb 不接受空 body） |
| P4 | 从卡片开会话：选引擎、在哪跑、跟过去还是留在看板 | 已有 | 抽屉 start session：引擎、worktree / project、follow / stay。worktree：新建任务 → 关联 story → 状态 doing；project：主检出上新开 tab → 状态 doing |
| P5 | 关联任务的 EVENTS 快照 | 已有 | 关联 story 的抽屉里：最近 12 条引擎事件，新的在前；daemon 重启后可能为空 |
| P6 | Routines：列表（仓库、cron、下次运行）+ prompt、precheck、最近运行 | 已有 | 页面菜单 → routines：每行 repo · cron · 下次运行 + 最近一次结果；详情有 prompt、precheck（只读）、最近 10 次运行和 agent 回复 |
| P7 | 新建 / 暂停恢复 / 立即运行 / 删除 / 打开最近一次运行的任务 | 已有 | `+` 新建（name / repo / prompt / schedule，带常用 cron）；详情里暂停恢复、run now（二次确认）、打开最近一次运行的任务、改 name/prompt/schedule、删除（二次确认）。precheck 是 shell 命令，不能从手机写 |
| P8 | GitHub Issues：按仓库，只看分给我的，刷新 | 已有 | 页面菜单 → github issues：仓库切换、assigned to me、刷新（绕过 60 秒缓存）；`gh` 缺失 / 未登录 / 没有 remote 时清楚显示原因并可重试 |
| P9 | 从 issue 开任务；已有任务的直接打开 | 已有 | 点 issue：已有关联任务的直接打开，否则选内置引擎后 start task |
| P10 | Worktrees 页：审计所有非 main worktree（脏、远端、PR、年龄），land，受保护的删除 | 已有 | 任务列表 `…` 页面菜单 → worktrees：按项目分组，每行分支、脏/探测失败、远端有无、PR/已合并/空闲判定、年龄；点开后 `land branch`（仅已跟踪的任务分支，merge/squash 二次确认，走现有 `task.land`）与 `remove worktree`（确认后调 `worktrees.remove`；有未提交改动时 git 的拒绝原因原样引用，再来一次明确的 `Force remove` 确认才会强制删）。新 ops `worktrees.list/remove` |

## 设置与杂项

| # | 功能 | 状态 | 手机上 |
|---|---|---|---|
| G1 | 深浅色 | 已有 | 跟随系统 |
| G2 | 语言 | 已有 | 手机跟 iOS 系统语言（系统设置 → Rove → 语言），不做 App 内切换。英文（开发语言）+ 简体中文：`Sources/RoveMobile/Localizable.xcstrings`（界面文案）和 `InfoPlist.xcstrings`（相机 / 本地网络授权说明）。`Text("…")` / `Button("…")` 字面量自动本地化；共享组件（`FormSection`、`PrimaryBar`、`SheetScaffold`、`Theme.kicker` 等）的参数是已本地化的 `String`，调用处用 `String(localized:)`，逻辑层（枚举 `label`、错误文案）同样；`PrimaryBar.identifier` 必填、固定英文，UI 测试用英文跑。不翻译：状态 tag（`working` / `idle` / `waiting-on-you` / `ready-for-review` / `landing`，与 TUI 和 `rove api context` 同一套词）、`[ rove ]`、分支 / 路径 / 引擎名、键名（`esc` / `enter`）、cron、bridge 返回的错误原文。中文措辞沿用 TUI 的 zh 文案（`packages/rove/src/tui/i18n/messages`）。新增文案时：英文字面量写进代码，`Localizable.xcstrings` 补 zh-Hans，别漏 |
| G3 | 通知开关 | 已有 | 设置 → notifications：只作用于这部手机，默认开；Notifier 发通知前读它；iOS 授权被拒时给出打开系统设置的入口 |
| G4 | 用量（quota）：每个窗口百分比和重置时间，75%/95% 变色 | 已有 | 设置 → usage：每个引擎每个窗口一条进度条，75% 起 warning 黄，95% 起 error 红；bridge 订阅 `usageSnapshotSignal()`，op `usage.get` |
| G5 | Engines：列表、检测到的路径、登录状态、上报方式 | 已有 | 设置 → engines：二进制路径、是否登录（不传邮箱，也不传命令参数）、上报方式（hooks / markers / screen rules） |
| G6 | Engines：开关、改命令、改名、重置/删除、设默认 | 已有 | 开关、设默认、改名、重置覆盖 / 删除自定义引擎；每一项都二次确认；bridge 守住“最后一个启用的引擎不关、默认必须是启用的”。改命令见 G6b |
| G6b | Engines：改启动命令 | 不适用 | `engineCommand.<id>` 是 daemon 真正去 spawn 的命令行，手机写入等于让 Mac 执行手机给的命令；只能在 Mac 上改。手机能把它重置回内置默认 |
| G7 | Plugins：启用/停用 | 已有 | 设置 → plugins：版本、linked、有更新、平台不支持、最近一次运行；启用/停用（二次确认） |
| G7b | Plugins：改 manifest 声明的设置 | 不适用 | 设置值会变成 plugin 自带命令的环境变量，手机写入等于给 Mac 上的命令塞参数；留在 Mac |
| G8 | Marketplace：浏览并安装插件 | 不适用 | 安装会跑仓库自带的 build 命令（TUI 要先 clone、列出所有命令、再让人确认）；手机上没有安全的办法替人确认这些命令，留在 Mac |
| G9 | Feedback：发 GitHub Discussion | 已有 | 设置 → feedback：二次确认后，用 Mac 上的 gh 登录发（公开、不可撤回） |
| G10 | 配对、断开、重连、忘掉配对 | 已有 | 设置 → bridge（复用配对页） |
| G11 | 透明度、焦点/分屏样式、键盘提示、zen 启动、编辑器选择、scrollback 长度 | 不适用 | 只影响 TUI 自己怎么画 |
| G12 | Keybindings 设置、F1 键位表、按住 ctrl 的提示 | 不适用 | 手机没有组合键 |
| G13 | Dev：重置 UI 状态、重启 backend | 不适用 | reset 会清空 UI 和任务索引，不可恢复；TUI 里“重启 backend”只是退出这个 TUI 窗口，真正重启 daemon 要在 Mac 的 shell 里跑 `rove daemon restart`，手机经 bridge 连着 daemon，重启会断掉它自己唯一的路 |
| G14 | What's New、Update 页、自更新 | 不适用 | 更新的是 Mac 上的 rove，命令在 Mac 的 shell 里跑；App 自己走 TestFlight |
| G15 | DAEMON OUT OF DATE 提示 | 已有 | 设置首页顶部：daemon 和 bridge 的 Rove 版本不同时出现 `daemon out of date` 和要在 Mac 上跑的命令（op `daemon.info`） |
| G16 | 窄终端布局（<70 列） | 不适用 | 这是给手机 SSH 用的 TUI 布局；本 App 就是它的替代 |

## `rove api` 中 TUI 没覆盖到的

| # | verb | 状态 | 手机上 |
|---|---|---|---|
| A1 | `context` / `collect`：每个任务的改动、提交、死 tab 的退出原因 | 已有 | `…` 菜单 → info：未提交 / 提交差异、running、每个 tab 的退出原因和输出尾部（`task.info` ← `collect`） |
| A2 | `read-output`：引擎结构化历史 | 已有 | 任务详情 `…` → Engine history：按消息渲染结构化历史（工具调用/结果可展开），`load newer` 用游标翻页；没有历史时回退到带标签的终端尾部 |
| A3 | `digest`：仓库近期工作汇总 | 已有 | 设置 → activity：选仓库和 7/14/30 天窗口，看动过的任务数和 routine 各状态的运行数 |
| A4 | `agent-turns`：每轮 token / 耗时 | 已有 | 设置 → activity：turns 总数、token（输入/输出/缓存）、耗时、按模型；最近 10 轮 |
| A5 | `set-model` / `set-effort` / `set-command` | 已有 | 菜单 → model & effort… / change engine…（`task.setModel` / `task.setEffort` / `task.setCommand`） |
| A6 | `ensure-worktree` / `remove-worktree` | 已有 | 菜单 → create worktree / remove worktree（后者二次确认，脏时再确认 force，保留任务和分支） |
| A7 | `schema`、`inspect`、`pty-list`、`engine-report`、`pane-*`、`prompt`、`dispatch`、`watch`、`set-active` | 不适用 | 给脚本、插件或已连接的 TUI 用的接口，没有人在手机上直接操作它们 |

## 进度

已有 95 / 需要做的 97（不含不适用 15 项）。剩下 2 项缺失都卡在没有公开接口，已提需：S2b shell tab（rove issue #120）、T16b tab 重排（rove issue #121）。
