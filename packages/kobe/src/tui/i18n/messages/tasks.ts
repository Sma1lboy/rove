/**
 * `tasks.*` messages. English is the source of truth; `zh: typeof en` keeps
 * the shapes locked together. Filled during the TUI i18n migration.
 */

export const en = {
  /** Top-level navigation rail — one row per destination */
  nav: {
    kanban: "Kanban",
    automations: "Routines",
    issues: "Issues",
  },
  /** Section headers */
  header: {
    scratch: "SCRATCH",
  },
  /** Search bar */
  search: {
    placeholder: "fuzzy filter",
  },
  /** Tree sidebar right-click menu. Each entry mirrors a chord the row
   *  already answers to, so the menu is a second route rather than a second
   *  set of rules. */
  menu: {
    open: "Open",
    openTab: "Open tab",
    closeTab: "Close tab",
    newChat: "New conversation",
    newShell: "New shell",
    newTask: "New task",
    /** Project row: un-save the repo + drop its row. Mirrors `d` on that row. */
    forgetProject: "Remove project",
    /** Project row: read the repo's durable field notes (`rove api note`). */
    fieldNotes: "Field notes",
    rename: "Rename",
    pin: "Pin",
    unpin: "Unpin",
    reorder: "Reorder row",
    /** Re-fire the task's stored brief as a new task. Menu-only. */
    runAgain: "Run again",
    /** The one entry with no chord behind it — status has no key yet, so the
     *  menu is its only route. */
    setStatus: "Set status",
    /** Also chord-less: put the row's branch / worktree path on the clipboard. */
    copyBranch: "Copy branch name",
    copyPath: "Copy path",
    /** The `o` / `b` / `v` chords' menu routes. */
    openEditor: "Open in editor",
    renameBranch: "Rename branch",
    changeEngine: "Change engine",
    /** Only while the row's PR checks are red: paste the failing job's log
     *  into this task's engine. */
    fixChecks: "Fix failing checks",
    /** Merge the base INTO this worktree — the `↓N` drift chip's action. */
    syncBase: "Sync with base",
    land: "Land into base branch",
    delete: "Delete",
  },
  /** The six `TaskStatus` values, for the set-status picker and its row chip.
   *  A LABEL on the board — nothing here stops a session or removes a
   *  worktree, so the words must not read like teardown verbs. */
  status: {
    backlog: "Backlog",
    inProgress: "In progress",
    inReview: "In review",
    done: "Done",
    canceled: "Canceled",
    error: "Error",
  },
  /** Set-status picker dialog. */
  setStatus: {
    title: "Set status",
    /** Marks the task's current value in the list. */
    current: "current",
    footer: "↑↓ choose · enter set · esc cancel",
  },
  /** "Sync with base" outcomes. The conflict and dirty cases are attention,
   *  not error: nothing broke, a human is needed next. */
  sync: {
    done: "Merged {base} into this worktree",
    alreadyCurrent: "Already up to date with {base}",
    conflict: "Merge conflict — resolve then commit: {files}",
    dirty: "Commit or stash the worktree's changes first, then sync",
    failed: "Sync failed: {error}",
  },
  /** Change-engine picker dialog (the menu route of `v`). */
  changeEngine: {
    title: "Change engine",
    current: "current",
    footer: "↑↓ choose · enter set · esc cancel",
    /** Leading label of the reasoning-level row (engines that declare levels). */
    effortLabel: "EFFORT",
    /** The level choice meaning "don't pin one — use the engine's own default". */
    noEffort: "engine default",
    /** Footer for an engine that HAS levels: the row needs its own keys. */
    footerEffort: "↑↓ engine · ←→ effort · enter set · esc cancel",
  },
  /** Run-again confirm dialog: the stored brief, verbatim and scrollable,
   *  before it is re-fired into a fresh task. */
  runAgain: {
    title: "Run again",
    source: "Brief from \u201C{title}\u201D",
    /** Says what confirming actually does — a new worktree, not a restart. */
    hint: "Runs this brief again in a new task, on its own branch and worktree.",
    confirm: "Run again",
    footer: "\u2191\u2193 scroll \u00B7 \u2190\u2192 choose \u00B7 enter run \u00B7 esc cancel",
  },
  /** Field-notes reader dialog (project row menu). */
  fieldNotes: {
    title: "Field notes",
    empty: "No field notes for this repo yet — agents file one with `rove api note`.",
    loading: "Loading…",
    footer: "↑↓ scroll · esc close",
  },
  /** Inline chip while move/reorder mode is active */
  moveChip: " move",
  /** Narrow mode's top-of-sidebar jump row back into the last-entered task */
  recentJump: "Recent: {title}",
  /** The fold row standing in for a project's routine sessions */
  routinesRow: "{count} routine sessions",
  /** Empty-state messages */
  empty: {
    noMatchSearch: "No matching tasks — esc to clear.",
    noActiveProject: "No active tasks for this project.",
    noActive: "No active tasks — create one above.",
  },
  /** Row-view engine activity labels (shown in subtitle, override branch) */
  activity: {
    /** A turn is in flight — the engine is producing output right now. */
    working: "working",
    rateLimited: "rate limited",
    permissionNeeded: "needs permission",
    error: "error",
    /** The engine PROCESS is gone (pty exit record), not a failed turn. */
    dead: "engine exited",
  },
  /** Row-view special subtitle words */
  subtitle: {
    noTracking: "no activity tracking",
    materializing: "materializing",
    deleting: "deleting",
    deleteFailed: "delete failed",
  },
  /** Set-branch (re-branch) dialog — lists the repo's local branches with
      filter-as-you-type; typing a new name renames the task's branch. */
  reBranch: {
    title: "Set branch",
    fieldLabel: "branch",
    hintNoBranches: "(no local branches — type a new name)",
    hintNoMatch: "(no match — enter renames to this branch)",
    footer: "↑↓ pick · enter set · esc cancel",
  },
  /** Toast / error messages */
  toast: {
    noDaemonWorktree: "No daemon running — can't create the worktree",
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
    copiedBranch: "Copied branch {text}",
    copiedPath: "Copied path {text}",
  },
}

