import type { DaemonRpcClient } from "@sma1lboy/kobe-daemon/client/rpc"
import { resolveLoginShell } from "@sma1lboy/kobe-daemon/daemon/platform-shell"
import type { SerializedTask } from "@sma1lboy/kobe-daemon/daemon/protocol"
import { engineLaunchArgv, protocolEntry } from "../engine/engine-presets.ts"
import {
  ComposerBusyError,
  awaitEngineProcess,
  deliverToHostedKey,
  ensureHostedEngine,
  ensureHostedSessionHost,
  findHostedEngineKey,
  hostedSessionFailureLine,
  hostedTaskKeys,
  killHostedSessions,
  listHostedSessions,
  openHostedSessionHost,
  pastePromptWhenEngineUp,
} from "../engine/hosted-session.ts"
import { sessionHasEngine } from "../engine/session-engine-presence.ts"
import { buildEngineSessionLaunch } from "../engine/session-launch.ts"
import { trustEngineWorktree } from "../engine/trust-worktree.ts"
import { TaskDeletingError } from "../orchestrator/errors.ts"
import type { PromptDeliveryIntent } from "../state/repo-init.ts"
import type { VendorId } from "../types/task.ts"

async function getTask(link: DaemonRpcClient, taskId: string): Promise<SerializedTask> {
  const { task } = await link.request<{ task: SerializedTask }>("task.get", {
    taskId,
  })
  return task
}

async function ensureTaskWorktree(link: DaemonRpcClient, taskId: string) {
  const task = await getTask(link, taskId)
  if (task.deletion) throw new TaskDeletingError(taskId)
  if (task.worktreePath) return { task, worktreePath: task.worktreePath }
  const { worktreePath } = await link.request<{ worktreePath: string | null }>("task.ensureWorktree", { taskId })
  if (!worktreePath) throw new Error(`task ${taskId} has no worktree`)
  return { task, worktreePath }
}

export async function ensureTaskSessionAdapter(link: DaemonRpcClient, taskId: string) {
  const { task, worktreePath } = await ensureTaskWorktree(link, taskId)
  const launch = taskEngineLaunch(task, worktreePath, { kind: "repo-init" })
  const host = await ensureHostedSessionHost()
  try {
    const opened = await ensureHostedEngine(host.rpc, worktreePath, launch)
    if (!opened.alive) throw new Error(`failed to start hosted engine session for ${taskId}`)
    // Paste-delivery vendor (kimi) with a repo init-prompt: the
    // message rides outside the argv. Best-effort paste — the engine IS up,
    // so a missed paste leaves an idle prompt, not a failed session.
    if (launch.firstMessage) {
      const engineBin = engineLaunchArgv({
        command: task.command,
        vendor: task.vendor,
        effort: task.modelEffort,
      })[0]
      await pastePromptWhenEngineUp(host.rpc, launch.key, engineBin, launch.firstMessage, {
        initMarkerPath: launch.initMarkerPath,
        initTimeoutMs: launch.initTimeoutMs,
      }).catch(() => false)
    }
  } finally {
    host.close()
  }
  return { session: launch.key, worktreePath }
}

/**
 * {@link ensureTaskSessionAdapter} with an explicit first message instead of
 * the repo's `.rove/init-prompt.md` (or legacy `.kobe` fallback). Used by the daemon's automation runner,
 * whose whole job is starting a session that says something specific.
 *
 * `promptIntent: {kind:"new-task"}` makes `buildEngineSessionLaunch` append the
 * text to the engine's OWN argv, so the prompt is part of the spawn rather
 * than a paste racing a cold TUI — the difference matters when no human is
 * watching to retype it.
 *
 * ## What `started` means here
 *
 * The ENGINE process was observed running, not "the login shell opened".
 * `ensureHostedEngine` answers the second question, and it answers `true` for
 * an `engineCommand` pointing at a binary that does not exist: the shell
 * prints `command not found`, keepAlive keeps the session, and the PTY is
 * alive with nothing in it. Reporting that as a start is what let a routine
 * record `dispatched` forever while every firing left a dead task behind — so
 * both delivery shapes wait for the engine itself before saying yes, and a
 * failure carries the session's last line so the caller can say WHY.
 */
