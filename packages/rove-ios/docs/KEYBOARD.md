# 键盘状态覆盖

`Tests/RoveMobileUITests/KeyboardStateTests.swift`（断言什么）和 `KeyboardStateTests+Inputs.swift`（每个输入点在哪、怎么点到）逐个输入点断言软键盘弹出时界面是否正确。只截图不算数：每一格都是断言。

## 怎么跑

```sh
bun packages/rove-ios/scripts/fixture-bridge.ts          # 另开一个终端
cd packages/rove-ios && xcodegen generate
TEST_RUNNER_ROVE_FIXTURE_URL='ws://127.0.0.1:7896/?token=fixture' \
  xcodebuild -scheme RoveMobile -destination 'platform=iOS Simulator,name=iPhone 17 Pro Max' \
  test -only-testing:RoveMobileUITests/KeyboardStateTests
```

- demo 测试不需要任何环境变量。fixture 测试没有 `ROVE_FIXTURE_URL` 时跳过；CI（`.github/workflows/ios.yml`）会先起 fixture bridge 再跑。
- fixture bridge 记下收到的每个请求，`GET /log` 读回、`DELETE /log` 清空（同一个 bearer token）。`term.resize` 的行列数和 `term.input` 的字节都从这里断言。
- `ROVE_SHOT_DIR` 设了就把每个输入点键盘弹出时的整屏存下来。
- 模拟器要处在软键盘模式（默认）。连着硬件键盘时软键盘不弹，除硬件键盘那一项外全部会报 `no keyboard`。
- 从没启动过的模拟器要先完整启动一次再重启，之前它会忽略深浅色切换，深色那轮会看到浅色 app 并失败（`launch` 会报 `stayed in the other appearance`）。CI 用 `simctl bootstatus -b`、`shutdown`、再 `bootstatus -b` 做这一步。

## 每个输入点断言什么（`check`）

1. 点输入框（或走它的打开路径）后软键盘出现，焦点在这个输入框上（取 `hasKeyboardFocus` 的元素，必须落在输入框里）。
2. 输入框整块在键盘之上：`frame.maxY` ≤ 键盘背板上沿和 `done` 条上沿里较高的那个。键盘背板上沿从截图里找（XCUI 给的键盘 frame 从按键开始，背板比它高 15–17pt）。
3. 输入框能点到（`isHittable`），说明没被页头或别的视图盖住。
4. 键盘配色跟主题：取键盘底部一块像素的亮度，浅色主题 > 0.6，深色 < 0.35。
5. 屏幕上有 `keyboardDone`，点了以后键盘收起、焦点离开。
6. 收起后关键元素（页头、主按钮）的 `minY` 和高度与弹出前相差 ≤ 1pt。
7. 在 sheet 里：主按钮在键盘弹出时能滚到并点到，且在键盘之上，滚动过程中键盘不收起。

终端详情页另外断言（`assertTerminalBlock` / `terminalChecks`）：按键行紧贴回复框、回复框底边离键盘（或 `done` 条）≤ 2pt；esc / ctrl / ↑ / send 能点；终端区取样亮度 < 0.15（深浅主题都是深色）；终端变矮、bridge 收到行数更少的 `term.resize`、列数不变；收起后行数回到原值。

## 覆盖矩阵

图例：✅ 修复前就通过；已修 Fn = 修复前失败、修复后通过；跳过 Sn = 见下方原因；— = 不在这次的范围。横屏只测终端页和新建任务页。

修复前的结果来自浅色竖屏 demo 一轮（跑到 routine 编辑为止）、fixture 终端一轮（深浅各一次）和横屏 fixture 一轮。看板、issue、设置、文件页、diff 备注这几行修复前没跑到，按代码判断：它们所在的 sheet / 页面没有挂 Done。

输入点这张表：套件（也就是 CI）每次跑「竖屏浅色 demo」和「竖屏深色 fixture」两列，深浅主题、demo 和 fixture 各覆盖一次；「竖屏深色 demo」和「竖屏浅色 fixture」两列在这个 PR 的一次本地全量运行里也跑过并通过，之后从套件里拿掉，因为托管 runner 比本地慢约 2.5 倍，四轮 sweep 会超过时限。终端详情页那张表的六列每次都跑。修复后在 iPhone 17 Pro Max 和全新创建的 iPhone 17 Pro（CI 用的机型）上都跑过。

### 输入点

