/**
 * `help.*` messages. English is the source of truth; `zh: typeof en` keeps
 * the shapes locked together. Filled during the TUI i18n migration.
 */

export const en = {
  /** Dialog title */
  title: "Rove — keybindings",
  /** Close / cancel hint */
  esc: "esc",
  /** Corner hint next to `esc`. The list is a scrollbox and routinely runs
   *  two thirds below the fold behind a one-cell scrollbar thumb, with
   *  nothing on screen naming the keys that move it. */
  scrollKeys: "↑↓ ⇞⇟ scroll",
  commandLayer: "{prefix} — more Rove commands",
  escCancel: "esc cancel",
  directLayer: "Hold ctrl — Rove shortcuts",
  releaseCtrl: "release ctrl to close",
  overflow: "… F1 for all shortcuts",
  moreCommandsPrefix: "More commands (prefix)",
  focused: "Focused: {surface}",
  allBindings: "All keybinding contexts",
  /** The sentence that names every way to drive Rove. Right-click belongs in
   *  it: six sidebar verbs (set status, the two copies, run again, field
   *  notes, sync with base) have no chord at all, and until this line nothing
   *  in the running TUI said the menu existed. */
  grammar: "Use keys here · one-press Rove shortcuts · {prefix} for more commands · right-click a row for its menu",
  disabled: "prefix disabled",
  here: "HERE — only in {surface}",
  direct: "ONE PRESS — Rove shortcuts",
  afterPrefix: "AFTER PREFIX — more Rove commands",
  otherPane: "OTHER PANE — {surface}",
}

export const zh: typeof en = {
  title: "Rove — 快捷键",
  esc: "esc",
  scrollKeys: "↑↓ ⇞⇟ 滚动",
  commandLayer: "{prefix} — 更多 Rove 命令",
  escCancel: "esc 取消",
  directLayer: "按住 ctrl — Rove 快捷键",
  releaseCtrl: "松开 ctrl 关闭",
  overflow: "… 按 F1 查看全部快捷键",
  moreCommandsPrefix: "更多命令（prefix）",
  focused: "当前焦点：{surface}",
  allBindings: "所有快捷键上下文",
  grammar: "当前区域直接按 · Rove 单次快捷键 · {prefix} 打开更多命令 · 右键任务行打开菜单",
  disabled: "Prefix 已禁用",
  here: "当前区域 — 仅在{surface}",
  direct: "一次按下 — Rove 快捷键",
  afterPrefix: "按下 Prefix 后 — 更多 Rove 命令",
  otherPane: "其他区域 — {surface}",
}
