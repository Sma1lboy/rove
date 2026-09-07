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
import { adopt, removeTaskWorktree } from "./handlers-lifecycle.ts"
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
    name: "remove-worktree",
    group: "worktree",
    summary:
      "Remove a task's git worktree directory, keeping the TASK and its BRANCH — the inverse of ensure-worktree, which can materialize it again. Same path as the Worktrees page's delete: the session is torn down first, a dirty tree is refused without --force, and every forced removal takes a salvage snapshot into refs/rove/salvage/<branch>-<stamp>. Refuses the project's own checkout (BASE_CHECKOUT) and the worktree the caller is running from (CALLER_WORKTREE). Use `delete` instead to end the task itself. Returns { worktreePath, branch, removed, residue? }.",
    flags: [
      F.taskId(),
      {
        name: "force",
        type: "bool",
        description:
          "Remove even with uncommitted changes (a salvage snapshot is taken first). Never deletes the branch.",
      },
    ],
    handler: removeTaskWorktree,
  },
  {
    name: "discover-adoptable",
    group: "worktree",
    summary: "List existing git worktrees in a repo not yet tracked as Rove tasks. Returns { worktrees }.",
    flags: [F.repo()],
    handler: (ctx) => simpleRpc(ctx, "worktree.discoverAdoptable", { repo: ctx.args.requireRepo("repo") }),
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
