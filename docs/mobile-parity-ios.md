# Web 手机版 → iOS 对照

Web 手机版（`packages/rove-web`，390 宽）是功能和布局的参照，这份表记它和 iOS 原生 app（`packages/rove-ios`）的差距，由「rove · iOS 界面对齐」routine 每轮更新。另外两份对照的范围不同：[`packages/rove-ios/docs/PARITY.md`](../packages/rove-ios/docs/PARITY.md) 是 iOS ↔ TUI，[`web/PARITY.md`](web/PARITY.md) 是 web ↔ TUI。

上次盘点：2026-11-05，第 2 轮，main `0b3e93316`。和第 1 轮基线 `966978834` 比，web 和 bridge 只有两个提交（#1637 prefs 写入、#1649 主题配色），没有新页面和新 op。开着的 web PR 里，#1648（首次运行页）、#1650（去掉 Dispatch courier）、#1653（隐藏没有 tab 的 main 行）合入后要再对一次。

怎么查的：`vite dev` 把 `/ws` 代理到一个临时 shim，shim 用 `fixture-bridge.ts` 的 `answer()` 回答、fixture 里没有的 op 回 `UNKNOWN_OP`，这样 web 和 iOS 看的是同一份数据。agent-browser 用 `set device "iPhone 14"` 开到 390×844。需要 key row 和 composer 时用 CDP 打开触屏模拟（`Emulation.setTouchEmulationEnabled` 加 `setEmulatedMedia`）。op 差异用 web 和 iOS 源码里的 op 字符串对 `packages/rove-bridge/src/ops` 求差集。

## 页面和状态

「打开过」= 在 390 宽下实际打开。「只读源码」= fixture 到不了那个状态。第 2 轮打开了任务列表、行菜单、Search 结果态和 Archived 折叠行，其余沿用第 1 轮的结果。

| 页面 | 怎么进 | 主要状态 | 这轮 |
|---|---|---|---|
| 任务列表（rail） | 首页 | 项目分组、shell 行、`inbox N`、New task、Kanban、Routines、Issues、Dispatch、Search、Settings；Archived 折叠行 | 打开过 |
| 行菜单 / 项目菜单 | 长按行 / 项目标题 | New conversation、New shell、Open in editor、Rename、Pin、Reorder、Set status、Change engine、Sync with base、Rename branch、Land、Copy、Archive、Remove session；项目：New task、Reorder、Field notes、Remove | 打开过 |
| Inbox | `inbox N` | attention 列表、空态 | 打开过（空态） |
| New session | New task | 项目、机器、Worktree、分支、Attach、引擎、Clone or adopt、Create without starting | 打开过 |
| 任务页 · Terminal | 点行 | 无会话时 Start / New conversation；engine tab 有 composer 和 key row；at menu 时 key row 以 1–4 开头；排队 chip；shell tab 没有 composer | 打开过 |
| 任务页 · Files / Diff / Browser | 顶部切换 | All / Changes、空 worktree、Ask agent to create PR | Files 打开过；Diff、Browser 只看到入口 |
| Routines | rail | 无 routine 的空态、新建 | 打开过（空态） |
| Dispatch | rail | 谁把 prompt 交给谁的图、空闲态 | 打开过（空闲态） |
| Search | rail | 空态；有结果、未搜任务；截断 | 打开过；截断只读源码 |
| Machines | rail，注册过 machine 才有 | 状态、版本、任务数、未连接原因 | 只读源码 |
| Kanban / Issues | rail，装了 mod 才有 | 看板、issue 列表 | 只读源码 |
| Mods | rail，有 mod pane 才有 | mod 面板 | 只读源码 |
| Settings | rail 底部 | General（语言、主题库、外观）、Engines、Connectors、Auto routing、Plugins、Keybindings、Feedback、Dev | 打开过 |
| Welcome / Update / Worktrees | 首次运行、更新、Settings | | 这轮没开 |

## 差距

状态：**缺**（有 bridge op，可以做）、**缺后端**（没有可用接口，不硬做）、**不做**（`packages/rove-ios/docs/PARITY.md` 已有决定）、**有 PR**。这轮之前已对齐的不列。

