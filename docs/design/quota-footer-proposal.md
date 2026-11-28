# Proposal: 多引擎底栏 Quota / 余额展示 UI 方案

- **关联 Issue**：#2389
- **阶段范围**：纯 UI 设计方案（不改后端采集、不改引擎适配器、不改产品代码）
- **覆盖端**：TUI（`@opentui/react`）+ `rove-web` / `rove-desktop`（两者共用同一套 web UI，仅桌面端复用宿主窗口）+ 移动端窄屏（`< 560px`）

---

## 1. 现状核查与前提澄清

在出方案前，先对齐代码库当前已经具备的能力与既有设计决策，避免重复建设或无意回退已有约定：

### 1.1 已有的数据与契约（Engine-owned UI data 已就位）

| 层级 | 现状与代码位置 | 对本提案的约束 |
|---|---|---|
| **中性契约** | `EngineQuotaUsage` / `EngineQuotaWindow`（`packages/rove-daemon/src/daemon/contracts.ts`，经 `packages/rove-core/src/types/engine.ts` 导出）：`{ capturedAt, windows: [{ kind, label, percent, resetsAt }] }` | UI 层只消费 `vendor`、`name`（来自 `engineDisplayName` / `engines.list`）与 `windows[]`，绝不硬编码任何引擎名或周期文案 |
| **已接入采集的引擎** | `packages/rove-core/src/engine/builtin-engines.ts` 中 **Claude**（OAuth usage 接口，返回 `5h` / `7d` / 模型 scoped 窗口）与 **Codex**（读取 rollout JSONL `rate_limits.primary/secondary`，自动过滤已过期窗口）已实现 `quotaUsage`。其余内置/自定义引擎当前未声明 `quotaUsage` | 无快照的引擎静默省略，**绝不显示 `0%`**；未来任何新引擎补齐 `quotaUsage` 后应零改动自动出现在 UI 中 |
| **缓存与推送** | Daemon `QuotaUsageCache`（`packages/rove-daemon/src/daemon/quota-usage-cache.ts`）统一控频（15 分钟刷新 / 60s 最小间隔 / 失败退避），经 `usage.snapshot` 推送；Bridge `UsageStore` 通过 `usage.get` 暴露 `{ usage: [{ vendor, name, capturedAt, windows }] \| null, context }` | 前端只读缓存快照，不触发采集；`usage === null` 表示尚未收到首帧，不可渲染为空状态或 `0%` |
| **共享视图模型** | `packages/rove-core/src/lib/usage-core.ts` 已提供 `usageRows`、`narrowUsageChip`、`contextChip`、`formatReset`、`usageChipsBudget` 与早期留存的 `buildFooterChips`；`usage-data.ts` 提供 `runway(window, now)` 节奏估算；`usage.show`（`used` \| `left`）定义于 `packages/rove-core/src/state/usage-show.ts` | 方案尽量复用 `usage-core.ts` 与 `usage-data.ts`。注意两处既有小缺口：<br>1. **单窗局限**：`narrowUsageChip` 仅取 `kind === "session"` 或 `windows[0]`，且 Claude 用 `session`/`weekly_all`，Codex 用 `primary`/`secondary`，尚未统一双窗提取规则。<br>2. **双端偏好缺口**：TUI 的 `SidebarUsageLines` / `WorkspaceFrame` 已遵循 `usage.show`（已用/剩余），但 `rove-web` 的 `UsageChips` 与 `UsageView` 目前仍默认按 `"used"` 渲染，落地时应一并补齐 |

### 1.2 与既有“静默底栏（quiet chrome）”决策的张力

Issue #2389 提出在窗口底栏直观看 `Session % | Weekly %`，但当前两端的布局已经历过一轮收敛：

- **`rove-web` / `rove-desktop`**：#1624 主动移除了常驻底栏，`StatusBar`（`packages/rove-web/src/status-bar.tsx`）现在**仅在断连或重连时出现**；#1758 将配额放进**左侧栏底部**（`rail-foot.tsx` → `UsageChips`），每引擎一行：`Claude ━━━━━━━ 5h 42%`。移动端（`< 560px`）则收进 Settings 列表底部的卡片。
- **TUI**：#2162 与 web 对齐，将配额移出 `WorkspaceFrame` 底栏（`host-footer.tsx`，由 `workspace-usage-footer.test.tsx` 锁定）并迁入 `SidebarUsageLines`。但 TUI 的 1 行底栏**依然常驻**，目前左侧仅画当前会话的 `ctx 62%`，右侧画 `⌃A commands · F1 help`，中间长期留白。

