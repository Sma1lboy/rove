# Web 手机版 → iOS 对照

Web 手机版（`packages/rove-web`，390 宽）是功能和布局的参照，这份表记它和 iOS 原生 app（`packages/rove-ios`）的差距，由「rove · iOS 界面对齐」routine 每轮更新。另外两份对照的范围不同：[`packages/rove-ios/docs/PARITY.md`](../packages/rove-ios/docs/PARITY.md) 是 iOS ↔ TUI，[`web/PARITY.md`](web/PARITY.md) 是 web ↔ TUI。

上次盘点：2026-11-16，第 5 轮，main `b2a443261`。第 4 轮（11-12）开了 worktree 但没提交任何东西，所以这轮直接和第 3 轮基线 `722e4c851` 比：web 新增了行首引擎标记（颜色表示任务状态）、行尾 PR 图标带数量、行上的插件标签（`row-token --keep`）、Sessions 页（按项目列活跃和归档会话）、项目的 main 会话可归档、New session 的机器选择（含 Auto）和 `⋯` 里的「agent 在哪跑」、GitHub 仓库多选 clone、Update 页、Usage 页改版、手机上右滑返回、按住说话的输入条、Files 行的右键菜单、Browser 标注截图。第 3 轮的四个 PR（#1811–#1814）都已合入。

怎么查的：`vite build` 产物由一个临时 shim 同时托管页面和 `/ws`（这轮 `vite dev` 白屏，见文末），shim 用 `fixture-bridge.ts` 的 `answer()` 回答、fixture 里没有的 op 回 `UNKNOWN_OP`，这样 web 和 iOS 看的是同一份数据。fixture 的任务行没有 `label`，web 显示空行，shim 要用 `title` 补上。agent-browser 用 `set device "iPhone 14"` 开到 390×844。需要 key row 和 composer 时用 CDP 打开触屏模拟（`Emulation.setTouchEmulationEnabled` 加 `setEmulatedMedia`）。op 差异用 web 和 iOS 源码里的 op 字符串对 `packages/rove-bridge/src/ops` 求差集。

## 页面和状态

「打开过」= 在 390 宽下实际打开。「只读源码」= fixture 到不了那个状态。第 5 轮打开了任务列表、Inbox（含 reply 展开）、任务页的 Files 面板，其余沿用前几轮的结果。

| 页面 | 怎么进 | 主要状态 | 这轮 |
|---|---|---|---|
| 任务列表（rail） | 首页 | 项目分组、shell 行、`inbox N`、New task、Kanban、Routines、Issues、Sessions、Settings；行首引擎标记，行尾定时启动时间（◷）、PR 图标（多个 PR 带数字）、插件标签；归档任务不在列表里；rail 上没有 Dispatch、Search | 打开过 |
| 行菜单 / 项目菜单 | 长按行 / 项目标题 | New conversation、New shell、Open in editor、Rename、Pin、Set status、Fix failing checks（检查失败时）、Land、Copy、More（Reorder、Change engine、Move to project、Sync with base、Rename branch）、Archive、Remove session；项目：New task、Reorder、Field notes、Remove | 打开过 |
| Inbox | `inbox N` | attention 列表、`[ ack all ]`、每行 `[ reply ]`（终端末 12 行 + 回复框；权限菜单时是按键；决策是选项）、空态 | 打开过 |
| New session | New task | 项目、机器、Worktree、分支、Attach、引擎；`⋯` 里有 Later（定时启动）；没有首条提示词不能建任务；可以开没有 git 的目录 | 打开过 |
| 任务页 · Terminal | 点行 | 无会话时 Start / New conversation；engine tab 有按住说话的消息栏和 key row；at menu 时 key row 以 1–4 开头；排队 chip；shell tab 没有 composer；退出的 tab 有 Reopen session | 打开过 |
| 任务页 · Context / Files / Diff / Browser | 顶部图标切换（Terminal 之外四个） | Context：上下文用量；Files：`[ commit ]`、`[ fix CI ]`、CI 检查列表和失败日志、`[ auto-fix CI ]`、文件内容预览；Diff：基线菜单、viewed、下一文件；Browser：地址栏 | 打开过；Context 的 op 不在 fixture 里，只看到报错态 |
| Sessions | rail、项目标题 | 一个项目或全部项目的 Active / Archived 两栏；长按行是行菜单（Unarchive、Remove） | 只读源码 |
| Routines | rail | 列表（NEEDS YOU / ACTIVE）、运行日志和筛选、新建 | 打开过列表 |
| Dispatch | rail | 谁把 prompt 交给谁的图、空闲态 | 打开过（空闲态） |
| Search | rail | 空态；有结果、未搜任务；截断 | 打开过；截断只读源码 |
| Machines | 命令面板（`ctrl+a /`），注册过 machine 才有 | 状态、版本、未连接原因、任务、`[ new task here ]`、`[ repos ]` | 打开过 |
| Usage | 命令面板；手机上额度读数在 Settings 顶部 | 按天、模型、任务的 token 条 | Settings 顶部读数打开过，Usage 页只读源码 |
| Kanban / Issues | rail，装了 mod 才有 | 看板；issue 列表和 `[ PRs waiting on me ]`（review queue） | Issues 打开过，Kanban 只读源码 |
| Mods | rail，有 mod pane 才有 | mod 面板 | 只读源码 |
| Settings | rail 底部 | Preferences：General、Appearance、Notifications、Snippets、Keybindings；Agents and tools：Engines、Auto routing、Voice、Connectors、Plugins；More：About、Feedback、Dev | 打开过分组页 |
| Update | 更新提示、About | 发行说明、Update now、装完重启 | 只读源码 |
| Welcome / Worktrees | 首次运行、Settings | | 这轮没开 |