export const zh: typeof en = {
  nav: {
    kanban: "看板",
    automations: "例行任务",
    issues: "议题",
  },
  header: {
    scratch: "临时",
  },
  search: {
    placeholder: "模糊搜索",
  },
  menu: {
    open: "打开",
    openTab: "打开该标签页",
    closeTab: "关闭该标签页",
    newChat: "新建会话",
    newShell: "新建终端",
    newTask: "新建任务",
    forgetProject: "移除项目",
    fieldNotes: "现场笔记",
    rename: "重命名",
    pin: "置顶",
    unpin: "取消置顶",
    reorder: "重新排序",
    runAgain: "重新运行",
    setStatus: "设置状态",
    copyBranch: "复制分支名",
    copyPath: "复制路径",
    openEditor: "在编辑器中打开",
    renameBranch: "重命名分支",
    changeEngine: "切换引擎",
    fixChecks: "修复失败的检查",
    syncBase: "同步基础分支",
    land: "合入基础分支",
    delete: "删除",
  },
  status: {
    backlog: "待办",
    inProgress: "进行中",
    inReview: "待评审",
    done: "已完成",
    canceled: "已取消",
    error: "出错",
  },
  setStatus: {
    title: "设置状态",
    current: "当前",
    footer: "↑↓ 选择 · enter 设置 · esc 取消",
  },
  sync: {
    done: "已把 {base} 合并进该工作树",
    alreadyCurrent: "已经和 {base} 同步",
    conflict: "合并冲突——解决后提交：{files}",
    dirty: "请先提交或暂存工作树里的改动，再同步",
    failed: "同步失败：{error}",
  },
  changeEngine: {
    title: "切换引擎",
    current: "当前",
    footer: "↑↓ 选择 · enter 设置 · esc 取消",
    effortLabel: "推理强度",
    noEffort: "引擎默认",
    footerEffort: "↑↓ 引擎 · ←→ 强度 · enter 设置 · esc 取消",
  },
  runAgain: {
    title: "重新运行",
    source: "来自任务「{title}」的指令",
    hint: "在新任务里重新执行这段指令，新任务有自己的分支和工作树。",
    confirm: "重新运行",
    footer: "\u2191\u2193 滚动 \u00B7 \u2190\u2192 选择 \u00B7 enter 运行 \u00B7 esc 取消",
  },
  fieldNotes: {
    title: "现场笔记",
    empty: "该仓库暂无现场笔记——agent 可用 `rove api note` 记录。",
    loading: "加载中…",
    footer: "↑↓ 滚动 · esc 关闭",
  },
  moveChip: " 移动",
  recentJump: "最近:{title}",
  routinesRow: "{count} 个 routine 会话",
  empty: {
    noMatchSearch: "无匹配任务——按 esc 清除。",
    noActiveProject: "该项目暂无活跃任务。",
    noActive: "暂无活跃任务——在上方新建。",
  },
  activity: {
    working: "运行中",
    rateLimited: "请求受限",
    permissionNeeded: "等待授权",
    error: "错误",
    dead: "引擎已退出",
  },
  subtitle: {
    noTracking: "不跟踪活动",
    materializing: "正在创建 worktree",
    deleting: "正在删除",
    deleteFailed: "删除失败",
  },
  reBranch: {
    title: "设置分支",
    fieldLabel: "分支",
    hintNoBranches: "（没有本地分支——输入新名称）",
    hintNoMatch: "（无匹配——回车将分支重命名为此名）",
    footer: "↑↓ 选择 · enter 设置 · esc 取消",
  },
  toast: {
    noDaemonWorktree: "守护进程未运行——无法创建 worktree",
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
    copiedBranch: "已复制分支 {text}",
    copiedPath: "已复制路径 {text}",
  },
}
