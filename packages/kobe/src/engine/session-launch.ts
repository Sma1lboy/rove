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
 * The {@link keepAlive} banner, as a matcher.
 *
 * Lives beside the `printf` that emits it so the two cannot drift: this is
 * how a caller OUTSIDE the PTY — the automation runner, which has to explain
 * a dispatch that produced no engine — reads the exit code back out of the
 * session's own output. Capture group 1 is that code.
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
  /** Which shell dialect the marker path is written for. Defaults to the real
   *  platform; injected so the Windows conversion is assertable on a POSIX
   *  runner, where it would otherwise be an identity no-op. */
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
 * Leaves the caller two things: `$__kobe_init_rc` (the outcome — `124` on
 * timeout) and, on success only, an env dump at `$__kobe_init_env` for the
 * caller to source. The caller owns both the path and the sourcing, because
 * the dump outlives this run — see {@link engineLaunchLine}.
 *
 * The dump is the DELTA of `export -p` across the script, not the whole
 * environment. It is sourced by EVERY session in the worktree, and a whole
 * dump would re-export the first session's `ROVE_TASK_ID` / `ROVE_TAB_ID`
 * over each later tab's own identity — hooks would then attribute every
 * tab's events to tab-1 — besides carrying its `PWD`/`SHLVL` along. Written
 * under `umask 077`: an init script's exports are exactly where an API key
 * would be.
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
  // Restoring the init script's exports sits OUTSIDE the once-per-worktree
  // marker guard. The marker is per-WORKTREE, so keeping the restore inside it
  // meant only the first session in a worktree ever saw what `.rove/init.sh`
  // exported — every later tab, and every restart of the first one, exec'd the
  // engine with none of its PATH/venv/API-key exports and no banner saying why.
  // `repo-init.ts`'s own contract says the exports reach the engine; this is
  // the half of it the guard was eating.
  const restore = `[ -f "$__kobe_init_env" ] && . "$__kobe_init_env" 2>/dev/null`
  // The marker is interpolated INTO the script, so it must be in the form the
  // shell reads paths in — Git Bash rejects a backslash path in `[ -f ]`.
  const markerPath = init?.markerPath && toPosixPath(init.markerPath, init.platform)
  if (!markerPath) {
    // No durable home for the dump — keep it per-shell and drop it after the
    // restore. Only reachable from direct callers; every spawner passes a marker.
    const tmpEnv = `__kobe_init_env="\${TMPDIR:-/tmp}/kobe-init-env.$$"`
    return SIGINT_GUARD + [tmpEnv, group, restore, `rm -f "$__kobe_init_env" 2>/dev/null`, tail].join("\n")
  }
  const marker = quoteShellArg(markerPath)
  const markerDir = quoteShellArg(markerDirOf(markerPath))
  return (
    SIGINT_GUARD +
    [
      // Durable and per-worktree, next to the marker — NOT `$TMPDIR/…$$`,
      // which is per-shell and was deleted the moment the first session's
      // init finished, leaving later sessions nothing to source.
      `__kobe_init_env=${quoteShellArg(`${markerPath}.env`)}`,
      // The marker RECORDS the outcome instead of only existing on success.
      // "Init never ran" and "init finished badly" used to look identical from
      // outside, and the paste-delivery spawner that waits on this file
      // therefore burned its whole 120s budget on any repo whose init.sh exits
      // non-zero. Re-run gating is unchanged in effect: a recorded non-zero
      // code retries, exactly as a missing marker did.
      `if [ ! -f ${marker} ] || [ "$(cat ${marker} 2>/dev/null)" != "0" ]; then`,
      `mkdir -p ${markerDir} 2>/dev/null`,
      // This run owns the marker while it runs: absent means "init is still
      // going", which is the question the spawner is asking. Without the
      // delete a retry would leave the previous run's code on disk and the
      // spawner would paste into an engine that has not started yet.
      `rm -f ${marker} 2>/dev/null`,
      group,
      `printf '%s' "$__kobe_init_rc" > ${marker}`,
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
   * Override the registry's first-message delivery for this launch. Spawners
   * normally leave it unset so the registry contract applies — a "paste"
   * vendor (kimi) gets its prompt back as `firstMessage` for the spawner to
   * paste post-spawn. The override survives for tests pinning the argv path.
   */
  readonly firstMessageDelivery?: "argv" | "paste"
}

export interface EngineSessionLaunch {
  readonly key: string
  readonly command: readonly string[]
  /**
   * First message the SPAWNER must deliver itself after the engine process
   * is up (paste-delivery vendors — see the registry's
   * `firstMessageDelivery`). Undefined when the message already rode the
   * launch argv or there is none.
   */
  readonly firstMessage?: string
  /**
   * When the launch includes a repo-init script, this is the marker file the
   * script writes when init FINISHES — carrying its exit code, so a failed or
   * timed-out init still marks completion. Paste-delivery spawners wait for it
   * before starting the engine-startup timer.
   */
  readonly initMarkerPath?: string
  /**
   * How long to wait for {@link initMarkerPath} to appear (ms). Mirrors the
   * bounded init timeout woven into the launch script.
   */
  readonly initTimeoutMs?: number
}

/** Canonical PTY Host key for a task's interactive engine tab (first by default). */
export function engineSessionKey(taskId: string, tabId = "tab-1"): string {
  return `${taskId}::${tabId}`
}

/**
 * A launch refused because the task lives on an SSH-backed remote project.
 *
 * The experimental remote-projects feature routes git through an exec host,
 * but the PTY host spawns locally against a raw cwd — so a remote task's
 * worktree path, which exists on the OTHER machine, gets an engine started
 * here against a directory that is not there. `rove add --remote` and the
 * Settings toggle both say SSH engine launch is unimplemented; this is the
 * guard that makes the code agree with the copy instead of failing obscurely.
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
  // ONE guard, here, because this is the single spawn-spec builder every entry
  // point funnels through — the Workspace host's tab open, `rove api send`,
  // and a prompted `add` alike (docs/ARCHITECTURE.md names it the canonical
  // launch builder). A per-caller check would leave whichever caller came next.
  const remoteKey = remoteKeyForRepo(input.task.repo) ?? remoteKeyForRepo(input.worktreePath)
  if (remoteKey) throw new RemoteEngineLaunchError(remoteKey)
  const protocolTaskId = input.task.kind === "main" ? undefined : input.task.id
  const dispatcherTaskId = input.task.kind === "main" ? input.task.id : undefined
  const gates = input.protocolGates
  const launchInit = resolveEngineLaunchInit(
    input.task.repo ?? "",
    input.worktreePath,
    input.promptIntent,
    input.task.id,
  )
  // The repo's accumulated field notes ride along in the same
  // --append-system-prompt as the filing protocol, so a fresh worktree
  // session starts with what earlier sessions already learned. Read only for
  // worktree (card) sessions — the main session is the dispatcher and gets
  // notes pushed to it live.
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
  // Paste-delivery vendors (kimi) must NOT see the first message
  // in their argv: their positional slot is a subcommand, so the text would
  // kill the launch as an unknown command. The spawner pastes it instead
  // (see EngineSessionLaunch.firstMessage).
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
  // Session identity as exported env, ahead of everything: the engine's hook
  // subprocesses inherit it, so `kobe hook` reports EXACTLY which task+tab an
  // event came from — a task's tabs share one worktree, so cwd can't tell
  // them apart. The keepAlive fallback shell inherits it too, so a manual
  // `claude` run in that tab after an engine exit is still attributed.
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
