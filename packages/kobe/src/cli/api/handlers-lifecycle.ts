/**
 * Verb handlers for the `lifecycle` group: `delete`, `land`, `adopt`.
 * Each carries a recovery story for a teardown that got half-way (a dirty
 * worktree, a branch with unmerged commits).
 */

import { errorMessage } from "@/lib/error-message"
import type { SerializedTask } from "@sma1lboy/kobe-daemon/daemon/protocol"
import { pathWithin, samePath } from "@sma1lboy/kobe-daemon/path-identity"
import { resolveCommandProtocol } from "../../engine/engine-presets.ts"
import { DIRTY_WORKTREE_CODE, EMPTY_BRANCH_DIRTY_WORKTREE_CODE } from "../../orchestrator/errors.ts"
import { canonicalize } from "../../orchestrator/worktree/paths.ts"
import type { DaemonRpc } from "../daemon-session.ts"
import { reportBranchDeletion } from "./delete-branch-report.ts"
import { verifiedSelfSession } from "./dispatcher.ts"
import { daemonOf } from "./handler-helpers.ts"
import { ApiError, type VerbContext, splitDaemonCode } from "./types.ts"

/** How long `delete --wait` follows a deletion before reporting `pending` —
 *  headroom, not a deadline the deletion itself respects. */
const DELETE_WAIT_TIMEOUT_MS = 60_000
const DELETE_POLL_INTERVAL_MS = 250

/**
 * `delete` — one task, or a whole fan-out round with `--group` (the same
 * `groupId` `collect` selects by, so the round compared is the round closed).
 */
export async function deleteTask(ctx: VerbContext): Promise<unknown> {
  const daemon = daemonOf(ctx)
  const groupId = ctx.args.str("group")
  const taskIdFlag = ctx.args.str("task-id")
  if (groupId && taskIdFlag) throw new ApiError("pass --task-id or --group, not both", "BAD_FLAG")
  if (!groupId && !taskIdFlag) throw new ApiError("delete needs --task-id ID or --group GROUPID", "MISSING_TARGET")
  // One identity read for the whole round — it shells out to verify.
  const self = await verifiedSelfSession()
  if (!groupId) return deleteOne(ctx, taskIdFlag as string, self)

  const { tasks } = await daemon.request<{ tasks: SerializedTask[] }>("task.list")
  const members = tasks.filter((t) => t.groupId === groupId)
  if (members.length === 0) {
    throw new ApiError(`no tasks in group ${groupId}`, "TASK_NOT_FOUND", {
      hint: "the groupId is the one `add --count` returned; any surviving sibling's `.groupId` in `list` recovers it",
      nextCommandArgs: ["api", "list"],
    })
  }
  // A sibling's refusal is RECORDED, not thrown: aborting on one dirty
  // worktree would hide which of N were already removed.
  const results: unknown[] = []
  for (const task of members) {
    try {
      results.push(await deleteOne(ctx, task.id, self))
    } catch (err) {
      // Read the ApiError's code FIRST: `deleteOne` already stripped the
      // `CODE: rest` prefix, so re-splitting the message finds nothing.
      const message = errorMessage(err)
      const code = err instanceof ApiError ? err.code : splitDaemonCode(message)?.code
      results.push({
        taskId: task.id,
        status: "failed" as const,
        error: message,
        ...(code ? { code } : {}),
      })
    }
  }
  const failures = results.filter((r) => (r as { status?: string }).status === "failed").length
  return { groupId, count: members.length, failures, results }
}

