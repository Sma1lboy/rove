/**
 * `send --handoff-from tab-N --replace`: the handoff lands in the DEAD tab's own
 * slot instead of a shared child. The task keeps one conversation per tab, so a
 * conversation whose engine is gone is replaced, not accompanied: same task, same
 * tab id, same worktree, a fresh session of the new engine. The row is repointed
 * (new engine, no old session), then `reviveTab` kills the leftover keepAlive
 * shell and launches the new engine in the same key; the brief is delivered to the
 * tab by the caller, as to any exact tab.
 */

import type { SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import { hostedKeyFor } from "@sma1lboy/rove-daemon/daemon/pty-alias"
import { withDeliveryLock } from "../../engine/delivery-lock.ts"
import { resolveCommandProtocol } from "../../engine/engine-presets.ts"
import { taskCwd } from "../../orchestrator/task-tree.ts"
import type { VendorId } from "../../types/vendor.ts"
import type { DaemonRpc } from "../daemon-session.ts"
import { ptyScopeOf } from "./pty-scope.ts"
import { ensureHostFor } from "./session-failed.ts"
import { applyTabOps, readDaemonTabs, taskEngineArgv } from "./tab-snapshot.ts"
import { ApiError, type ApiRuntime, type PromptTarget, helpStep } from "./types.ts"

/** Fields of the old conversation a replaced engine tab must not inherit. */
const OLD_CONVERSATION = [
  "sessionId",
  "spawned",
  "forkFrom",
  "initialPrompt",
  "liveVendor",
  "lastTitle",
  "autoTitle",
] as const

/**
 * Positive evidence only: the tab is an engine tab of THIS task whose session is gone
 * (`alive: false`) or whose engine left a bare shell behind (`engineAlive: false`).
 * Anything else — a running engine, an unknown liveness, a viewport onto another
 * task's session — is refused rather than guessed at.
 */
async function assertDeadEngineTab(
  runtime: ApiRuntime,
  daemon: DaemonRpc,
  task: SerializedTask,
  tabId: string,
): Promise<void> {
  const scope = await ptyScopeOf(daemon, task)
  if (hostedKeyFor(task.id, tabId, scope) === null || scope.alias?.tabId === tabId) {
    throw new ApiError(`tab ${tabId} runs under another task's conversation; --replace cannot swap it`, "BAD_FLAG", {
      taskId: task.id,
      tabId,
    })
  }
  const row = (await runtime.taskTabs(task.id, taskEngineArgv(task), scope)).tabs.find((t) => t.id === tabId)
  if (!row || row.kind !== "engine") {
    throw new ApiError(`${tabId} is not an engine conversation; nothing to replace`, "BAD_FLAG", helpStep("send"))
  }
  if (row.viewOf) {
    throw new ApiError(`${tabId} is a view of task ${row.viewOf}'s session; --replace cannot swap it`, "BAD_FLAG", {
      taskId: task.id,
      tabId,
    })
  }
  if (row.alive === false || row.engineAlive === false) return
  throw new ApiError(
    `${tabId}'s engine is still running; --replace only takes over a dead or exited tab. Drop --replace to continue in a shared child task`,
    "TAB_ALIVE",
    { taskId: task.id, tabId },
  )
}

/** Fields a replacement rewrites on the row: the old conversation's identity, plus the engine pick. */
const REWRITTEN = [...OLD_CONVERSATION, "vendor", "engineCommand"] as const

/** Put the tab back as it was and end whatever the replacement started, so the tab reads dead again and the same handoff can be retried. */
async function undoReplace(
  daemon: DaemonRpc,
  taskId: string,
  tabId: string,
  before: Readonly<Record<string, unknown>>,
): Promise<void> {
  const set: Record<string, unknown> = {}
  const unset: string[] = []
  for (const field of REWRITTEN) {
    if (before[field] === undefined) unset.push(field)
    else set[field] = before[field]
  }
  await applyTabOps(daemon, taskId, [{ op: "patch", id: tabId, set, unset }])
  const host = await ensureHostFor(taskId, "no PTY host to stop the replacement in")
  try {
    await host.rpc.request("pty.kill", { key: `${taskId}::${tabId}`, wait: true })
  } finally {
    host.close()
  }
}

/**
 * Repoint the dead tab at `command`'s engine with no conversation of its own, then
 * start it. Returns once the new engine's session is up, with the way to take it back:
 * the caller delivers the brief, and a delivery that fails calls it, so a failed handoff
 * costs the dead tab nothing (its conversation stays the one a retry briefs from).
 */
export function replaceDeadTab(
  ctx: { readonly runtime: ApiRuntime; readonly daemon: DaemonRpc },
  task: SerializedTask,
  tabId: string,
  command: string | undefined,
): Promise<() => Promise<void>> {
  const { runtime, daemon } = ctx
  return withDeliveryLock(`${task.id}::${tabId}::replace`, async () => {
    await assertDeadEngineTab(runtime, daemon, task, tabId)
    const worktree = taskCwd(task)
    if (!worktree) throw new ApiError(`task ${task.id} has no worktree yet`, "NO_WORKTREE")
    const before = ((await readDaemonTabs(daemon, task.id))?.tabs.find((t) => t.id === tabId) ?? {}) as Record<
      string,
      unknown
    >
    const protocol = command ? resolveCommandProtocol(command) : undefined
    // A wrapper preset launches its own command under its protocol; a plain engine id needs no override,
    // and the old tab's override must not survive onto a different engine.
    const set = protocol ? { vendor: protocol, ...(command !== protocol ? { engineCommand: command } : {}) } : undefined
    const unset = protocol && command === protocol ? [...OLD_CONVERSATION, "engineCommand"] : OLD_CONVERSATION
    const undo = () => undoReplace(daemon, task.id, tabId, before)
    await applyTabOps(daemon, task.id, [{ op: "patch", id: tabId, ...(set ? { set } : {}), unset }])
    const target: PromptTarget = {
      id: task.id,
      worktreePath: worktree,
      kind: task.kind,
      vendor: task.vendor as VendorId | undefined,
      command: task.command,
      modelEffort: task.modelEffort,
      model: task.model,
      repo: task.repo,
    }
    try {
      // The brief is pasted next; a paste before the engine is a process of its own lands in the leftover shell.
      await runtime.reviveTab(daemon, target, tabId, worktree, { replaceExited: true, awaitEngine: true })
    } catch (error) {
      await undo().catch(() => {})
      throw error
    }
    return undo
  })
}
