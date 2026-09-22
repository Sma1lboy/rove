import { readFileSync } from "node:fs"
import { toPosixPath } from "@sma1lboy/kobe-daemon/daemon/platform-shell"
import { worktreeInitMarkerPath } from "../env.ts"
import { remoteKeyForRepo } from "../exec/resolve.ts"
import { quoteShellArg, quoteShellArgv } from "../lib/shell-command.ts"
import { readFieldNotes } from "../state/field-notes.ts"
import { type PromptDeliveryIntent, resolveEngineLaunchInit } from "../state/repo-init.ts"
import type { VendorId } from "../types/vendor.ts"
import { protocolEntry } from "./engine-presets.ts"
import { withDispatcherProtocol, withWorktreeProtocol } from "./worktree-protocol.ts"

export const SIGINT_GUARD = "trap ':' INT; "

/**
 * True when the repo-init marker records a FINISHED run — the ONE reader of
 * this file, shared by every caller that asks "has `.rove/init.sh` stopped?".
 *
 * The launch script writes init's exit code into the marker and deletes it
 * before re-running, so "finished" means "holds a recorded code", not
 * "exists". An EMPTY marker (left by pre-0.9.101 launches) is re-run by the
 * shell's own guard (`[ "$(cat m)" != "0" ]`), so an `existsSync` reader would
 * wrongly conclude the engine had started while init is still running.
 */
export function initMarkerSaysFinished(markerPath: string): boolean {
  try {
    return readFileSync(markerPath, "utf8").trim().length > 0
  } catch {
    // Missing (never ran, or deleted to re-run) or unreadable: no recorded outcome.
    return false
  }
}

/**
 * The {@link keepAlive} banner as a matcher, kept beside its `printf` so they
 * cannot drift. Lets callers outside the PTY (the automation runner) read the
 * engine exit code from session output. Capture group 1 is that code.
 */
export const ENGINE_EXIT_BANNER = /Engine exited \(code (\d+)\)/

/** Keep a hosted terminal useful after its engine exits. */
export function keepAlive(command: string): string {
  const banner = "\\n  ⚠ Engine exited (code %s). Check Settings → Engines and fix the launch command.\\n\\n"
  return `${command}; __rc=$?; [ "$__rc" -ne 0 ] && printf '${banner}' "$__rc"; exec "\${SHELL:-/bin/sh}"`
}

export interface EngineInitLaunch {
  readonly initScript?: string
  readonly markerPath?: string
  readonly timeoutSeconds?: number
  /** Shell dialect for the marker path; defaults to the real platform.
   *  Injectable so the Windows conversion is testable on POSIX. */
  readonly platform?: NodeJS.Platform
}

export const REPO_INIT_TIMEOUT_SECONDS = 120
export const REPO_INIT_TIMEOUT_MIN_SECONDS = 5
export const REPO_INIT_TIMEOUT_MAX_SECONDS = 3600

export function resolveRepoInitTimeoutSeconds(raw?: string | number | null): number {
  const n = typeof raw === "number" ? raw : raw == null ? Number.NaN : Number.parseInt(raw, 10)
  if (!Number.isFinite(n)) return REPO_INIT_TIMEOUT_SECONDS
  return Math.max(REPO_INIT_TIMEOUT_MIN_SECONDS, Math.min(REPO_INIT_TIMEOUT_MAX_SECONDS, Math.round(n)))
}

/**
 * Run repo init without allowing a hung setup command to block engine entry.
 *
 * Leaves `$__kobe_init_rc` (`124` on timeout) and, on success only, an env
 * dump at `$__kobe_init_env`; the caller owns that path and the sourcing,
 * since the dump outlives this run — see {@link engineLaunchLine}.
 *
 * The dump is the DELTA of `export -p` across the script: every session in the
 * worktree sources it, and a whole dump would overwrite each later tab's
 * `ROVE_TASK_ID` / `ROVE_TAB_ID` (hooks would attribute events to tab-1) and
 * `PWD`/`SHLVL`. Written under `umask 077` since exports may hold API keys.
 */
