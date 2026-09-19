/**
 * `tasks.sync.*` and `tasks.conflicts.*` — what the two base-branch merges
 * say. "Sync with base" and "Resolve conflicts with agent" run the same
 * daemon-side merge and share every outcome but one, so their messages live
 * together, and apart from the rest of `tasks.ts`: that file is the sidebar's
 * rows, menu and dialogs, this one is the merge's own vocabulary. Spliced back
 * under `tasks` by `tasks.ts`, so the keys are unchanged.
 */

/** "Sync with base" outcomes. The conflict and dirty cases are attention,
 *  not error: nothing broke, a human is needed next. */
export const syncEn = {
  done: "Merged {base} into this worktree",
  alreadyCurrent: "Already up to date with {base}",
  conflict: "Merge conflict — resolve then commit: {files}",
  dirty: "Commit the worktree's changes first, then sync: {files}",
  failed: "Sync failed: {error}",
}

/** "Resolve conflicts with agent" — its own outcome; the rest are `sync.*`. */
export const conflictsEn = {
  handedOff: "Asked the agent to resolve {count} conflicted file(s)",
}

export const syncZh: typeof syncEn = {
  done: "已把 {base} 合并进该工作树",
  alreadyCurrent: "已经和 {base} 同步",
  conflict: "合并冲突——解决后提交：{files}",
  dirty: "请先提交工作树里的改动，再同步：{files}",
  failed: "同步失败：{error}",
}

export const conflictsZh: typeof conflictsEn = {
  handedOff: "已让 agent 解决 {count} 个冲突文件",
}
