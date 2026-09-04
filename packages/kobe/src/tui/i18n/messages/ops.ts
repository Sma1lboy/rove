/**
 * `ops.*` messages. English is the source of truth; `zh: typeof en` keeps
 * the shapes locked together. Filled during the TUI i18n migration.
 */

export const en = {
  preview: {
    diffVsHead: "diff vs HEAD",
    diffVsBase: "diff vs {base}",
    file: "file",
    image: "image",
    binary: "binary file",
    closeHint: "· q to close",
    loading: "loading…",
    noTextPreview: "no text preview",
    openHint: "o open in system viewer",
    /** Header label for the whole-worktree pathspec (`.`), which would
     *  otherwise render as a bare dot. */
    allFiles: "all files",
    /** A directory / whole-worktree diff git produced no hunks for. A single
     *  file falls back to its content; a pathspec has none to fall back to. */
    noChanges: "no changes in {pathspec}",
    /** A rename's header: the side the file came from, which its own diff
     *  now shows paired instead of as a whole-file add. */
    renamedFrom: "renamed from {origPath}",
    /** A real patch git expressed entirely in its preamble. Blank is not an
     *  answer here — it cannot be told apart from "nothing changed". */
    binaryChanged: "binary file changed",
    imageChanged: "image changed",
    modeChanged: "mode changed · {from} → {to}",
    /** git refused. Carries git's own stderr rather than presenting the
     *  absent diff as an absence of changes. */
    gitFailed: "could not read the diff",
    retryHint: "r to retry",
    /** Footer on a combined diff: review notes anchor to ONE path, so a diff
     *  spanning files carries none. Stated so the absence reads as a rule. */
    notesPerFile: "notes are per-file — open a single file's diff to add them",
    review: {
      noteDialogTitle: "Review note — {location}",
      noteFieldLabel: "note",
      noteSubmitLabel: "add note",
      notePlaceholder: "what should the agent change here?",
      count: "{total} notes · {unsent} unsent",
      keysHint: "j/k line · v range · c note · x drop · s send · r reload",
      /** Error toast when `s` had notes to send and no session to send them to. */
      sendNoEngine: "No engine session in this task — the notes are still unsent. Open one with ctrl+t.",
    },
  },
}

export const zh: typeof en = {
  preview: {
    diffVsHead: "与 HEAD 对比",
    diffVsBase: "与 {base} 对比",
    file: "文件",
    image: "图片",
    binary: "二进制文件",
    closeHint: "· q 关闭",
    loading: "加载中…",
    noTextPreview: "无文本预览",
    openHint: "o 用系统查看器打开",
    allFiles: "全部文件",
    noChanges: "{pathspec} 没有改动",
    renamedFrom: "重命名自 {origPath}",
    binaryChanged: "二进制文件已改动",
    imageChanged: "图片已改动",
    modeChanged: "权限位已改动 · {from} → {to}",
    gitFailed: "读取 diff 失败",
    retryHint: "按 r 重试",
    notesPerFile: "备注按单文件锚定——要加备注请打开单个文件的 diff",
    review: {
      noteDialogTitle: "评审备注 — {location}",
      noteFieldLabel: "备注",
      noteSubmitLabel: "添加备注",
      notePlaceholder: "希望 agent 在这里改什么？",
      count: "{total} 条备注 · {unsent} 条未发送",
      keysHint: "j/k 行 · v 范围 · c 备注 · x 删除 · s 发送 · r 重载",
      /** `s` 有备注要发但这个任务没有会话时的错误 toast。 */
      sendNoEngine: "这个任务没有引擎会话——备注仍未发送。用 ctrl+t 开一个。",
    },
  },
}
