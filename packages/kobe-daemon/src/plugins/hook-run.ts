/**
 * One plugin hook command: spawn it, capture its output, bound it by a
 * deadline, and append the run to the plugin's `log.jsonl`.
 *
 * - **A hung hook is killed at its deadline, process group and all.** `sh -c
 *   "curl … </dev/null"` does not exec, so signalling only the shell leaves
 *   curl alive — holding the daemon's stdout/stderr pipes so it can't exit.
 * - **A hook still running after {@link HOOK_SLOW_MS} gets a `phase:
 *   "running"` record**, so `rove plugin log` isn't silent about a hang.
 */

import { spawn } from "node:child_process"
import { appendFileSync, mkdirSync } from "node:fs"
import { rotateLogIfNeeded } from "../daemon/log-rotate.ts"
import { OWNER_ONLY_DIR_MODE, OWNER_ONLY_FILE_MODE } from "../daemon/owner-only.ts"
import { buildPluginEnv } from "./env.ts"
import type { PluginCommandSpec } from "./manifest.ts"
import { pluginConfigDir, pluginLogPath, pluginStateDir } from "./plugin-paths.ts"

const OUTPUT_CAP = 8 * 1024

/** Per-plugin log.jsonl cap, below daemon.log's 10MB since every plugin keeps
 *  one and `tool.*` hooks append per tool call. One `.old` generation kept. */
const PLUGIN_LOG_CAP_BYTES = 4 * 1024 * 1024

/** `[[shutdown]]` hook budget — tight because `rove daemon stop` waits on it. */
export const SHUTDOWN_GRACE_MS = 3_000

/** `[[startup]]`/`[[events]]` deadline: room for a webhook POST, short enough
 *  that a hook wedged on a dead network can't pile up processes. Override
 *  with `timeout_ms`. */
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
    // 0600: captured stdout/stderr may contain the plugin's own token.
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
  // 0700: config holds the settings .env (API keys); state is plugin-owned.
  // Guarded to keep "never rejects" (EEXIST from a same-named file, EACCES,
  // ENOSPC). Without these dirs the ROVE_PLUGIN_*_DIR contract can't hold, so
  // record the failure and skip the spawn.
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
      // Own process group, so the deadline kill takes the hook's children too.
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
        // Capped at half the budget so this lands strictly before the kill.
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
