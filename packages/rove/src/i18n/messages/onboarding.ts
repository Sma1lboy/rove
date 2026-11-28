/**
 * `onboarding.*` messages — the first-run welcome dialog
 * (`src/tui-react/onboarding/host.tsx`) and the installs it defers to
 * `src/cli/onboarding.ts`. English is the source of truth; `zh: typeof en`
 * keeps the shapes locked together.
 *
 */

export const en = {
  engineTitle: "Engine and account",
  engineChecking: "Checking installed engines and accounts…",
  engineReady: "✓ Ready to start a task",
  engineMissing: "No usable engine yet",
  engineUsable: "✓ {engine}: ready",
  engineSignedOut: "! {engine}: installed, not signed in",
  engineSetup:
    "Install an engine using docs.rove.run/rove/engines, then run its CLI and sign in. Run `rove doctor --fix` to check setup; Settings → Engines lists integrations.",
  engineContinue: "❯ Continue to optional setup",
  engineLegend: "enter continue · esc skip optional setup",
  quickStart: "Start a task with a prompt",
  quickIntent: "Creates an isolated worktree and branch. Use {key} for the full task dialog.",
  tabShared: "New conversations share this task’s files",
  tabIsolated: "{key}: new task, isolated worktree",

  /** Dialog header */
  title: "Welcome to Rove",
  /** One-liner under the header: what Rove actually does, before any question. */
  subtitle: "Managed tasks get isolated worktrees and branches. Directory and project tasks reuse existing files.",
  /** Step 1 question; {shell} is the detected shell name (zsh/bash/fish) */
  completionsLabel: "Shell completions for {shell}",
  /** Step 1 explanation */
  completionsExplain: "Tab-completes rove subcommands. One line is added to your shell config.",
  /** Step 2 question */
  skillLabel: "Rove agent skill",
  /** Step 2 explanation */
  skillExplain:
    "Lets the coding agents on this machine drive Rove themselves: start tasks, read other sessions, message them.",
  /** Recommended option */
  optionYes: "Install",
  /** Muted tag beside the skill step's Install option */
  recommended: "recommended",
  /** Step position beside the active question's title */
  stepCounter: "{n} / {total}",
  /** Decline option */
  optionNo: "Not now",
  queued: "Queued — installs when you quit Rove",
  /** Answered skill step, installed on the spot: {engines} lists where */
  skillInstalled: "Installed for {engines}",
  skillFailed: "Install failed: {reason}",
  skillNoEngines: "No coding agent here takes the skill",
  skipped: "Skipped",
  installFailed: "! {item} failed: {reason}. Retry: {command} (or quit Rove again).",
  /** Key legend at the bottom of the dialog */
  legend: "↑↓ select · enter confirm · esc close",
  /** Final informational page: heading. Every {placeholder} below is filled from the LIVE keymap. */
  keysTitle: "Keyboard basics",
  /** {nav} sidebar move keys, {open} select key */
  keysBare: "Bare keys act in the focused pane — {nav} moves, {open} opens.",
  /** {newTab} new-tab chord, {focusNext} pane-cycle chord */
  keysOnePress: "A few one-press chords are Rove's own — {newTab} new tab, {focusNext} next pane.",
  /** {prefix} the prefix first stroke */
  keysPrefix: "{prefix} opens the command map — hold it a beat and a guide appears.",
  /** {help} the help chord */
  keysHelp: "{help} shows the full live reference anytime.",
  /** Last line of the dialog: where the engine-integration panel lives afterwards. */
  keysNext: "Next: Settings → Engines lists every engine and installs its activity hooks.",
  /** Legend on the keys page */
  keysLegend: "enter finish",
  /** Deferred install: completions line was written; {path} is the rc/completions file */
  appliedCompletions: "✓ completions hooked into {path} (takes effect in new shells)",
  /** Deferred install / `completions --install`: {path} already had a completions block — nothing written */
  keptCompletions: "· {path} already has a completions block — left untouched",
}

export const zh: typeof en = {
  engineTitle: "引擎与账户",
  engineChecking: "正在检查引擎与账户…",
  engineReady: "✓ 可以开始任务",
  engineMissing: "还没有可用的引擎",
  engineUsable: "✓ {engine}：可用",
  engineSignedOut: "! {engine}：已安装，未登录",
  engineSetup:
    "从 docs.rove.run/rove/engines 安装引擎，然后运行其 CLI 并登录。运行 `rove doctor --fix` 检查配置；设置 → 引擎 可查看集成。",
  engineContinue: "❯ 继续可选设置",
  engineLegend: "enter 继续 · esc 跳过可选设置",
  quickStart: "输入提示词开始任务",
  quickIntent: "创建独立 worktree 和分支。按 {key} 打开完整任务对话框。",
  tabShared: "新对话共享当前任务的文件",
  tabIsolated: "{key}：新建任务，使用独立 worktree",

  title: "欢迎使用 Rove",
  subtitle: "托管任务使用独立的 worktree 和分支；目录与项目任务复用现有文件。",
  completionsLabel: "{shell} 的 shell 补全",
  completionsExplain: "让 rove 子命令支持 Tab 补全，会在你的 shell 配置里加一行。",
  skillLabel: "Rove agent skill",
  skillExplain: "让本机的编码 agent 自己操作 Rove：开任务、读其他会话、给它们发消息。",
  optionYes: "安装",
  recommended: "推荐",
  stepCounter: "{n} / {total}",
  optionNo: "跳过",
  queued: "已排队 — 退出 Rove 后安装",
  skillInstalled: "已为 {engines} 安装",
  skillFailed: "安装失败：{reason}",
  skillNoEngines: "这台机器上没有能装 skill 的编码 agent",
  skipped: "已跳过",
  installFailed: "! {item} 安装失败：{reason}。重试：{command}（或再次退出 Rove）。",
  legend: "↑↓ 选择 · enter 确认 · esc 关闭",
  keysTitle: "键盘基础",
  keysBare: "裸键作用于当前聚焦面板 — {nav} 移动，{open} 打开。",
  keysOnePress: "少量单次快捷键属于 Rove 自己 — {newTab} 新标签页，{focusNext} 切换面板。",
  keysPrefix: "{prefix} 打开命令层 — 按住稍等会出现命令指南。",
  keysHelp: "随时按 {help} 查看完整的实时键位表。",
  keysNext: "接下来：设置 → 引擎 里列出每个引擎，并可在那里安装它们的活动钩子。",
  keysLegend: "enter 完成",
  appliedCompletions: "✓ 补全已写入 {path}（新开的 shell 生效）",
  keptCompletions: "· {path} 里已有补全配置 — 未改动",
}
