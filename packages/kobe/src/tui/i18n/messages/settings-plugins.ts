/**
 * `settings.plugins.*` + `settings.marketplace.*` — copy for the two Settings
 * surfaces that are about plugins: managing what is registered, and browsing
 * the marketplace to add more. Split out of `./settings.ts`, which owns the
 * rest of the dialog, because these two sections share a subject (and the
 * vocabulary that goes with it: manifests, hooks, declared surfaces, installs)
 * with each other and with nothing else in that file.
 *
 * English is the source of truth; `zh: typeof en` mirrors its shape exactly.
 * `./settings.ts` spreads both into its own `en` / `zh`, so the message keys
 * stay `settings.plugins.…` / `settings.marketplace.…` — this split is
 * invisible to callers.
 */

export const en = {
  plugins: {
    title: "Plugins",
    hint: "Plugins registered in ~/.rove/plugins.json. enter (or click) toggles one on or off — the daemon watches the file, so the change applies live. Rows indented under a plugin are the settings it declares; enter edits one, and the value reaches the plugin on its next run. Install and remove them from the shell: `rove plugin install <owner/repo>`, `rove plugin link <dir>`.",
    empty:
      "No plugins registered. Install one with `rove plugin install <owner/repo>` — browse the `rove-plugin` topic on GitHub.",
    sourceLink: "linked {path}",
    sourceGithub: "{spec}",
    updateAvailable: "update available — rove plugin update",
    declares: "{actions} actions · {events} events · {panes} panes",
    declaresWithEngines: "{actions} actions · {events} events · {panes} panes · {engines} engines",
    manifestUnreadable: "manifest unreadable",
    unsupportedPlatform: "· not supported on this platform",
    noHooks: "· no hooks declared",
    lastRun: "· last run {label} {status} {ago} ago",
    neverRun: "· never run",
    runOk: "ok",
    runRunning: "still running",
    runFailed: "failed to start",
    runExit: "exit {code}",
    settingUnset: "(unset — enter to edit)",
    settingInvalidTitle: "Not a number",
    settingInvalidBody: "{label} only accepts a number. Keeping the previous value.",
  },
  marketplace: {
    title: "Marketplace",
    hint: "Plugins published under the `rove-plugin` topic on GitHub, most-starred first. enter (or click) shows what the install would run and asks before running any of it. The listing is re-queried each time you open this section.",
    loading: "Searching GitHub…",
    empty: "No plugins listed.",
    offline: "GitHub is unreachable — showing first-party plugins only. Re-open this section to retry.",
    installedTag: "installed",
    firstParty: "first-party",
    preparing: "cloning {ref}…",
    installing: "building and registering {name}…",
    installed: "installed {id} v{version} — it is enabled, and appears under Plugins.",
    cancelled: "install cancelled; nothing was run.",
    failed: "install failed: {error}",
    alreadyInstalled: "already installed as {id} — manage it under Plugins.",
    confirmTitle: "Install {name}?",
    confirmInstall: "install",
    previewSource: "source: {source}",
    previewCommands: "Commands this plugin declares:",
    previewNoCommands: "This plugin declares no commands.",
    previewWarning: "warning: {warning}",
    previewTrust:
      "Installing runs the build commands above, and the rest run later on the events they declare. They run as you, with your environment, and nothing is sandboxed.",
  },
}

export const zh: typeof en = {
  plugins: {
    title: "插件",
    hint: "在 ~/.rove/plugins.json 里注册的插件。enter（或点击）切换启用/禁用——daemon 监听该文件，改动实时生效。插件下方缩进的行是它声明的设置项，enter 编辑，新值在插件下次运行时生效。安装与移除在 shell 里做：`rove plugin install <owner/repo>`、`rove plugin link <dir>`。",
    empty:
      "尚未注册任何插件。用 `rove plugin install <owner/repo>` 安装一个——可在 GitHub 的 `rove-plugin` 话题下浏览。",
    sourceLink: "本地链接 {path}",
    sourceGithub: "{spec}",
    updateAvailable: "有新版本 — rove plugin update",
    declares: "{actions} 个动作 · {events} 个事件 · {panes} 个面板",
    declaresWithEngines: "{actions} 个动作 · {events} 个事件 · {panes} 个面板 · {engines} 个引擎",
    manifestUnreadable: "manifest 无法解析",
    unsupportedPlatform: "· 不支持当前平台",
    noHooks: "· 未声明钩子",
    lastRun: "· 上次运行 {label} {status} {ago}前",
    neverRun: "· 尚未运行过",
    runOk: "成功",
    runRunning: "仍在运行",
    runFailed: "启动失败",
    runExit: "退出码 {code}",
    settingUnset: "(未设置 — enter 编辑)",
    settingInvalidTitle: "不是数字",
    settingInvalidBody: "{label} 只接受数字，保留原值。",
  },
  marketplace: {
    title: "插件市场",
    hint: "GitHub 上 `rove-plugin` 话题下发布的插件，按 star 数排序。enter（或点击）会先列出安装会执行的命令，确认后才真正执行。每次进入本区块都会重新查询列表。",
    loading: "正在搜索 GitHub…",
    empty: "列表为空。",
    offline: "GitHub 不可达——只显示首方插件。重新进入本区块可再试一次。",
    installedTag: "已安装",
    firstParty: "首方",
    preparing: "正在克隆 {ref}…",
    installing: "正在构建并注册 {name}…",
    installed: "已安装 {id} v{version}——已启用，可在「插件」区块管理。",
    cancelled: "已取消安装，没有执行任何命令。",
    failed: "安装失败：{error}",
    alreadyInstalled: "已安装为 {id}——在「插件」区块管理。",
    confirmTitle: "安装 {name}？",
    confirmInstall: "安装",
    previewSource: "来源：{source}",
    previewCommands: "该插件声明的命令：",
    previewNoCommands: "该插件未声明任何命令。",
    previewWarning: "警告：{warning}",
    previewTrust:
      "安装会执行上面的 build 命令，其余命令会在它们声明的事件发生时执行。它们以你的身份、带你的环境变量运行，没有任何沙箱。",
  },
}