因此，当前真正让多会话并发体验受阻的不是“没有配额展示”，而是四个具体缺口：

1. **只能看到单窗**：侧栏底部受 220–280px 宽度限制，只显示 `5h`（或首个窗口），看不到 `Weekly (7d)` 消耗，周额度快满时缺乏预警。
2. **折叠侧栏即失明**：并发干活时折叠侧栏（`railFolded` / TUI 折叠）以换取终端宽度，配额随侧栏一起消失。
3. **未聚焦当前会话的引擎**：侧栏底部按字母序平铺所有引擎，视线要先扫一遍才能确认“当前聚焦 tab 所用引擎还剩多少”。
4. **缺少不离屏的详情核对**：web 点击配额行直接整页切去 `UsageView`（打断终端上下文），TUI 侧栏行则完全不可交互（看重置时间和全部窗口要打开 Settings → General）。

下面三套方案刻意在**常驻视觉成本（与 quiet chrome 的取舍）**、**默认信息密度**和**多引擎展开方式**上拉开梯度，供拍板选择。

---

## 2. 共同设计原则（三套方案共同遵守）

- **Engine-owned UI data**：引擎名、窗口标签（`5h` / `7d` / 模型名）、窗口顺序均来自引擎适配器快照，中性 UI 不写死任何厂商字符串或周期换算。
- **语义色与双编码**：沿用 `usage-core.ts` 阈值（`< 75%` `ok`、`75–94%` `warn`、`≥ 95%` `crit`）。健康态保持低噪（web 数字 `--muted`、条 `--success`），仅 `warn` / `crit` 用 `--warning` / `--error` 提权；色弱或单色终端下叠加 `!`（crit）或刻度填充比，不只靠颜色传义。数值跟随 `usage.show`（`used` / `left`），但告警阈值始终以已用比例为准。
- **只用既有 Token 与控件原语**：
  - Web / Desktop：仅用 `packages/rove-web/src/tailwind.css` 既有 token（`--surface`、`--paper`、`--inset`、`--line`、`--ink`、`--muted`、`--subtle`、`--success`、`--warning`、`--error`、`--shadow-popover`），等宽 `--mono` + `tabular-nums`，`--fs-meta (12px)`；不做光晕、渐变、侧边彩条（side stripe）或非浮层阴影；复用 `src/ui/` 组件。
  - TUI：Yoga flex，纯 `theme.*` 色彩，仅用 Latin/通用盒绘字符（`━`、`·`、`│`、`█`、`░`），避免特殊 Unicode 符号在不同 OS 终端回退错位。
- **不新增未签字全局快捷键**：键盘可达性先通过点击、Tab Focus + Enter 与命令面板提供；若需新增全局/前缀键，单列为 `PROPOSED` 待签字后写入 `docs/KEYBINDINGS.md` 与 `docs/design/keybinding-decisions.md`。
- **零假数据与防抖动**：`usage === null` 不占位、不闪 `0%`；当前 tab 引擎无 `quotaUsage` 时不伪造 `0%`；刷新保持上次读数，不引起 layout shift。

---

## 3. 三套 UI 方案

### 方案 A：极简数字胶囊（Minimal Numeric Capsule）

**核心思路**：只用纯等宽数字表达“当前会话引擎的 Session | Weekly”，不画进度条、不加 Popover，追求最低视觉干扰。点击整枚胶囊直达 Usage 页（TUI 打开 Settings → General）。

- **落位**：
  - **TUI**：直接复用 `host-footer.tsx` 既有 1 行底栏（零新增高度），紧跟在 `ctx 62%` 右侧。
  - **Web / Desktop**：在窗口最底部恢复一条 24px 静默细底栏（复用 `StatusBar` 同一行位：断连时左侧展示连接状态，正常时显示配额胶囊），同时移除侧栏底部的 `UsageChips` 避免双份重复。
- **展示结构**：
  - 仅展示**当前活跃会话所属引擎**的主/次两个窗口：`Claude  5h 42% │ 7d 18%`。
  - 其他引擎若也有快照，尾部跟静默计数 `+1`（若被折叠的引擎处于 `warn` / `crit`，`+1` 染对应告警色并附 `!`）。
  - 鼠标悬停仅给出原生 `title` 摘要（全部引擎 + reset 时间），无自绘浮层。

