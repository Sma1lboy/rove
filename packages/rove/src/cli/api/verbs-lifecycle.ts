/**
 * The `lifecycle` verb group — land, delete: the verbs that end a task's
 * life, which is why they are worth naming apart from the metadata edits
 * (`update`) next door. One file per `VerbGroup`, mirroring the
 * taxonomy `rove api schema --group lifecycle` prints — though it is each
 * spec's own `group` field, not this file, that decides where a verb lists.
 * Specs spread back into the
 * {@link VERBS} table, so schema/help/validation see one canonical list.
 */

import { F } from "./flags.ts"
import { archiveTask, deleteTask, land, unarchiveTask } from "./handlers-lifecycle.ts"
import { sync } from "./handlers-sync.ts"
import type { VerbSpec } from "./types.ts"

export const LIFECYCLE_VERBS: readonly VerbSpec[] = [
  {
    name: "land",
    group: "lifecycle",
    summary:
      "Merge a task's branch back into its base repo's current branch. Refuses a dirty base checkout, a branch that no longer resolves in the base repo (MISSING_REF — renamed or deleted outside Rove), and a branch with zero commits ahead of the base (EMPTY_BRANCH; EMPTY_BRANCH_DIRTY_WORKTREE with a send-back recovery path when the worktree still holds the uncommitted work). On conflict, aborts and returns the conflicted files (resolve by hand). Returns { landedOn, commit }. A MULTI-REPO task (`add --repo A --repo B`) lands every repo into its own base, in picked order: every repo is probed first and nothing is merged if any refuses; the run stops at the first conflict, leaving earlier repos landed; re-run `land` to resume (a repo already merged reads as `skipped`). Worktrees are removed only once every repo has landed. Its result adds `.repos[]` ({ name, status: landed|skipped|conflict|refused|failed|pending, landedOn, ahead, commit, error?, code? }); a stop is the usual error (LAND_CONFLICT, MAIN_CHECKOUT_DIRTY, …) carrying `.repos[]` and `.failedRepo`.",
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
      {
        name: "repo",
        type: "string",
        placeholder: "NAME",
        description:
          "Multi-repo task: land (or, with --dry-run, probe) only this repo, named as in `.task.extraRepos[].name` (the primary's name is its directory name). UNKNOWN_REPO otherwise.",
      },
    ],
    handler: land,
  },
  {
    name: "sync",
    group: "lifecycle",
    summary:
      "Merge the base branch INTO a task's worktree (the inverse of `land`; the sidebar's ↓N drift). Refuses a dirty worktree (SYNC_WORKTREE_DIRTY — commit first, never stash); a conflict is left IN PLACE in the worktree for you to resolve (SYNC_CONFLICT lists the files). Returns { baseRef, alreadyCurrent }. A multi-repo task syncs EVERY repo against its own base and carries `.repos[]` ({ name, ok, baseRef?, alreadyCurrent?, error?, code? }); one repo's conflict does not stop the others, and is raised as the error after all ran.",
    flags: [
      F.taskId(),
      {
        name: "repo",
        type: "string",
        placeholder: "NAME",
        description: "Multi-repo task: sync only this repo (`.task.extraRepos[].name`; UNKNOWN_REPO otherwise).",
      },
    ],
    handler: sync,
  },
  {
    name: "delete",
    group: "lifecycle",
    summary:
      "Remove a task and its worktree; the git branch stays unless --delete-branch. Needs --force on a dirty worktree. Returns { queued } — removal itself runs in the background; add --wait for the resolved outcome. With --delete-branch / --delete-remote the reply also carries `branch` — { branch, deleted, keptReason?, remote? } — so `the branch went with it` is a fact you read rather than an assumption. Pass --group instead of --task-id to close a whole fan-out round in one call: it returns { groupId, count, failures, results } with one entry per sibling, and a refusal on one (a dirty worktree) is recorded there rather than aborting the rest. CHILDREN (`spawn`): by default the task's children are promoted — they keep running, re-parented to the deleted task's own parent (or top level); --cascade deletes the whole subtree instead, each worktree still passing the dirty gate before ANY of it is queued. A directory more than one task runs in (an owner and its shared children) is removed only with its last task; deleting a shared child never touches the directory, and an owner leaving hands the directory to a remaining child.",
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
        name: "cascade",
        type: "bool",
        description:
          "Also delete every descendant of the task (its `spawn` children, recursively). Default: children are promoted instead. The reply lists the ids as `deleted`.",
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
  {
    name: "archive",
    group: "lifecycle",
    summary:
      "Hide a task from the sidebar and the default `list`, without touching anything else: the worktree, branch, transcript and any running session stay exactly as they are, and `send`, `read-output`, `get-task` and `delete` keep working on it by id. Applies to the task and every descendant (its `spawn` children, recursively) together. Refused with TASK_BUSY while an engine in the subtree is running or waiting on you — pass --force to hide it anyway; archive never stops a session. A project's `main` checkout cannot be archived. Undo with `unarchive`; `list --archived` finds archived tasks. Returns { taskId, archived, ids } — `ids` is every task hidden.",
    flags: [
      F.taskId(),
      {
        name: "force",
        type: "bool",
        description: "Archive even though an engine in the subtree is running or waiting on you. Nothing is stopped.",
      },
    ],
    handler: archiveTask,
  },
  {
    name: "unarchive",
    group: "lifecycle",
    summary:
      "Bring an archived task back into the sidebar and `list`, together with its archived descendants. A child unarchived on its own while its parent is still archived shows as a top-level row until the parent returns. Returns { taskId, archived: false, ids }.",
    flags: [F.taskId()],
    handler: unarchiveTask,
  },
]