| 功能 | Web | Bridge | iOS 状态 |
|---|---|---|---|
| 菜单数字键：at menu 时 key row 以 1–4、Enter 开头 | `term-key-row.tsx` | `term.input` | 已对齐（#1639） |
| Composer 走 `tab.send`，忙时排到 turn 结束；排队 chip | `term-composer.tsx`、`term-queue.tsx` | `tab.send`、`queue.list`、`queue.cancel` | **有 PR** [#1659](https://github.com/Sma1lboy/rove/pull/1659) |
| 搜索所有对话 | `palette-search.tsx`、`search-hits.ts` | `sessions.search` | **有 PR** [#1656](https://github.com/Sma1lboy/rove/pull/1656) |
| Routine 的任务不进任务列表 | `rail.ts` 按 `routine` 过滤 | 行字段 `routine` | **有 PR** [#1655](https://github.com/Sma1lboy/rove/pull/1655) |
| 归档 / 取消归档，Archived 折叠行 | `archiveFlow`、`rail-archived.ts` | `task.archive`，`TasksPayload.archived` | **有 PR** [#1657](https://github.com/Sma1lboy/rove/pull/1657) |
| 行菜单 Sync with base | `syncBaseFlow` | `task.syncBase` | **有 PR** [#1658](https://github.com/Sma1lboy/rove/pull/1658) |
| 行菜单 Fix checks（检查失败时出现） | `fixChecksFlow` | `task.fixChecks` | **缺** |
| 行上一个任务开的多个 PR | `pr-chip.tsx` | 行字段 `sessionPrs` | **缺** |
| 复活已退出的 tab | `terminal-view.tsx` | `term.revive` | **缺** |
| Land 前预检 | `landFlow` | `task.landPreflight` | **缺** |
| 清掉 routine 的 Inbox 项 | `inbox-view.tsx` | `attention.dismissRoutine` | **缺** |
| 在别的机器上新建 / clone | `new-session-machine.tsx` | `task.spawn` 的 `machine`、`clone` | **缺**，依赖 Machines |
| Mods 页 | `mods-view.tsx` | `mods` 推送、`mod.press`、`mod.submit` | **缺** |
| 从 GitHub 账号选仓库 clone | `new-session-repo-menu.tsx` | `github.repos` | **缺** |
| Settings → Connectors（GitHub 登录、同步） | `settings-connectors.tsx` | `github.status/login/logout/sync` | **缺** |
| Settings → Engines 安装 Rove skill | `settings-engines.tsx` | `skill.missing`、`skill.install` | **缺** |
| Settings → Auto routing | `settings-routing.tsx` | 这轮没查 | 待查：web 上分类器的三个字段写着 edit it in the TUI |
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

1. 确认这轮的 PR 合入情况，把上表的「有 PR」改成已对齐。
2. Fix checks、Land 前预检、复活已退出的 tab、Inbox 清 routine 项、行上多个 PR：改动小，后端都已就绪。Fix checks 要在 fixture 里加一个 `checkState: failing` 的行，且这个文件也画 Android 的金图，见下。
3. Machines、Dispatch、Mods：页面大，每个单开一轮。Dispatch 等 #1650 定下来再做。

## 验证手法里的坑

- `scripts/fixture-bridge.ts` 启动时读 `demo-fixture.json`，改完要重启，否则新 op 答 `{}`。
- iPhone 17e 是 390pt 宽，和 web 的 390 同尺寸。
- agent-browser 要先 `open` 再 `set viewport`，新开的浏览器顺序反了会掉回桌面宽度。
- 机器负载高时 `rove-bridge` 的 `POST /login` 测试会超过 5 秒限时，`bun test --timeout 60000 test/web-login.test.ts` 能过。
- `demo-fixture.json` 里 `tasks.subscribe` 的行也画 Android 的 `ScreenshotsTest.demoTasks` 金图，加行会让 Android 的 `verify` 变红，要连 Android 的金图一起改。只给 iOS 测试用的行放 `fixture-bridge.ts` 里更省事。其他 op 可以随便加。
- 红掉的 `[routine]` PR 会被自动派一个 `pr #N fix` task 去修，它检出同名分支。`git checkout` 报 `already used by worktree` 时分支已经归它，别再 push；连用 `;` 的命令会接着在原分支上执行，切分支前先确认切成功了。
- `set viewport` 和 `set device` 对已有页面的 hash 跳转不重载，改了 `rove.prefs` 这类缓存要 `location.reload()`。
- `KeyboardStateTests/testLandscapeDemo` 在 iPhone 17e 上连干净的 main 都不过（新建任务页的 prompt 被键盘盖住，181.99 > 142.5）。暗色那两个测试要把模拟器外观切成 dark 才有意义，CI 也跳过它们。新建的模拟器要先按 `ios.yml` 关掉硬件键盘标记，否则报 `no keyboard`。
