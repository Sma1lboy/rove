/**
 * `files.*` messages. English is the source of truth; `zh: typeof en` keeps
 * the shapes locked together. Filled during the TUI i18n migration.
 */

export const en = {
  /** Error toast when `a` has no engine session to paste the mention into. */
  mentionNoEngine: "No engine session in this task — nothing to mention into. Open one with ctrl+t.",
  tabs: {
    all: "All",
    changes: "Changes",
  },
  actions: {
    zen: "Zen",
    createPR: "Ask agent to create PR",
    /** Chip on the Changes tab — the whole worktree's diff in one tab. */
    diffAll: "[D] diff everything",
  },
  legend: {
    changes: "M modified · A added · D deleted · ? untracked",
  },
  scope: {
    working: "scope: working tree",
    branch: "scope: vs {base}",
    toggleHint: "b to toggle",
    /** Stated in place of the toggle hint when no base ref resolved: Branch
     *  scope is unreachable, and a silent `b` reads as a broken key. */
    noBase: "no base ref for branch scope (no origin/HEAD, main or master)",
  },
  empty: {
    noTask: "(no task — press n to create)",
    noFiles: "(empty worktree)",
    noChanges: "(no changes — clean worktree)",
  },
  error: {
    /** Only rendered for the two kinds `r` can actually resolve — see
     *  {@link gitErrorIsRetryable}. */
    retryHint: "press r to retry",
    notGitRepo: "not a git repository — run `git init` here, or open a task in a repo",
    // Matches `tasks.toast.worktreeGoneBody`, which prescribes the same
    // recovery for the same condition.
    pathMissing: "the worktree directory is gone — reopen the task to re-create it",
    permissionDenied: "permission denied reading the worktree — check the directory's owner and mode",
    // Wording aligned with `doctor.fix.git` / `doctor.fix.gitAction`.
    gitNotInstalled: "git is not on PATH — install it with your OS package manager",
    gitFailed: "git command failed",
  },
  toast: {
    prOnTargetBranch: "Already on the target branch ({branch}) — ask the agent to create the PR from a task branch",
    /** `gh` unavailable, the run expired, or the checks went green while the
     *  menu was open — better than pasting a prompt with no evidence in it. */
    ciNoFailingChecks: "No failing check logs to read — the run may have expired, or the checks are no longer red",
  },
}

export const zh: typeof en = {
  /** `a` 没有引擎会话可粘贴提及时的错误 toast。 */
  mentionNoEngine: "这个任务没有引擎会话——没有地方可以提及。用 ctrl+t 开一个。",
  tabs: {
    all: "全部",
    changes: "改动",
  },
  actions: {
    zen: "专注模式",
    createPR: "让 agent 创建 PR",
    diffAll: "[D] 查看全部改动",
  },
  legend: {
    changes: "M 已修改 · A 已添加 · D 已删除 · ? 未跟踪",
  },
  scope: {
    working: "范围：工作区改动",
    branch: "范围：对比 {base}",
    toggleHint: "按 b 切换",
    noBase: "分支范围没有基准 ref（没有 origin/HEAD、main 或 master）",
  },
  empty: {
    noTask: "（暂无任务 — 按 n 创建）",
    noFiles: "（worktree 为空）",
    noChanges: "（无改动 — worktree 干净）",
  },
  error: {
    retryHint: "按 r 重试",
    notGitRepo: "不是 git 仓库——在这里执行 `git init`，或改为打开仓库里的任务",
    pathMissing: "worktree 目录已不存在——重新打开该任务会重建它",
    permissionDenied: "读取 worktree 时权限不足——请检查该目录的属主和权限",
    gitNotInstalled: "PATH 上找不到 git——请用系统包管理器安装",
    gitFailed: "git 命令失败",
  },
  toast: {
    prOnTargetBranch: "当前就在目标分支（{branch}）— 请在任务分支上让 agent 创建 PR",
    ciNoFailingChecks: "没有可读的失败检查日志——运行记录可能已过期，或检查已不再是红的",
  },
}
