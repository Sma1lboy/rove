/**
 * Shared children: the second conversation on a task that already ran its own
 * (`send --tab new`, `tab-new --kind engine`) is a child sharing the task's
 * directory. The rules live in the orchestrator (`orchestrator/spawn-child.ts`);
 * this is the CLI's placement, serialization and failure handling.
 */

import type { SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import { withDeliveryLock } from "../../engine/delivery-lock.ts"
import { resolveCommandProtocol } from "../../engine/engine-presets.ts"
import { PLACEHOLDER_TASK_TITLE, deriveTitleFromPrompt } from "../../orchestrator/title.ts"
import type { DaemonRpc } from "../daemon-session.ts"
import { ptyScopeOf } from "./pty-scope.ts"
import { readDaemonTabs, taskEngineArgv } from "./tab-snapshot.ts"
import { ApiError, type ApiRuntime } from "./types.ts"

/**
 * The shared child that stands in for a later engine conversation on `parentTaskId`
 * (`send --tab new`, `tab-new --kind engine`): same directory, the pinned
 * `command` or else the parent's engine. No dispatcher: these verbs never set one.
 */
export async function spawnSharedChild(
  daemon: DaemonRpc,
  parentTaskId: string,
  command: string | undefined,
  title?: string,
): Promise<SerializedTask> {
  const vendor = command ? resolveCommandProtocol(command) : undefined
  const res = await daemon.request<{ task: SerializedTask }>("task.spawn", {
    parentTaskId,
    worktree: false,
    ...(title ? { title } : {}),
    ...(command ? { command } : {}),
    ...(vendor ? { vendor } : {}),
  })
  return res.task
}

/** How long a second new conversation waits on the first's claim of the task's own tab-1 (engine boot included). */
const FIRST_CONVERSATION_LOCK_MS = 120_000

/**
 * Serializes new-conversation calls on one task: two concurrent ones on an unstarted task would both
 * claim its tab-1. The second runs after the first, sees the engine started, and becomes a shared child.
 */
export function withFirstConversationLock<T>(taskId: string, fn: () => Promise<T>): Promise<T> {
  return withDeliveryLock(`${taskId}::new-conversation`, fn, { timeoutMs: FIRST_CONVERSATION_LOCK_MS })
}

/** Where a new engine conversation starts: the task's own `tab-1`, or a shared child. */
export interface ConversationHome {
  readonly task: SerializedTask
  readonly child: boolean
}

/**
 * Whether the task's own conversation ran: an engine tab that spawned, or its first engine tab
 * holding a live session (the TUI's `engineStarted`). A seeded, never-launched tab-1 — beside a
 * shell, or from merely viewing the task — is no conversation.
 */
async function engineStarted(daemon: DaemonRpc, runtime: ApiRuntime, task: SerializedTask): Promise<boolean> {
  if (task.ptyAlias) return true
  const tabs = (await readDaemonTabs(daemon, task.id))?.tabs ?? []
  const engines = tabs.filter((tab) => tab.kind === "engine")
  if (engines.length === 0) return false
  if (engines.some((tab) => tab.spawned)) return true
  const { tabs: rows } = await runtime.taskTabs(task.id, taskEngineArgv(task), await ptyScopeOf(daemon, task))
  return rows.find((row) => row.id === engines[0]?.id)?.alive === true
}

/**
 * A task whose engine never started has had no conversation, and its first one lives in the
 * task itself (`tab-1`); only a later one is a shared child. A differing `command` re-points the
 * unstarted task's engine first; a first `prompt` replaces a placeholder title.
 */
export async function conversationHome(
  daemon: DaemonRpc,
  runtime: ApiRuntime,
  task: SerializedTask,
  command: string | undefined,
  prompt?: string,
): Promise<ConversationHome> {
  const title = prompt ? deriveTitleFromPrompt(prompt) : ""
  if (await engineStarted(daemon, runtime, task)) {
    return { task: await spawnSharedChild(daemon, task.id, command, title), child: true }
  }
  if (command && command !== task.command) {
    const vendor = resolveCommandProtocol(command)
    await daemon.request("task.setCommand", { taskId: task.id, command, ...(vendor ? { vendor } : {}) })
  }
  // The first prompt names the task; a rename failure must not stop the conversation.
  if (title && task.title === PLACEHOLDER_TASK_TITLE) {
    await daemon.request("task.rename", { taskId: task.id, title }).catch(() => undefined)
  }
  const fresh = await daemon.request<{ task: SerializedTask }>("task.get", { taskId: task.id })
  return { task: fresh.task, child: false }
}

/** Refusals before any session started: nothing ran, so the caller may retry from scratch. */
const ENGINE_REFUSALS: Record<string, true> = {
  ENGINE_LIMIT: true,
  ENGINE_ADMISSION_BUSY: true,
  ENGINE_ADMISSION_UNAVAILABLE: true,
}

/**
 * A shared child whose engine did not start. A refusal before anything ran takes
 * the empty child back and points the retry at the parent (`retryArgs`); any other
 * failure keeps the child and names it.
 */
export async function failSharedChild(
  daemon: DaemonRpc,
  err: unknown,
  childTaskId: string,
  retryArgs: readonly string[],
): Promise<never> {
  if (!(err instanceof ApiError)) throw err
  if (ENGINE_REFUSALS[err.code]) {
    // Not forced: if the parent went first, this child is the last row and must keep its dirty gate.
    await daemon.request("task.delete", { taskId: childTaskId }).catch(() => undefined)
    throw new ApiError(err.message, err.code, { ...err.data, nextCommandArgs: retryArgs })
  }
  throw new ApiError(err.message, err.code, { ...err.data, childTaskId })
}
