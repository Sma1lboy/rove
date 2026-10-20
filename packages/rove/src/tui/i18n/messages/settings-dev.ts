/**
 * `settings.dev.*` — copy for the Settings Dev section (reset, restart,
 * reload, experiments). Spread into `./settings.ts`'s `en` / `zh`, so keys
 * stay `settings.dev.…`. `zh: typeof en` mirrors the English shape exactly.
 */

export const en = {
  dev: {
    reset: "Reset UI state",
    resetHint:
      "Clears ~/.config/rove/state.json and ~/.rove/tasks.json, then quits Rove — relaunch to start fresh. Working session list, pane sizes, theme, model picks all reset. Worktrees on disk and engine session history are not touched.",
    resetButton: "[enter] Reset",
    restart: "Restart backend",
    restartHint:
      "Stops the Rove daemon and relaunches this window on the installed build — picks up daemon / orchestrator / engine edits without quitting by hand. Running engine sessions live in the PTY host and survive it; other attached Rove windows reconnect on their own.",
    restartButton: "[enter] Restart",
    reload: "Reload settings",
    reloadHint:
      "Applies hand edits to ~/.config/rove/state.json (from `rove config`) to this window without a restart.",
    reloadButton: "[enter] Reload",
    reloadDone: "Reloaded: {count} changed.",
    reloadUnchanged: "Already matches state.json; nothing changed.",
    reloadFailed: "state.json could not be read, nothing changed: {error}",
    doctorHint:
      "Daemon wedged or unresponsive? Restart backend above does it from here; from a shell it is `rove daemon restart`. Hosted engine sessions stay alive across a daemon restart.",
    experimental: "Experimental",
    remoteHint:
      "Remote projects (SSH): register a project whose git worktrees live on another host, driven from this local Rove. Unfinished — Hosted PTY engine launch over SSH is not implemented, and file/diff panes still degrade. Enables `rove add --remote`.",
    remote: "Remote projects",
    autoStatusHint:
      "Auto status flow: a backlog task moves to in_progress when its engine starts a turn, and new sessions get a system-prompt note telling the agent to set in_review itself when the work is done. Never touches done/canceled.",
    autoStatus: "Auto status flow",
    dispatcherHint:
      "Field-notes dispatcher: task sessions file one-line gotchas (`rove api note`), the daemon forwards each to the repo's main session, and that session relays them to the in-flight tasks that benefit (`rove api dispatch`). Web-hosted sessions receive the relays today.",
    dispatcher: "Field-notes dispatcher",
  },
}

export const zh: typeof en = {
  dev: {
    reset: "重置 UI 状态",
    resetHint:
      "清空 ~/.config/rove/state.json 和 ~/.rove/tasks.json，然后退出 Rove——重新启动即可从头开始。工作会话列表、面板尺寸、主题、模型选择都会重置。磁盘上的 worktree 和引擎会话历史不受影响。",
    resetButton: "[enter] 重置",
    restart: "重启后端",
    restartHint:
      "停止 Rove daemon，并以已安装的版本重新启动当前窗口——无需手动退出即可应用 daemon / orchestrator / engine 的改动。正在运行的引擎会话由 PTY host 托管，不受影响；其他已连接的 Rove 窗口会自行重连。",
    restartButton: "[enter] 重启",
    reload: "重新加载设置",
    reloadHint: "把对 ~/.config/rove/state.json 的手动修改（来自 `rove config`）应用到当前窗口，无需重启。",
    reloadButton: "[enter] 重新加载",
    reloadDone: "已重新加载：{count} 项有变化。",
    reloadUnchanged: "已与 state.json 一致，没有变化。",
    reloadFailed: "无法读取 state.json，未做任何改动：{error}",
    doctorHint:
      "daemon 卡住或无响应？上面的「重启后端」就能在这里完成；在 shell 里则是 `rove daemon restart`。Hosted PTY 引擎会话不会因 daemon 重启而退出。",
    experimental: "实验性",
    remoteHint:
      "远程项目（SSH）：注册一个 git worktree + 引擎都通过 SSH 跑在另一台主机上、由本地 Rove 驱动的项目。尚未完成——文件/diff 面板对远程仍会降级。启用 `rove add --remote`。",
    remote: "远程项目",
    autoStatusHint:
      "自动状态流转：backlog 任务在其引擎开始一轮时移到 in_progress，新会话会拿到一条系统提示，告诉 agent 完成后自行设为 in_review。绝不触碰 done/canceled。",
    autoStatus: "自动状态流转",
    dispatcherHint:
      "现场笔记调度器：任务会话提交一行经验（`rove api note`），daemon 将每条转发给仓库的主会话，主会话再把它们转达给能受益的进行中任务（`rove api dispatch`）。目前由 Web 托管的会话会收到转达。",
    dispatcher: "现场笔记调度器",
  },
}
