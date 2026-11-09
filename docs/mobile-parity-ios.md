# Web 手机版 → iOS 对照

Web 手机版（`packages/rove-web`，390 宽）是功能和布局的参照，这份表记它和 iOS 原生 app（`packages/rove-ios`）的差距，由「rove · iOS 界面对齐」routine 每轮更新。另外两份对照的范围不同：[`packages/rove-ios/docs/PARITY.md`](../packages/rove-ios/docs/PARITY.md) 是 iOS ↔ TUI，[`web/PARITY.md`](web/PARITY.md) 是 web ↔ TUI。

上次盘点：2026-11-09，第 3 轮，main `722e4c851`。和第 2 轮基线 `0b3e93316` 比，web 和 bridge 新增了 Machines 总览、Usage 页、Context 面板、Chat（transcript）面板、笔记和 todo、stack 和 attempts 条、`.rove/run.sh`、diff 基线选择、定时启动、review queue、routine 运行日志筛选、语音输入，Files 面板加了文件预览。第 2 轮的五个 PR（#1655–#1659）都已合入。

怎么查的：`vite build` 产物由一个临时 shim 同时托管页面和 `/ws`（这轮 `vite dev` 白屏，见文末），shim 用 `fixture-bridge.ts` 的 `answer()` 回答、fixture 里没有的 op 回 `UNKNOWN_OP`，这样 web 和 iOS 看的是同一份数据。fixture 的任务行没有 `label`，web 显示空行，shim 要用 `title` 补上。agent-browser 用 `set device "iPhone 14"` 开到 390×844。需要 key row 和 composer 时用 CDP 打开触屏模拟（`Emulation.setTouchEmulationEnabled` 加 `setEmulatedMedia`）。op 差异用 web 和 iOS 源码里的 op 字符串对 `packages/rove-bridge/src/ops` 求差集。

## 页面和状态

「打开过」= 在 390 宽下实际打开。「只读源码」= fixture 到不了那个状态。第 3 轮打开了任务列表、行菜单、Inbox、New session、任务页的五个面板、Routines、Issues、Settings 分组和 Machines，其余沿用前两轮的结果。

| 页面 | 怎么进 | 主要状态 | 这轮 |
|---|---|---|---|
| 任务列表（rail） | 首页 | 项目分组、shell 行、`inbox N`、New task、Kanban、Routines、Issues、最近任务、Settings；Archived 折叠行；rail 上没有 Dispatch、Search | 打开过 |
| 行菜单 / 项目菜单 | 长按行 / 项目标题 | New conversation、New shell、Open in editor、Rename、Pin、Set status、Fix failing checks（检查失败时）、Land、Copy、More（Reorder、Change engine、Move to project、Sync with base、Rename branch）、Archive、Remove session；项目：New task、Reorder、Field notes、Remove | 打开过 |
| Inbox | `inbox N` | attention 列表、`[ ack all ]`、每行 `[ reply ]`、空态 | 打开过 |
| New session | New task | 项目、机器、Worktree、分支、Attach、引擎；`⋯` 里有 Later（定时启动）、Create without starting；可以开没有 git 的目录 | 打开过 |
| 任务页 · Terminal | 点行 | 无会话时 Start / New conversation；engine tab 有按住说话的消息栏和 key row；at menu 时 key row 以 1–4 开头；排队 chip；shell tab 没有 composer；退出的 tab 有 Reopen session | 打开过 |
| 任务页 · Context / Files / Diff / Browser | 顶部图标切换（Terminal 之外四个） | Context：上下文用量；Files：`[ commit ]`、`[ create PR ]`、文件内容预览；Diff：基线菜单、viewed、下一文件；Browser：地址栏 | 打开过；Context 的 op 不在 fixture 里，只看到报错态 |
| Routines | rail | 列表（NEEDS YOU / ACTIVE）、运行日志和筛选、新建 | 打开过列表 |
| Search | 命令面板（`ctrl+a /`） | 空态；有结果、未搜任务；截断 | 第 2 轮打开过；这轮 rail 上已没有入口 |
| Machines | 命令面板（`ctrl+a /`），注册过 machine 才有 | 状态、版本、未连接原因、任务、`[ new task here ]`、`[ repos ]` | 打开过 |
| Usage | 命令面板；手机上额度读数在 Settings 顶部 | 按天、模型、任务的 token 条 | Settings 顶部读数打开过，Usage 页只读源码 |
| Kanban / Issues | rail，装了 mod 才有 | 看板；issue 列表和 `[ PRs waiting on me ]`（review queue） | Issues 打开过，Kanban 只读源码 |
| Mods | rail，有 mod pane 才有 | mod 面板 | 只读源码 |
| Settings | rail 底部 | Preferences：General、Appearance、Notifications、Snippets、Keybindings；Agents and tools：Engines、Auto routing、Voice、Connectors、Plugins；More：About、Feedback、Dev | 打开过分组页 |
| Welcome / Update / Worktrees | 首次运行、更新、Settings | | 这轮没开 |

