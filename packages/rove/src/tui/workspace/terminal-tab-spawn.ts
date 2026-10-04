/**
 * argv → typed shell command line for a tab's PTY spawn. Imports nothing on
 * purpose, so the quoting rule stays pure string work that core, the component
 * and `terminal-tab-argv.ts` all share. Knowledge of what a tab is doesn't
 * belong here.
 */

/** What a tab's PTY should spawn: an argv, plus optional bytes typed into
 *  it right after spawn (`TaskPtyOpts.initialInput`). */
export interface TabSpawn {
  readonly command: readonly string[]
  readonly initialInput?: string
  /**
   * First message pasted once the engine is up (`TaskPtyOpts.firstMessage`),
   * for paste-delivery vendors (kimi) whose positional argv slot is a
   * subcommand. Undefined when the message rode the argv or there is none.
   */
  readonly firstMessage?: string
  /** Engine binary name the paste's engine-up probe matches (base argv[0]). */
  readonly engineBin?: string
}

/** Args that survive an interactive prompt unquoted; anything else gets
 *  single-quoted (`'\''` escape) — POSIX shells and fish both accept it. */
const SHELL_SAFE_ARG = /^[A-Za-z0-9@%+=:,./_-]+$/

/** Render an argv as one shell-ready command line. */
export function shellCommandLine(argv: readonly string[]): string {
  return argv.map((a) => (SHELL_SAFE_ARG.test(a) ? a : `'${a.replaceAll("'", "'\\''")}'`)).join(" ")
}

/**
 * Spawn `shell` and TYPE the engine line into it (tty input buffering holds it
 * until the shell is ready): keeps rc files/aliases/PATH, and exiting the
 * engine lands on a prompt instead of killing the tab.
 *
 * `env` rides the typed line as an `env K=V …` prefix, not the PTY env: it
 * reaches fresh spawns and adopted warm shells alike, works in fish (which
 * rejects bare `K=V cmd`), and the engine's hook subprocesses inherit it — how
 * `kobe hook` learns which tab an event came from.
 */
export function shellSpawn(argv: readonly string[], shell: string, env?: Readonly<Record<string, string>>): TabSpawn {
  const pairs = Object.entries(env ?? {})
  const full = pairs.length > 0 ? ["env", ...pairs.map(([k, v]) => `${k}=${v}`), ...argv] : argv
  return { command: [shell], initialInput: `${shellCommandLine(full)}\r` }
}

/**
 * Identity export for a bare shell tab (ctrl+e shell), so an engine the user
 * types there inherits `ROVE_TASK_ID`/`ROVE_TAB_ID` and the daemon gets
 * tab-precise events for a session Rove never spawned. `KOBE_*` aliases too: a
 * bare shell never passes through the CLI's ROVE_* → KOBE_* mirror (same
 * reason as `session-launch.ts`). Typed via `initialInput`, so it reaches warm
 * spares with no pty protocol change. Leading space skips HIST_IGNORE_SPACE
 * history; `clear` hides it from scrollback. ponytail: one visible line
 * flashes before the clear; upgrade path = an `env` field on PtySpawnSpec with
 * a skip-spare rule if cosmetics matter.
 */
export function shellIdentityInput(taskId: string, tabId: string): string {
  const task = shellCommandLine([taskId])
  const tab = shellCommandLine([tabId])
  return ` export ROVE_TASK_ID=${task} KOBE_TASK_ID=${task} ROVE_TAB_ID=${tab} KOBE_TAB_ID=${tab} && clear\r`
}
