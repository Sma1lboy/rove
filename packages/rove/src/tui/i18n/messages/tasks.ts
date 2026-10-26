import { en as confirmEn, zh as confirmZh } from "./tasks-confirm"
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
    mods: "Mods",
  },
  /** Section headers */
  header: {
    scratch: "Ungrouped",
  },
  /** Search bar */
  search: {
    placeholder: "fuzzy filter",
  },
  /** Sort mode line; `{mode}` is one of `sort.modes`. The web rail reads the same copy. */
  sort: {
    label: "sort: {mode}",
    hint: "Change the order (manual → newest → attention → name)",
    reorderSwitched: "Reorder needs manual order — switched",
    modes: {
      default: "manual",
      recent: "newest",
      attention: "attention",
      name: "name",
    },
  },
  /** Tree sidebar right-click menu. Each entry mirrors a chord the row
   *  already answers to, so the menu is a second route rather than a second
   *  set of rules. */
  menu: {
    open: "Open",
    /** A task with children: fold or unfold them. Menu-only (no chord yet). */
    collapseChildren: "Collapse children",
    expandChildren: "Expand children",
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
    /** Also chord-less: put the row's task id / branch / worktree path on the clipboard. */
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
    land: "Land into base branch",
    /** Hide the task and its children from the sidebar; nothing is stopped or removed. Menu-only. */
    archive: "Archive",
    unarchive: "Unarchive",
    delete: "Remove session",
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
  /** Row menu "Archive" / "Unarchive". Archive only hides: the copy must not read like teardown. */
  archive: {
    done: "Archived {title}. Its worktree, branch and sessions are untouched",
    restored: "Restored {title}",
    busyTitle: "Archive while it's working?",
    busyBody: "An engine in {title} is still working or waiting on you. Archiving hides the row without stopping it.",
    busyConfirm: "Archive anyway",
    failed: "Couldn't archive: {error}",
    restoreFailed: "Couldn't restore: {error}",
  },
  /** Row menu "Re-run failed checks" outcomes. */
  rerun: {
    started: "Re-running failed checks",
    none: "No failed checks to re-run",
    external: "These checks didn't run on GitHub Actions; re-run them where they ran",
    refused: "Re-run refused: {detail}",
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
  confirm: confirmEn,
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
  routinesRowOne: "1 routine session",
  /** The fold row at the end of the sidebar holding archived tasks */
  archivedRow: "Archived · {count}",
  /** Machine section headers — another computer running its own Rove daemon */
  machine: {
    connecting: "connecting…",
    offline: "offline",
    unsupported: "unsupported",
    mismatch: "protocol mismatch",
    /** Files/diff placeholder for a task whose worktree is on another machine */
    filesElsewhere: "on {host}",
    filesHint: "{host} is unreachable right now; its files show here again when it reconnects.",
    /** Workspace placeholder for a task on another machine, until its terminals can be opened here */
    terminalElsewhere: "This task runs on {host}, which is unreachable right now.",
    runsOn: "on {host}",
    noTabs: "No tabs on {host} yet — prefix t opens one there.",
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
    mods: "Mods",
  },
  header: {
    scratch: "未分组",
  },
  search: {
    placeholder: "模糊搜索",
  },
  sort: {
    label: "排序：{mode}",
    hint: "切换排序（手动 → 最新 → 关注 → 名称）",
    reorderSwitched: "调整顺序需手动排序，已切换",
    modes: {
      default: "手动",
      recent: "最新",
      attention: "关注",
      name: "名称",
    },
  },
  menu: {
    open: "打开",
    collapseChildren: "折叠子任务",
    expandChildren: "展开子任务",
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
    land: "合入基础分支",
    archive: "归档",
    unarchive: "取消归档",
    delete: "移除会话",
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
  archive: {
    done: "已归档 {title}。工作树、分支和会话都保持原样",
    restored: "已恢复 {title}",
    busyTitle: "它还在工作，仍要归档？",
    busyBody: "{title} 里有引擎仍在工作或在等你。归档只隐藏这一行，不会停止它。",
    busyConfirm: "仍要归档",
    failed: "归档失败：{error}",
    restoreFailed: "恢复失败：{error}",
  },
  rerun: {
    started: "正在重新运行失败的检查",
    none: "没有可重新运行的失败检查",
    external: "这些检查不是在 GitHub Actions 上运行的，请到它们运行的地方重新运行",
    refused: "无法重新运行：{detail}",
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
  confirm: confirmZh,
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
  routinesRowOne: "1 个 routine 会话",
  archivedRow: "已归档 · {count}",
  machine: {
    connecting: "连接中…",
    offline: "离线",
    unsupported: "不支持",
    mismatch: "协议不兼容",
    filesElsewhere: "在 {host} 上",
    filesHint: "{host} 暂时连不上；重新连上后这里会再显示它的文件。",
    terminalElsewhere: "这个任务跑在 {host} 上，暂时连不上。",
    runsOn: "在 {host} 上",
    noTabs: "{host} 上还没有 tab——按 prefix t 在那里新开一个。",
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
