/**
 * `worktree.*` daemon RPC handlers.
 *
 * The first entries (`discoverAdoptable`/`adopt`) are
 * split out of `handlers.ts` (which was over the repo's 500-line file-size
 * cap). `worktree.reconcile` (adopt-on-`git worktree add`) was REMOVED
 * 2026-08-24: creation is mechanical, not intent — adoption now needs an
 * engine session-start in a managed root or an explicit `rove add .`/adopt.
 *
 * `list`/`remove` are NEW — the standalone worktree-management TUI page
 * (`tui/component/worktrees-page.tsx`). Unlike the other four, they don't
 * need `ctx.orch`: `GitWorktreeManager` and `getSavedRepos()` are already
 * public, orchestrator-independent primitives, so these compose them
 * directly instead of routing through the Orchestrator. Local projects
 * only for v1 — a remote (`ssh://…`) project's worktrees would need
 * `git ls-remote`/`fs.stat` run over its `ExecHost` instead of directly, a
 * real follow-up rather than bundled here.
 */

import { logDaemonError } from "./crash-log.ts"
import { matchTaskByWorktreePath } from "./cwd-task.ts"
import { optionalString, optionalVendor, requireString } from "./handler-validators.ts"
import type { DaemonRequestHandler } from "./handlers.ts"
import { serializeTask } from "./protocol.ts"

export const WORKTREE_HANDLERS: readonly DaemonRequestHandler[] = [
  {
    name: "worktree.discoverAdoptable",
    web: true,
    async handle(payload, ctx) {
      const repo = requireString(payload, "repo")
      const worktrees = await ctx.orch.discoverAdoptableWorktrees(repo)
      return { worktrees }
    },
  },
  {
    name: "worktree.adopt",
    web: true,
    async handle(payload, ctx) {
      const task = await ctx.orch.adoptWorktree({
        repo: requireString(payload, "repo"),
        worktreePath: requireString(payload, "worktreePath"),
        branch: optionalString(payload, "branch"),
        vendor: optionalVendor(payload, "vendor"),
        title: optionalString(payload, "title"),
        ifExists: optionalString(payload, "ifExists") === "return" ? "return" : "error",
      })
      return { task: serializeTask(task) }
    },
  },
  {
    // DEPRECATED (issue #75): archive concept removed. Kept as a no-op so
    // older CLI builds don't get "unknown daemon request" while C2 removes
    // the CLI hook path.
    name: "worktree.archiveRemoved",
    handle() {
      return { archived: false }
    },
  },
  {
    name: "worktree.list",
    async handle(payload, ctx) {
      return { projects: await ctx.runtime.listWorktreeProjects(payload.network !== false) }
    },
  },
  {
    name: "worktree.remove",
    async handle(payload, ctx) {
      const path = requireString(payload, "path")
      const force = payload.force === true
      await ctx.runtime.removeWorktree(path, force)
      // Self-heal the task index: a worktree removed here (worktrees page /
      // web) otherwise leaves the owning task pointing at a dead dir, so the
      // next enter would spawn the engine into a nonexistent cwd. Drop the
      // pointer (keep the branch) so ensureWorktree re-materialises instead.
      // Exact-path match; unmatched (untracked worktree) is a harmless no-op.
      // Guarded on `ctx.orch` — this handler historically composes runtime
      // primitives directly, so a caller may not wire an orchestrator.
      const taskId = ctx.orch ? matchTaskByWorktreePath(ctx.orch.listTasks(), path) : undefined
      if (taskId) await ctx.orch.clearWorktreePath(taskId)
      return { removed: true }
    },
  },
]