#### 线框稿（方案 A）

```text
[TUI — 100 cols 宽屏，复用现有 host-footer 1 行，零新增行高]
┌──────────────────────┬───────────────────────────────────────────────────────────────────────┐
│ [ rove ]             │  tab-1 · claude                                                Files  │
│                      │  > running tests...                                                   │
│  rove                │                                                                       │
│   ● quota proposal   │                                                                       │
│   ○ fix retry        │                                                                       │
│                      │                                                                       │
│  Settings         ‹‹ │                                                                       │
└──────────────────────┴───────────────────────────────────────────────────────────────────────┘
 ctx 62%   Claude 5h 42% │ 7d 18%  +1                                     ⌃A commands · F1 help

[rove-web / rove-desktop — 1440px，24px 静默底栏，右侧栏底部不再重复画 UsageChips]
+--------------------+-------------------------------------------------------------------------+
| [ rove ]  INBOX 0  |  1 quota proposal                                     [Files] [Context] |
|                    |                                                                         |
|  rove              |  $ _                                                                    |
|   quota proposal   |                                                                         |
|   fix retry        |                                                                         |
|                    |                                                                         |
|  [gear] Settings   |                                                                         |
+--------------------+-------------------------------------------------------------------------+
|  (Claude  5h 42% │ 7d 18%  +1)                                                               |
+----------------------------------------------------------------------------------------------+
   ↑ 胶囊：bg-inset / border-hairline border-line / rounded-xs / px-2 / text-meta font-mono
     正常态全 --muted，仅 75%+ 数字染 --warning，95%+ 染 --error + "!"

[TUI 窄屏 < 70 cols]
 ctx 62%  Claude 42%│18%                                                                ⌃A · F1

[Web 折叠侧栏 — 胶囊仍在底栏，不随侧栏消失]
+----------------------------------------------------------------------------------------------+
|  1 quota proposal                                                          [Files] [Context] |
|  $ _                                                                                         |
+----------------------------------------------------------------------------------------------+
|  (Claude  5h 42% │ 7d 18%  +1)                                                               |
+----------------------------------------------------------------------------------------------+

[Phone < 560px — 不画底栏，保留 Settings 列表底部卡片并升级为双窗文本]
  Claude                     5h 42% │ 7d 18%
  Codex                       5h 5% │ 7d 12%
```

- **信息密度**：**低**（单引擎 × 双窗纯数字，无进度条、无重置时间）。
- **优点**：实现最轻，几乎不引入新状态或浮层焦点管理；折叠侧栏后仍可见；撤掉侧栏底部配额行后，侧栏可多展示 2–3 条任务。
- **缺点**：
  - 在 Web/Desktop 打破了 #1624“正常状态下无常驻底栏”的静默界面原则（常驻吃掉 24px 终端高度）。
  - 无法在不切离终端的情况下查看其他引擎的具体配额或各窗口 reset 时间，仍需跳去 Usage 页。
  - 纯数字对“快满了”的余光感知弱于带比例条的样式。

---

### 方案 B：分段微进度条底栏（Segmented Micro-Bar Status Strip）

**核心思路**：面向重度多引擎并发场景，在底栏用**紧凑分段微进度条**直接呈现双窗消耗比例与下一次重置时间，宽屏下同时平铺当前引擎 + 次引擎，做到“不点击就能读完核心配额信息”。

- **落位**：
  - **TUI**：复用 `host-footer.tsx` 1 行底栏；宽屏（≥ 120 cols）展示当前引擎双窗微条 + 重置时间，中等屏（80–119 cols）丢弃重置时间并缩短条宽，窄屏（< 70 cols）退化为方案 A 的纯数字。
  - **Web / Desktop**：26px 底部状态条（`bg-surface` + `border-t-hairline border-line`），横跨窗口底部；同样移除侧栏底部的 `UsageChips`。
- **视觉编码**：
  - 每个窗口由 `label` + **5 格离散微刻度条**（每格代表 20%，4px 高、`1px` 间隙，已用格 `bg-success/warning/error`，未用格 `bg-line`）+ `percent` 组成。
  - 当前活跃引擎置首（名称 `--ink`），次引擎紧随其后（名称 `--muted`，仅画单窗或双窗，受 `usageChipsBudget` 约束），第 3 个及以上引擎折为 `+N`。