async function deleteOne(
  ctx: VerbContext,
  taskId: string,
  self: Awaited<ReturnType<typeof verifiedSelfSession>>,
): Promise<unknown> {
  const daemon = daemonOf(ctx)
  const force = ctx.args.bool("force") ?? false
  // Opt-in: by default git keeps the branch as the durable record.
  const deleteBranch = ctx.args.bool("delete-branch") ?? false
  // A SEPARATE opt-in, never implied by --delete-branch: a remote delete is
  // unrecoverable by anyone and breaks an open PR. Two radii, two consents.
  const deleteRemote = ctx.args.bool("delete-remote") ?? false
  // Read BEFORE the delete: the task row is gone once removal resolves.
  const subject =
    deleteBranch || deleteRemote
      ? (await daemon.request<{ task: { repo: string; branch?: string } }>("task.get", { taskId })).task
      : undefined
  // The daemon's audit line names WHO asked, from the verified identity —
  // never the bare env: unverifiable stays unattributed.
  let res: { taskId: string; queued: boolean }
  try {
    res = (await daemon.request("task.delete", {
      taskId,
      force,
      deleteBranch,
      ...(self ? { requestedByTaskId: self.taskId, requestedByTabId: self.tabId } : {}),
    })) as { taskId: string; queued: boolean }
  } catch (err) {
    throw deleteRecoveryError(err, taskId)
  }
  // task.delete never kills the hosted session; without this the
  // `kobe-<id>` session + engine orphan invisibly. Mirrors the TUI's
  // finishDeletedTaskFlow, after the RPC succeeds.
  await ctx.runtime.tearDownSession(taskId)
  if (!res.queued) return { ...res, status: "not_found" as const }
  // Removal runs in the background; `--wait` asks for the OUTCOME. A branch
  // flag implies it: git refuses to delete a branch a live worktree holds, so
  // the branch report is only truthful once removal has resolved.
  if (!ctx.args.bool("wait") && !subject) return { ...res, status: "queued" as const }
  const outcome = await awaitDeletion(daemon, taskId)
  // Only after `removed`: otherwise git's refusal describes the live worktree.
  const branch =
    subject && outcome.status === "removed"
      ? reportBranchDeletion(subject.repo, subject.branch ?? "", { deleteBranch, force, deleteRemote })
      : undefined
  return { ...res, ...outcome, ...(branch ? { branch } : {}) }
}

/**
 * Poll the task index until the deletion resolves. The index IS the record —
 * `finish()` removes the row on success and stamps `deletion.phase = "error"`
 * with the git failure on it — so this reads the outcome rather than tracking
 * a second copy of it.
 */
async function awaitDeletion(
  daemon: DaemonRpc,
  taskId: string,
): Promise<{ status: "removed" | "failed" | "pending"; error?: string }> {
  const deadline = Date.now() + DELETE_WAIT_TIMEOUT_MS
  for (;;) {
    const { tasks } = await daemon.request<{ tasks: SerializedTask[] }>("task.list")
    const task = tasks.find((t) => t.id === taskId)
    if (!task) return { status: "removed" }
    const deletion = task.deletion
    if (deletion?.phase === "error") {
      return { status: "failed", error: deletion.error ?? "worktree removal failed" }
    }
    // Teardown can take tens of seconds: `pending` means the daemon still owns
    // it and the caller should look again, never that it was refused.
    if (Date.now() >= deadline) return { status: "pending" }
    await new Promise((resolve) => setTimeout(resolve, DELETE_POLL_INTERVAL_MS))
  }
}

export async function land(ctx: VerbContext): Promise<unknown> {
  const daemon = daemonOf(ctx)
  const taskId = ctx.args.require("task-id")
  // `--dry-run`: the land's own preflight, writing nothing — destination
  // branch (the base checkout's current one), commit count, base dirtiness,
  // and the refusal if any.
  if (ctx.args.bool("dry-run") === true) {
    const res = await daemon.request<{ result: unknown }>("task.landPreflight", { taskId })
    return res.result
  }
  const strategy = ctx.args.str("strategy") === "squash" ? "squash" : "merge"
  let res: { result: unknown }
  try {
    res = await daemon.request<{ result: unknown }>("task.land", {
      taskId,
      strategy,
      deleteBranch: ctx.args.bool("delete-branch") ?? false,
      // UNDEFINED when absent so the orchestrator's default (remove) applies;
      // don't coerce to false.
      removeWorktree: ctx.args.bool("remove-worktree"),
      // Sent on EVERY land: the daemon refuses to remove the caller's own
      // worktree, else an agent landing its own task deletes its cwd.
      callerCwd: process.cwd(),
    })
  } catch (err) {
    throw landRecoveryError(err, taskId)
  }
  return { ok: true, taskId, ...(res.result as object) }
}

/**
 * Give EMPTY_BRANCH_DIRTY_WORKTREE a self-healing `hint` + `nextCommandArgs`:
 * `send` the worker back to commit its own work — never auto-commit, the
 * message belongs to whoever did the work. The branch name is lifted out of
 * the error message (only the message survives the RPC wire). The clean
 * variant (EMPTY_BRANCH) deliberately gets NO recovery: "reported success,
 * delivered nothing" needs a human, not an auto-retry.
 */