| 输入点 | 竖屏浅色 fixture | 竖屏深色 fixture | 竖屏浅色 demo | 竖屏深色 demo | 横屏浅色 fixture | 横屏浅色 demo |
| --- | --- | --- | --- | --- | --- | --- |
| 配对链接 | ✅ | ✅ | ✅ | ✅ | — | — |
| CF-Access-Client-Id | ✅ | ✅ | ✅ | ✅ | — | — |
| CF-Access-Client-Secret | ✅ | ✅ | ✅ | ✅ | — | — |
| 额外 header 名 / 值 | ✅ | ✅ | ✅ | ✅ | — | — |
| 任务列表搜索 | 已修 F2 | 已修 F2 | 已修 F2 | 已修 F2 | — | — |
| 新建任务：标题 | 已修 F2 | 已修 F2 | 已修 F2 | 已修 F2 | 已修 F2 | 已修 F2 |
| 新建任务：首个 prompt | 已修 F2 | 已修 F2 | 已修 F2 | 已修 F2 | 已修 F2 F4 | 已修 F2 F4 |
| 新建任务：分支 | 已修 F2 | 已修 F2 | 已修 F2 | 已修 F2 | 已修 F2 | 已修 F2 |
| 新建任务：clone URL / 父目录 / 文件夹名 | 已修 F2 | 已修 F2 | 已修 F2 | 已修 F2 | 已修 F2 | 已修 F2 |
| 新建任务：模型 | 跳过 S4 | 跳过 S4 | 跳过 S4 | 跳过 S4 | 跳过 S4 | 跳过 S4 |
| 任务改名 / 改分支 / 模型 | 已修 F1 | 已修 F1 | 已修 F1 | 已修 F1 | — | — |
| 终端 tab 改名 | 已修 F1 | 已修 F1 | 已修 F1 | 已修 F1 | — | — |
| 新会话首条消息 | 已修 F1 | 已修 F1 | 已修 F1 | 已修 F1 | — | — |
| 终端回复框 | 已修 F1 | 已修 F1 | 已修 F1 | 已修 F1 | 已修 F1 F3 | 已修 F1 F3 |
| 终端本身（SwiftTerm） | 已修 F2 | 已修 F2 | 已修 F2 | 已修 F2 | 已修 F2 F3 | 已修 F2 F3 |
| 终端工具：在历史里查找 | ✅ | ✅ | ✅ | ✅ | — | — |
| routine 新建：名字 / prompt / cron | 已修 F2 | 已修 F2 | 已修 F2 | 已修 F2 | — | — |
| routine 编辑：名字 / prompt / cron | 已修 F2 | 已修 F2 | 已修 F2 | 已修 F2 | — | — |
| 看板新故事：标题 / 正文 | 已修 F2 | 已修 F2 | 已修 F2 | 已修 F2 | — | — |
| issue（看板故事）标题 / 正文 | 已修 F2 | 已修 F2 | 已修 F2 | 已修 F2 | — | — |
| 设置 · 反馈：标题 | 已修 F2 F6 | 已修 F2 F6 | 已修 F2 F6 | 已修 F2 F6 | — | — |
| 设置 · 反馈：正文 | 已修 F2 | 已修 F2 | 已修 F2 | 已修 F2 | — | — |
| 设置 · 引擎显示名 | 已修 F2 | 已修 F2 | 已修 F2 | 已修 F2 | — | — |
| 文件页路径搜索 | 已修 F2 | 已修 F2 | 已修 F2 | 已修 F2 | — | — |
| diff 审阅备注 | 已修 F2 | 已修 F2 | 已修 F2 | 已修 F2 | — | — |

GitHub issues 页（`page-issues`）没有可编辑的文本框：点开 issue 是开任务的 sheet，issue 正文由 bridge 直接作为首条 prompt 发出。能编辑的 issue 正文在看板故事抽屉里（上表「issue（看板故事）」那一行）。

### 终端详情页