#### 线框稿（方案 B）

```text
[TUI — 120 cols 宽屏]
 ctx 62%  │  Claude 5h ━━━── 62% → 14:00 · 7d ━──── 18%  │  Codex 5h ───── 5%       ⌃A commands · F1 help

[TUI — 80 cols 中等屏（丢弃 reset 与次引擎进度条）]
 ctx 62%  │  Claude 5h ━━━── 62% · 7d 18%  │  Codex 5%                              ⌃A commands · F1 help

[rove-web / rove-desktop — 1440px，26px 底部状态条]
+----------------------------------------------------------------------------------------------------------+
|  Claude  5h [███░░] 62%  7d [█░░░░] 18%  → 14:00   │   Codex  5h [░░░░░] 5%  7d [█░░░░] 12%              |
+----------------------------------------------------------------------------------------------------------+
   ↑ 5 格离散微条（4px 高、28px 宽，1px gap），纯语义 token 填充；当前引擎名 --ink，其余 --muted

[rove-web — 1024px（次引擎自动收敛为紧迫单窗，不换行不溢出）]
+--------------------------------------------------------------------------+
|  Claude  5h [███░░] 62%  7d [█░░░░] 18%   │   Codex  5h [░░░░░] 5%       |
+--------------------------------------------------------------------------+

[Phone < 560px — 不画底部状态条，Settings 卡片沿用细进度条并补第二窗]
  Claude  5h ━━━━━━━━━━━░░░░  62%  → 14:00
          7d ━━━░░░░░░░░░░░░  18%  → 12/04 06:00
  Codex   5h ━░░░░░░░░░░░░░░   5%  → 15:30
```

- **信息密度**：**高**（1–2 引擎 × 双窗微进度条 + 百分比 + 重置时间）。
- **优点**：余光扫视效率最高，不需点击即可同时判断“当前 5h 是否告急、7d 是否健康、何时重置、备用引擎余量是否充足”。
- **缺点**：
  - 视觉重量最重，在 Web/Desktop 最明显偏离 #1624 的静默界面方向（常驻 26px 底栏 + 多段彩色刻度，容易与终端内引擎自身的状态栏打架）。
  - 3 个及以上引擎同时接入 `quotaUsage` 后，底栏横向空间仍放不下，最终还是要折叠或截断。
  - 在小屏笔记本（1024px / 80 cols）下需要较多断点裁切逻辑。

---

### 方案 C：活跃引擎轻量槽 + 多引擎详情 Popover（Active-Engine Slot + Multi-Engine Popover）⭐ 推荐

**核心思路**：**常态极克制、按需全展开**。底栏/侧栏脚只用极低噪音展示“当前会话引擎的 `Session | Weekly` 双窗 + 紧迫窗细底线”，把多引擎、全部窗口（含模型 scoped 窗）、重置时间与 `runway` 节奏全部收进一个**不离屏的轻量 Popover（TUI 为浮层卡片，手机为 Bottom Sheet）**。

#### 落位子选项（Web / Desktop，供拍板）

TUI 侧没有歧义：直接复用 `host-footer.tsx` 现有的 1 行底栏（零新增高度），同时侧栏底部 `SidebarUsageLines` 可保留或撤除（推荐撤除，避免同一屏幕画两遍）。

Web / Desktop 侧与 #1624 quiet chrome 的权衡给出两个清晰落位变体：

- **变体 C1（静默优先，兼容 #1624）**：
  - 侧栏展开时**仍保持零常驻底栏**，将现有 `RailFoot` 中的 `UsageChips` 升级为**双窗紧凑触发槽**（当前活跃引擎置顶显示 `5h 42% · 7d 18%` + 细进度条，其余引擎收进 `+1` 徽标，整个区域从多行压缩为 1–2 行，点击不再跳走而是就地弹出 Popover）。
  - **当侧栏折叠（`railFolded`）时**，工作区底部自动出现 24px 轻量槽位（或右下角无遮挡锚点）承接同一触发器，解决“折叠侧栏即失明”的痛点。
- **变体 C2（双端几何 1:1，常驻 24px 细底栏）**：
  - Web / Desktop 常驻一条 24px 极简底栏（与断连 `StatusBar` 共用同一行位），左侧放当前引擎双窗触发槽，与 TUI 的 `host-footer` 空间模型完全一致；同时移除侧栏底部的 `UsageChips`，把侧栏底部空间完全留给任务列表与 Settings。

