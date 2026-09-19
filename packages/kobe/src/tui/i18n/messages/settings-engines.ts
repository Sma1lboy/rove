/**
 * `settings.engines.*` and `settings.accounts.*` — the copy for ONE surface:
 * the engine card in Settings → Engines.
 *
 * Its own file rather than a slice of `./settings.ts` because the card is
 * three lines owned by three different things — what the user configured, what
 * detection found about the engine, and what Rove installed INTO the engine —
 * and it grows every time one of those learns something new. Kept in the
 * `settings` namespace all the same: `./settings.ts` spreads these two keys
 * back in, so every call site still spells its key `settings.engines.*` and the
 * `zh: typeof en` shape lock holds per file.
 *
 * English is the source of truth.
 */

export const en = {
  engines: {
    title: "Engines",
    hint: "Every engine Rove can launch, with what detection found under each one: where its binary is, and for the engines with an account detector whether you are logged in. [x] = offered when picking an engine for a task; (●) = the global default (per-project picks, e.g. Ctrl+Shift+T, override it) — click either, or use the keys below. Override a launch command when the binary isn't on PATH or to pass default flags. space on/off · enter edit command · r rename · x reset/remove · d set default. The third line under each engine names which of Rove's reporting layers it uses — hooks it installs, completion markers it reads, screen rules it falls back to. A missing layer is not a fault: an engine whose hooks report everything needs no screen rules.",
    customTag: "  (custom)",
    addEngine: "+ Add engine",
    launchCommandTitle: "{name} launch command",
    displayNameTitle: "{name} display name (blank = default)",
    addTitle: "Add engine",
    addStepTitle: "Add engine · {id}",
    protocolTitle: "Add engine · {id} — protocol",
    protocolNone: "None — generic adapter",
    protocolFooter: "↑↓ choose · enter pick · esc cancel",
    protocolRow: "protocol {protocol}",
    protocolGeneric: "generic",
    idPlaceholder: "lowercase slug, e.g. aider",
    commandPlaceholder: "e.g. aider --model sonnet",
    /** Third card line: Rove's activity hooks are current in this engine's config. */
    hookInstalled: "hooks installed",
    /** Installed, but written by an older Rove — the next launch rewrites them. */
    hookOutdated: "hooks outdated",
    /** The engine supports hooks and has none; the install row writes them. */
    hookMissing: "hooks not installed",
    /** The engine reports nothing itself — normal for contrib and custom engines. */
    hookNone: "no hooks",
    /** Hooks are supported and absent, and the CLI is not on this machine —
     *  nothing to fix, so it reads muted rather than as a warning. */
    hookUnavailable: "engine not installed",
    /** The engine persists a turn-completion marker Rove reads back. */
    markersYes: "markers",
    markersNo: "no markers",
    /** The engine declares screen-classification rules. */
    screenYes: "screen rules",
    screenNo: "no screen rules",
    /** The hook merge is being refused; {file} names it, {reason} says why. */
    hookRefused: "! {file} rejected: {reason}",
    /** Install row, with something to do. {count} = engines that need it. */
    installHooks: "→ Install engine integrations ({count})",
    /** Install row, with nothing to do. */
    installHooksDone: "· Engine integrations up to date",
    /** Uninstall button, with something to remove. {count} = engines hooked. */
    uninstallHooks: "← Remove engine integrations ({count})",
    /** Uninstall button, with nothing on disk to remove. */
    uninstallHooksDone: "· No engine integrations installed",
  },
  accounts: {
    checking: "Checking…",
    notLoggedIn: "○ Not logged in",
    loggedIn: "● Logged in: {email}",
    apiKeyConfigured: "● API key configured",
    chatgptLogin: "● ChatGPT login: {email}",
    tokenConfigured: "● Token configured ({source})",
    detected: "● Login detected",
  },
}

export const zh: typeof en = {
  engines: {
    title: "引擎",
    hint: "Rove 能启动的所有引擎，每个下面跟着本地探测到的情况：二进制在哪，以及对有账户探测器的引擎是否已登录。[x] = 为任务选引擎时会列出它；(●) = 全局默认引擎（各项目自己的选择会覆盖它，如 Ctrl+Shift+T）——两者都可直接点，也可用下面的按键。二进制不在 PATH 上、或要传默认参数时，覆盖它的启动命令。space 开/关 · enter 编辑命令 · r 重命名 · x 重置/移除 · d 设为默认。每个引擎下方第三行说明它的状态由哪几层负责——Rove 安装的钩子、可读回的完成标记、兜底的读屏规则。缺某一层不算故障：钩子已经报全的引擎不需要读屏规则。",
    customTag: "  (自定义)",
    addEngine: "+ 添加引擎",
    launchCommandTitle: "{name} 的启动命令",
    displayNameTitle: "{name} 的显示名称（留空 = 默认）",
    addTitle: "添加引擎",
    addStepTitle: "添加引擎 · {id}",
    protocolTitle: "添加引擎 · {id} —— 协议",
    protocolNone: "无 —— 通用适配器",
    protocolFooter: "↑↓ 选择 · enter 确认 · esc 取消",
    protocolRow: "协议 {protocol}",
    protocolGeneric: "通用",
    idPlaceholder: "小写短名，如 aider",
    commandPlaceholder: "如 aider --model sonnet",
    hookInstalled: "已装钩子",
    hookOutdated: "钩子已过期",
    hookMissing: "未装钩子",
    hookNone: "无钩子",
    hookUnavailable: "引擎未安装",
    markersYes: "有完成标记",
    markersNo: "无完成标记",
    screenYes: "有读屏规则",
    screenNo: "无读屏规则",
    hookRefused: "! {file} 被拒绝：{reason}",
    installHooks: "→ 安装引擎接入（{count}）",
    installHooksDone: "· 引擎接入已是最新",
    uninstallHooks: "← 移除引擎接入（{count}）",
    uninstallHooksDone: "· 未安装任何引擎接入",
  },
  accounts: {
    checking: "检查中…",
    notLoggedIn: "○ 未登录",
    loggedIn: "● 已登录: {email}",
    apiKeyConfigured: "● 已配置 API key",
    chatgptLogin: "● ChatGPT 登录: {email}",
    tokenConfigured: "● 已配置 Token ({source})",
    detected: "● 检测到登录",
  },
}