function boundedInitGroup(script: string, timeoutSeconds: number): string {
  const seconds = String(timeoutSeconds)
  const timeoutBanner = "\\n  ⚠ Repo init script timed out after %ss and was killed; continuing to the engine.\\n\\n"
  const failBanner = "\\n  ⚠ Repo init script failed (code %s); continuing to the engine.\\n\\n"
  return [
    `__kobe_init_pre="\${TMPDIR:-/tmp}/kobe-init-pre.$$"`,
    `__kobe_init_to="\${TMPDIR:-/tmp}/kobe-init-timeout.$$"`,
    `rm -f "$__kobe_init_env" "$__kobe_init_pre" "$__kobe_init_to" 2>/dev/null`,
    "(",
    `export -p > "$__kobe_init_pre" 2>/dev/null`,
    script,
    "__kobe_init_ec=$?",
    "umask 077",
    // No pre-image means no way to tell the script's exports from the
    // session's own, so write nothing rather than clobber tab identity.
    `[ -s "$__kobe_init_pre" ] && export -p 2>/dev/null | grep -vxF -f "$__kobe_init_pre" > "$__kobe_init_env" 2>/dev/null`,
    "exit $__kobe_init_ec",
    ") </dev/null &",
    "__kobe_init_pid=$!",
    `( sleep ${seconds}; : > "$__kobe_init_to"; kill -TERM "$__kobe_init_pid" 2>/dev/null; sleep 2; kill -KILL "$__kobe_init_pid" 2>/dev/null ) &`,
    "__kobe_init_wd=$!",
    `wait "$__kobe_init_pid" 2>/dev/null; __kobe_init_rc=$?`,
    `kill "$__kobe_init_wd" 2>/dev/null; wait "$__kobe_init_wd" 2>/dev/null`,
    `if [ -f "$__kobe_init_to" ]; then __kobe_init_rc=124; printf '${timeoutBanner}' '${seconds}'; rm -f "$__kobe_init_env" 2>/dev/null;`,
    `elif [ "$__kobe_init_rc" -ne 0 ]; then printf '${failBanner}' "$__kobe_init_rc"; rm -f "$__kobe_init_env" 2>/dev/null; fi`,
    `rm -f "$__kobe_init_pre" "$__kobe_init_to" 2>/dev/null`,
  ].join("\n")
}

function markerDirOf(path: string): string {
  const index = path.lastIndexOf("/")
  return index <= 0 ? "." : path.slice(0, index)
}