#### 线框稿（方案 C）

```text
=== 1. TUI：复用 host-footer 1 行 + 按需居中/贴底浮层卡片 ===

[常态 — 100 cols，零新增行高]
 ctx 62%   Claude 5h 42% · 7d 18%  +1                                     ⌃A commands · F1 help

[点击底栏槽或命令面板触发 — 复用 ui/dialog.tsx 卡片与 usageRows()，Esc 立刻回终端]
                     ┌─ QUOTA ───────────────────────────────── esc ─┐
                     │                                               │
                     │  ● CLAUDE  (active)                           │
                     │    5h      ████░░░░░░   42%   → 14:00         │
                     │    7d      ██░░░░░░░░   18%   → 12/04 06:00   │
                     │    Sonnet  █░░░░░░░░░    9%   → 12/04 06:00   │
                     │                                               │
                     │    CODEX                                      │
                     │    5h      █░░░░░░░░░    5%   → 15:30         │
                     │    7d      ██░░░░░░░░   12%   → 12/05 00:00   │
                     │                                               │
                     │  updated 2m ago            [ Open Settings ]  │
                     └───────────────────────────────────────────────┘

=== 2. rove-web / rove-desktop：触发槽 + 锚定上方 Popover ===

[触发槽 — C2 常驻 24px 细底栏（或 C1 侧栏折叠时出现）]
+----------------------------------------------------------------------------------------------+
|  Claude  5h 42% · 7d 18%  [+1]                                                               |
|  ━━━━━━━━━━░░░░░░░░░░░░░░                                                                    |
+----------------------------------------------------------------------------------------------+
   ↑ 底边一条 2px 极细进度线（仅映射紧迫窗/max 占比，语义色跟随最高告警级别），
     点击或 Focus+Enter 展开上方 Popover（hover 仅显示原生 title，避免误触弹出）

[触发槽 — C1 侧栏展开态（RailFoot，无常驻底栏）]
  ───────────────────────────
  Claude   5h 42% · 7d 18%  +1      ← 点击就地向上/向右弹出同一 Popover
  ━━━━━━━━━━░░░░░░░░░░░░░░░░░
  [gear] Settings

[展开态 Popover — bg-surface / border-hairline border-line / rounded-md / shadow-popover，宽 280px]
  ┌──────────────────────────────────────────┐
  │  ● Claude                        active  │   ← 当前会话引擎置顶，圆点 --accent
  │    5h     ━━━━━━━░░░░░░░   42%   → 14:00 │   ← 复用 usageBar 3px 细条 + tabular-nums
  │    7d     ━━░░░░░░░░░░░░   18%   → 12/04 │
  │    Sonnet ━░░░░░░░░░░░░░    9%   → 12/04 │
  │    at this pace lasts until the reset    │   ← 复用 usage-data.ts runway()
  │  ──────────────────────────────────────  │   ← 1px --line-faint（仅多引擎间分隔）
  │  ○ Codex                                 │
  │    5h     ━░░░░░░░░░░░░░    5%   → 15:30 │
  │    7d     ━━░░░░░░░░░░░░   12%   → 12/05 │
  │  ──────────────────────────────────────  │
  │  Updated 2m ago           Open Usage ›   │   ← 点击关 Popover 并进 UsageView
  └──────────────────────────────────────────┘
   ↑
  [Claude  5h 42% · 7d 18%  +1]

=== 3. Phone < 560px — 不画悬浮 Popover，遵循 phone-ui 使用 Bottom Sheet ===

[入口：Settings 列表底部的 Quota 卡片（点击打开 Bottom Sheet，44px 触控行高）]
  ┌────────────────────────────────────┐
  │                ━━━                 │  ← Sheet 抓手
  │  Quota                         ×   │
  │                                    │
  │  ● Claude                  active  │
  │    5h   ━━━━━━━━░░░░░  42%  → 14:00│
  │    7d   ━━━░░░░░░░░░░  18%  → 12/04│
  │                                    │
  │  ○ Codex                           │
  │    5h   ━░░░░░░░░░░░░   5%  → 15:30│
  │    7d   ━━░░░░░░░░░░░  12%  → 12/05│
  │                                    │
  │  Updated 2m ago      Open Usage ›  │
  └────────────────────────────────────┘
```

