/**
 * `gates.*` messages: the decision dialog a task's question opens from the
 * Inbox. English is the source of truth; `zh: typeof en` keeps the shapes
 * locked together.
 */

export const en = {
  decision: {
    title: "Decision needed",
    /** Section label over the option list. */
    optionsLabel: "choose",
    /** Marks the option the asking task recommended. */
    recommended: "recommended",
    /** Section label over the free-text field. */
    noteLabel: "note",
    noteOptionalHint: "optional, sent with your choice",
    noteRequiredHint: "required, this question has no options",
    notePlaceholder: "type your answer",
    /** Shown when a question without options is submitted empty. */
    needsText: "Type an answer first.",
    footerOptions: "↑/↓ choose · tab note · enter send · esc cancel",
    footerNote: "enter send · esc cancel",
    footerNoteWithOptions: "tab options · enter send · esc cancel",
  },
  toast: {
    answerFailed: "Could not send the answer: {error}",
  },
}

export const zh: typeof en = {
  decision: {
    title: "等你决定",
    optionsLabel: "选择",
    recommended: "推荐",
    noteLabel: "备注",
    noteOptionalHint: "可选，随选择一起发送",
    noteRequiredHint: "必填，这个问题没有选项",
    notePlaceholder: "输入你的回答",
    needsText: "请先输入回答。",
    footerOptions: "↑/↓ 选择 · tab 备注 · enter 发送 · esc 取消",
    footerNote: "enter 发送 · esc 取消",
    footerNoteWithOptions: "tab 选项 · enter 发送 · esc 取消",
  },
  toast: {
    answerFailed: "回答发送失败：{error}",
  },
}
