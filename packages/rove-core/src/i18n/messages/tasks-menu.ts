/** The task list's menu entries: a row's, a project's and the Scratch section's. */

export const en = {
  open: "Open",
  /** A task with children: fold or unfold them. Menu-only (no chord yet). */
  collapseChildren: "Collapse children",
  expandChildren: "Expand children",
  newChat: "New conversation",
  newShell: "New shell",
  continueEngine: "Continue in another engine…",
  /** Scratch section header: a new Scratch task in $HOME on the preferred engine. */
  newScratchChat: "New conversation (no folder)",
  newTask: "New task",
  newTaskFromBranch: "New task from this branch",
  /** Project row: un-save the repo + drop its row. Mirrors `d` on that row. */
  forgetProject: "Remove project",
  /** Project row: read the repo's durable field notes (`rove api note`). */
  fieldNotes: "Field notes",
  rename: "Rename",
  pin: "Pin",
  unpin: "Unpin",
  reorder: "Reorder row",
  /** Project row: jump the project above every other. Menu-only. */
  moveToTop: "Move to top",
  /** Project header: move the project one place up / down. Menu-only. */
  moveProjectUp: "Move up",
  moveProjectDown: "Move down",
  /** Re-fire the task's stored brief as a new task. Menu-only. */
  runAgain: "Run again",
  /** Menu-only, like `runAgain`, `land`, `fieldNotes` and the two copies —
   *  status has no key yet, so the menu is its only route. */
  setStatus: "Set status",
  /** Regroup the task under another project; nothing on disk moves. Menu-only. */
  moveToProject: "Move to project…",
  /** Also chord-less: put the row's task id / branch / worktree path on the clipboard. */
  copy: "Copy",
  more: "More",
  copyId: "Copy task ID",
  copyBranch: "Copy branch name",
  copyPath: "Copy path",
  /** The `o` / `b` / `v` chords' menu routes. */
  openEditor: "Open in editor",
  renameBranch: "Rename branch",
  changeEngine: "Change engine",
  /** Only while the row's PR checks are red: paste the failing job's log
   *  into this task's engine. */
  fixChecks: "Fix failing checks",
  /** Also only while red: restart the failed CI jobs, for a flaky failure. */
  rerunChecks: "Re-run failed checks",
  /** Merge the base INTO this worktree — the `↓N` drift chip's action. */
  syncBase: "Sync with base",
  /** Only while a merge/rebase/cherry-pick/revert is paused in the worktree. */
  resolveConflicts: "Resolve conflicts",
  /** Same gate: `git <op> --abort`, behind a confirm. */
  abortOperation: "Abort paused merge or rebase",
  land: "Land into base branch",
  /** Menu-only: the task keeps its unread dot; toasts and chime stop (errors still toast). */
  muteNotifications: "Mute notifications",
  unmuteNotifications: "Unmute notifications",
  /** Hide the task and its children from the sidebar; nothing is stopped or removed. Menu-only. */
  archive: "Archive",
  unarchive: "Unarchive",
  delete: "Remove session",
}

export const zh: typeof en = {
  open: "打开",
  collapseChildren: "折叠子任务",
  expandChildren: "展开子任务",
  newChat: "新建会话",
  newShell: "新建终端",
  continueEngine: "换个引擎继续…",
  newScratchChat: "新建会话（无文件夹）",
  newTask: "新建任务",
  newTaskFromBranch: "基于此分支新建任务",
  forgetProject: "移除项目",
  fieldNotes: "现场笔记",
  rename: "重命名",
  pin: "置顶",
  unpin: "取消置顶",
  reorder: "重新排序",
  moveToTop: "移到顶部",
  moveProjectUp: "上移",
  moveProjectDown: "下移",
  runAgain: "重新运行",
  setStatus: "设置状态",
  moveToProject: "移到其他项目…",
  copy: "复制",
  more: "更多",
  copyId: "复制任务 ID",
  copyBranch: "复制分支名",
  copyPath: "复制路径",
  openEditor: "在编辑器中打开",
  renameBranch: "重命名分支",
  changeEngine: "切换引擎",
  fixChecks: "修复失败的检查",
  rerunChecks: "重新运行失败的检查",
  syncBase: "同步基础分支",
  resolveConflicts: "让 agent 解决冲突",
  abortOperation: "中止暂停的合并或变基",
  land: "合入基础分支",
  muteNotifications: "静音通知",
  unmuteNotifications: "取消静音通知",
  archive: "归档",
  unarchive: "取消归档",
  delete: "移除会话",
}