- **信息密度**：**分层自适应**（常态极低：当前引擎双窗 + 细线 + `+N`；展开高：全引擎 × 全窗口 × reset 时间 × `runway` 节奏 × 新鲜度）。
- **优点**：
  - 在不牺牲终端视线的前提下，同时解决双窗同屏、折叠侧栏失明、活跃引擎优先与多引擎核对四个痛点。
  - 天然支持任意数量的新引擎（3、4、5 个引擎接入后，底栏宽度恒定不变，Popover 内滚动即可）。
  - 高度复用已有资产：`usage-core.ts`（`usageRows`、`formatReset`、`toneOf`）、`usage-data.ts`（`runway`）、`ui/shell.ts`（`usageBar`、`USAGE_TONE`）、TUI `ui/dialog.tsx`。
  - 兼顾 #1624：通过 C1/C2 清晰解耦“是否恢复常驻底栏”这一独立决策。
- **缺点**：
  - 相比方案 A 多一个 Popover / Sheet 状态机（位置锚定、Esc 关闭、焦点归还终端、点击外部关闭），需要按 `rove-ui §6` 做好键盘与触控测试。
  - 查看非当前引擎的精确数字需要多点一下（不过当任一非当前引擎 ≥ 75% 时，`+N` 徽标本身会变 `warn`/`crit` 主动提醒）。

---

## 4. 三套方案横向对比

| 维度 | 现状（Baseline） | 方案 A：极简数字胶囊 | 方案 B：分段微进度条底栏 | 方案 C：活跃槽 + 多引擎 Popover（推荐） |
|---|---|---|---|---|
| **常态显示窗口** | 单窗（`5h`） | 双窗（`5h \| 7d`） | 双窗（`5h \| 7d` + reset） | 双窗（`5h \| 7d` + 紧迫窗细线） |
| **常态显示引擎数** | 全部引擎（每行一个） | 仅当前引擎 + `+N` | 最多 2 引擎 + `+N` | 仅当前引擎 + `+N`（含告警冒泡） |
| **信息密度** | 低 | 低 | 高 | 常态低 / 展开高（渐进披露） |
| **TUI 额外行高** | 0（占侧栏底 2+ 行） | 0（复用 `host-footer`） | 0（复用 `host-footer`） | 0（复用 `host-footer`） |
| **Web/Desktop 垂直成本** | 0（占侧栏底） | 常驻 24px 底栏 | 常驻 26px 底栏 | **C1**：展开 0 / 折叠 24px；**C2**：常驻 24px |
| **侧栏折叠后是否可见** | 否（消失） | 是 | 是 | 是（C1 自动浮现 / C2 常驻） |
| **与 #1624 quiet chrome 契合度** | 高 | 中（新增常驻底栏） | 低（常驻彩色刻度条） | **C1 极高** / **C2 中高** |
| **多引擎（3+）扩展性** | 侧栏被撑高 | 好（仅 `+N`） | 差（横向拥挤） | 极好（底栏定宽，Popover 纵向列表） |
| **不离屏看全部引擎与 reset** | 否（跳 Usage 页） | 否（仅 `title`） | 部分（仅前 2 引擎） | **是**（Popover / 浮层卡片 / Sheet） |
| **实现与维护成本** | — | 最小 | 中（多断点裁切 + 微刻度绘制） | 中（Popover 锚定与焦点归还，数据全复用） |

---

## 5. 窄屏、移动端与边界态降级策略

### 5.1 宽度与端降级矩阵

