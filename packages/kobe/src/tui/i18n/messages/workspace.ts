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
      /** A peer/API message accepted by the daemon but not yet pasted (issue #78). */
      promptDeferred: "message queued",
    },
    /** Toast title when a message is deferred because the composer was busy. */
    deferredToast: "Message queued — composer busy",
    /** Insert feedback: the A/C gate still blocked at release time. */
    deferredStillQueued: "Still typing? The queued message stays in the Inbox — open it again to send.",
    /** Insert feedback: the target tab has no live session to receive the paste. */
    deferredUnavailable: "That tab isn't running — the queued message stays in the Inbox.",
    /** Insert feedback: the release attempt errored (RPC/PTY hiccup). */
    deferredInsertFailed: "Couldn't insert the queued message — it's still in the Inbox.",
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
    worktreeExplain: "每个任务都会创建独立的 git worktree 目录和分支，多个 AI 会话可以并行修改同一份代码库，互不干扰。",
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
      /** peer/API 消息已被 daemon 受理但尚未插入（issue #78）。 */
      promptDeferred: "消息已排队",
    },
    /** composer 忙、消息被受理延后的 toast 标题。 */
    deferredToast: "消息已排队——composer 正忙",
    /** 插入反馈：放行那一刻 A/C 闸门仍拦住。 */
    deferredStillQueued: "还在打字？排队的消息留在收件箱——再打开一次即可发送。",
    /** 插入反馈：目标 tab 没有存活会话可接收。 */
    deferredUnavailable: "该标签页未运行——排队的消息留在收件箱。",
    /** 插入反馈：放行过程出错（RPC/PTY 故障）。 */
    deferredInsertFailed: "无法插入排队的消息——它仍在收件箱中。",
  },
  terminalComing: "嵌入终端正在启动……",
}
