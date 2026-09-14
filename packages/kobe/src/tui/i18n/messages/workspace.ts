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
    /** Every tab of this task was closed — the task and its worktree remain.
     *  Both chords are bound by `EmptyWorkspacePane`, which renders this. */
    noSessions: "No sessions here — press ⏎ or ctrl+e to start one",
    /** Experimental remote (`ssh://`) project: the worktree is on the other
     *  machine, and the PTY host only spawns locally. Said here rather than
     *  letting the launch guard throw through the render path. */
    remoteUnsupported: "Hosted engine launch over SSH is not implemented — this task's worktree is on {host}",
  },
  /** Zero-tasks welcome panel (first launch) */
  welcome: {
    title: "Welcome to Rove",
    tagline: "Run several AI coding sessions side by side — each task gets its own git worktree and branch.",
    /** What a worktree is and why every task has one. */
    worktreeExplain:
      "Each task creates its own git worktree directory and branch, so multiple AI sessions can edit the same codebase in parallel without colliding.",
    /** {key} is the live new-task chord */
    stepNew: "creates your first task — pick a repo, a base branch, an engine",
    /** {key} is the live help chord */
    stepHelp: "shows every shortcut reachable from the current focus",
    /** {key} is the live prefix chord */
    stepPrefix: "opens the command menu",
    /** {list} is the engine CLIs that are installed AND signed in */
    enginesFound: "✓ engines: {list}",
    /** {list} is the installed-but-logged-out engine CLIs. The common cold state:
     *  the CLI is there, so "install one" would be wrong advice. */
    enginesSignedOut: "✗ installed but not signed in: {list} — run one of them in a shell and log in",
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
    clearHint: "d clear",
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
      /** A dead engine PROCESS (pty exit record), not a failed turn. */
      dead: "engine exited",
      /** A routine whose latest firing needs a human. */
      routineFailed: "routine needs you",
    },
    /** Rate-limited card's context line: when the armed auto-resume fires.
     *  `{time}` is a locale-formatted clock time. */
    resumesAt: "resumes {time}",
  },
}

export const zh: typeof en = {
  quit: {
    confirmTitle: "退出 Rove？",
    confirmBody: "守护进程和任务会话会继续运行，这里只关闭原生工作区。",
    confirmLabel: "退出",
  },
  empty: {
    selectTask: "请选择一个带 worktree 的任务",
    noSessions: "这里没有会话——按 ⏎ 或 ctrl+e 开一个",
    remoteUnsupported: "尚未实现通过 SSH 启动托管引擎——该任务的 worktree 在 {host} 上",
  },
  welcome: {
    title: "欢迎使用 Rove",
    tagline: "并行运行多个 AI 编码会话——每个任务都有自己的 git worktree 和分支。",
    worktreeExplain: "每个任务都会创建独立的 git worktree 目录和分支，多个 AI 会话可以并行修改同一份代码库，互不干扰。",
    stepNew: "创建你的第一个任务——选仓库、基础分支和引擎",
    stepHelp: "查看当前焦点下的全部快捷键",
    stepPrefix: "打开命令菜单",
    enginesFound: "✓ 已检测到引擎:{list}",
    enginesSignedOut: "✗ 已安装但未登录:{list}——请在 shell 里运行其中之一并完成登录",
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
    clearHint: "d 清除",
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
      dead: "引擎已退出",
      routineFailed: "例行任务需要处理",
    },
    resumesAt: "{time} 恢复",
  },
}