| 视口 / 形态 | 方案 A | 方案 B | 方案 C（推荐） |
|---|---|---|---|
| **Wide**（Web `≥ 1280px` / TUI `≥ 120 cols`） | 当前引擎 `5h 42% │ 7d 18%` + `+N` | 当前引擎双窗微条 + reset + 次引擎微条 | 当前引擎 `5h 42% · 7d 18%` + 细线 + `+N`；点击开 Popover |
| **Medium**（Web `1024px` / TUI `80–119 cols`） | 同上 | 丢弃 reset，次引擎降为单窗微条或数字 | 同上（宽度恒定，无需裁切） |
| **Narrow Rail**（Web 拖至 `~220px`） | 底栏不受侧栏宽度影响 | 底栏不受侧栏宽度影响 | C1 侧栏脚自动省略引擎名或缩至 `5h 42%·7d 18%`（`min-w-0 truncate` 保证数字不截断）；C2 不受影响 |
| **Folded Rail**（`railFolded` / TUI 折叠） | 底栏常驻，不受影响 | 底栏常驻，不受影响 | C1 自动在工作区底部浮现触发槽；C2 不受影响 |
| **TUI Narrow**（`< 70 cols`，`isNarrowWidth`） | 丢弃窗口标签与 `+N`：`Claude 42%│18%`，优先保留 `ctx` 与 `⌃A · F1` | 退化为纯数字：`Claude 42%│18%` | 缩写为 `Claude 42%·18%`（极端 `< 50 cols` 只留最紧迫窗 `42%`）；仍可打开详情浮层 |
| **Phone / Touch**（`< 560px`，如 `390×844`） | 不占终端底行（避免挤压 `TermKeyRow` / `PhoneBarHost`），收入 Settings 底部卡片 | 同左，Settings 卡片展示双窗条 + reset | 不占终端底行；保留 Settings 底部卡片（≥ 44px 行高），点击开 **Bottom Sheet**（符合 `phone-ui`） |

### 5.2 关键边界态（对齐 `rove-ui §5` 与 `DESIGN.md`）

1. **未收到首帧（`usage === null`）**：整块不渲染，不占位、不闪 `0%`，与现有 `UsageChips` / `SidebarUsageLines` 一致。
2. **当前会话引擎无 `quotaUsage`（如 Copilot、Kimi、自定义引擎或纯 Shell Tab）**：
   - 不显示该引擎的假 `0%`。
   - 若其他引擎有快照：槽位静默回退为 `Quota · Claude 42%`（或告警级别最高的引擎）+ `+N`，仍可点开 Popover 查看全局额度。
   - 若没有任何引擎有快照：整块隐藏（TUI 底栏只留 `ctx` 与键提示；Web C2 隐藏底栏）。
3. **仅返回单个窗口**（例如 Codex 的 `5h` 窗口已过重置点被过滤，只剩 `7d`）：直接只显示该 1 窗（`Codex 7d 12%`），不渲染空分隔符 `│ —`。
4. **窗口数 > 2**（例如 Claude 同时返回 `5h`、`7d` 与模型 scoped 窗 `Sonnet`）：常态槽位只取前 2 个核心周期窗（`5h`、`7d`），其余 scoped 窗完整呈现在 Popover / 浮层中。
5. **非当前引擎告警冒泡**：当前引擎健康（如 Codex `5%`），但后台并行跑着的 Claude 已达 `96%` 时，尾部的 `+1` 徽标染 `--error` 并附 `!`（`+1!`），防止多会话并发下漏看后台限流。
6. **数据陈旧（`capturedAt` 超过 30 分钟，如离线或接口退避）**：保留上次有效读数不清空，Popover 底部以 `--warning` 显示 `Stale · 42m ago`。
7. **`usage.show = "left"`**：双端统一读取 `usage.show`，数值翻转为剩余比例、进度条按剩余长度绘制，告警色依然跟随已用比例。
8. **i18n 与长名称**：窗口标签（`5h` / `7d`）与重置时间（`→ 14:00`）沿用 `usage-core.ts` 的无语言数字格式；Popover 内固定词条（`Active`、`Updated {n}m ago`、`Stale`、`Open Usage`）全部进入 `en` / `zh` 词库；自定义引擎长名用 `truncate` 截断，百分比数字永远 `flex-shrink: 0` 不被挤掉。

---

## 6. 与现有 Usage 页及相邻表面的职责边界

| 表面 | 核心职责 | 展示粒度 | 交互边界 |
|---|---|---|---|
| **底栏 / 侧栏 Quota 槽**（本提案） | **多会话并发时的实时护栏**（不用切屏，一眼知道当前引擎能不能继续发 prompt） | 当前引擎双窗（`Session \| Weekly`）+ 告警色 + 后台引擎计数/告警冒泡 | 常驻只读；点击展开 Popover（不再直接整页跳走） |
| **多引擎 Quota Popover / TUI 浮层**（方案 C） | **不离开终端的横向核对**（切引擎前比一下各家余量和重置点） | 全部上报引擎 × 全部窗口（含 scoped）× 重置时间 × `runway` 节奏 × 刷新时间 | 轻浮层，`Esc` / 外点即关并把焦点还给终端；底部提供 `Open Usage ›` |
| **Usage 页**（`packages/rove-web/src/usage-page.tsx`） | **历史账单与成本复盘**（14 天工作量小票） | 14 天总 token、按天分引擎堆叠柱状图、按引擎/模型汇总、Top 任务排行（可点击跳任务）、以及页面底部 Quota 区块 | 全页分析视图，不与实时底栏竞争；底栏 Popover 是它的轻量入口之一 |
| **Context Tab / TUI `ctx %`** | **单会话上下文窗口水位** | 当前对话的 context occupancy 与构成拆分（system/tools/memory/skills/messages） | 会话级指标，与账号级 Quota 明确分隔（TUI 底栏用间距/竖线隔开 `ctx 62%` 与 `Claude 5h 42% · 7d 18%`） |
| **Settings → General → Usage** | **展示偏好配置**（及 TUI 兜底详览） | `usage.show`（已用 / 剩余）切换；TUI 既有 `UsageDashboard` 保留作设置内只读参照 | 配置入口，不再承担日常频繁查看配额的任务 |

