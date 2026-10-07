import { en as toastEn, zh as toastZh } from "./tasks-toast"

/**
 * `tasks.*` messages. English is the source of truth; `zh: typeof en` keeps
 * the shapes locked together.
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
    /** Project row: jump the project above every other. Menu-only. */
    moveToTop: "Move to top",
    /** Project row: move mode on its main row, so j/k move the project. */
    reorderProject: "Reorder project",
    /** Re-fire the task's stored brief as a new task. Menu-only. */
    runAgain: "Run again",
    /** Menu-only, like `runAgain`, `land`, `fieldNotes` and the two copies —
     *  status has no key yet, so the menu is its only route. */
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
    dirty: "Commit the worktree's changes first, then sync: {files}",
    failed: "Sync failed: {error}",
  },
  /** Change-engine picker dialog (the menu route of `v`). */
  changeEngine: {
    title: "Change engine",
    current: "current",
    /** Leading label of the reasoning-level row (engines that declare levels). */
    effortLabel: "EFFORT",
    /** The level choice meaning "don't pin one — use the engine's own default". */
    noEffort: "engine default",
    /** Footer segments, joined with " · " — only the rows on screen add theirs. */
    footer: {
      engine: "↑↓ engine",
      effort: "←→ effort",
      model: "tab model",
      set: "enter set",
      cancel: "esc cancel",
    },
  },
  /** The model row shared by every engine-choosing dialog (`model-field.tsx`). */
  engineModel: {
    label: "MODEL",
    /** Empty input = don't pin one — the engine's own default. */
    placeholder: "engine default",
    loading: "listing models…",
  },
  /** Auto-routing tier names — the user-facing vocabulary; never an engine. */
  tier: {
    swift: "swift",
    standard: "standard",
    deep: "deep",
    manual: "manual",
  },
  /** What each depth is FOR. Names no vendor, model or flag — the mapping
   *  table (Settings → Auto routing) is the only place those appear. */
  tierDesc: {
    swift: "small, well-specified edits — the fastest, cheapest setting",
    standard: "everyday feature work and bug fixes",
    deep: "hard problems: unclear root causes, large refactors, design decisions",
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
    /** Footer when the reader can also retire a note (`d`). */
    footerDeletable: "↑↓ select · d delete · esc close",
    /** `d` on a note. The body quotes the note so the confirm names the fact
     *  being retired, not just "a note". `{text}` = the note's own line. */
    confirmDelete: {
      title: "Delete this field note?",
      body: "“{text}” stops being injected into new sessions on this repo. Nothing else changes.",
    },
  },
  /** The destructive confirms on a task row (`d` on the tasks pane). Every
   *  body says what SURVIVES, because that is the fact that decides whether
   *  a user should press enter. */
  confirm: {
    cancel: "cancel",
    /** A project row is a saved repo, not a worktree — `d` un-saves it. */
    forgetProjectTitle: 'Remove project "{title}"?',
    forgetProjectBody:
      "Forgets it from the projects list. The repo, its branches, worktrees, and any tasks under it stay on disk — re-add it with `rove add`.",
    forgetProjectConfirm: "remove",
    deleteTitle: 'Delete "{title}"?',
    /** A `dir` task pins the user's own directory; deletion never touches it. */
    deleteBodyDir: "Removes the task entry. The directory itself stays on disk. Its hosted sessions are stopped.",
    deleteBodyTask: "Removes the task entry and its worktree. The git branch stays. Its hosted sessions are stopped.",
    deleteConfirm: "delete",
    forceDeleteTitle: '"{title}" has uncommitted changes',
    forceDeleteConfirm: "force delete",
  },
  /** Bare text prompt behind `b` on hosts without the branch picker. */
  renameBranch: {
    title: "Rename branch",
    fieldLabel: "branch",
  },
  /** Inline chip while move/reorder mode is active */
  moveChip: " move",
  /** Narrow mode's top-of-sidebar jump row back into the last-entered task */
  recentJump: "Recent: {title}",
  /** The fold row standing in for a project's routine sessions */
  routinesRow: "{count} routine sessions",
  /** Machine section headers — another computer running its own Rove daemon */
  machine: {
    connecting: "connecting…",
    offline: "offline",
    unsupported: "unsupported",
    mismatch: "protocol mismatch",
    /** Files/diff placeholder for a task whose worktree is on another machine */
    filesElsewhere: "on {host}",
    filesHint: "This task's worktree lives on {host}. Opening remote files arrives in a later release.",
  },
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
  /**
   * The DERIVED task group — whose turn it is, computed from the worker's
   * report, the PR observation, engine activity and tab liveness
   * (`lib/task-group.ts`). Distinct from `activity` above, which names what
   * ONE engine is doing: these name what the TASK needs from a person, which
   * is what the board badge and the row ordering are about. `idle` and
   * `unknown` are deliberately unlabelled — a row with nothing to do says so
   * by drawing nothing.
   */
  group: {
    /** Blocked on a human: permission, a quota wall, a settled error, a dead
     *  tab that delivered nothing, a failed deletion. */
    waitingOnYou: "needs you",
    /** PR open and approved — the merge is yours to do. */
    landing: "ready to land",
    /** A report landed (or a turn finished) and nobody has acted on it. */
    readyForReview: "needs review",
    /** An engine is producing output, or the daemon will resume it on a
     *  timer. Nothing here for a person. */
    working: "working",
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
  toast: toastEn,
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
    moveToTop: "移到顶部",
    reorderProject: "调整项目顺序",
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
    dirty: "请先提交工作树里的改动，再同步：{files}",
    failed: "同步失败：{error}",
  },
  changeEngine: {
    title: "切换引擎",
    current: "当前",
    effortLabel: "推理强度",
    noEffort: "引擎默认",
    footer: {
      engine: "↑↓ 引擎",
      effort: "←→ 强度",
      model: "tab 模型",
      set: "enter 设置",
      cancel: "esc 取消",
    },
  },
  engineModel: {
    label: "模型",
    placeholder: "引擎默认",
    loading: "正在列出模型…",
  },
  tier: {
    swift: "轻快",
    standard: "标准",
    deep: "深入",
    manual: "手动",
  },
  tierDesc: {
    swift: "小而明确的改动——最快、最省的一档",
    standard: "日常的功能开发和修 bug",
    deep: "难题：根因不明、大重构、设计决策",
  },
  runAgain: {
    title: "重新运行",
    source: "来自任务「{title}」的指令",
    hint: "在新任务里重新执行这段指令，新任务有自己的分支和工作树。",
    confirm: "重新运行",
    footer: "\u2191\u2193 滚动 \u00B7 \u2190\u2192 选择 \u00B7 enter 运行 \u00B7 esc 取消",
  },
  confirm: {
    cancel: "取消",
    forgetProjectTitle: "从列表中移除项目「{title}」？",
    forgetProjectBody:
      "只是把它从项目列表里忘掉。仓库、分支、worktree 以及它下面的任务都会留在磁盘上——之后可以用 `rove add` 重新加回来。",
    forgetProjectConfirm: "移除",
    deleteTitle: "删除「{title}」？",
    deleteBodyDir: "只删除任务条目。目录本身会留在磁盘上。它的托管会话会被停止。",
    deleteBodyTask: "删除任务条目和它的 worktree。git 分支会保留。它的托管会话会被停止。",
    deleteConfirm: "删除",
    forceDeleteTitle: "「{title}」有未提交的改动",
    forceDeleteConfirm: "强制删除",
  },
  renameBranch: {
    title: "重命名分支",
    fieldLabel: "分支",
  },
  fieldNotes: {
    title: "现场笔记",
    empty: "该仓库暂无现场笔记——agent 可用 `rove api note` 记录。",
    loading: "加载中…",
    footer: "↑↓ 滚动 · esc 关闭",
    footerDeletable: "↑↓ 选择 · d 删除 · esc 关闭",
    confirmDelete: {
      title: "删除这条现场笔记?",
      body: "「{text}」将不再注入该仓库的新会话。其他内容不受影响。",
    },
  },
  moveChip: " 移动",
  recentJump: "最近:{title}",
  routinesRow: "{count} 个 routine 会话",
  machine: {
    connecting: "连接中…",
    offline: "离线",
    unsupported: "不支持",
    mismatch: "协议不兼容",
    filesElsewhere: "在 {host} 上",
    filesHint: "这个任务的 worktree 在 {host} 上。读取远端文件会在后续版本提供。",
  },
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
  group: {
    waitingOnYou: "等你处理",
    landing: "可以合了",
    readyForReview: "待你验收",
    working: "运行中",
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
  toast: toastZh,
}
