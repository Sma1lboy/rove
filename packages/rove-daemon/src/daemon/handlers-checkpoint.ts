/**
 * `task.checkpointList` / `task.checkpoint` / `task.rewind`: file-only undo
 * points of a managed task's worktree. The automatic snapshot at turn-complete
 * lives in `handlers-engine-report.ts`.
 *
 * Checkpoints belong to the WORKSPACE OWNER: a shared child acts on its
 * owner's, and every reply names that task as `workspaceTaskId`. Jobs are
 * queued per owner, so a rewind never interleaves with a snapshot of the tree
 * it is rewriting, whichever sharer asked for it.
 */

import { optionalBoolean, optionalNumber, optionalString, requireString } from "./handler-validators.ts"
import type { DaemonRequestHandler } from "./handlers.ts"

/** Engine states that mean a turn is in flight: rewriting files under it would corrupt the agent's view. */
const ENGINE_BUSY: Readonly<Record<string, true>> = { running: true, permission_needed: true }

export const CHECKPOINT_HANDLERS: readonly DaemonRequestHandler[] = [
  {
    name: "task.checkpointList",
    async handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      const { ownerId } = ctx.orch.checkpointScope(taskId)
      const checkpoints = await ctx.checkpoints.run(ownerId, () => ctx.orch.listCheckpoints(taskId))
      return { workspaceTaskId: ownerId, checkpoints }
    },
  },
  {
    name: "task.checkpoint",
    blocking: true,
    async handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      const tabId = optionalString(payload, "tabId")
      const { ownerId } = ctx.orch.checkpointScope(taskId)
      const result = await ctx.checkpoints.run(ownerId, () =>
        ctx.orch.takeCheckpoint(taskId, tabId ? { tabId } : undefined),
      )
      return { workspaceTaskId: ownerId, ...result }
    },
  },
  {
    name: "task.rewind",
    blocking: true,
    async handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      const to = optionalNumber(payload, "to")
      if (to === undefined || !Number.isInteger(to) || to < 1) throw new Error("to must be a checkpoint number (>= 1)")
      const { ownerId, sharerIds } = ctx.orch.checkpointScope(taskId)
      // Every task in the workspace edits these files, not just the one asked about.
      const busy = sharerIds.filter((id) => ENGINE_BUSY[ctx.activity.stateOf(id, null) ?? "idle"] === true)
      if (busy.length > 0 && optionalBoolean(payload, "force") !== true) {
        throw new Error(
          `TASK_BUSY: ${busy.length === 1 ? "an engine is" : `${busy.length} engines are`} mid-turn or waiting on you in ${busy.join(", ")}; rewinding rewrites files under ${busy.length === 1 ? "it" : "them"}. Pass force to rewind anyway.`,
        )
      }
      const result = await ctx.checkpoints.run(ownerId, () => ctx.orch.rewindToCheckpoint(taskId, to))
      return { workspaceTaskId: ownerId, ...result }
    },
  },
]
