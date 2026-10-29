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
import { checkpoint, checkpointList, rewind } from "./handlers-checkpoint.ts"
import { adopt, removeTaskWorktree } from "./handlers-lifecycle.ts"
import { WORKTREE_USAGE_VERB } from "./handlers-worktree-usage.ts"
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
    name: "checkpoint-list",
    group: "worktree",
    summary:
      "List a task's checkpoints — file-only undo points of its worktree, taken automatically when an engine turn completes (and by `checkpoint`). Newest last. Managed tasks only (not a project's main checkout or a dir task). Returns { taskId, checkpoints: [{ n, ref, commit, tree, at, tabId? }] }; each is the git ref refs/rove/checkpoints/<task>/<n>, so `git diff <ref>` works too.",
    flags: [F.taskId()],
    handler: checkpointList,
  },
  {
    name: "checkpoint",
    group: "worktree",
    summary:
      "Snapshot a task's worktree now (tracked edits and untracked files, minus gitignored ones) as the next checkpoint. Never touches the branch, HEAD or index. Skipped when the tree equals the latest checkpoint. The newest 100 per task are kept. Returns { taskId, created, checkpoint, uncaptured? } — `uncaptured` names nested repos/submodules whose contents are not captured.",
    flags: [F.taskId()],
    handler: checkpoint,
  },
  {
    name: "rewind",
    group: "worktree",
    summary:
      "Restore a task's worktree files to checkpoint N — files only: the branch, HEAD and the conversation are not rewound, and the index is reset to HEAD. The current state is checkpointed first, so a rewind is undoable: `rewind --to <undo.n>` goes back. Files created after N are deleted, files deleted since are restored, gitignored files are left alone. Refused with TASK_BUSY while the engine is mid-turn or waiting on you, unless --force. Returns { taskId, target, undo, uncaptured }.",
    flags: [
      F.taskId(),
      {
        name: "to",
        type: "int",
        required: true,
        placeholder: "N",
        description: "Checkpoint number to restore (from `checkpoint-list`).",
      },
      {
        name: "force",
        type: "bool",
        description: "Rewind even while the engine is running or waiting on permission.",
      },
    ],
    handler: rewind,
  },
  WORKTREE_USAGE_VERB,
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
