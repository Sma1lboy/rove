/**
 * Dispatcher provenance — the collaboration loop's reply address. A task
 * created from inside another rove engine tab records WHO dispatched it
 * (`dispatcher: {taskId, tabId}`), and a bare `send` from that task replies
 * to exactly that tab. Holds both the create-side stamping and the send-side
 * routing.
 */

import type { DaemonRpc } from "@sma1lboy/rove-core/client/daemon-session.ts"
import { ROVE_PRODUCT_NAME } from "@sma1lboy/rove-core/product.ts"
import type { SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import { type Dispatcher, ownSession } from "../../client/dispatch-provenance.ts"
import { roveApiInvocation } from "../../engine/interactive-command.ts"
import { taskEngineArgv } from "../../tabs/tab-snapshot.ts"
import { ptyScopeOf } from "./pty-scope.ts"
import { ApiError, type ApiRuntime } from "./types.ts"

export {
  type Dispatcher,
  type OwnReplyRoute,
  type SelfSessionProbe,
  dispatcherEnvPayload,
  ownSession,
  readOwnDispatcher,
  recordSend,
  resetVerifiedSelfSession,
  takeIdentityWarning,
  verifiedSelfSession,
} from "../../client/dispatch-provenance.ts"

/** A rove session's bare `send` with no dispatcher: the active task is the person's focus, not an address an agent meant. */
export function noReplyAddress(self: Dispatcher): ApiError {
  return new ApiError(
    `task ${self.taskId} has no dispatcher on record, so a send without --task-id has no reply address`,
    "NO_REPLY_ADDRESS",
    {
      hint: `name the target with --task-id/--tab (see \`${ROVE_PRODUCT_NAME} api list\`), or notify the user with \`${ROVE_PRODUCT_NAME} api notify\``,
      nextCommandArgs: ["api", "list"],
    },
  )
}

/**
 * Pick the tab a dispatcher-defaulted `send` lands on: the dispatched-from
 * tab, else the dispatcher task's canonical live engine tab, NEVER a silent
 * spawn — with nothing alive it throws a typed error. `undefined` means "the
 * canonical tab" in the delivery layer's spelling.
 */
export async function resolveDispatcherTab(
  runtime: ApiRuntime,
  daemon: DaemonRpc,
  dispatcher: Dispatcher,
): Promise<string | undefined> {
  // A migrated child's tabs are read from the PTY its alias names, not from keys under its own id.
  const task = await daemon
    .request<{ task: SerializedTask }>("task.get", { taskId: dispatcher.taskId })
    .then((res) => res.task)
    .catch(() => null)
  const { tabs, running } = await runtime.taskTabs(
    dispatcher.taskId,
    undefined,
    task ? await ptyScopeOf(daemon, task) : undefined,
  )
  // Only when ALIVE: the tab join also lists live sessions the snapshot never
  // registered, and a tab merely gone from the snapshot gets the canonical
  // fallback instead of a TAB_NOT_FOUND at delivery.
  if (tabs.some((t) => t.id === dispatcher.tabId && t.alive)) return dispatcher.tabId
  // Gated on a live engine tab: the canonical path COLD-STARTS an engine for
  // a task with none — right for a first prompt, wrong for a reply.
  if (running) return undefined
  throw new ApiError(
    `dispatcher tab ${dispatcher.tabId} on task ${dispatcher.taskId} is dead and the task has no live engine tab — the reply has nowhere to land`,
    "DISPATCHER_UNREACHABLE",
    {
      dispatcher,
      hint: `address an alive target explicitly with --task-id/--tab (see \`${ROVE_PRODUCT_NAME} api pty-list\`), or notify the user with \`${ROVE_PRODUCT_NAME} api notify\``,
      nextCommandArgs: ["api", "pty-list"],
    },
  )
}

/**
 * The tab of `taskId` a task re-parented under it should reply to: the caller's own tab when the caller speaks
 * for that task, else its live engine tab. `undefined` = none known (the daemon records `tab-1`, and a reply
 * then falls back to the canonical engine tab if that one is dead — see {@link resolveDispatcherTab}).
 */
export async function replyTabOf(runtime: ApiRuntime, daemon: DaemonRpc, taskId: string): Promise<string | undefined> {
  const self = await ownSession(daemon)
  if (self?.taskId === taskId) return self.tabId
  const task = await daemon
    .request<{ task: SerializedTask }>("task.get", { taskId })
    .then((res) => res.task)
    .catch(() => null)
  if (!task) return undefined
  const { tabs } = await runtime.taskTabs(taskId, taskEngineArgv(task), await ptyScopeOf(daemon, task))
  return tabs.find((t) => t.kind === "engine" && t.alive === true && t.engineAlive !== false)?.id
}

/**
 * Peer provenance: a prompt issued from INSIDE another rove task tells the
 * receiver who is talking and how to answer.
 *
 * Both delivery verbs wear it, `add --prompt` included: otherwise the sender
 * is only the task ROW's `dispatcher`, which a receiver has no reason to go
 * read, so a dispatched task finishes and then sits waiting. A
 * `from task <id>` header plus the reply command — the id only: a title is
 * the session's opening line, stale by the time anyone reads it. Sender is the VERIFIED $ROVE_TASK_ID/$ROVE_TAB_ID pair — an
 * unverified one would bake a stranger's tab into the reply command. A send
 * from a plain shell, an unverified process, or to yourself stays untouched.
 */
export async function withPeerProvenance(daemon: DaemonRpc, targetTaskId: string, prompt: string): Promise<string> {
  const self = await ownSession(daemon)
  const senderId = self?.taskId
  if (!self || !senderId || senderId === targetTaskId) return prompt
  const api = roveApiInvocation()
  // The sender's TAB, not just its task: task-granular replies go through
  // canonical-tab resolution, the link that breaks. $ROVE_TAB_ID is exported
  // into every engine tab (session-launch.ts).
  const replyTarget = `--task-id ${senderId} --tab ${self.tabId}`
  // A pointer, not a curriculum: every peer message pays for this prefix in
  // context, so the command path appears once (the skill names `schema`). The skill is required ONCE PER SESSION — a receiver replying
  // from the raw prefix alone improvises verbs and side-channels.
  //
  // "reply only if it changes what I do next": an unconditional "reply" made
  // peers acknowledge every message (and each other's acknowledgements), one
  // full engine turn apiece.
  // The sender's text goes LAST, whole, after a blank line: a model replies
  // in the language of the tokens nearest its turn, so wrapping a Chinese
  // prompt in an English clause pulls replies into English.
  return `[ROVE PEER] from task ${senderId} (Rove agent skill /rove, read it once per session; reply only if it changes what I do next: \`${api} send ${replyTarget} --prompt "<text>"\`)\n\n${prompt}`
}
