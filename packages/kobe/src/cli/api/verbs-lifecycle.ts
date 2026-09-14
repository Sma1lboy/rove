/**
 * The `lifecycle` verb group — pin, land, delete: the verbs that end a task's
 * life or decide it survives, which is why they are worth naming apart from
 * the metadata edits next door. One file per `VerbGroup`, mirroring the
 * taxonomy `rove api schema --group lifecycle` prints — though it is each
 * spec's own `group` field, not this file, that decides where a verb lists.
 * Specs spread back into the
 * {@link VERBS} table, so schema/help/validation see one canonical list.
 */

import { F } from "./flags.ts"
import { simpleRpc } from "./handler-helpers.ts"
import { deleteTask, land } from "./handlers-lifecycle.ts"
import type { VerbSpec } from "./types.ts"

export const LIFECYCLE_VERBS: readonly VerbSpec[] = [
  {
    name: "pin",
    group: "lifecycle",
    summary: "Pin (or with --pinned=false, unpin) a task to the top of the sidebar.",
    flags: [F.taskId(), { name: "pinned", type: "bool", default: "true", description: "true to pin, false to unpin." }],
    handler: (ctx) =>
      simpleRpc(ctx, "task.pin", {
        taskId: ctx.args.require("task-id"),
        pinned: ctx.args.bool("pinned") ?? true,
      }),
  },
  {
    name: "land",
    group: "lifecycle",
    summary:
      "Merge a task's branch back into its base repo's current branch. Refuses a dirty base checkout, a branch that no longer resolves in the base repo (MISSING_REF — renamed or deleted outside Rove), and a branch with zero commits ahead of the base (EMPTY_BRANCH; EMPTY_BRANCH_DIRTY_WORKTREE with a send-back recovery path when the worktree still holds the uncommitted work). On conflict, aborts and returns the conflicted files (resolve by hand). Returns { landedOn, commit }.",
    flags: [
      F.taskId(),
      {
        name: "dry-run",
        type: "bool",
        description:
          "Report whether the land would proceed, and write nothing. Returns { branch, landedOn, ahead?, baseDirty?, refusal?, dirtyFiles?, baseDir } — `landedOn` is the base checkout's CURRENT branch (the merge destination), `ahead` the commits that would land, and `refusal` one of DETACHED_HEAD, UNREADABLE_BASE, UNBORN_BASE, SAME_BRANCH, MAIN_CHECKOUT_DIRTY, MISSING_REF, EMPTY_BRANCH, EMPTY_BRANCH_DIRTY_WORKTREE when the land would be refused. Ignores --strategy/--delete-branch/--remove-worktree.",
      },
      {
        name: "strategy",
        type: "enum",
        values: ["merge", "squash"],
        default: "merge",
        description: "merge (--no-ff) or squash into one commit.",
      },
      {
        name: "delete-branch",
        type: "bool",
        description:
          "Delete the task's branch after a successful land. Uses `git branch -D`, which drops the branch's reflog too; with --strategy squash the base's new commit does not reach the branch's own commits, so Rove first anchors the tip at refs/rove/salvage/<branch>-<stamp> and returns it as `branchAnchor`. Requires the worktree to be gone: git refuses to delete a branch a live worktree has checked out, so a land that kept the worktree keeps the branch too and says so in `branchKept`.",
      },
      {
        name: "remove-worktree",
        type: "bool",
        default: "true",
        description:
          "Remove the task's worktree after a successful land (default; the branch always stays). Pass --remove-worktree=false to keep it. Dirty worktrees, the base checkout, and the caller's own worktree are refused — the outcome is reported in the result's `worktree` field, never thrown.",
      },
    ],
    handler: land,
  },
  {
    name: "delete",
    group: "lifecycle",
    summary:
      "Remove a task and its worktree; the git branch stays unless --delete-branch. Needs --force on a dirty worktree. Returns { queued } — removal itself runs in the background; add --wait for the resolved outcome. With --delete-branch / --delete-remote the reply also carries `branch` — { branch, deleted, keptReason?, remote? } — so `the branch went with it` is a fact you read rather than an assumption. Pass --group instead of --task-id to close a whole fan-out round in one call: it returns { groupId, count, failures, results } with one entry per sibling, and a refusal on one (a dirty worktree) is recorded there rather than aborting the rest.",
    flags: [
      F.taskId(false),
      {
        name: "group",
        type: "string",
        placeholder: "GROUPID",
        description:
          "Delete every task of one fan-out round (the `groupId` that `add --count` returns, the same selector `collect --group` takes). Mutually exclusive with --task-id.",
      },
      {
        name: "force",
        type: "bool",
        description: "Delete even with uncommitted changes (never implies --delete-branch).",
      },
      {
        name: "delete-branch",
        type: "bool",
        description:
          "Also delete the task's LOCAL git branch (default: keep it). The outcome is reported in the result's `branch` field — `{ deleted, keptReason? }` — because git legitimately refuses (unmerged work, a sibling worktree holding the branch) and that refusal used to reach daemon.log and nowhere a caller could read it. Implies --wait: a branch verdict read before the worktree is gone describes the worktree, not the branch.",
      },
      {
        name: "delete-remote",
        type: "bool",
        description:
          "Also `git push --delete` the branch on its remote (its own `branch.<name>.remote`, else origin). A SEPARATE opt-in that --delete-branch never implies: a local branch is recoverable from any clone that still has it, a remote one is recoverable by nobody and its deletion closes any open PR. Reported in `branch.remote` — `{ name, deleted, error? }`. Implies --wait.",
      },
      {
        name: "wait",
        type: "bool",
        description:
          "Follow the background removal and report its OUTCOME (removed / failed / pending) instead of returning as soon as it is queued.",
      },
    ],
    handler: deleteTask,
  },
]
