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

    /** macOS: node-pty's spawn-helper prebuild lacks the exec bit */
    spawnHelper: "restore the exec bit on node-pty's spawn-helper — every node-pty PTY spawn fails without it",
    /** Why the chmod fix is safe */
    spawnHelperWhy: "safe to run: chmod on two prebuilt binaries; idempotent, and `bun install` does the same",

    /** Why every `reset` fix is print-only */
    resetWhy: "stops the daemon, the PTY host, and every live session — not undoable, so doctor only prints it",
    /** Daemon process alive but its socket unreachable */
    resetDaemonWedged: "the daemon process is alive but unreachable (wedged)",
    /** PTY host unreachable or down */
    resetPty: "the PTY host is unreachable or not running",
    /** Pre-v0.8 tmux sessions still resident */
    resetLegacy: "pre-v0.8 tmux sessions are still holding processes and memory",

    /** Processes left behind by a PTY session something outside Rove killed; {count} of them */
    orphans: "{count} process(es) outlived the PTY session that spawned them and are still running",
    /** Why the orphan sweep is print-only */
    orphansWhy:
      "kills processes, which is not undoable — and a task you backgrounded on purpose looks the same; read the list, then run it yourself",

    /** Hook channel down: the other half of the remedy, owned by the user */
    engineTabs: "engine tabs may hold a stale daemon socket path",
    /** The in-TUI action for {@link engineTabs} */
    engineTabsAction: "close and reopen the affected engine tabs in the TUI",
    /** Why engine-tab restarts are print-only */
    engineTabsWhy: "kills that tab's live engine session — your call, not doctor's",

    /** This process's entry point was deleted out from under it */
    staleInstall: "the install this Rove runs from no longer exists on disk",
    /** The manual action for {@link staleInstall} */
    staleInstallAction: "npm install -g @sma1lboy/rove, then relaunch Rove",
    /** Why {@link staleInstall} is print-only */
    staleInstallWhy: "doctor cannot reinstall Rove over the running process — a human has to, then relaunch",

    /** Why installs/logins are print-only */
    humanOnlyWhy: "doctor does not install software or log in to accounts for you",
    /** git missing from PATH */
    git: "git is not on PATH",
    /** The manual action for {@link git} */
    gitAction: "install git with your OS package manager",
    /** No engine has both a CLI binary and an account */
    noEngine: "no usable engine — no engine CLI is both installed and logged in",
    /** The manual action for {@link noEngine}: nothing is installed at all */
    noEngineAction: "install an engine CLI (claude, codex, copilot, or kimi) and log in",
    /** An engine CLI IS installed — only the login is missing */
    noEngineLogin: "no usable engine — an engine CLI is installed but not signed in",
    /** The manual action for {@link noEngineLogin}. `{list}` is the installed
     *  engine CLIs; telling this user to install one would point at a binary
     *  whose absolute path doctor printed two lines above. */
    noEngineLoginAction: "run one of the installed engine CLIs ({list}) in a shell and complete its login",
    /** Windows only: no node, so the PTY host cannot start */
    windowsNode: "Node.js is missing — the Windows PTY host cannot start",
    /** The manual action for {@link windowsNode} */
    windowsNodeAction: "install Node.js from https://nodejs.org",
    /** Running under a Bun older than package.json#engines.bun */
    staleBun: "the Bun running Rove is older than this build supports — terminals will not paint",
    /** The manual action for {@link staleBun} */
    staleBunAction:
      "upgrade Bun (`bun upgrade`, `brew upgrade bun`, or `npm install -g bun@latest`), then relaunch Rove",
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

    spawnHelper: "恢复 node-pty spawn-helper 的可执行位 — 缺了它 node-pty 的每次 PTY 启动都会失败",
    spawnHelperWhy: "可安全执行: 只对两个预编译二进制做 chmod; 幂等, `bun install` 也会做同样的事",

    resetWhy: "会停掉 daemon、PTY host 和所有活动会话 — 不可撤销, 所以 doctor 只打印",
    resetDaemonWedged: "daemon 进程存活但无法连接 (卡死)",
    resetPty: "PTY host 无法连接或没有在运行",
    resetLegacy: "v0.8 之前的 tmux 会话仍占用进程和内存",

    orphans: "有 {count} 个进程比启动它们的 PTY 会话活得更久, 现在还在运行",
    orphansWhy: "会杀进程, 不可撤销 — 而且你故意放后台的任务看起来一模一样; 先看清单, 再自己执行",

    engineTabs: "引擎 tab 可能持有过期的 daemon socket 路径",
    engineTabsAction: "在 TUI 里关闭并重开受影响的引擎 tab",
    engineTabsWhy: "会杀掉该 tab 的活动引擎会话 — 由你决定, doctor 不代劳",

    staleInstall: "当前 Rove 所在的安装已从磁盘删除",
    staleInstallAction: "npm install -g @sma1lboy/rove, 然后重新启动 Rove",
    staleInstallWhy: "doctor 无法在运行中的进程上重装 Rove — 需要人工重装后重新启动",

    humanOnlyWhy: "doctor 不会替你安装软件或登录账号",
    git: "PATH 上找不到 git",
    gitAction: "用你的系统包管理器安装 git",
    noEngine: "没有可用引擎 — 没有任何引擎 CLI 同时满足已安装且已登录",
    noEngineAction: "安装任一引擎 CLI（claude、codex、copilot 或 kimi）并登录",
    noEngineLogin: "没有可用引擎 — 引擎 CLI 已安装, 但没有登录",
    noEngineLoginAction: "在 shell 里运行已安装的引擎 CLI（{list}）之一并完成登录",
    windowsNode: "缺少 Node.js — Windows PTY host 无法启动",
    windowsNodeAction: "从 https://nodejs.org 安装 Node.js",
    staleBun: "运行 Rove 的 Bun 版本低于本构建的要求 — 终端不会有任何输出",
    staleBunAction: "升级 Bun (`bun upgrade` / `brew upgrade bun` / `npm install -g bun@latest`), 然后重新启动 Rove",
  },
}
