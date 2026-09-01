/**
 * The `worktree` verb group — materializing and adopting worktrees: the verbs
 * that touch git rather than the task index. One file per `VerbGroup`,
 * mirroring the taxonomy `rove api schema --group worktree` prints — though it
 * is each spec's own `group` field, not this file, that decides where a verb
 * lists. Specs spread back into the {@link VERBS} table, so
 * schema/help/validation see one canonical list.
 */

import { F } from "./flags.ts"
import { simpleRpc } from "./handler-helpers.ts"
import { adopt } from "./handlers-tasks.ts"
import type { VerbSpec } from "./types.ts"

export const WORKTREE_VERBS: readonly VerbSpec[] = [
  {
    name: "ensure-worktree",
    group: "worktree",
    summary: "Materialize a task's git worktree on disk now (without starting an engine). Returns { worktreePath }.",
    flags: [F.taskId()],
    handler: (ctx) => simpleRpc(ctx, "task.ensureWorktree", { taskId: ctx.args.require("task-id") }),
  },
  {
    name: "discover-adoptable",
    group: "worktree",
    summary: "List existing git worktrees in a repo not yet tracked as Rove tasks. Returns { worktrees }.",
    flags: [F.repo()],
    handler: (ctx) => simpleRpc(ctx, "worktree.discoverAdoptable", { repo: ctx.args.requirePath("repo") }),
  },
  {
    name: "adopt",
    group: "worktree",
    summary: "Import an existing git worktree as a Rove task. Returns { task }.",
    flags: [
      F.repo(),
      {
        name: "worktree",
        type: "string",
        required: true,
        placeholder: "PATH",
        description: "Path of the worktree to adopt.",
      },
      { name: "branch", type: "string", placeholder: "B", description: "Branch override (else the worktree's own)." },
      F.command(),
      F.title(),
    ],
    handler: adopt,
  },
]
