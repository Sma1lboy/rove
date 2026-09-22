/**
 * `worktree.*` daemon RPC handlers.
 *
 * Deliberately no adopt-on-`git worktree add`: creating a worktree is not
 * intent, so adoption needs an engine session-start in a managed root or an
 * explicit `rove add .`/adopt.
 *
 * `list`/`remove` back the worktrees TUI page and compose orchestrator-free
 * runtime primitives, so they don't need `ctx.orch`. Local projects only: a
 * remote (`ssh://…`) project would need the git/fs calls over its `ExecHost`.
 */

import { logDaemonError } from "./crash-log.ts"
import { matchTaskByWorktreePath } from "./cwd-task.ts"
import { optionalString, optionalVendor, requireString } from "./handler-validators.ts"
import type { DaemonRequestHandler } from "./handlers.ts"
import { serializeTask } from "./protocol.ts"

/**
 * Sentinel in `worktree.remove`'s kind refusal. Callers discriminate on the
 * MESSAGE (the RPC layer rebuilds `new Error(message)`); `splitDaemonCode`
 * in the CLI parses the `CODE: rest` shape.
 */
export const NOT_A_ROVE_WORKTREE_CODE = "NOT_A_ROVE_WORKTREE"

export const WORKTREE_HANDLERS: readonly DaemonRequestHandler[] = [
  {
    name: "worktree.discoverAdoptable",
    blocking: true,
    async handle(payload, ctx) {
      const repo = requireString(payload, "repo")
      // `git worktree list --porcelain` silently drops an entry whose admin
      // dir it cannot read (exit 0), so `unreadable` tells "nothing to adopt"
      // from "your worktree's uncommitted work is unreachable".
      const [worktrees, unreadable] = await Promise.all([
        ctx.orch.discoverAdoptableWorktrees(repo),
        ctx.runtime.listUnreadableWorktrees(repo).catch((err) => {
          logDaemonError("worktree-discover-unreadable", err)
          return [] as readonly string[]
        }),
      ])
      return { worktrees, unreadable }
    },
  },
  {
    name: "worktree.adopt",
    blocking: true,
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
    blocking: true,
    async handle(payload, ctx) {
      return { projects: await ctx.runtime.listWorktreeProjects(payload.network !== false) }
    },
  },
  {
    name: "worktree.remove",
    blocking: true,
    async handle(payload, ctx) {
      const path = requireString(payload, "path")
      const force = payload.force === true
      // Tear the engine down BEFORE unlinking: `git worktree remove` succeeds
      // under a live cwd, and the engine's later writes land in an unlinked
      // inode (not on disk, branch, or salvage snapshot). Same order as
      // `task-deletion-runner.ts`.
      //
      // Ordering, not gating: the page's delete is optimistic, and a dead
      // session throws like a stuck one. Logged, then the removal proceeds.
      const tasks = ctx.orch ? ctx.orch.listTasks() : []
      const taskId = matchTaskByWorktreePath(tasks, path)
      // A `dir` task's path is the user's own directory and a `main` task's
      // the project checkout; removing either deletes files Rove never made.
      // Sibling destructive paths refuse these kinds too (`deleteTask`,
      // `ensureWorktree`, `land`), and `clearWorktreePath` skips them.
      const kind = taskId ? tasks.find((t) => t.id === taskId)?.kind : undefined
      if (kind === "dir" || kind === "main") {
        throw new Error(
          `${NOT_A_ROVE_WORKTREE_CODE}: ${path} is ${
            kind === "dir" ? "a directory task's own directory" : "the project's own checkout"
          }, not a Rove-created worktree — refusing to delete it`,
        )
      }
      if (taskId) {
        await ctx.runtime
          .tearDownTaskSession(taskId)
          .catch((err) => logDaemonError("worktree-remove-session-teardown", err))
      }
      const residue = await ctx.runtime.removeWorktree(path, force)
      // Drop the task's dead pointer (keep the branch) so the next enter
      // re-materialises instead of spawning into a missing cwd. Also on the
      // residue path: git already deregistered it. `ctx.orch` may be unwired.
      if (taskId && ctx.orch) await ctx.orch.clearWorktreePath(taskId)
      return { removed: true, ...(residue ? { residue } : {}) }
    },
  },
]
