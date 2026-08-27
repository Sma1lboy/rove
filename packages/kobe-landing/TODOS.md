# kobe-landing — TODOs

Landing page 迭代清单。源文件：`packages/kobe-landing/index.html`（静态页 + plugins/themes/changelog 三个子页）。
线上：[rove.run](https://rove.run) · 仓库：[github.com/Sma1lboy/rove](https://github.com/Sma1lboy/rove)

## 状态（2026-08-27 逐条核对过实现，不是照抄旧标记）

原第 1–7 条已全部落地并验证，条目删除。核对结果：

- 旧 #1（hero badge 去重）、#4（"Get started" CTA）→ hero 现在是 kicker + 单 CTA，无重复安装命令。
- 旧 #2（平台支持文案）→ hero requirements 已写明 "Runs on macOS & Linux (Windows via WSL)"；Windows 疑问已由 `docs/TROUBLESHOOTING.md` 的 Windows 章节解决（走 WSL，原生需 Bun + Node + Git for Windows）。
- 旧 #3（GitHub logo + 实时 star 数）→ nav 内已有 inline SVG + `starCount` fetch（localStorage 缓存 + 限流 fallback）。
- 旧 #5（静态 mockup 换活动效）→ 首屏已是可交互的 fleet mock（`fleet.js`，可点任务/Kanban/Routines/Inbox/Zen）。
- 旧 #6（why section 图片驱动）→ 已被 stages 滚动叙事（multiplex / ssh-native / peers）整体取代。
- 旧 #7（`kobe api fan-out` 裸命令）→ 已是 fan-out 动画（`fanout.css` + `stages.js`），命令降为注脚。

## 待办

- **清理未引用的大资产**（需 owner 确认删除）：`assets/hero-flow-v2.png` (2.1MB)、`assets/demo.mp4` (1.6MB)、`assets/task-streams.gif` (1.1MB)、`assets/quicklook.mp4`、`assets/quicklook-poster.jpg`、`assets/demo-poster.png`、`hero-fanout.png`、`z1-zen-fill.png` 都不再被任何页面引用（现役图片只有 `cand-5-rivers.png`、`assets/favicon.png`、`assets/og-card.jpg`），约 5.6MB 会跟着每次 deploy 一起上传。
- og-card：`assets/og-card.jpg` 是真实页面 1200×630 截图。hero 文案改版后需要重截一张（用本地 server + 1200×630 viewport,隐藏 navbar）。