/** Compose optional marker-gated repo init, engine command, and fallback shell. */
export function engineLaunchLine(engineCommand: string, init?: EngineInitLaunch): string {
  const tail = keepAlive(engineCommand)
  const script = init?.initScript?.trim()
  if (!script) return tail
  const group = boundedInitGroup(script, resolveRepoInitTimeoutSeconds(init?.timeoutSeconds))
  // Restore sits OUTSIDE the once-per-worktree marker guard: every tab and
  // restart must get init's exports (the `repo-init.ts` contract), not only
  // the session that ran init.
  const restore = `[ -f "$__kobe_init_env" ] && . "$__kobe_init_env" 2>/dev/null`
  // The marker is interpolated INTO the script, so it must be in the form the
  // shell reads paths in — Git Bash rejects a backslash path in `[ -f ]`.
  const markerPath = init?.markerPath && toPosixPath(init.markerPath, init.platform)
  if (!markerPath) {
    // No durable home: per-shell dump, dropped after restore. Only direct
    // callers reach this; every spawner passes a marker.
    const tmpEnv = `__kobe_init_env="\${TMPDIR:-/tmp}/kobe-init-env.$$"`
    return SIGINT_GUARD + [tmpEnv, group, restore, `rm -f "$__kobe_init_env" 2>/dev/null`, tail].join("\n")
  }
  const marker = quoteShellArg(markerPath)
  const markerDir = quoteShellArg(markerDirOf(markerPath))
  // Beside the marker: same per-worktree keying and `mkdir -p`.
  const lock = quoteShellArg(`${markerPath}.lock`)
  // The winner's own ceiling plus slack for the shell around it: a loser that
  // gave up earlier would start its engine while init was still writing.
  const waitSeconds = String(resolveRepoInitTimeoutSeconds(init?.timeoutSeconds) + 5)
  return (
    SIGINT_GUARD +
    [
      // Durable and per-worktree, NOT per-shell `$TMPDIR/…$$`, so later
      // sessions still have it to source.
      `__kobe_init_env=${quoteShellArg(`${markerPath}.env`)}`,
      // The marker RECORDS the exit code so the paste-delivery spawner can
      // tell "never ran" from "finished badly". A recorded non-zero code
      // retries, same as a missing marker.
      `if [ ! -f ${marker} ] || [ "$(cat ${marker} 2>/dev/null)" != "0" ]; then`,
      `mkdir -p ${markerDir} 2>/dev/null`,
      // The marker is a RECEIPT, not a lock: absent for the whole run and
      // shared by every tab of the worktree, so concurrent tabs would both
      // pass the test above and run init twice, breaking "once per worktree"
      // (`state/repo-init.ts`, `docs/CONFIGURATION.md`).
      //
      // `set -C` makes `> file` POSIX sh's atomic create-or-fail (`flock`
      // isn't on every platform). The loser waits for the winner, so it
      // sources a COMPLETE env dump (written in the group, before the marker).
      `if (set -C; : > ${lock}) 2>/dev/null; then`,
      // Absent marker means "init still running" to the spawner; a stale code
      // left by a retry would make it paste before the engine starts.
      `rm -f ${marker} 2>/dev/null`,
      group,
      `printf '%s' "$__kobe_init_rc" > ${marker}`,
      `rm -f ${lock} 2>/dev/null`,
      "else",
      // Wait on the LOCK, not the marker: a loser could see the PREVIOUS run's
      // marker just before the winner deletes it. The lock spans from before
      // that delete until after the new marker is written.
      //
      // Bounded by init's own budget so a crashed winner costs one wait, not a
      // stall; the engine then starts without exports (as if init failed) and
      // clearing the stale lock lets the next launch retry.
      "__kobe_init_w=0",
      `while [ -f ${lock} ] && [ "$__kobe_init_w" -lt ${waitSeconds} ]; do sleep 1; __kobe_init_w=$((__kobe_init_w+1)); done`,
      `rm -f ${lock} 2>/dev/null`,
      "fi",
      "fi",
      restore,
      tail,
    ].join("\n")
  )
}

export interface EngineSessionLaunchTask {
  readonly id: string
  readonly kind?: "main" | "task" | "dir"
  readonly vendor?: VendorId
  readonly repo?: string
}

export interface EngineSessionProtocolGates {
  readonly status?: () => boolean
  readonly notes?: () => boolean
  readonly dispatcher?: () => boolean
}

export interface EngineSessionLaunchInput {
  readonly task: EngineSessionLaunchTask
  readonly worktreePath: string
  readonly shell: string
  /** Engine argv with any tab-specific pin/resume flag already applied. */
  readonly argv: readonly string[]
  readonly promptIntent: PromptDeliveryIntent
  readonly initTimeoutSeconds?: number
  /** Injectable feature gates keep the pure composition deterministic in tests. */
  readonly protocolGates?: EngineSessionProtocolGates
  /** Field-note reader seam; defaults to the real store (tests inject). */
  readonly readNotes?: (repoRoot: string) => readonly { text: string; author: string }[]
  /** Which engine TAB this session is (defaults to tab-1, the key's tab). */
  readonly tabId?: string
  /**
   * Override the registry's first-message delivery. Spawners leave it unset (a
   * "paste" vendor like kimi gets `firstMessage` back to paste post-spawn);
   * tests use it to pin the argv path.
   */
  readonly firstMessageDelivery?: "argv" | "paste"
}

export interface EngineSessionLaunch {
  readonly key: string
  readonly command: readonly string[]
  /**
   * First message the SPAWNER must paste once the engine is up (registry
   * `firstMessageDelivery: "paste"`). Undefined when it rode argv or is absent.
   */
  readonly firstMessage?: string
  /**
   * With a repo-init script: the marker written when init FINISHES, holding
   * its exit code (failure/timeout still marks completion). Paste-delivery
   * spawners wait for it before starting the engine-startup timer.
   */
  readonly initMarkerPath?: string
  /** Wait budget for {@link initMarkerPath} (ms); mirrors the script's init timeout. */
  readonly initTimeoutMs?: number
}

