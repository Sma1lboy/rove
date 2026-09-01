/**
 * `onboarding.*` messages — the first-run wizard (`src/cli/onboarding.ts` +
 * `src/tui-react/onboarding/host.tsx`). English is the source of truth;
 * `zh: typeof en` keeps the shapes locked together.
 */

export const en = {
  /** Wizard header */
  title: "Welcome to Rove",
  /** One-liner under the header */
  subtitle: "Two quick questions and a quick environment check before your first launch.",
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
  /** Key legend at the bottom of the wizard */
  legend: "↑↓ select · enter confirm · q skip setup",
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
  /** Legend on the keys page */
  keysLegend: "enter finish",
  /** Environment page: heading */
  envTitle: "Environment check",
  /** Environment page: one-liner under the heading */
  envExplain: "Read-only — what Rove found on this machine:",
  /** Environment page verdict when at least one engine is usable and git is present */
  envReady: "✓ You're set — at least one engine is ready.",
  /** Environment page verdict when no engine is usable (git line above still shows its own result) */
  envNotReady: "✗ No usable engine yet — Rove needs one to run tasks.",
  /** Legend on the environment page */
  envLegend: "enter continue · q skip setup",
  /** Closing banner when the machine cannot run a first task yet */
  notReadyHeader: "Not ready yet:",
  /** Post-wizard: completions line was written; {path} is the rc/completions file */
  appliedCompletions: "✓ completions hooked into {path} (takes effect in new shells)",
  /** Post-wizard: completions declined; {command} re-runs it later */
  skippedCompletions: "· completions skipped — run `{command}` anytime",
  /** Post-wizard: about to run the skill installer; {command} is the npx command */
  installingSkill: "installing the Rove agent skill ({command})…",
  /** Post-wizard: skill installer failed; {command} retries it */
  skillFailed: "! skill install failed — retry with `{command}`",
  /** Post-wizard: the skill installer needs Node/npx, which isn't installed */
  skillNeedsNode:
    "! agent skill needs `npx` (part of Node.js) — install Node from https://nodejs.org, then run `{command}`",
  /** Post-wizard: skill declined; {command} re-runs it later */
  skippedSkill: "· agent skill skipped — run `{command}` anytime",
  /** Final ready banner */
  ready: "You're ready to go!",
  /** Final hint: how to start; {command} is the CLI name the user invoked */
  readyHint: "Run `{command}` to launch the TUI.",
}

export const zh: typeof en = {
  title: "欢迎使用 Rove",
  subtitle: "首次启动前，先回答两个小问题，再做一次环境检查。",
  completionsQuestion: "为 {shell} 安装 shell 补全吗？",
  completionsExplain: "让 rove 子命令支持 Tab 补全，会在你的 shell 配置里加一行。",
  skillQuestion: "安装 Rove agent skill 吗？",
  skillExplain: "教会编码 agent 通过 `rove api` 在命令行驱动 Rove。",
  optionYes: "安装（推荐）",
  optionNo: "跳过",
  legend: "↑↓ 选择 · enter 确认 · q 跳过设置",
  keysTitle: "键盘基础",
  keysBare: "裸键作用于当前聚焦面板 — {nav} 移动，{open} 打开。",
  keysOnePress: "少量单次快捷键属于 Rove 自己 — {newTab} 新标签页，{focusNext} 切换面板。",
  keysPrefix: "{prefix} 打开命令层 — 按住稍等会出现命令指南。",
  keysHelp: "随时按 {help} 查看完整的实时键位表。",
  keysLegend: "enter 完成",
  envTitle: "环境检查",
  envExplain: "只读检查 — Rove 在这台机器上发现了什么：",
  envReady: "✓ 一切就绪 — 至少一个引擎可用。",
  envNotReady: "✗ 还没有可用引擎 — Rove 需要一个引擎才能运行任务。",
  envLegend: "enter 继续 · q 跳过设置",
  notReadyHeader: "还没准备好：",
  appliedCompletions: "✓ 补全已写入 {path}（新开的 shell 生效）",
  skippedCompletions: "· 已跳过补全 — 之后可随时运行 `{command}`",
  installingSkill: "正在安装 Rove agent skill（{command}）…",
  skillFailed: "! skill 安装失败 — 可用 `{command}` 重试",
  skillNeedsNode:
    "! agent skill 需要 `npx`（Node.js 的一部分）— 请从 https://nodejs.org 安装 Node，然后运行 `{command}`",
  skippedSkill: "· 已跳过 agent skill — 之后可随时运行 `{command}`",
  ready: "一切就绪！",
  readyHint: "运行 `{command}` 启动 TUI。",
}
