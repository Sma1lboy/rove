/** Task action notifications. */

export const en = {
  // `rove daemon restart` is what `doctor.fix.daemonDown` prescribes for the
  // identical condition — the TUI and doctor must not disagree on the fix.
  noDaemonWorktree: "No daemon running — can't create the worktree. Start it with `rove daemon restart`.",
  noEditor: "No editor found — set ROVE_OPEN_EDITOR (e.g. 'code', 'cursor', 'nvim')",
  openWorktreeFailed: "Couldn't open worktree with {label}",
  worktreeErrorDeleting: "This task is being deleted — it can't be opened",
  worktreeErrorNotGit:
    "This project isn't a git repo yet — a task needs a git branch. Run `git init` (+ a first commit) in the project, then open the task. Non-git support is coming.",
  worktreeErrorGeneric: "Couldn't create the worktree: {message}",
  scratchAdopted: "Adopted into {repo} — save it as a project from New Task if you want it in the picker",
  scratchOpenFailed: "Couldn't open a scratch shell: {message}",
  scratchCloseFailed: "Couldn't close the scratch task: {message}",
  worktreeGoneTitle: 'Worktree for "{title}" is gone',
  worktreeGoneBody:
    "Closed {count} tab(s). The branch {branch} is still there — reopen the task to re-create its worktree.",
  // PR checks RESOLVING is the edge worth interrupting for — a run that
  // merely STARTED (none → pending) is not. `checkResolutionNotify` in
  // monitor/pr-status.ts owns that rule; these are its two landings.
  checksPassingTitle: 'Checks passed for "{title}"',
  checksFailingTitle: 'Checks failed for "{title}"',
  checksResolvedBody: "PR {pr} on {branch}",
  copiedBranch: "Copied branch {text}",
  copiedPath: "Copied path {text}",
  // Both clipboard channels refused: no platform clipboard command on PATH
  // (a headless box), and a terminal that answers "no" to OSC 52.
  copyFailed: "Couldn't reach a clipboard — no clipboard command on PATH, and this terminal refused OSC 52.",

  /** Action failures. Each names the state that SURVIVED the failure —
   *  the `kanban.*` block's shape, and the thing a user needs in order to
   *  know whether to retry or to stop worrying. */
  forgetProjectFailed: "Couldn't remove the project — it stays in the projects list: {error}",
  deleteFailed: 'Couldn\'t delete "{title}" — the task and its worktree are untouched: {error}',
  createFailed: "Couldn't create the task — nothing was created: {error}",
  forkFailed: "Couldn't fork the task — the original is untouched: {error}",
  renameFailed: "Couldn't rename the task — it keeps its old title: {error}",
  renameBranchFailed: 'Couldn\'t rename the branch — it stays "{branch}": {error}',
  switchEngineFailed: "Couldn't switch the engine — the task keeps the one it had: {error}",
  setStatusFailed: "Couldn't set the status — it stays {status}: {error}",
  pinFailed: "Couldn't change the pin — the task keeps its current place: {error}",
  moveFailed: "Couldn't move the task — it keeps its current place: {error}",
  issueChatFailed: "Couldn't start the issue chat — the issue is unchanged: {error}",
  inboxMarkReadFailed: "Couldn't mark it read — it stays in the inbox: {error}",
  inboxDismissFailed: "Couldn't dismiss it — it stays in the inbox: {error}",

  /** Successes with nothing on screen to show them — both changes only
   *  become visible later, so the toast is the only feedback. */
  engineSwitched: "Engine → {engine} (applies on reopen)",
  statusSet: "Status → {status}",
}

export const zh: typeof en = {
  noDaemonWorktree: "守护进程未运行——无法创建 worktree。请运行 `rove daemon restart` 启动它。",
  noEditor: "未找到编辑器——请设置 ROVE_OPEN_EDITOR（如 'code'、'cursor'、'nvim'）",
  openWorktreeFailed: "无法用 {label} 打开 worktree",
  worktreeErrorDeleting: "该任务正在删除中——无法打开",
  worktreeErrorNotGit:
    "该项目尚非 git 仓库——任务需要 git 分支。请在项目中执行 `git init`（+ 首次提交）后再打开任务。非 git 项目的支持即将推出。",
  worktreeErrorGeneric: "无法创建 worktree：{message}",
  scratchAdopted: "已归入 {repo}——若要出现在项目选择器里,可在新建任务中保存为项目",
  scratchOpenFailed: "无法打开临时 Shell:{message}",
  scratchCloseFailed: "无法关闭临时任务:{message}",
  worktreeGoneTitle: '"{title}" 的 worktree 已消失',
  worktreeGoneBody: "已关闭 {count} 个标签页。分支 {branch} 仍在——重新打开该任务会重建 worktree。",
  checksPassingTitle: "「{title}」的 PR 检查已通过",
  checksFailingTitle: "「{title}」的 PR 检查失败了",
  checksResolvedBody: "PR {pr}，分支 {branch}",
  copiedBranch: "已复制分支 {text}",
  copiedPath: "已复制路径 {text}",
  copyFailed: "无法访问剪贴板——PATH 上没有剪贴板命令，这个终端也拒绝了 OSC 52。",

  forgetProjectFailed: "移除项目失败——它仍在项目列表里：{error}",
  deleteFailed: "删除「{title}」失败——任务和它的 worktree 都没有被改动：{error}",
  createFailed: "创建任务失败——什么都没有被创建：{error}",
  forkFailed: "fork 任务失败——原任务没有被改动：{error}",
  renameFailed: "重命名任务失败——它仍用原来的标题：{error}",
  renameBranchFailed: "重命名分支失败——它仍是「{branch}」：{error}",
  switchEngineFailed: "切换引擎失败——任务仍使用原来的引擎：{error}",
  setStatusFailed: "设置状态失败——它仍是 {status}：{error}",
  pinFailed: "修改置顶状态失败——任务仍在原来的位置：{error}",
  moveFailed: "移动任务失败——它仍在原来的位置：{error}",
  issueChatFailed: "启动议题会话失败——议题没有被改动：{error}",
  inboxMarkReadFailed: "标记为已读失败——它仍留在收件箱里：{error}",
  inboxDismissFailed: "忽略失败——它仍留在收件箱里：{error}",

  engineSwitched: "引擎 → {engine}（重新打开后生效）",
  statusSet: "状态 → {status}",
}