/** Canonical PTY Host key for a task's interactive engine tab (first by default). */
export function engineSessionKey(taskId: string, tabId = "tab-1"): string {
  return `${taskId}::${tabId}`
}

/**
 * A launch refused because the task lives on an SSH-backed remote project: git
 * goes through an exec host, but the PTY host spawns locally against a cwd
 * that only exists on the other machine. SSH engine launch is unimplemented.
 */
export class RemoteEngineLaunchError extends Error {
  readonly code = "REMOTE_ENGINE_LAUNCH_UNSUPPORTED"
  constructor(readonly repo: string) {
    super(`hosted engine launch over SSH is not implemented (remote project ${repo})`)
    this.name = "RemoteEngineLaunchError"
  }
}

/** Build one PTY Host spawn spec shared by interactive and headless entry. */
export function buildEngineSessionLaunch(input: EngineSessionLaunchInput): EngineSessionLaunch {
  // Guarded here: every entry point (tab open, `rove api send`, prompted
  // `add`) funnels through this canonical builder.
  const remoteKey = remoteKeyForRepo(input.task.repo) ?? remoteKeyForRepo(input.worktreePath)
  if (remoteKey) throw new RemoteEngineLaunchError(remoteKey)
  const protocolTaskId = input.task.kind === "main" ? undefined : input.task.id
  const dispatcherTaskId = input.task.kind === "main" ? input.task.id : undefined
  const gates = input.protocolGates
  const launchInit = resolveEngineLaunchInit(input.task.repo ?? "", input.worktreePath, input.promptIntent)
  // Field notes ride the protocol's --append-system-prompt. Worktree sessions
  // only — the main (dispatcher) session gets notes pushed live.
  const notes = protocolTaskId ? (input.readNotes ?? readFieldNotes)(input.task.repo ?? "") : []
  let argv = withDispatcherProtocol(
    withWorktreeProtocol(
      input.argv,
      input.task.vendor,
      protocolTaskId,
      {
        status: gates?.status,
        notes: gates?.notes,
      },
      notes,
    ),
    input.task.vendor,
    dispatcherTaskId,
    gates?.dispatcher,
  )
  // Paste-delivery vendors (kimi) read the positional slot as a subcommand, so
  // the first message stays out of argv; the spawner pastes it instead.
  const delivery = input.firstMessageDelivery ?? protocolEntry(input.task.vendor).firstMessageDelivery ?? "argv"
  const pasteFirstMessage = delivery === "paste" ? launchInit.firstMessage?.text : undefined
  if (launchInit.firstMessage && !pasteFirstMessage) argv = [...argv, launchInit.firstMessage.text]
  const markerPath = launchInit.initScript ? worktreeInitMarkerPath(input.worktreePath) : undefined
  const initTimeoutMs = resolveRepoInitTimeoutSeconds(input.initTimeoutSeconds) * 1000
  const script = engineLaunchLine(quoteShellArgv(argv, { bareSafe: true }), {
    initScript: launchInit.initScript,
    markerPath,
    timeoutSeconds: input.initTimeoutSeconds,
  })
  // Exported identity, inherited by hook subprocesses and the keepAlive shell:
  // tabs share one worktree, so cwd can't tell which task+tab an event is from.
  const taskId = quoteShellArg(input.task.id)
  const tabId = quoteShellArg(input.tabId ?? "tab-1")
  const identity = `export ROVE_TASK_ID=${taskId} KOBE_TASK_ID=${taskId} ROVE_TAB_ID=${tabId} KOBE_TAB_ID=${tabId}\n`
  return {
    key: engineSessionKey(input.task.id, input.tabId),
    command: [input.shell, "-ilc", identity + script],
    ...(pasteFirstMessage ? { firstMessage: pasteFirstMessage } : {}),
    ...(markerPath ? { initMarkerPath: markerPath, initTimeoutMs } : {}),
  }
}
