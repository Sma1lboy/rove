/**
 * `update.*` messages. English is the source of truth; `zh: typeof en` keeps
 * the shapes locked together. Filled during the TUI i18n migration.
 */

export const en = {
  pageTitle: "ROVE UPDATE",
  /** Page-header close affordance, opposite the title. Keys stay literal;
   *  only the verb is translated — same shape as `versions.footerHint`. */
  closeHint: "q / esc close",
  /** Brand-row chip — must stay tiny, the rail is the narrowest panel. */
  chip: "↑ {version}",
  current: "current",
  latest: "latest",
  /** The registry check failed (offline, npm down, timeout). Must stay
   *  distinct from "you are up to date". */
  latestUnknown: "unknown — could not reach the registry",
  /** The registry answered and nothing is newer. Distinct from
   *  `latestUnknown`: this one is a checked fact, not a failed lookup. Worded
   *  for BOTH cases it covers — the installed build can equal the published
   *  release or be ahead of it (a local build, a lagging dist-tag). */
  upToDate: "No newer release — nothing to install.",
  releaseUrlUnavailable: "release URL unavailable",
  statusReleaseOpened: "Opened release page in your browser.",
  statusReleaseError: "Could not open release URL.",
  statusRunningUpdater: "Closing the TUI and running the updater in this terminal...",
  loadingNotes: "Loading release notes...",
  notesUnavailable: "Release notes are unavailable. Use Open release to view the GitHub release page.",
  changesSectionHeader: "── changes from v{from} to v{to} ──",
  updateComplete: "Rove update complete. Relaunch Rove to use the new version.",
  updateFailed: "Rove update failed with exit code {code}.",
  pressAnyKey: "Press any key to close this update window.",
  actions: {
    updateNow: "Update now",
    openRelease: "Open release",
    close: "Close",
    closeDetail: "return to the workspace",
  },
  skew: {
    title: "⚠ DAEMON OUT OF DATE",
    olderBuild: "an older build",
    hint: "daemon is {daemon} — you launched v{clientVersion}. Run `rove daemon restart`, then relaunch Rove",
  },
  /** This process's own install was deleted — it can never start a daemon again. */
  staleInstall: {
    title: "✕ ROVE INSTALL IS GONE",
    hint: "this Rove is running from an install that no longer exists on disk, so it cannot start a daemon. Reinstall (`npm install -g @sma1lboy/rove`) and relaunch Rove",
  },
  versions: {
    pageTitle: "ROVE VERSIONS",
    loading: "Loading releases...",
    unavailable: "Could not fetch releases (offline or rate-limited).",
    tagCurrent: "current",
    tagLatest: "latest",
    tagBreaking: "breaking",
    /** Shown before the user commits to a version. `enforceResetGate()` calls
        `process.exit(1)` at every app entrance until the reset runs, so the
        reset is mandatory, not advisory — and it costs live sessions. */
    breakingWarning:
      "⚠ installing this crosses breaking version(s) {versions}. Rove will refuse to start until you run `rove reset`, which stops the daemon, the PTY host, and every live session. Tasks and worktrees are kept.",
    footerHint: "j/k select · enter install · q close",
    closeHint: "q / esc close",
  },
}

export const zh: typeof en = {
  pageTitle: "ROVE 更新",
  closeHint: "q / esc 关闭",
  chip: "↑ {version}",
  current: "当前",
  latest: "最新",
  latestUnknown: "未知 —— 无法连接到 registry",
  upToDate: "没有更新的版本 —— 无需安装。",
  releaseUrlUnavailable: "发布链接不可用",
  statusReleaseOpened: "已在浏览器中打开发布说明页面。",
  statusReleaseError: "无法打开发布链接。",
  statusRunningUpdater: "正在关闭 TUI，并在当前终端中运行更新程序……",
  loadingNotes: "正在加载发布说明……",
  notesUnavailable: "发布说明不可用。请使用「打开发布页」查看 GitHub 发布页面。",
  changesSectionHeader: "── v{from} 至 v{to} 的变更 ──",
  updateComplete: "Rove 更新完成。请重新启动 Rove 以使用新版本。",
  updateFailed: "Rove 更新失败，退出码为 {code}。",
  pressAnyKey: "按任意键关闭此更新窗口。",
  actions: {
    updateNow: "立即更新",
    openRelease: "打开发布页",
    close: "关闭",
    closeDetail: "返回工作区",
  },
  skew: {
    title: "⚠ DAEMON 版本不一致",
    olderBuild: "旧版本构建",
    hint: "daemon 运行的是 {daemon}，而你启动的是 v{clientVersion}。请运行 `rove daemon restart`，然后重新启动 Rove",
  },
  staleInstall: {
    title: "✕ ROVE 安装已不存在",
    hint: "当前 Rove 运行自一份已从磁盘删除的安装，因此无法启动 daemon。请重新安装（`npm install -g @sma1lboy/rove`）并重新启动 Rove",
  },
  versions: {
    pageTitle: "ROVE 版本列表",
    loading: "正在加载发布列表……",
    unavailable: "无法获取发布列表（离线或触发限流）。",
    tagCurrent: "当前",
    tagLatest: "最新",
    tagBreaking: "breaking",
    breakingWarning:
      "⚠ 安装该版本会跨过 breaking 版本 {versions}。更新后 Rove 会拒绝启动，直到你运行 `rove reset`——它会停掉 daemon、PTY host 和所有活动会话。任务和 worktree 会保留。",
    footerHint: "j/k 选择 · enter 安装 · q 关闭",
    closeHint: "q / esc 关闭",
  },
}
