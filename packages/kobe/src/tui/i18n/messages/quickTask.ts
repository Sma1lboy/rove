/**
 * `quickTask.*` messages. English is the source of truth; `zh: typeof en` keeps
 * the shapes locked together. Filled during the TUI i18n migration.
 */

export const en = {
  /** Dialog header: "Quick task · <repo>" */
  title: "Quick task · {repoLabel}",
  /** Cancel / close hint */
  /** Prompt field label */
  promptLabel: "PROMPT",
  /** Prompt input placeholder */
  promptPlaceholder: "what should this task do?",
  /** Engine field label */
  engineLabel: "ENGINE",
  /** Branch field label */
  branchLabel: "BRANCH",
  /** Footer hint legend */
  legend: "enter create · tab fields · ctrl+e engine · ctrl+v attach · esc cancel",
}

export const zh: typeof en = {
  title: "快速任务 · {repoLabel}",
  promptLabel: "提示词",
  promptPlaceholder: "这个任务要做什么？",
  engineLabel: "引擎",
  branchLabel: "分支",
  legend: "enter 创建 · tab 切换字段 · ctrl+e 引擎 · ctrl+v 附件 · esc 取消",
}
