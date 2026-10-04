/** Daemon-owned issue store RPCs (`docs/WORK-TRACKING.md`). A mutation
 *  republishes the repo's whole snapshot, so every attached surface renders
 *  from one truth instead of patching its own copy. */

import { requireString } from "./handler-validators.ts"
import type { DaemonHandlerContext, DaemonRequestHandler } from "./handlers.ts"
import type { RepoIssues } from "./issues-store.ts"

/**
 * Publish only when someone subscribes. `issue.snapshot` has no in-repo
 * subscriber but is a public plugin API; unguarded, every task delete, done
 * transition and issue edit serializes the repo's ENTIRE issue state.
 *
 * A missing `hasSubscribersFor` means "publish": a missing gate costs one
 * wasted publish, a wrongly-closed one silently drops a plugin's events.
 */
export function publishIssueSnapshot(ctx: DaemonHandlerContext, state: RepoIssues): void {
  if (ctx.daemon.hasSubscribersFor?.("issue.snapshot") === false) return
  ctx.bus.publish("issue.snapshot", state)
}

export const ISSUE_HANDLERS: readonly DaemonRequestHandler[] = [
  {
    name: "issue.list",
    async handle(payload, ctx) {
      return ctx.issues.list(requireString(payload, "repoRoot"))
    },
  },
  {
    name: "issue.repos",
    async handle(_payload, ctx) {
      return { repos: await ctx.issues.repos() }
    },
  },
  {
    name: "issue.mutate",
    async handle(payload, ctx) {
      const repoRoot = requireString(payload, "repoRoot")
      // The store only type-checks `taskId`, so a typo'd id would leave a card
      // In progress pointing at nothing. Checked here (every caller funnels
      // through this RPC) so the store stays task-agnostic; the prose is what
      // `toApiError` maps to TASK_NOT_FOUND. Running BEFORE the store lock
      // makes the CLI's title+link update all-or-nothing.
      const op = payload.op
      const opType = op && typeof op === "object" ? (op as { type?: unknown }).type : undefined
      if (opType === "link" || opType === "update") {
        const taskId = (op as { taskId?: unknown }).taskId
        if (typeof taskId === "string" && taskId.length > 0 && !ctx.orch.getTask(taskId)) {
          throw new Error(`task not found: ${taskId}`)
        }
      }
      const state = await ctx.issues.mutate(repoRoot, payload.op)
      publishIssueSnapshot(ctx, state)
      ctx.plugins?.handleUiReport({
        kind: "issue.changed",
        detail: {
          repo: repoRoot,
          ...(payload.op && typeof payload.op === "object" ? { op: payload.op as Record<string, unknown> } : {}),
        },
      })
      return state
    },
  },
]