**去重约定**：无论最终选定方案 A、B 还是 C2（常驻底栏），**同一视口内只保留一处配额摘要** —— 启用底栏后同步移除侧栏底部的 `SidebarUsageLines` / `UsageChips`（移动端 Settings 卡片不受影响），避免用户在同一屏幕上看到两份互为镜像的配额读数。

---

## 7. 推荐结论与待拍板事项

### 推荐：**方案 C（活跃引擎轻量槽 + 多引擎详情 Popover）**

理由：
1. **最贴合 Rove 的克制气质**：TUI 零新增行高；Web/Desktop 常态几乎不增加视觉噪音，同时彻底解决“看不到 Weekly %”“折叠侧栏失明”“多引擎核对要切走终端”三个核心痛点。
2. **面向多引擎扩展不返工**：未来接入第 3、第 4 个支持配额的引擎时，底栏布局零抖动，Popover 自然承接。
3. **工程复用度最高**：数据契约、轮询缓存、`usage-core.ts` 格式化与 `usage-data.ts` 的 `runway()` 全部现成，无需动后端采集。

### 需要 Owner 拍板的 4 个小决策（决定后即可进入实现 PR）

1. **Web / Desktop 落位选 C1 还是 C2？**
   - **C1（推荐）**：侧栏展开时保持 #1624 零底栏（升级侧栏脚为双窗槽 + Popover），仅在折叠侧栏时于底栏自动浮现触发槽。
   - **C2**：恢复常驻 24px 静默底栏（与 TUI 几何 1:1，断连 `StatusBar` 复用同行），并从侧栏脚移除 `UsageChips` 释放任务树高度。
2. **双窗选择器的契约方式**：
   - 选项 1（纯视图层，零适配器改动）：在 `usage-core.ts` 增加中性辅助函数 `primaryQuotaChips(usage, now, show)`，按适配器返回顺序取前 2 个不同 `label` 窗口。
   - 选项 2（推荐，更稳健）：在 `EngineQuotaWindow` 增加可选语义字段 `slot?: "session" | "weekly" | "scoped"`，由 Claude / Codex 适配器标注，避免 Codex 的 `5h` 过期后把 `7d` 误排到首位当作 Session 窗。
3. **Popover 触发方式**：
   - 推荐**仅点击 + 键盘（Focus + Enter/Space）展开**，hover 仅保留原生 `title` 提示，避免鼠标划过底栏误触发遮挡终端底部输入行（符合 `rove-ui §6`）。
4. **TUI 是否为 Quota 浮层增加快捷键？**
   - 推荐首期仅用**底栏点击 + 命令面板（`Quota details`）**，不急着占新键位；若高频需要，可在后续按 `docs/KEYBINDINGS.md` 提一条 `PROPOSED` 快捷键。

### 建议后续实现分期（不在本 PR 范围内）

- **Phase 1（纯前端 + 共享 view model）**：
  1. 补齐 `rove-web` 对 `usage.show`（`used` / `left`）的读取；
  2. 在 `packages/rove-core/src/lib/usage-core.ts` 补齐双窗选择与告警冒泡纯函数及单测；
  3. 落地 TUI（`host-footer.tsx` + 浮层卡片）与 `rove-web` / `rove-desktop`（触发槽 + Popover + 手机 Bottom Sheet）并更新 `docs/web/PARITY.md`。
- **Phase 2（独立后端 PR）**：按需为其余内置引擎补充 `quotaUsage` 采集，UI 层自动生效。