## 差距

状态：**缺**（有 bridge op，可以做）、**缺后端**（没有可用接口，不硬做）、**不做**（`packages/rove-ios/docs/PARITY.md` 已有决定）、**有 PR**。这轮之前已对齐的不列。

| 功能 | Web | Bridge | iOS 状态 |
|---|---|---|---|
| 菜单数字键、`tab.send` 和排队 chip、搜索所有对话、Routine 不进任务列表、归档、Sync with base | | | 已对齐（#1639、#1655–#1659） |
| Inbox：全部已阅、routine 条目可清 | `inbox-view.tsx`、`inbox-open.ts` | `attention.dismissRoutine` | 已对齐 [#1811](https://github.com/Sma1lboy/rove/pull/1811) |
| 行菜单 Fix checks、Land 前预检 | `fixChecksFlow`、`landFlow` | `task.fixChecks`、`task.landPreflight` | 已对齐 [#1812](https://github.com/Sma1lboy/rove/pull/1812) |
| 复活已退出的 tab | `terminal-view.tsx`、`term-notice.tsx` | `term.revive` | 已对齐 [#1813](https://github.com/Sma1lboy/rove/pull/1813)；shell 还活着但引擎退出（`restartExited`）没做 |
| Machines 总览 | `machines-dialog.tsx` | `machines.list` | 已对齐 [#1814](https://github.com/Sma1lboy/rove/pull/1814)；`[ new task here ]`、`[ repos ]` 没做 |
| 行上一个任务开的多个 PR | `pr-chip.tsx` | 行字段 `sessionPrs` | **有 PR** [#2091](https://github.com/Sma1lboy/rove/pull/2091)：PR 标签后 `+N`，行菜单每个 PR 一项 Open PR |
| Inbox 每行直接回复 | `inbox-peek.tsx`、`inbox-view.tsx` | `output.read`、`tab.send`、`term.input` | **有 PR** [#2092](https://github.com/Sma1lboy/rove/pull/2092)；决策仍走原来的 gate sheet |
| 定时启动：行上的时间、Start now、Cancel | `starts-chip.tsx`、`row-actions.tsx` | 行字段 `startsAt`、`task.startScheduledNow`、`task.cancelScheduledStart` | **有 PR** [#2091](https://github.com/Sma1lboy/rove/pull/2091) |
| 定时启动：New session 的 Later | `new-session-later.tsx`、`schedule-start.ts` | `task.scheduleStart` | **缺** |
| CI 检查列表、失败日志 | `checks-section.tsx` | `pr.checks`、`pr.checkLog` | **有 PR** [#2093](https://github.com/Sma1lboy/rove/pull/2093)；每项后面的「· N 前」没做 |
| CI 自动修复开关 | `auto-fix-line.tsx` | 行字段 `autoFixCi`、`task.autoFixCi` | **缺** |
| 任务笔记和 todo | `task-todos.ts`、`note-composer.tsx` | 行字段 `notes`、`todos` | **缺** |
| Issues 页的 PRs waiting on me | `review-queue-view.tsx` | `review.queue` | **缺** |
| Files 的 `[ commit ]`、`[ create PR ]`、文件内容预览 | `files-view.tsx`、`preview-view.tsx` | `task.prompt`、`file.read` | **缺** |
| Context 面板 | `context-view.tsx` | `context.usage` | **缺** |
| Usage 页（按天、模型、任务） | `usage-page.tsx` | 这轮没查 op | **缺** |
| Chat（transcript）面板 | `transcript-view.tsx` | 这轮没查 op | **缺**；iOS 有历史页 `TaskHistoryView` |
| Attempts、Stack 条、Compare | `attempts-strip.tsx`、`stack-strip.tsx`、`compare-view.tsx` | `task.keep` 等 | **缺** |
| 打开 task 监听的端口 | `ports-strip.tsx` | `browser.ports` | **缺** |
| Diff 基线选择 | `diff-base-picker.tsx` | `diff.refs`、`diff.files` | **缺** |
| 行首引擎标记（状态色、Appearance 可换回圆点） | `ui/engine-icon.tsx`、`status-mark.ts` | `engines.list` 的 `icon`（SVG path） | **缺**：SwiftUI 没有现成的 SVG path 解析，要写一个小 parser 或换成 bridge 发图片 |
| Sessions 页 | `sessions-view.tsx`、`sessions-data.ts` | 只用 `tasks.subscribe` 的 `archived` | 大体已对齐：iOS 列表底部有 Archived 折叠行，行菜单有 Unarchive；没有按项目的独立页 |
| main 会话归档 | `row-actions.tsx` | `task.archive` | **有 PR** [#2091](https://github.com/Sma1lboy/rove/pull/2091) |
| New session 机器选择（Auto）、「agent 在哪跑」 | `new-session-machine.tsx`、`new-session-more.tsx` | `task.spawn` 的 `machine` 等 | **缺**，和下面「在别的机器上新建」一起做 |
| Files 行的长按菜单 | `files-view.tsx` | 已有 op | **缺** |
| Snippets | `settings-snippets.tsx`、`snippet-suggest.tsx` | `snippets.*` | **缺** |
| 语音输入（按住说话、Settings › Voice） | `term-dictation.ts`、`voice/` | `voice.*` | **不做**：iOS 用系统听写 |
| 在别的机器上新建 / clone | `new-session-machine.tsx` | `task.spawn` 的 `machine`、`clone` | **缺**，依赖 Machines |
| Mods 页 | `mods-view.tsx` | `mods` 推送、`mod.press`、`mod.submit` | **缺** |
| 从 GitHub 账号选仓库 clone | `new-session-repo-menu.tsx` | `github.repos` | **缺** |
| Settings → Connectors（GitHub 登录、同步） | `settings-connectors.tsx` | `github.status/login/logout/sync` | **缺** |
| Settings → Engines 安装 Rove skill | `settings-engines.tsx` | `skill.missing`、`skill.install` | **缺** |
| Settings → Auto routing | `settings-routing.tsx` | `autoRouting.get`、`autoRouting.setClassifier`、`autoRouting.setTier` | **缺** |
| 首次运行 Welcome、一键开始 | `welcome-view.tsx` | `welcome.env` | **缺**；iOS 有引擎面板（T25） |
| Scratch 会话 | `task.openScratch` | `task.openScratch` | **缺** |
| 方向键跟随 DECCKM（应用光标模式发 `ESC O x`） | `term-keys.ts` | 无 | **缺**：iOS 的 `KeyMapper` 固定发 `ESC [ x` |
| 关页面后的推送通知 | `web-push.ts` | `push.*` 是 Web Push | **缺后端**：bridge 没有 APNs 通道，iOS 只有本地通知（I7） |
| 主题库、任务配色 | `settings-theme-gallery.tsx` | `theme.*`、`prefs.*` | **不做**：G1、G11 决定跟系统外观 |
| Browser 面板 | `browser-view.tsx` | `browser.probe` | 待定：它开的多是 Mac 的 localhost，手机到不了，需要先确认用途 |
| 分屏 | `split-view.tsx` | `tab.split` | **不做**：S11 |
| 编辑器打开、系统应用打开 | | `task.openEditor`、`file.openExternal` | **不做**：T24、F8 |
| 右滑返回、按住说话的输入条 | | | 不用做：iOS 原生导航自带返回手势；输入条见上面语音那行 |
| Keybindings、Dev 重置和重启、Update、Release notes | | `keybindings.*`、`dev.reset`、`daemon.restart`、`update.check`、`release.notes` | **不做**：G12–G14 |

iOS 领先的地方，不反向对齐：Inbox 的 `decision_needed`、`report_missing` 行（`docs/web/PARITY.md` 标 web 缺失）。

## 下一轮的顺序

1. #2091–#2093 合入后把三行改成已对齐。
2. 自动修复开关（`autoFixCi` 行字段 + 检查列表下面一行）、New session 的 Later、引擎标记。
3. 笔记和 todo、review queue、Files 的提交和 PR 入口、Files 行长按菜单。
4. Mods、Context、Usage：页面大，每个单开一轮。Machines 的 `[ new task here ]`、New task 的机器选择（含 Auto）一起做。

## 验证手法里的坑

- `scripts/fixture-bridge.ts` 启动时读 `demo-fixture.json`，改完要重启，否则新 op 答 `{}`。
- iPhone 17e 是 390pt 宽，和 web 的 390 同尺寸。
- agent-browser 要先 `open` 再 `set viewport`，新开的浏览器顺序反了会掉回桌面宽度。
- 机器负载高时 `rove-bridge` 的 `POST /login` 测试会超过 5 秒限时，`bun test --timeout 60000 test/web-login.test.ts` 能过。
- `demo-fixture.json` 里 `tasks.subscribe` 的行也画 Android 的 `ScreenshotsTest.demoTasks` 金图，加行会让 Android 的 `verify` 变红，要连 Android 的金图一起改。只给 iOS 测试用的行放 `fixture-bridge.ts` 里更省事。其他 op 可以随便加。
- 红掉的 `[routine]` PR 会被自动派一个 `pr #N fix` task 去修，它检出同名分支。`git checkout` 报 `already used by worktree` 时分支已经归它，别再 push；连用 `;` 的命令会接着在原分支上执行，切分支前先确认切成功了。
- `set viewport` 和 `set device` 对已有页面的 hash 跳转不重载，改了 `rove.prefs` 这类缓存要 `location.reload()`。
- `KeyboardStateTests/testLandscapeDemo` 在 iPhone 17e 上连干净的 main 都不过（新建任务页的 prompt 被键盘盖住，181.99 > 142.5）。暗色那两个测试要把模拟器外观切成 dark 才有意义，CI 也跳过它们。新建的模拟器要先按 `ios.yml` 关掉硬件键盘标记，否则报 `no keyboard`。
- `rove-web` 的 `vite dev` 这轮白屏：`rove-daemon/src/daemon/pre-rename-runtime.ts` 的 `node:path` 进了 client 依赖图。`vite build` 不受影响，用产物验证。
- `:7896` 常被别的 worktree 的 `fixture-bridge.ts` 占着，它答的是那个 checkout 的 fixture。这轮复制了一份监听 `:7898`，`TEST_RUNNER_ROVE_FIXTURE_URL` 指过去。
- 重开 agent-browser 后 `localStorage` 是空的，同路径的 `#token=` 不会重新加载，要 `localStorage.setItem("rove.bridge.token", ...)` 再 `location.reload()`。截图前先确认页面上有目标文字：这轮第一次把 Settings 当成 Inbox 拍了进去。
- `ROVE_SHOT_DIR` 里上一次留下的 `<name>.done` 会让 `checkpoint` 直接放行，截到的是测试结束后的桌面。重跑前清掉自己目录里的旧 `.done`。
- `pkill -f fixture-bridge.ts` 会连发出它的 shell 命令一起杀掉（命令行里也有这个字符串），按 `lsof -ti :7896` 的 pid 杀。
- 第 4 轮留下了 `bobcat`、`tamarin`、`treefrog`、`elephant` 四个 worktree（`ios/inbox-reply`、`ios/pr-checks`、`ios/later-start`、`ios/parity-inventory-r4`），没有提交，只有 elephant 里有一份没提交的盘点改动。分支名被占，这轮换了新名字。
- zsh 里 `grep --include=*.swift` 不加引号报 `no matches found`，要写 `--include='*.swift'`。
- 容器上的 `.accessibilityIdentifier` 会盖掉子按钮的 identifier，UI 测试找不到按钮。identifier 放到叶子节点上。