export async function startTaskSessionWithPromptAdapter(
  link: DaemonRpcClient,
  taskId: string,
  prompt: string,
): Promise<{ started: boolean; error?: string }> {
  const { task, worktreePath } = await ensureTaskWorktree(link, taskId)
  // Learn the user's language from their own first prompt, so the text Rove
  // injects LATER — when no user message is in hand (a quota resume fired by
  // a timer) — comes out in the language they actually write. Best-effort:
  // this is an observation, and failing to record it must never block the
  // session it was observed from.
  await link.request("task.observeLanguage", { taskId, text: prompt }).catch(() => {})
  // "new-task", not "explicit": both callers (automation runner, work-item
  // start) create the task immediately ahead of this call, so the first prompt gets
  // the branch-rename coda like every other new-worktree entry point.
  const launch = taskEngineLaunch(task, worktreePath, {
    kind: "new-task",
    prompt,
  })
  const host = await ensureHostedSessionHost()
  try {
    const opened = await ensureHostedEngine(host.rpc, worktreePath, launch)
    if (!opened.alive) return { started: false, error: "hosted session did not open" }
    const engineBin = engineLaunchArgv({
      command: task.command,
      vendor: task.vendor,
      effort: task.modelEffort,
    })[0]
    const wait = { initMarkerPath: launch.initMarkerPath, initTimeoutMs: launch.initTimeoutMs }
    // Paste-delivery vendor (kimi): the prompt rides OUTSIDE the
    // argv; deliver it once the engine process is up. A paste that never
    // lands means the prompt was not delivered — report false.
    if (launch.firstMessage) {
      const outcome = await pastePromptWhenEngineUp(host.rpc, launch.key, engineBin, launch.firstMessage, wait)
      if (outcome !== null) return { started: true }
      return { started: false, error: await startFailureReason(host.rpc, launch.key) }
    }
    // Argv-delivery vendor (claude, codex, copilot): the prompt is already on
    // the engine's command line, so there is nothing left to deliver — but
    // nothing has confirmed the engine READ that command line either.
    if ((await awaitEngineProcess(host.rpc, launch.key, engineBin, wait)) !== null) return { started: true }
    return { started: false, error: await startFailureReason(host.rpc, launch.key) }
  } finally {
    host.close()
  }
}

/** Why a spawn did not produce an engine, in the session's own words. */
async function startFailureReason(rpc: Parameters<typeof hostedSessionFailureLine>[0], key: string): Promise<string> {
  const tail = await hostedSessionFailureLine(rpc, key)
  const base = "engine process never started"
  return tail ? `${base}; last session output: ${tail}` : base
}

function taskEngineLaunch(task: SerializedTask, worktreePath: string, promptIntent: PromptDeliveryIntent) {
  // Pre-trust the worktree in the vendor's first-run store.
  trustEngineWorktree(task.vendor, worktreePath)
  return buildEngineSessionLaunch({
    task: {
      id: task.id,
      kind: task.kind,
      vendor: task.vendor,
      repo: task.repo,
    },
    worktreePath,
    shell: resolveLoginShell({ fallback: "/bin/zsh" }),
    argv: engineLaunchArgv({
      command: task.command,
      vendor: task.vendor,
      effort: task.modelEffort,
    }),
    promptIntent,
  })
}

/**
 * Deliver a prompt into a task's LIVE hosted engine session only — never
 * spawns one. Used by the daemon's quota-resume runner: resuming a dead
 * engine would start a fresh context-less session and burn quota on it, so
 * "no alive engine" returns false and the schedule is dropped instead.
 *
 * "Alive engine" is a PROCESS fact, not a session one. `findHostedEngineKey`
 * matches the session's spawn argv, which keeps matching long after the
 * engine exited: keepAlive `exec`s a login shell in its place, the session
 * stays alive, and a paste into it is EXECUTED as shell commands in the
 * task's worktree. `sessionHasEngine` is the same gate `send` applies before
 * writing a byte (`cli/api/pty-delivery.ts`), and every path that writes
 * needs it — this one delivers unattended, on a timer.
 */
export async function deliverPromptToLiveEngineAdapter(
  task: {
    readonly id: string
    readonly vendor?: VendorId
    readonly command?: string
    readonly worktreePath: string
  },
  prompt: string,
): Promise<boolean> {
  const host = await openHostedSessionHost()
  if (!host) return false
  try {
    const sessions = await listHostedSessions(host.rpc)
    const engineArgv = engineLaunchArgv({
      command: task.command,
      vendor: task.vendor,
    })
    const key = findHostedEngineKey(sessions, task.id, engineArgv[0])
    if (!key) return false
    if (!(await sessionHasEngine(sessions.find((s) => s.key === key)?.pid, engineArgv))) return false
    const manifest = task.vendor ? protocolEntry(task.vendor).screenManifest : undefined
    return (
      (await deliverToHostedKey(host.rpc, key, prompt, {
        screenManifest: manifest,
      })) !== null
    )
  } catch (err) {
    // Composer-busy is not a silent failure: let the quota-resume runner log
    // it instead of dropping the prompt without a trace.
    if (err instanceof ComposerBusyError) throw err
    return false
  } finally {
    host.close()
  }
}

/** The tab a hosted session key names (`<taskId>::<tabId>`), default tab-1. */
function tabIdFromHostedKey(key: string): string {
  return key.split("::")[1] ?? "tab-1"
}

