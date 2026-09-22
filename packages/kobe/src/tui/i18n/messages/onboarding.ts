/**
 * `onboarding.*` messages — the first-run welcome dialog
 * (`src/tui-react/onboarding/host.tsx`) and the installs it defers to
 * `src/cli/onboarding.ts`. English is the source of truth; `zh: typeof en`
 * keeps the shapes locked together.
 *
 * The environment-report and ready/not-ready keys are deliberately gone: the
 * welcome pane behind the dialog renders that verdict from the same probe,
 * and the dialog shows each answer as its own transcript line, so a closing
 * banner restating them would be a second and third copy of one fact.
 */

export const en = {
  /** Dialog header */
  title: "Welcome to Rove",
  /** One-liner under the header: what Rove actually does, before any question. */
  subtitle: "Every task gets its own git worktree and branch, so parallel sessions never collide.",
  /** Step 1 question; {shell} is the detected shell name (zsh/bash/fish) */
  completionsQuestion: "Install shell completions for {shell}?",
  /** Step 1 explanation */
  completionsExplain: "Tab-completes rove subcommands. One line is added to your shell config.",
  /** Step 2 question */
  skillQuestion: "Install the Rove agent skill?",
  /** Step 2 explanation */
  skillExplain: "Teaches coding agents to drive Rove from the shell via `rove api`.",
  /** Recommended option */
  optionYes: "Yes (recommended)",
  /** Decline option */
  optionNo: "No",
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
  /** Deferred install: about to run the skill installer; {command} is the npx command */
  installingSkill: "installing the Rove agent skill ({command})…",
  /** Deferred install: skill installer failed; {command} retries it */
  skillFailed: "! skill install failed — retry with `{command}`",
  /** Deferred install: the skill installer needs Node/npx, which isn't installed */
  skillNeedsNode:
    "! agent skill needs `npx` (part of Node.js) — install Node from https://nodejs.org, then run `{command}`",
}

export const zh: typeof en = {
  title: "欢迎使用 Rove",
  subtitle: "每个任务都有自己的 git worktree 和分支，所以并行的会话不会互相干扰。",
  completionsQuestion: "为 {shell} 安装 shell 补全吗？",
  completionsExplain: "让 rove 子命令支持 Tab 补全，会在你的 shell 配置里加一行。",
  skillQuestion: "安装 Rove agent skill 吗？",
  skillExplain: "教会编码 agent 通过 `rove api` 在命令行驱动 Rove。",
  optionYes: "安装（推荐）",
  optionNo: "跳过",
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
  installingSkill: "正在安装 Rove agent skill（{command}）…",
  skillFailed: "! skill 安装失败 — 可用 `{command}` 重试",
  skillNeedsNode:
    "! agent skill 需要 `npx`（Node.js 的一部分）— 请从 https://nodejs.org 安装 Node，然后运行 `{command}`",
}