## 差距

状态：**缺**（有 bridge op，可以做）、**缺后端**（没有可用接口，不硬做）、**不做**（`packages/rove-ios/docs/PARITY.md` 已有决定）、**有 PR**。这轮之前已对齐的不列。

| 功能 | Web | Bridge | iOS 状态 |
|---|---|---|---|
| 菜单数字键、`tab.send` 和排队 chip、搜索所有对话、Routine 不进任务列表、归档、Sync with base | | | 已对齐（#1639、#1655–#1659） |
| Inbox：全部已阅、routine 条目可清 | `inbox-view.tsx`、`inbox-open.ts` | `attention.dismissRoutine` | **有 PR** [#1811](https://github.com/Sma1lboy/rove/pull/1811) |
| 行菜单 Fix checks、Land 前预检 | `fixChecksFlow`、`landFlow` | `task.fixChecks`、`task.landPreflight` | **有 PR** [#1812](https://github.com/Sma1lboy/rove/pull/1812) |
| 复活已退出的 tab | `terminal-view.tsx`、`term-notice.tsx` | `term.revive` | **有 PR** [#1813](https://github.com/Sma1lboy/rove/pull/1813)；shell 还活着但引擎退出（`restartExited`）没做 |
| Machines 总览 | `machines-dialog.tsx` | `machines.list` | **有 PR** [#1814](https://github.com/Sma1lboy/rove/pull/1814)；`[ new task here ]`、`[ repos ]` 没做 |
| 行上一个任务开的多个 PR | `pr-chip.tsx` | 行字段 `sessionPrs` | **缺** |
| Inbox 每行直接回复 | `inbox-peek.ts`、`inbox-peek.tsx` | `output.read`、`tab.send`、`term.input`、`gate.answer` | **缺** |
| 定时启动（New session 的 Later、行上的倒计时） | `new-session-later.tsx`、`schedule-start.ts` | `task.scheduleStart`、`task.cancelScheduledStart`、`task.startScheduledNow` | **缺** |
| CI 检查列表、失败日志、自动修复开关 | `checks-section.tsx`、`auto-fix-line.tsx` | `pr.checks`、`pr.checkLog`、`task.autoFixCi` | **缺** |
| 任务笔记和 todo | `task-todos.ts`、`note-composer.tsx` | 行字段 `notes`、`todos` | **缺** |
| Issues 页的 PRs waiting on me | `review-queue-view.tsx` | `review.queue` | **缺** |
| Files 的 `[ commit ]`、`[ create PR ]`、文件内容预览 | `files-view.tsx`、`preview-view.tsx` | `task.prompt`、`file.read` | **缺** |
| Context 面板 | `context-view.tsx` | `context.usage` | **缺** |
| Usage 页（按天、模型、任务） | `usage-page.tsx` | 这轮没查 op | **缺** |
| Chat（transcript）面板 | `transcript-view.tsx` | 这轮没查 op | **缺**；iOS 有历史页 `TaskHistoryView` |
| Attempts、Stack 条、Compare | `attempts-strip.tsx`、`stack-strip.tsx`、`compare-view.tsx` | `task.keep` 等 | **缺** |
| `.rove/run.sh` | `run-strip.tsx` | `run.start`、`run.status`、`run.stop` | **缺** |
| Diff 基线选择 | `diff-base-picker.tsx` | `diff.refs`、`diff.files` | **缺** |
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
| Keybindings、Dev 重置和重启、Update、Release notes | | `keybindings.*`、`dev.reset`、`daemon.restart`、`update.check`、`release.notes` | **不做**：G12–G14 |

iOS 领先的地方，不反向对齐：Inbox 的 `decision_needed`、`report_missing` 行（`docs/web/PARITY.md` 标 web 缺失）。

## 下一轮的顺序

1. 确认 #1811–#1814 的合入情况，把上表的「有 PR」改成已对齐。
2. 行上多个 PR、Inbox 直接回复、定时启动、CI 检查列表：后端都已就绪，每项只碰一两个页面。
3. 笔记和 todo、review queue、Files 的提交和 PR 入口。
4. Mods、Context、Usage：页面大，每个单开一轮。Machines 的 `[ new task here ]` 和 New task 的机器选择一起做。

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
- zsh 里 `grep --include=*.swift` 不加引号报 `no matches found`，要写 `--include='*.swift'`。
- 容器上的 `.accessibilityIdentifier` 会盖掉子按钮的 identifier，UI 测试找不到按钮。identifier 放到叶子节点上。
- 每轮最后把几个 PR 按顺序试合一次，再在合并结果上跑测试。这轮四个 PR 都把 UI 测试插在同一个函数前，字符串也有相邻 key，单独都绿，合起来冲突。新测试各插到不同的函数前；`Localizable.xcstrings` 按字母序排，相邻的新 key 也会冲突。
