/**
 * `worktrees.*` messages — the standalone worktree-management page
 * (`kobe worktrees`). English is the source of truth; `zh: typeof en` keeps
 * the shapes locked together.
 */

export const en = {
  title: "Worktrees",
  loading: "Loading worktrees…",
  noProjects: "No local projects known to Rove yet.",
  noWorktrees: "No worktrees.",

  badge: {
    kobeManaged: "rove",
    dirty: "dirty",
    dirtyUnknown: "dirty?",
    remoteOn: "on remote",
    remoteOff: "not pushed",
    remoteUnknown: "remote unknown",
  },

  verdict: {
    prOpen: "PR open",
    prMerged: "merged (PR)",
    inMain: "in main",
    prClosed: "PR closed",
    idle: "stale",
  },

  row: {
    detached: "(detached)",
    created: "created {age} ago",
  },

  delete: {
    button: "Delete",
    confirmTitle: "Delete worktree?",
    confirmBody: 'Delete the worktree for "{branch}"? This removes the working directory; the branch itself is kept.',
    forceTitle: "Force delete worktree?",
    /** Shared with the task force-delete confirm (`tui/lib/task-actions.ts`):
        the same event, and it used to be described twice in different words,
        one of them shouting. Neither said the true part — every force path
        snapshots the work first (`orchestrator/worktree/manager-remove.ts`
        calls `salvageWorktree` before `git worktree remove --force`), and
        overstating the danger pushes people to cancel a safe operation. */
    forceBody:
      '"{branch}" has uncommitted, untracked, or gitignored work. Force delete removes the worktree, but the work is snapshotted first to a salvage ref — list them with `git for-each-ref refs/rove/salvage`. Force delete anyway?',
    /** The daemon's own words for WHICH of the three refusals fired. Only that
        message names the gitignored paths, and `git status` cannot see those —
        without them the user goes looking with a command that reports nothing. */
    forceReason: "Refused because: {reason}",
    failed: "Failed to delete worktree: {error}",
    residue:
      "Git deregistered the worktree, but couldn't delete {path} ({reason}). Rove is done with it — retrying won't help; delete the directory by hand if you want the space.",
  },

  land: {
    button: "Land",
    confirmTitle: "Land branch?",
    // NAMES the destination and the commit count, both read before the dialog
    // opens (`task.landPreflight`). The old copy said "the base repo's current
    // branch" — a description of a value Rove already had — on the one screen
    // where the docs tell you to check it. The refusals it used to warn about
    // (dirty base, empty branch) now stop the land BEFORE this dialog, so they
    // are gone from the body.
    confirmBody:
      'Merge "{branch}" into {landedOn} ({commits} commits), then remove this worktree? The branch is kept. Conflicts abort with a file list.',
    /** Singular sibling of {@link confirmBody} — "1 commits" is the kind of
     *  wrong that makes a user distrust the number next to it. */
    confirmBodyOne:
      'Merge "{branch}" into {landedOn} (1 commit), then remove this worktree? The branch is kept. Conflicts abort with a file list.',
    noTask: "This worktree isn't tracked as a Rove task — nothing to land.",
    conflict: "Land hit conflicts (merge aborted). Resolve by hand: {files}",
    dirtyBase:
      "The base checkout has uncommitted changes — commit them, then land. Never `git stash` here: the stash stack lives in the repo's common dir and is shared by every linked worktree, so a stash can entangle other tasks' work.",
    failed: "Land failed: {error}",
    done: 'Landed "{branch}" onto {landedOn} ({commit}).',
    worktreeKept: "Landed, but the worktree was kept: {reason}",
    worktreePathStale: "Landed and removed the worktree, but the task still points at it: {reason}",
    worktreeResidue:
      "Landed. Git deregistered the worktree, but couldn't delete {path} ({reason}) — delete the directory by hand if you want the space.",
  },

  hint: {},
}

export const zh: typeof en = {
  title: "工作树",
  loading: "正在加载 worktree…",
  noProjects: "Rove 还没有已知的本地项目。",
  noWorktrees: "没有 worktree。",

  badge: {
    kobeManaged: "rove",
    dirty: "有改动",
    dirtyUnknown: "改动未知",
    remoteOn: "已推送",
    remoteOff: "未推送",
    remoteUnknown: "远端未知",
  },

  verdict: {
    prOpen: "PR 评审中",
    prMerged: "已合入 (PR)",
    inMain: "已在主分支",
    prClosed: "PR 已关闭",
    idle: "陈旧",
  },

  row: {
    detached: "(游离状态)",
    created: "{age}前创建",
  },

  delete: {
    button: "删除",
    confirmTitle: "删除 worktree？",
    confirmBody: '确定删除 "{branch}" 对应的 worktree？工作目录会被移除，分支本身会保留。',
    forceTitle: "强制删除 worktree？",
    forceBody:
      '"{branch}" 存在未提交、未跟踪或被 gitignore 的改动。强制删除会移除 worktree，但这些改动会先被快照到一个 salvage ref——用 `git for-each-ref refs/rove/salvage` 可以列出它们。仍要强制删除吗？',
    forceReason: "拒绝原因：{reason}",
    failed: "删除 worktree 失败：{error}",
    residue:
      "Git 已注销该 worktree，但没能删掉 {path}（{reason}）。Rove 这边已经处理完了——重试没有用；想要回磁盘空间请手动删除该目录。",
  },

  land: {
    button: "合入",
    confirmTitle: "合入分支？",
    confirmBody:
      '把 "{branch}" 合入 {landedOn}（{commits} 个提交），然后移除这个 worktree？分支会保留。冲突会中止并给出文件清单。',
    confirmBodyOne:
      '把 "{branch}" 合入 {landedOn}（1 个提交），然后移除这个 worktree？分支会保留。冲突会中止并给出文件清单。',
    noTask: "该 worktree 未作为 Rove 任务被跟踪——没有可合入的对象。",
    conflict: "合入遇到冲突（已中止）。请手动解决：{files}",
    dirtyBase:
      "基础检出有未提交改动——请先提交再合入。绝不要在这里 `git stash`：stash 栈存放在仓库的 common dir 中，该仓库所有 linked worktree 共享，一次 stash 可能纠缠其他任务的工作。",
    failed: "合入失败：{error}",
    done: '已把 "{branch}" 合入 {landedOn}（{commit}）。',
    worktreeKept: "已合入，但 worktree 保留了：{reason}",
    worktreePathStale: "已合入并移除 worktree，但任务仍指向它：{reason}",
    worktreeResidue: "已合入。Git 已注销该 worktree，但没能删掉 {path}（{reason}）——想要回磁盘空间请手动删除该目录。",
  },

  hint: {},
}
