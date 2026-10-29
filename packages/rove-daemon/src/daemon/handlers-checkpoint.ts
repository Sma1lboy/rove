/**
 * `task.checkpointList` / `task.checkpoint` / `task.rewind`: file-only undo
 * points of a managed task's worktree. The automatic snapshot at turn-complete
 * lives in `handlers-engine-report.ts`; everything here shares its per-task
 * {@link CheckpointQueue}, so a rewind never interleaves with a snapshot.
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
      return { checkpoints: await ctx.checkpoints.run(taskId, () => ctx.orch.listCheckpoints(taskId)) }
    },
  },
  {
    name: "task.checkpoint",
    blocking: true,
    async handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      const tabId = optionalString(payload, "tabId")
      return await ctx.checkpoints.run(taskId, () => ctx.orch.takeCheckpoint(taskId, tabId ? { tabId } : undefined))
    },
  },
  {
    name: "task.rewind",
    blocking: true,
    async handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      const to = optionalNumber(payload, "to")
      if (to === undefined || !Number.isInteger(to) || to < 1) throw new Error("to must be a checkpoint number (>= 1)")
      if (
        optionalBoolean(payload, "force") !== true &&
        ENGINE_BUSY[ctx.activity.stateOf(taskId, null) ?? "idle"] === true
      ) {
        throw new Error(
          "TASK_BUSY: the task's engine is mid-turn or waiting on you; rewinding rewrites files under it. Pass force to rewind anyway.",
        )
      }
      return await ctx.checkpoints.run(taskId, () => ctx.orch.rewindToCheckpoint(taskId, to))
    },
  },
]
