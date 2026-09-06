/**
 * One plugin hook command: spawn it, capture its output, bound it by a
 * deadline, and append the run to the plugin's `log.jsonl`. The host
 * (`runtime.ts`) decides WHICH hooks fire; this file owns HOW one of them
 * runs.
 *
 * Two properties the host depends on:
 *
 * - **A hook that hangs is killed at its deadline, process group and all.**
 *   `spawn` is `detached`, so the hook gets its own group and SIGKILL reaches
 *   the children it left behind: `sh -c "curl … </dev/null"` does not exec,
 *   so signalling only the shell leaves the curl alive. Before this bound
 *   existed, four fires of a hanging hook left four shells and four
 *   grandchildren running, and they outlived the daemon — which could not
 *   exit either, because they still held its stdout/stderr pipes.
 * - **A hook still running after {@link HOOK_SLOW_MS} is logged before it
 *   finishes**, as a `phase: "running"` record. The close record alone is why
 *   a hang used to leave `rove plugin log` saying `(no runs logged yet)`: the
 *   one surface an author checks was silent for exactly the failure that
 *   leaks.
 */

import { spawn } from "node:child_process"
import { appendFileSync, mkdirSync } from "node:fs"
import { rotateLogIfNeeded } from "../daemon/log-rotate.ts"
import { OWNER_ONLY_DIR_MODE, OWNER_ONLY_FILE_MODE } from "../daemon/owner-only.ts"
import { buildPluginEnv } from "./env.ts"
import type { PluginCommandSpec } from "./manifest.ts"
import { pluginConfigDir, pluginLogPath, pluginStateDir } from "./plugin-paths.ts"

const OUTPUT_CAP = 8 * 1024

/** Cap for a single plugin's log.jsonl. Smaller than daemon.log's 10MB
 *  because this is per plugin and every enabled one keeps its own: a plugin
 *  hooked to `tool.pre`/`tool.post` appends a record per tool call, forever.
 *  One `.old` generation is kept. */
const PLUGIN_LOG_CAP_BYTES = 4 * 1024 * 1024

/** How long a `[[shutdown]]` hook may run. Tighter than the others because
 *  this one is spent inside `rove daemon stop`, where the user is waiting. */
export const SHUTDOWN_GRACE_MS = 3_000

/** Deadline for `[[startup]]` and `[[events]]` hooks — long enough for the
 *  webhook POST the Ground Rules assume, short enough that a hook wedged on a
 *  dead network cannot accumulate one process per tool call. A hook that
 *  genuinely needs longer says so with `timeout_ms`. */
export const HOOK_TIMEOUT_MS = 30_000

/** A hook still alive this long gets a `running` log record. */
export const HOOK_SLOW_MS = 2_000

export type HookKind = "startup" | "event" | "shutdown"

/** Kill callbacks for hooks that have not exited yet, so daemon stop can reap
 *  them instead of waiting out their deadlines. */
export type HookKillSet = Set<() => void>

export interface HookRunOptions {
  readonly pluginId: string
  readonly pluginRoot: string
  readonly spec: PluginCommandSpec
  readonly kind: HookKind
  /** Event name / `startup` / `shutdown[i]` — whatever the log should show. */
  readonly label: string
  readonly extraEnv: Record<string, string>
  readonly homeDir?: string
  readonly socketPath: string
  readonly binPath: string
  readonly log?: (line: string) => void
  readonly inFlight?: HookKillSet
}

/** The hook's deadline: its own `timeout_ms`, else the default for its kind. */
export function hookTimeoutMs(spec: PluginCommandSpec, kind: HookKind): number {
  return spec.timeoutMs ?? (kind === "shutdown" ? SHUTDOWN_GRACE_MS : HOOK_TIMEOUT_MS)
}

function appendRecord(pluginId: string, homeDir: string | undefined, record: Record<string, unknown>): void {
  try {
    const logPath = pluginLogPath(pluginId, homeDir)
    // The record carries the plugin's captured stdout/stderr, so a plugin
    // that prints its own token on failure writes it here — 0600, and
    // capped like daemon.log so a per-tool-call hook can't fill the disk.
    rotateLogIfNeeded(logPath, PLUGIN_LOG_CAP_BYTES)
    appendFileSync(logPath, `${JSON.stringify(record)}\n`, { mode: OWNER_ONLY_FILE_MODE })
  } catch {
    // Log write failure must never take the daemon down.
  }
}

