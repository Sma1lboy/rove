/**
 * `workItems.*` messages — the external-tracker (GitHub issues) page. English
 * is the source of truth; `zh: typeof en` keeps the shapes locked together.
 */

export const en = {
  title: "ISSUES",
  noRepo: "no project",
  empty: "No open issues.",
  assignedFilter: "assigned to me",
  starting: "Starting work on #{number}…",
  startedNoEngine: "Created {title}, but its engine did not start.",
  /** Error-toast title when starting work fails. `{number}` = issue number, `{error}` = the daemon's message. */
  startFailed: "Couldn't start work on #{number}: {error}",
  errorHint: {
    noRemote: "Add a GitHub remote (`git remote add origin <url>`) and try again, or press q / esc to close.",
    ghMissing: "Install the `gh` CLI and authenticate, or press q / esc to close.",
    auth: "Run `gh auth login`, or press q / esc to close.",
    fallback: "{message} · press q / esc to close",
  },
}

export const zh: typeof en = {
  title: "议题",
  noRepo: "无项目",
  empty: "没有开放的议题。",
  assignedFilter: "分配给我的",
  starting: "正在开始处理 #{number}…",
  startedNoEngine: "已创建 {title}，但引擎没有启动。",
  /** 开始处理失败时的错误 toast 标题。`{number}` = 议题编号，`{error}` = daemon 返回的信息。 */
  startFailed: "开始处理 #{number} 失败：{error}",
  errorHint: {
    noRemote: "添加 GitHub remote（`git remote add origin <url>`）后重试，或按 q / esc 关闭。",
    ghMissing: "安装 `gh` CLI 并登录，或按 q / esc 关闭。",
    auth: "执行 `gh auth login`，或按 q / esc 关闭。",
    fallback: "{message} · 按 q / esc 关闭",
  },
}
