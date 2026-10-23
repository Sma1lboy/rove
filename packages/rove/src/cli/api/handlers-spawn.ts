/**
 * The `spawn` verb: a new conversation as a child of an existing task, either
 * in the parent's own directory (`--no-worktree`) or in a fresh worktree cut
 * from the parent's current branch tip. The rules live in the orchestrator
 * (`orchestrator/spawn-child.ts`); this is flag parsing, parent resolution,
 * and first-prompt delivery.
 */

import type { SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import { resolveCommandProtocol } from "../../engine/engine-presets.ts"
import { taskCwd } from "../../orchestrator/task-tree.ts"
import type { VendorId } from "../../types/vendor.ts"
import type { DaemonRpc } from "../daemon-session.ts"
import { launchedEngine } from "./add-engine-fields.ts"
import { dispatcherEnvPayload, ownSession, withPeerProvenance } from "./dispatcher.ts"
import { daemonOf } from "./handler-helpers.ts"
import { ApiError, type VerbContext, helpStep } from "./types.ts"

/**
 * `--parent`, else the caller's own verified session. A migrated child's PTY
 * still carries its parent's task id, so the aliased tab says which task the
 * caller really is.
 */
async function resolveParent(ctx: VerbContext, daemon: DaemonRpc): Promise<string> {
  const explicit = ctx.args.str("parent")
  if (explicit) return explicit
  const self = await ownSession(daemon)
  if (!self) {
    throw new ApiError(
      "no --parent given and the caller is not a verified rove session — pass --parent ID",
      "MISSING_TARGET",
      helpStep("spawn"),
    )
  }
  return self.taskId
}

/**
 * The shared child that stands in for a second engine tab on `parentTaskId`
 * (`send --tab new`, `tab-new --kind engine`): same directory, the pinned
 * `command` or else the parent's engine. No dispatcher: these verbs never set one.
 */
export async function spawnSharedChild(
  daemon: DaemonRpc,
  parentTaskId: string,
  command: string | undefined,
): Promise<SerializedTask> {
  const vendor = command ? resolveCommandProtocol(command) : undefined
  const res = await daemon.request<{ task: SerializedTask }>("task.spawn", {
    parentTaskId,
    worktree: false,
    ...(command ? { command } : {}),
    ...(vendor ? { vendor } : {}),
  })
  return res.task
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

export async function spawn(ctx: VerbContext): Promise<unknown> {
  const { args } = ctx
  const daemon = daemonOf(ctx)
  // Read (and validate) the prompt BEFORE `task.spawn`: its throws would
  // otherwise leave an orphan child behind an error carrying no taskId.
  const prompt = args.promptText()
  if (args.bool("worktree") === true && args.bool("no-worktree") === true) {
    throw new ApiError("--worktree and --no-worktree conflict — pass one", "CONFLICTING_FLAGS", helpStep("spawn"))
  }
  // A worktree is the default; `--worktree=false` and `--no-worktree` both opt out.
  const worktree = args.bool("no-worktree") !== true && args.bool("worktree") !== false
  if (!worktree && args.str("isolate-in")) {
    throw new ApiError(
      "--isolate-in cuts the worktree in the linked repo, so it cannot combine with --no-worktree",
      "CONFLICTING_FLAGS",
      helpStep("spawn"),
    )
  }
  const parentTaskId = await resolveParent(ctx, daemon)
  const command = args.str("command")
  const vendor = command ? resolveCommandProtocol(command) : undefined
  const res = await daemon.request<{
    taskId: string
    task: SerializedTask
    parentDirty: boolean
    sharedLinks: string[]
  }>("task.spawn", {
    parentTaskId,
    worktree,
    ...(await dispatcherEnvPayload(daemon)),
    ...(args.str("base-branch") ? { baseRef: args.str("base-branch") } : {}),
    ...(args.str("isolate-in") ? { isolateIn: args.str("isolate-in") } : {}),
    ...(args.str("title") ? { title: args.str("title") } : {}),
    ...(command ? { command } : {}),
    ...(vendor ? { vendor } : {}),
  })
  const { taskId, task, parentDirty, sharedLinks } = res
  const placed = { taskId, task, engine: launchedEngine(task), parentDirty, sharedLinks }
  if (!prompt) return { ...placed, started: false }

  // Same provenance prefix `send` carries: the child's brief names its parent session as the reply address.
  const brief = await withPeerProvenance(daemon, taskId, prompt)
  const delivered = await ctx.runtime.deliverPrompt(
    daemon,
    {
      id: taskId,
      worktreePath: taskCwd(task),
      kind: task.kind,
      vendor: task.vendor as VendorId | undefined,
      command: task.command,
      modelEffort: task.modelEffort,
      model: task.model,
      repo: task.repo,
      newTask: true,
    },
    brief,
  )
  // The child IS created, so the error carries its id.
  if (!delivered.delivered) {
    throw new ApiError(
      `task ${taskId} spawned but the prompt was not delivered (paste did not land)`,
      "NOT_DELIVERED",
      { taskId, engine: placed.engine, parentDirty, sharedLinks },
    )
  }
  // `.task.prompt` means "the engine was given exactly this text": recorded only once delivery confirmed.
  await daemon.request("task.setPrompt", { taskId, prompt }).catch((err: unknown) => {
    console.error(`[rove api spawn] task.setPrompt failed for ${taskId}:`, err)
  })
  return {
    ...placed,
    started: delivered.started,
    engineReady: delivered.engineReady,
    session: delivered.session,
    delivered: delivered.delivered,
    ...(delivered.bytes === undefined ? {} : { bytes: delivered.bytes }),
    ...(delivered.promptEcho ? { promptEcho: delivered.promptEcho } : {}),
    ...(delivered.reason ? { reason: delivered.reason } : {}),
  }
}
