/**
 * `worktree.*` daemon RPC handlers.
 *
 * The `worktree.` slice of the one registry, grouped by RPC-name prefix like
 * `handlers-task.ts` / `handlers-ui.ts` and spread back in by `handlers.ts`.
 *
 * `worktree.reconcile` (adopt-on-`git worktree add`) was REMOVED
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
      // Tear the engine down BEFORE unlinking its directory. `git worktree
      // remove` succeeds against a live process — POSIX unlink does not care
      // that something holds the directory as its cwd — and every write that
      // engine makes afterwards lands in an unlinked inode: not on disk, not
      // in the branch, and not in the salvage snapshot (which ran before
      // them). The task-deletion path already orders it this way
      // (`task-deletion-runner.ts`); this one did not.
      //
      // Ordering, not gating: teardown failure must not block a removal the
      // user confirmed (the worktrees page's delete is optimistic — the row
      // is already gone from their screen), and a dead/absent session throws
      // the same way a stuck one does, which would strand every already-dead
      // task's worktree. Logged, then the removal proceeds.
      const taskId = ctx.orch ? matchTaskByWorktreePath(ctx.orch.listTasks(), path) : undefined
      if (taskId) {
        await ctx.runtime
          .tearDownTaskSession(taskId)
          .catch((err) => logDaemonError("worktree-remove-session-teardown", err))
      }
      const residue = await ctx.runtime.removeWorktree(path, force)
      // Self-heal the task index: a worktree removed here (worktrees page /
      // web) otherwise leaves the owning task pointing at a dead dir, so the
      // next enter would spawn the engine into a nonexistent cwd. Drop the
      // pointer (keep the branch) so ensureWorktree re-materialises instead.
      // Exact-path match; unmatched (untracked worktree) is a harmless no-op.
      // Guarded on `ctx.orch` — this handler historically composes runtime
      // primitives directly, so a caller may not wire an orchestrator.
      // Runs on the residue path too: git has deregistered the worktree, so
      // the task's pointer is just as dead as after a clean removal.
      if (taskId && ctx.orch) await ctx.orch.clearWorktreePath(taskId)
      return { removed: true, ...(residue ? { residue } : {}) }
    },
  },
]
