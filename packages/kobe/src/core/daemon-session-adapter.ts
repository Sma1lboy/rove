import type { DaemonRpcClient } from "@sma1lboy/kobe-daemon/client/rpc"
import { resolveLoginShell } from "@sma1lboy/kobe-daemon/daemon/platform-shell"
import type { SerializedTask } from "@sma1lboy/kobe-daemon/daemon/protocol"
import { engineLaunchArgv } from "../engine/engine-presets.ts"
import {
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
import { enginePresence } from "../engine/session-engine-presence.ts"
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
    // Paste-delivery vendor (kimi): best-effort — the engine IS up, so a
    // missed paste leaves an idle prompt, not a failed session.
    if (launch.firstMessage) {
      const engineBin = engineLaunchArgv({
        command: task.command,
        vendor: task.vendor,
        effort: task.modelEffort,
        model: task.model,
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
 * the repo init-prompt. `new-task` intent puts the prompt in the engine's own
 * argv, not a paste racing a cold TUI with nobody watching.
 *
 * `started` = the ENGINE process was observed, not just the shell:
 * `ensureHostedEngine` says alive even for a missing binary (keepAlive keeps
 * the `command not found` shell), which would record `dispatched` for a dead
 * task. Failures carry the session's last line.
 */
export async function startTaskSessionWithPromptAdapter(
  link: DaemonRpcClient,
  taskId: string,
  prompt: string,
): Promise<{ started: boolean; error?: string }> {
  const { task, worktreePath } = await ensureTaskWorktree(link, taskId)
  // So later Rove-injected text (e.g. timer-fired quota resume) matches the
  // user's language. Best-effort: must never block the session.
  await link.request("task.observeLanguage", { taskId, text: prompt }).catch(() => {})
  // "new-task", not "explicit": callers just created the task, so the prompt
  // gets the branch-rename coda like other new-worktree entry points.
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
      model: task.model,
    })[0]
    const wait = { initMarkerPath: launch.initMarkerPath, initTimeoutMs: launch.initTimeoutMs }
    // Paste-delivery vendor (kimi): a paste that never lands is not started.
    if (launch.firstMessage) {
      const outcome = await pastePromptWhenEngineUp(host.rpc, launch.key, engineBin, launch.firstMessage, wait)
      if (outcome !== null) return { started: true }
      return { started: false, error: await startFailureReason(host.rpc, launch.key) }
    }
    // Argv-delivery vendor: prompt is on the command line, but confirm the engine runs.
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
      model: task.model,
    }),
    promptIntent,
  })
}

/**
 * Deliver into a LIVE engine only — never spawns (quota-resume: a fresh
 * context-less session would burn quota), so returns false instead.
 *
 * "Alive" is a PROCESS fact: the spawn-argv key keeps matching after the
 * engine exits and keepAlive `exec`s a shell, where a paste would be EXECUTED
 * in the worktree. `enginePresence` is the same gate `send` applies; every
 * writing path needs it.
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
    const presence = await enginePresence(sessions.find((s) => s.key === key)?.pid, engineArgv)
    if (presence.kind !== "engine") return false
    return (await deliverToHostedKey(host.rpc, key, prompt, { vendor: presence.vendor })) !== null
  } catch {
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
 * {@link deliverPromptToLiveEngineAdapter} reporting which tab and why not.
 * `no-engine` stays distinct from `no-session`: a routine finding its engine
 * dead must respawn and record `revived`, not paste at a zsh prompt.
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
  { outcome: "delivered"; tabId: string } | { outcome: "no-session" } | { outcome: "no-engine"; tabId: string }
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
    const presence = await enginePresence(sessions.find((s) => s.key === key)?.pid, engineArgv)
    if (presence.kind !== "engine") {
      return { outcome: "no-engine", tabId: tabIdFromHostedKey(key) }
    }
    const delivered = await deliverToHostedKey(host.rpc, key, prompt, { vendor: presence.vendor })
    return delivered === null ? { outcome: "no-session" } : { outcome: "delivered", tabId: tabIdFromHostedKey(key) }
  } catch {
    // A host lost mid-delivery also means "revive it".
    return { outcome: "no-session" }
  } finally {
    host.close()
  }
}

/** Exact-tab variant (a routine bound to one tab). Never reroutes or spawns. */
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
  { outcome: "delivered"; tabId: string } | { outcome: "no-session" } | { outcome: "no-engine"; tabId: string }
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
    const presence = await enginePresence(session.pid, engineArgv)
    if (presence.kind !== "engine") return { outcome: "no-engine", tabId: target.tabId }
    const delivered = await deliverToHostedKey(host.rpc, key, prompt, { vendor: presence.vendor })
    return delivered === null ? { outcome: "no-session" } : { outcome: "delivered", tabId: target.tabId }
  } finally {
    host.close()
  }
}

export async function tearDownTaskSessionAdapter(taskId: string): Promise<void> {
  const host = await openHostedSessionHost()
  if (!host) return
  try {
    // `wait`: every caller removes the worktree next, and on Windows a child
    // still exiting with its cwd inside makes it undeletable.
    await killHostedSessions(host.rpc, hostedTaskKeys(await listHostedSessions(host.rpc), taskId), { wait: true })
  } catch {
    // Task mutation already committed; teardown remains best-effort.
  } finally {
    host.close()
  }
}