| 场景 | 竖屏浅色 fixture | 竖屏深色 fixture | 竖屏浅色 demo | 竖屏深色 demo | 横屏浅色 fixture | 横屏浅色 demo |
| --- | --- | --- | --- | --- | --- | --- |
| 按键行 + 回复框贴着键盘（≤ 2pt），esc / ctrl / ↑ / send 可点 | 已修 F1 | 已修 F1 | 已修 F1 | 已修 F1 | 已修 F1 F3 | 已修 F1 F3 |
| 终端变矮 | ✅ | ✅ | ✅ | ✅ | 已修 F3 | 已修 F3 |
| bridge 收到行数更少的 `term.resize`，列数不变 | ✅ | ✅ | 跳过 S3 | 跳过 S3 | 已修 F3 | 跳过 S3 |
| 收起后行数复原 | 已修 F2 | 已修 F2 | 跳过 S3 | 跳过 S3 | 已修 F2 | 跳过 S3 |
| 键盘弹出时打字 + send，bridge 收到 `ship it` 和回车 | ✅ | ✅ | 跳过 S3 | 跳过 S3 | ✅ | 跳过 S3 |
| 键盘弹出时按 esc 键，键盘不收起，bridge 收到 ESC | ✅ | ✅ | ✅（字节跳过 S3） | ✅（字节跳过 S3） | ✅ | ✅（字节跳过 S3） |
| 在终端里拖动翻历史，键盘不收起 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 在按键行 / 回复框上下拉，键盘收起 | 已修 F5 | 已修 F5 | 已修 F5 | 已修 F5 | 已修 F5 | 已修 F5 |
| 终端区常驻深色（亮度 < 0.15） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

### 外接硬件键盘

| 按键 | 连硬件键盘的模拟器（本地手动） | CI |
| --- | --- | --- |
| ctrl-c → `\x03` | ✅ | 跳过 S1 |
| ↑ → `ESC [A` | ✅ | 跳过 S1 |
| ⌘B 不把字母 b 送进终端 | ✅ | 跳过 S1 |
| esc → `ESC` | 跳过 S2 | 跳过 S1 |

## 修复

| | 问题 | 改法 |
| --- | --- | --- |
| F1 | SwiftUI 的 `.toolbar(placement: .keyboard)` 在 iOS 26 画成浮在内容上的玻璃胶囊，盖住终端的 send 和 sheet 的主按钮；它下面还留了约 15pt 空白 | 换成自己画的 `done` 条（`Shared/KeyboardDone.swift`）：作为底部 `safeAreaInset` 排在键盘正上方，内容排在它之上；键盘出现后把焦点输入框滚到条的上方，表单滚动区加上条的高度作为底部边距；键盘收起后，放得下的内容回到顶部 |
| F2 | 只有任务详情和配对页有 Done；任务列表搜索、所有 sheet、设置页、文件页都没有；SwiftTerm 拿到焦点时也没有 | `done` 条装在 `QuillSheetChrome`（只给最上层 sheet）、任务列表、配对页、`SettingsPage`、文件页；终端页的 `done` 放在按键行最右边。收键盘改用窗口 `endEditing(true)`：发给 nil 的 `resignFirstResponder` 放不开 SwiftTerm |
| F3 | 横屏键盘弹出后，页头、状态行、tab 行占满剩下的高度，终端只剩一条缝 | 竖向尺寸为 compact 且键盘弹出时，任务详情收起这三行（`TaskDetailView.typingInShortWindow`） |
| F4 | 横屏新建任务里，112pt 高的 prompt 编辑框被固定在底部的主按钮挤得看不见 | 同样条件下 `SheetScaffold` 收起标题行，主按钮放进滚动内容末尾（滚到就能点） |
| F5 | 终端页没有办法下拉收起键盘 | 按键行 + 回复框这一块向下拖超过 24pt 收起键盘；终端自己的拖动仍然只翻历史 |
| F6 | 空的 `FieldBox` 输入框第一次获得焦点时从 44pt 缩到 40.7pt，下面的内容整体上移 3.3pt，收起后不复原 | `FieldBox` 最小高度 44pt |

## 跳过的原因

| | 跳过什么 | 原因 |
| --- | --- | --- |
| S1 | CI 上的硬件键盘测试 | 模拟器默认不接硬件键盘。XCUITest 没法接上它；不接时 `typeKey` 走软键盘，发不出 ctrl 和 esc。测试检测到软键盘弹出就 `XCTSkip` 并写明原因 |
| S2 | 硬件 esc | 接了硬件键盘的模拟器上，XCUITest 敲的 Escape 不进 app：SwiftTerm 的 `pressesBegan` 收不到，加一个 `wantsPriorityOverSystemBehavior` 的 `inputEscape` 键命令也收不到。测试里用 `XCTExpectFailure` 记着，哪天能收到会自己报出来 |
| S3 | demo 下 bridge 收到的 resize 行数和输入字节 | demo 模式不发任何请求（`BridgeClient.fire` 在 demo 下直接丢掉），没有东西可读；界面那一半（终端变矮、按键行贴键盘）照常断言 |
| S4 | 新建任务的模型输入框 | 只在所选引擎带 `models` 时出现；fixture 和 demo 的 `engines.list` 都不带，任务详情里的「Model & effort…」sheet 覆盖了同一种输入框 |
