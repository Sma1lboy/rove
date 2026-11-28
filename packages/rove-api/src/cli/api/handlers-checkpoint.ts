/**
 * `checkpoint-list` / `checkpoint` / `rewind` — file-only undo points of a
 * managed task's worktree (`task.checkpointList` / `task.checkpoint` / `task.rewind`).
 */

import type {
  CheckpointRecord,
  RewindResult,
  TakeCheckpointResult,
} from "@sma1lboy/rove-daemon/daemon/checkpoint-contracts"
import { daemonOf } from "./handler-helpers.ts"
import type { VerbContext } from "./types.ts"

/** Replies name the task whose history was used: a shared child acts on its workspace owner's. */
interface Owned {
  readonly workspaceTaskId: string
}

export async function checkpointList(ctx: VerbContext): Promise<unknown> {
  const taskId = ctx.args.require("task-id")
  const res = await daemonOf(ctx).request<Owned & { checkpoints: CheckpointRecord[] }>("task.checkpointList", {
    taskId,
  })
  return { taskId, ...res }
}

export async function checkpoint(ctx: VerbContext): Promise<unknown> {
  const taskId = ctx.args.require("task-id")
  const res = await daemonOf(ctx).request<Owned & TakeCheckpointResult>("task.checkpoint", { taskId })
  return { taskId, ...res }
}

export async function rewind(ctx: VerbContext): Promise<unknown> {
  const taskId = ctx.args.require("task-id")
  const to = ctx.args.int("to")
  const res = await daemonOf(ctx).request<Owned & RewindResult>("task.rewind", {
    taskId,
    to,
    ...(ctx.args.bool("force") === true ? { force: true } : {}),
  })
  return { taskId, ...res }
}