/**
 * {@link deliverPromptToLiveEngineAdapter} reporting composer-busy as a VALUE.
 *
 * The routine runner must not drop a daily report the way
 * quota-resume drops a continue nudge: a dropped report and a routine that
 * never ran look identical to the user. It needs the busy layer and the tab
 * to file a deferral, and the daemon cannot catch `ComposerBusyError` by type
 * across the package boundary — so the outcome crosses as data.
 *
 * `no-engine` is the same fact as {@link deliverPromptToLiveEngineAdapter}'s
 * refusal, kept distinct from `no-session` because the caller acts on it
 * differently: a routine that finds its overnight engine dead must respawn
 * and record `revived`, not paste a natural-language instruction at a zsh
 * prompt and record `dispatched`.
 */
export async function deliverPromptToLiveEngineDetailedAdapter(
  task: {
    readonly id: string
    readonly vendor?: VendorId
    readonly command?: string
    readonly worktreePath: string
  },
  prompt: string,
): Promise<
  | { outcome: "delivered"; tabId: string }
  | { outcome: "no-session" }
  | { outcome: "no-engine"; tabId: string }
  | {
      outcome: "busy"
      tabId: string
      layer: "recent-human-write" | "composer-not-empty"
    }
> {
  const host = await openHostedSessionHost()
  if (!host) return { outcome: "no-session" }
  try {
    const sessions = await listHostedSessions(host.rpc)
    const engineArgv = engineLaunchArgv({
      command: task.command,
      vendor: task.vendor,
    })
    const key = findHostedEngineKey(sessions, task.id, engineArgv[0])
    if (!key) return { outcome: "no-session" }
    if (!(await sessionHasEngine(sessions.find((s) => s.key === key)?.pid, engineArgv))) {
      return { outcome: "no-engine", tabId: tabIdFromHostedKey(key) }
    }
    const manifest = task.vendor ? protocolEntry(task.vendor).screenManifest : undefined
    try {
      const delivered = await deliverToHostedKey(host.rpc, key, prompt, {
        screenManifest: manifest,
      })
      return delivered === null ? { outcome: "no-session" } : { outcome: "delivered", tabId: tabIdFromHostedKey(key) }
    } catch (err) {
      if (err instanceof ComposerBusyError) {
        return {
          outcome: "busy",
          tabId: tabIdFromHostedKey(key),
          layer: err.layer,
        }
      }
      throw err
    }
  } catch {
    // A host that went away mid-delivery is indistinguishable from one that
    // was never there — both mean "revive it", which is the caller's fallback.
    return { outcome: "no-session" }
  } finally {
    host.close()
  }
}

/** Exact-tab variant used by deferred queue draining. Never reroutes or spawns. */
export async function deliverPromptToLiveEngineTabDetailedAdapter(
  target: {
    readonly id: string
    readonly tabId: string
    readonly vendor?: VendorId
    readonly command?: string
    readonly worktreePath: string
  },
  prompt: string,
): Promise<
  | { outcome: "delivered"; tabId: string }
  | { outcome: "no-session" }
  | { outcome: "no-engine"; tabId: string }
  | {
      outcome: "busy"
      tabId: string
      layer: "recent-human-write" | "composer-not-empty"
    }
> {
  const host = await openHostedSessionHost()
  if (!host) return { outcome: "no-session" }
  try {
    const key = `${target.id}::${target.tabId}`
    let sessions: Awaited<ReturnType<typeof listHostedSessions>>
    try {
      sessions = await listHostedSessions(host.rpc)
    } catch {
      return { outcome: "no-session" }
    }
    const session = sessions.find((candidate) => candidate.alive && candidate.key === key)
    if (!session) return { outcome: "no-session" }
    const engineArgv = engineLaunchArgv({
      command: target.command,
      vendor: target.vendor,
    })
    if (!(await sessionHasEngine(session.pid, engineArgv))) return { outcome: "no-engine", tabId: target.tabId }
    const manifest = target.vendor ? protocolEntry(target.vendor).screenManifest : undefined
    try {
      const delivered = await deliverToHostedKey(host.rpc, key, prompt, {
        screenManifest: manifest,
      })
      return delivered === null ? { outcome: "no-session" } : { outcome: "delivered", tabId: target.tabId }
    } catch (err) {
      if (err instanceof ComposerBusyError) {
        return { outcome: "busy", tabId: target.tabId, layer: err.layer }
      }
      throw err
    }
  } finally {
    host.close()
  }
}

export async function tearDownTaskSessionAdapter(taskId: string): Promise<void> {
  const host = await openHostedSessionHost()
  if (!host) return
  try {
    await killHostedSessions(host.rpc, hostedTaskKeys(await listHostedSessions(host.rpc), taskId))
  } catch {
    // Task mutation already committed; teardown remains best-effort.
  } finally {
    host.close()
  }
}