export async function runPluginHook(opts: HookRunOptions): Promise<void> {
  const { pluginId, spec, kind, label, homeDir } = opts
  const timeoutMs = hookTimeoutMs(spec, kind)
  const startedAt = Date.now()
  // 0700: config holds the settings .env (documented home for API keys) and
  // state is plugin-owned durable data; neither is anyone else's business.
  //
  // Guarded because this is the one place the "never rejects" contract used to
  // break: a config/state path occupied by a same-named FILE (EEXIST), or an
  // unwritable/full disk (EACCES, ENOSPC), threw out of this function and out
  // of every caller. In `PluginHost.stop` that abandoned the OTHER plugins'
  // shutdown hooks — unawaited and unreaped, which is the orphan the doc
  // comment there warns about. A plugin that has no config/state dir cannot
  // honour the ROVE_PLUGIN_*_DIR contract, so record the failure and skip the
  // spawn rather than launching a hook into a broken environment.
  try {
    mkdirSync(pluginConfigDir(pluginId, homeDir), { recursive: true, mode: OWNER_ONLY_DIR_MODE })
    mkdirSync(pluginStateDir(pluginId, homeDir), { recursive: true, mode: OWNER_ONLY_DIR_MODE })
  } catch (err) {
    appendRecord(pluginId, homeDir, {
      at: startedAt,
      kind,
      label,
      command: spec.command,
      exitCode: null,
      durationMs: Date.now() - startedAt,
      spawnError: String(err),
    })
    opts.log?.(`plugin ${pluginId} ${label}: ${String(err)}`)
    return
  }
  let exitCode: number | null = null
  let stdout = ""
  let stderr = ""
  let spawnError: string | undefined
  let timedOut = false
  await new Promise<void>((resolve) => {
    const [cmd, ...args] = spec.command
    const child = spawn(cmd as string, args, {
      cwd: opts.pluginRoot,
      env: buildPluginEnv({
        homeDir,
        socketPath: opts.socketPath,
        binPath: opts.binPath,
        pluginId,
        pluginRoot: opts.pluginRoot,
        extra: opts.extraEnv,
      }),
      stdio: ["ignore", "pipe", "pipe"],
      // Own process group, so the deadline below can take the hook's
      // children with it. A hook is not interactive; it has no business
      // sharing the daemon's group.
      detached: true,
    })
    const kill = (): void => {
      try {
        // Negative pid = the whole group. The group only exists once the
        // child is spawned, so fall back to the child itself.
        if (child.pid) process.kill(-child.pid, "SIGKILL")
        else child.kill("SIGKILL")
      } catch {
        child.kill("SIGKILL")
      }
    }
    const deadline = setTimeout(() => {
      timedOut = true
      kill()
    }, timeoutMs)
    deadline.unref?.()
    const slow = setTimeout(
      () => {
        appendRecord(pluginId, homeDir, {
          at: startedAt,
          kind,
          label,
          command: spec.command,
          phase: "running",
          runningMs: Date.now() - startedAt,
          timeoutMs,
        })
        // Half the budget for a hook with a short one, so the "still running"
        // record always lands strictly before the kill rather than racing it.
      },
      Math.min(HOOK_SLOW_MS, Math.floor(timeoutMs / 2)),
    )
    slow.unref?.()
    opts.inFlight?.add(kill)
    const finish = (): void => {
      clearTimeout(deadline)
      clearTimeout(slow)
      opts.inFlight?.delete(kill)
      resolve()
    }
    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < OUTPUT_CAP) stdout += chunk.toString().slice(0, OUTPUT_CAP - stdout.length)
    })
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < OUTPUT_CAP) stderr += chunk.toString().slice(0, OUTPUT_CAP - stderr.length)
    })
    child.on("error", (err) => {
      spawnError = String(err)
      finish()
    })
    child.on("close", (code) => {
      exitCode = code
      finish()
    })
  })
  appendRecord(pluginId, homeDir, {
    at: startedAt,
    kind,
    label,
    command: spec.command,
    exitCode,
    durationMs: Date.now() - startedAt,
    ...(timedOut ? { timedOut: true, timeoutMs } : {}),
    ...(stdout ? { stdout } : {}),
    ...(stderr ? { stderr } : {}),
    ...(spawnError ? { spawnError } : {}),
  })
  if (timedOut) {
    opts.log?.(`plugin ${pluginId} ${label}: killed after ${timeoutMs}ms (hook did not exit)`)
  } else if (spawnError || (exitCode !== null && exitCode !== 0)) {
    opts.log?.(`plugin ${pluginId} ${label}: ${spawnError ?? `exit ${exitCode}`}`)
  }
}