function landRecoveryError(err: unknown, taskId: string): unknown {
  const message = errorMessage(err)
  if (!message.includes(EMPTY_BRANCH_DIRTY_WORKTREE_CODE)) return err
  const branch = /EMPTY_BRANCH_DIRTY_WORKTREE: '([^']+)'/.exec(message)?.[1] ?? "your task branch"
  return new ApiError(splitDaemonCode(message)?.rest ?? message, EMPTY_BRANCH_DIRTY_WORKTREE_CODE, {
    hint: "the worker wrote files but never committed them — send it back to commit its own work, then land again",
    nextCommandArgs: [
      "api",
      "send",
      "--task-id",
      taskId,
      "--prompt",
      `your work is uncommitted on ${branch} — commit it yourself with a proper message, then report back`,
    ],
  })
}

/**
 * Give `delete`'s dirty-worktree refusal the same recovery `land` gets —
 * deliberately NOT `--force`: uncommitted files are somebody's unlanded work,
 * so send the worker back to commit; discarding stays an explicit choice.
 * {@link splitDaemonCode} in `toApiError` already lifts the code; this adds
 * only the self-healing fields, which need the task id.
 */
function deleteRecoveryError(err: unknown, taskId: string): unknown {
  const message = errorMessage(err)
  const coded = splitDaemonCode(message)
  if (coded?.code !== DIRTY_WORKTREE_CODE) return err
  return new ApiError(coded.rest, DIRTY_WORKTREE_CODE, {
    taskId,
    hint: "the worktree still holds work this delete would destroy — the message names it, and a gitignored path never shows in `git status`. Send the worker back to commit it, or pass --force to delete the task AND discard that work",
    nextCommandArgs: [
      "api",
      "send",
      "--task-id",
      taskId,
      "--prompt",
      "your worktree still holds work that this cleanup would destroy (it may be gitignored, so `git status` will not show it — check `git status --ignored`). Commit it yourself with a proper message, then report back",
    ],
  })
}

/**
 * `remove-worktree` — the inverse of `ensure-worktree`: drop the directory,
 * keep the task row and its branch, so `ensure-worktree` can materialise it
 * again.
 *
 * Deliberately the Worktrees page's `worktree.remove` RPC: it tears the
 * session down first, salvage-snapshots on every force, refuses a dirty tree
 * without one, and clears the task's worktree pointer.
 *
 * The two refusals below are this verb's own (the RPC has none): the caller
 * is often an agent inside the worktree it names. `land` refuses the same
 * two edges (`removeLandedWorktree`).
 */
export async function removeTaskWorktree(ctx: VerbContext): Promise<unknown> {
  const daemon = daemonOf(ctx)
  const taskId = ctx.args.require("task-id")
  const force = ctx.args.bool("force") ?? false
  const { task } = await daemon.request<{ task: SerializedTask }>("task.get", { taskId })
  const worktreePath = (task.worktreePath ?? "").trim()
  if (!worktreePath) {
    throw new ApiError(`task ${taskId} has no worktree on disk`, "NO_WORKTREE", {
      hint: "nothing to remove — `ensure-worktree` materialises one",
    })
  }
  const wt = canonicalize(worktreePath)
  if (samePath(wt, canonicalize(task.repo))) {
    throw new ApiError(
      `refusing to remove ${worktreePath} — it is the project's own checkout, not a Rove worktree`,
      "BASE_CHECKOUT",
    )
  }
  if (pathWithin(wt, canonicalize(process.cwd())) !== null) {
    throw new ApiError(
      `refusing to remove the caller's own worktree (${worktreePath}) — re-run from outside it`,
      "CALLER_WORKTREE",
    )
  }
  // `residue` = git deregistered the worktree but couldn't delete the dir: a
  // reported outcome, not an error, and the only place that path is named.
  const res = await daemon.request<{ removed: boolean; residue?: { path: string; reason: string } }>(
    "worktree.remove",
    { path: worktreePath, force },
  )
  return { ok: true, taskId, worktreePath, branch: task.branch, ...res }
}

export async function adopt(ctx: VerbContext): Promise<unknown> {
  const daemon = daemonOf(ctx)
  const { args } = ctx
  const input: Record<string, string> = {
    repo: args.requireRepo("repo"),
    worktreePath: args.requirePath("worktree"),
  }
  const branch = args.str("branch")
  if (branch) input.branch = branch
  const command = args.str("command")
  if (command) {
    input.command = command
    input.vendor = resolveCommandProtocol(command)
  }
  const title = args.str("title")
  if (title) input.title = title
  return daemon.request<{ task: SerializedTask }>("worktree.adopt", input)
}
