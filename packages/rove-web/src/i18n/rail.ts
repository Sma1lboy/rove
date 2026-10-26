/** `rail`, `inbox` messages. English is the source of truth; `zh: typeof en` keeps the shapes locked together. */
export const en = {
  rail: {
    inbox: "inbox {count}",
    empty: "no tasks yet",
    emptyHint: "start one with New task above, in the TUI, or with `rove api add`",
    newTask: "New task",
    noProject: "Ungrouped",
    extraRepos: "{count} more repos in this task",
    pr: {
      state: { open: "open", merged: "merged", closed: "closed" },
      many: "{count} PRs in this task and its children",
      checks: {
        conflict: "conflicts with its base",
        failing: "checks failing",
        passing: "checks passing",
        pending: "checks running",
      },
    },
    searchPlaceholder: "fuzzy filter",
    engineSwitched: "Engine → {engine} (applies on reopen)",
    engineSwitchFailed: "could not switch engine: {error}",
  },
  inbox: {
    title: "inbox",
    hints: "↑↓ move · enter open · d clear · esc close",
    attention: "attention",
    recent: "recent",
    empty: "no pending attention",
    state: {
      done: "done",
      needsInput: "needs input",
      error: "error",
      rateLimited: "rate limited",
      dead: "engine exited",
      routineFailed: "routine needs you",
    },
  },
}

export const zh: typeof en = {
  rail: {
    inbox: "收件箱 {count}",
    empty: "还没有任务",
    emptyHint: "用上面的「新建任务」、在 TUI 里或用 `rove api add` 新建一个",
    newTask: "新建任务",
    noProject: "未分组",
    extraRepos: "这个任务还含 {count} 个仓库",
    pr: {
      state: { open: "进行中", merged: "已合并", closed: "已关闭" },
      many: "这个任务及子任务共 {count} 个 PR",
      checks: { conflict: "与基础分支冲突", failing: "检查未通过", passing: "检查已通过", pending: "检查进行中" },
    },
    searchPlaceholder: "模糊搜索",
    engineSwitched: "引擎 → {engine}（重新打开后生效）",
    engineSwitchFailed: "切换引擎失败：{error}",
  },
  inbox: {
    title: "收件箱",
    hints: "↑↓ 移动 · enter 打开 · d 清除 · esc 关闭",
    attention: "待处理",
    recent: "最近使用",
    empty: "暂无待处理",
    state: {
      done: "完成",
      needsInput: "需要输入",
      error: "出错",
      rateLimited: "限流",
      dead: "引擎已退出",
      routineFailed: "例行任务需要处理",
    },
  },
}
