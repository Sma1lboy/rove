/**
 * `task.pin` / `task.keep` / `task.autoFixCi` / `task.notes`: the small per-task settings a person flips
 * on a row: pin it, mark the kept attempt, opt in to auto-fix CI, keep notes and a checklist.
 */

import { TodoRefusedError, parseTodoOps } from "../task-notes.ts"
import { optionalBoolean, requireString } from "./handler-validators.ts"
import type { DaemonRequestHandler } from "./handlers.ts"

export const FIELD_HANDLERS: readonly DaemonRequestHandler[] = [
  {
    name: "task.pin",
    async handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      await ctx.orch.setPinned(taskId, optionalBoolean(payload, "pinned"))
      return {}
    },
  },
  {
    name: "task.keep",
    async handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      await ctx.orch.setKept(taskId, optionalBoolean(payload, "kept") ?? true)
      return {}
    },
  },
  {
    name: "task.autoFixCi",
    async handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      const enabled = optionalBoolean(payload, "enabled")
      if (enabled === undefined) throw new Error("enabled must be a boolean")
      // On starts a fresh count (also what re-enabling after a stop means); off forgets it.
      await ctx.orch.setAutoFixCi(taskId, enabled ? { attempts: 0 } : null)
      return {}
    },
  },
  {
    name: "task.notes",
    async handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      const notes = typeof payload.notes === "string" ? payload.notes : undefined
      try {
        const ops = payload.ops === undefined ? undefined : parseTodoOps(payload.ops)
        return await ctx.orch.updateNotes(taskId, {
          ...(notes !== undefined ? { notes } : {}),
          ...(ops ? { ops } : {}),
        })
      } catch (err) {
        // The `CODE: message` shape every daemon refusal travels in.
        if (err instanceof TodoRefusedError) throw new Error(`${err.code}: ${err.message}`)
        throw err
      }
    },
  },
]
