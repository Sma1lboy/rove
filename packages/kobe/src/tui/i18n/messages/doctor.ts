/**
 * `doctor.*` messages — the `rove doctor --fix` remediation flow
 * (`src/cli/doctor-fix.ts`). English is the source of truth; `zh: typeof en`
 * keeps the shapes locked together. Shell commands themselves stay literal in
 * the calling code — only the prose around them is translated.
 */

export const en = {
  fix: {
    /** Appended to a plain `doctor` run when at least one fix applies; {command} is `rove doctor --fix` */
    hint: "{count} finding(s) above have a known fix — run `{command}` to review them one by one",
    /** `--fix` found nothing to do */
    none: "fix: nothing to fix — no known remediation applies to this report",
    /** Header over the runnable (confirm-then-execute) fixes */
    header: "fixes — each one asks before running:",
    /** {command} is the exact command line about to be executed */
    willRun: "will run: {command}",
    /** Per-fix y/N prompt (default is No) */
    confirmPrompt: "apply this fix? [y/N] ",
    /** Fix command exited 0 */
    done: "✓ done",
    /** Fix command failed; {code} is its exit code */
    failed: "✗ exited with code {code}",
    /** User answered no */
    skipped: "· skipped",
    /** `--fix` without a TTY: nothing is ever executed */
    nonInteractive: "no interactive terminal — nothing was executed; run the commands above yourself",
    /** Header over the print-only fixes */
    manualHeader: "manual steps — doctor prints these but never runs them:",

    /** Shared rationale for every daemon-restart fix */
    daemonRestartWhy: "safe to run: engine sessions live in the separate PTY host and survive a daemon restart",
    /** Daemon reachable but running an older build than this CLI */
    daemonStale: "restart the daemon — it is running an older build than this CLI",
    /** Daemon not running at all */
    daemonDown: "start the daemon — it is not running",
    /** Engine hook channel down: no hook-sourced activity on any tab */
    hooksDown: "restart the daemon to re-establish the engine hook channel",
    /** Daemon too old to answer `debug.inspect` */
    inspectStale: "restart the daemon — it predates the hook-channel check",

    /** Shared rationale for the skill install/update fix */
    skillInstallWhy: "safe to run: installs skill files only; re-running is idempotent",
    /** Agent skill absent */
    skillMissing: "install the Rove agent skill",
    /** Agent skill older than this build expects */
    skillStale: "update the Rove agent skill to the version this build expects",

    /** Why every `reset` fix is print-only */
    resetWhy: "stops the daemon, the PTY host, and every live session — not undoable, so doctor only prints it",
    /** Daemon process alive but its socket unreachable */
    resetDaemonWedged: "the daemon process is alive but unreachable (wedged)",
    /** PTY host unreachable or down */
    resetPty: "the PTY host is unreachable or not running",
    /** Pre-v0.8 tmux sessions still resident */
    resetLegacy: "pre-v0.8 tmux sessions are still holding processes and memory",

    /** Hook channel down: the other half of the remedy, owned by the user */
    engineTabs: "engine tabs may hold a stale daemon socket path",
    /** The in-TUI action for {@link engineTabs} */
    engineTabsAction: "close and reopen the affected engine tabs in the TUI",
    /** Why engine-tab restarts are print-only */
    engineTabsWhy: "kills that tab's live engine session — your call, not doctor's",

    /** Why installs/logins are print-only */
    humanOnlyWhy: "doctor does not install software or log in to accounts for you",
    /** git missing from PATH */
    git: "git is not on PATH",
    /** The manual action for {@link git} */
    gitAction: "install git with your OS package manager",
    /** No engine has both a CLI binary and an account */
    noEngine: "no usable engine — no engine CLI is both installed and logged in",
    /** The manual action for {@link noEngine} */
    noEngineAction: "install the claude, codex, or copilot CLI and log in",
    /** Windows only: no node, so the PTY host cannot start */
    windowsNode: "Node.js is missing — the Windows PTY host cannot start",
    /** The manual action for {@link windowsNode} */
    windowsNodeAction: "install Node.js from https://nodejs.org",
  },
}

export const zh: typeof en = {
  fix: {
    hint: "上面有 {count} 项发现存在已知修法 — 运行 `{command}` 逐条查看",
    none: "fix: 无可修项 — 本次报告没有匹配到已知修法",
    header: "修复项 — 每一条都会先询问再执行:",
    willRun: "将执行: {command}",
    confirmPrompt: "执行这条修复吗? [y/N] ",
    done: "✓ 完成",
    failed: "✗ 退出码 {code}",
    skipped: "· 已跳过",
    nonInteractive: "没有交互终端 — 未执行任何命令; 请自行运行上面的命令",
    manualHeader: "人工步骤 — doctor 只打印, 永远不会替你执行:",

    daemonRestartWhy: "可安全执行: 引擎会话在独立的 PTY host 里, daemon 重启后仍然存活",
    daemonStale: "重启 daemon — 它运行的构建比当前 CLI 旧",
    daemonDown: "启动 daemon — 它当前没有在运行",
    hooksDown: "重启 daemon 以重建引擎 hook 通道",
    inspectStale: "重启 daemon — 它的版本早于 hook 通道检查",

    skillInstallWhy: "可安全执行: 只写入 skill 文件; 重复运行是幂等的",
    skillMissing: "安装 Rove agent skill",
    skillStale: "把 Rove agent skill 更新到当前构建期望的版本",

    resetWhy: "会停掉 daemon、PTY host 和所有活动会话 — 不可撤销, 所以 doctor 只打印",
    resetDaemonWedged: "daemon 进程存活但无法连接 (卡死)",
    resetPty: "PTY host 无法连接或没有在运行",
    resetLegacy: "v0.8 之前的 tmux 会话仍占用进程和内存",

    engineTabs: "引擎 tab 可能持有过期的 daemon socket 路径",
    engineTabsAction: "在 TUI 里关闭并重开受影响的引擎 tab",
    engineTabsWhy: "会杀掉该 tab 的活动引擎会话 — 由你决定, doctor 不代劳",

    humanOnlyWhy: "doctor 不会替你安装软件或登录账号",
    git: "PATH 上找不到 git",
    gitAction: "用你的系统包管理器安装 git",
    noEngine: "没有可用引擎 — 没有任何引擎 CLI 同时满足已安装且已登录",
    noEngineAction: "安装 claude、codex 或 copilot CLI 并登录",
    windowsNode: "缺少 Node.js — Windows PTY host 无法启动",
    windowsNodeAction: "从 https://nodejs.org 安装 Node.js",
  },
}
