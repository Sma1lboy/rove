/** Daemon-owned issue store RPCs (`docs/WORK-TRACKING.md`). A mutation
 *  republishes the repo's whole snapshot, so every attached surface renders
 *  from one truth instead of patching its own copy. */

import { requireString } from "./handler-validators.ts"
import type { DaemonHandlerContext, DaemonRequestHandler } from "./handlers.ts"
import type { RepoIssues } from "./issues-store.ts"

/**
 * Publish a repo's issue snapshot — but only when somebody is subscribed to
 * the channel.
 *
 * `issue.snapshot` has no in-repo subscriber (its one consumer, the browser
 * Issues pane, was deleted in #855; the TUI kanban uses the `issue.list` /
 * `issue.mutate` RPCs). The channel survives because it is a public plugin
 * API, so out-of-repo subscribers nobody here can enumerate may hold it — but
 * with nobody attached, every task delete, every task→done transition and
 * every issue edit was serializing a repo's ENTIRE issue state for no reader.
 * `channels.ts` named this exact gate as the fix; this is it.
 *
 * `hasSubscribersFor` is optional on the context (older test doubles omit the
 * whole thing), and its absence must mean "publish" — the safe direction: a
 * missing gate costs one wasted publish, a wrongly-closed one silently drops a
 * plugin's events.
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
      // A `link` op — and an `update` carrying a `taskId` — names a task, and
      // the store only type-checks `taskId` as a non-empty string; without
      // this guard a typo'd id is accepted and the card sits in In progress
      // pointing at nothing. The check lives HERE, rather than in the store:
      // both the
      // CLI (`issue-update --task`) and the web link route funnel through this
      // one RPC, and the task index is on the handler context, so the issue
      // store keeps knowing nothing about tasks. The prose is the same one
      // every other handler throws, which `toApiError` maps to a typed
      // TASK_NOT_FOUND with the `api list` recovery command.
      //
      // It also runs BEFORE `issues.mutate` takes the store lock, which is
      // what makes the CLI's title+link update all-or-nothing: a bad link
      // rejects the whole op instead of landing the rename first.
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
