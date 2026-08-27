/**
 * `workspace.*` messages — the PureTUI Workspace Host:
 * the quit-confirm dialog and the "no task selected" empty state. English is
 * the source of truth; `zh: typeof en` keeps the shapes locked together.
 */

export const en = {
  quit: {
    confirmTitle: "Quit Rove?",
    confirmBody: "The daemon and task sessions keep running. This closes only the native workspace.",
    confirmLabel: "Quit",
  },
  empty: {
    selectTask: "Select a task with a worktree",
  },
  /** Zero-tasks welcome panel (first launch / everything archived) */
  welcome: {
    title: "Welcome to Rove",
    tagline: "Run several AI coding sessions side by side — each task gets its own git worktree and branch.",
    /** {key} is the live new-task chord */
    stepNew: "creates your first task — pick a repo, a base branch, an engine",
    /** {key} is the live help chord */
    stepHelp: "shows every shortcut reachable from the current focus",
    /** {key} is the live prefix chord */
    stepPrefix: "opens the command menu",
    /** {list} is the detected engine CLIs, e.g. "claude · codex" */
    enginesFound: "✓ engines: {list}",
    enginesMissing: "✗ no engine CLI found — install claude, codex, copilot, or kimi, then restart Rove",
    gitMissing: "✗ git not found on PATH — Rove needs git to create worktrees",
    doctorHint: "run `rove doctor` in a shell for the full diagnosis",
    docsHint: "docs: https://docs.rove.run",
  },
  attention: {
    none: "No available Inbox items",
  },
  inbox: {
    title: "INBOX",
    empty: "No pending attention",
    openHint: "enter open",
    deleteHint: "d delete",
    /** Cards clipped past the visible window. `{count}` = hidden card count. */
    more: "+{count} more",
    section: {
      attention: "ATTENTION",
      recent: "RECENT",
    },
    state: {
      done: "done",
      needsInput: "needs input",
      error: "error",
      rateLimited: "rate limited",
      running: "running",
    },
  },
  terminalComing: "Embedded terminal is starting...",
}

export const zh: typeof en = {
  quit: {
    confirmTitle: "退出 Rove？",
    confirmBody: "守护进程和任务会话会继续运行，这里只关闭原生工作区。",
    confirmLabel: "退出",
  },
  empty: {
    selectTask: "请选择一个带 worktree 的任务",
  },
  welcome: {
    title: "欢迎使用 Rove",
    tagline: "并行运行多个 AI 编码会话——每个任务都有自己的 git worktree 和分支。",
    stepNew: "创建你的第一个任务——选仓库、基础分支和引擎",
    stepHelp: "查看当前焦点下的全部快捷键",
    stepPrefix: "打开命令菜单",
    enginesFound: "✓ 已检测到引擎:{list}",
    enginesMissing: "✗ 未找到引擎 CLI——请安装 claude、codex、copilot 或 kimi 后重启 Rove",
    gitMissing: "✗ PATH 上没有 git——Rove 需要 git 来创建 worktree",
    doctorHint: "在 shell 里运行 `rove doctor` 查看完整诊断",
    docsHint: "文档:https://docs.rove.run",
  },
  attention: {
    none: "收件箱中没有可打开的项目",
  },
  inbox: {
    title: "收件箱",
    empty: "暂无待处理",
    openHint: "enter 打开",
    deleteHint: "d 删除",
    more: "还有 {count} 条",
    section: {
      attention: "待处理",
      recent: "最近使用",
    },
    state: {
      done: "完成",
      needsInput: "需要输入",
      error: "出错",
      rateLimited: "限流",
      running: "进行中",
    },
  },
  terminalComing: "嵌入终端正在启动……",
}
