/**
 * Verb handlers for the `lifecycle` group: `delete`, `land`, `adopt`.
 *
 * Split from `handlers-tasks.ts`, which owns reads and prompt delivery.
 * These three END a task — worktree teardown, branch merge, taking over an
 * existing checkout — so each carries a recovery story for a teardown that
 * got half-way (a dirty worktree, a branch with unmerged commits), which is
 * a different failure mode from "the prompt did not land".
 */

import { isAbsolute, relative } from "node:path"
import { errorMessage } from "@/lib/error-message"
import type { SerializedTask } from "@sma1lboy/kobe-daemon/daemon/protocol"
import { resolveCommandProtocol } from "../../engine/engine-presets.ts"
import { DIRTY_WORKTREE_CODE, EMPTY_BRANCH_DIRTY_WORKTREE_CODE } from "../../orchestrator/errors.ts"
import { canonicalize } from "../../orchestrator/worktree/paths.ts"
import type { DaemonRpc } from "../daemon-session.ts"
import { verifiedSelfSession } from "./dispatcher.ts"
import { daemonOf } from "./handler-helpers.ts"
import { ApiError, type VerbContext, splitDaemonCode } from "./types.ts"

/** How long `delete --wait` follows a deletion before reporting `pending`.
 *  A worktree teardown is filesystem-bound; this is generous headroom, not a
 *  deadline the deletion itself respects. */
const DELETE_WAIT_TIMEOUT_MS = 60_000
const DELETE_POLL_INTERVAL_MS = 250

/**
 * `delete` — one task, or a whole fan-out round with `--group`.
 *
 * The round is the asymmetry this closes: creating is batched (`add --count`),
 * reading is batched (`collect --group`), and only deleting was one-at-a-time
 * — yet the documented workflow ends by removing the N-1 losers. `--group`
 * selects by the same `groupId` `collect` does, so the round a coordinator
 * compared is the round it can close.
 */
export async function deleteTask(ctx: VerbContext): Promise<unknown> {
  const daemon = daemonOf(ctx)
  const groupId = ctx.args.str("group")
  const taskIdFlag = ctx.args.str("task-id")
  if (groupId && taskIdFlag) throw new ApiError("pass --task-id or --group, not both", "BAD_FLAG")
  if (!groupId && !taskIdFlag) throw new ApiError("delete needs --task-id ID or --group GROUPID", "MISSING_TARGET")
  // One identity read for the whole round rather than per sibling — it is the
  // same caller either way, and it shells out to verify.
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
  // Sequential, and a sibling's refusal is RECORDED rather than thrown: a
  // round routinely holds one dirty worktree, and aborting there would leave
  // the caller unable to tell which of N were already removed. Every entry
  // names its own outcome, so a partial round is readable.
  const results: unknown[] = []
  for (const task of members) {
    try {
      results.push(await deleteOne(ctx, task.id, self))
    } catch (err) {
      // `deleteOne` already lifted the daemon's `CODE: rest` prefix into an
      // ApiError (that is what adds the recovery hint), so reading the code
      // off the error comes FIRST — re-splitting its message finds nothing,
      // because the prefix is exactly what was stripped.
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
  // Branch deletion is opt-in (same flag as `land`): delete drops the
  // worktree + task entry, git keeps the branch as the durable record.
  const deleteBranch = ctx.args.bool("delete-branch") ?? false
  // Deleting somebody else's task destroys their worktree and every tab in
  // it, so the daemon's audit line has to name WHO asked. Same verified
  // identity `send`/`add` use, never the bare env: unverifiable
  // stays unattributed rather than blaming a stranger's session.
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
  // The daemon's task.delete removes the worktree + index entry but never the
  // hosted session. Without this, a scripted delete
  // orphans the `kobe-<id>` session + its engine — invisible to every kobe UI
  // since the task is gone from tasks.json. Mirror the TUI's finishDeletedTaskFlow
  // and kill it here, after the delete RPC succeeds.
  await ctx.runtime.tearDownSession(taskId)
  if (!res.queued) return { ...res, status: "not_found" as const }
  // Removal runs in the background, so the default reply can only say the work
  // was scheduled. A caller that needs the OUTCOME (a cleanup script deciding
  // whether to retry, an agent tearing down its own fan-out) asks for it.
  if (!ctx.args.bool("wait")) return { ...res, status: "queued" as const }
  return { ...res, ...(await awaitDeletion(daemon, taskId)) }
}

/**
 * Poll the task index until the deletion resolves. The index IS the record —
 * `finish()` removes the row on success and stamps `deletion.phase = "error"`
 * with the git failure on it — so this reads the outcome rather than tracking
 * a second copy of it. Previously that error reached `daemon.log` and nowhere
 * else, which is how a failed removal came back looking like a successful one.
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
    // A worktree teardown is filesystem-bound and can take tens of seconds, so
    // running out of patience is not the same as failing: `pending` says the
    // deletion is still owned by the daemon and the caller should look again,
    // never that it was refused.
    if (Date.now() >= deadline) return { status: "pending" }
    await new Promise((resolve) => setTimeout(resolve, DELETE_POLL_INTERVAL_MS))
  }
}

export async function land(ctx: VerbContext): Promise<unknown> {
  const daemon = daemonOf(ctx)
  const taskId = ctx.args.require("task-id")
  // `--dry-run` returns the same probe the land itself runs first, and writes
  // nothing: the destination branch, how many commits would land, whether the
  // base is dirty, and the refusal if there is one. A coordinator deciding
  // WHICH sibling to land needs this before it picks; a human needs it because
  // the destination is the base checkout's current branch, which nothing else
  // tells them until the success toast.
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
      // Left UNDEFINED when the flag is absent so the orchestrator's default
      // (remove it) applies; only an explicit `--remove-worktree=false` keeps
      // the worktree. Coercing undefined to false here would pin the CLI to
      // an opt-in it does not have.
      removeWorktree: ctx.args.bool("remove-worktree"),
      // Sent on EVERY land: the daemon refuses to remove the worktree the
      // caller is running from, and it can only know where that is if we tell
      // it. Removal is the default, so an agent landing its own task would
      // otherwise delete its own cwd.
      callerCwd: process.cwd(),
    })
  } catch (err) {
    throw landRecoveryError(err, taskId)
  }
  return { ok: true, taskId, ...(res.result as object) }
}

/**
 * Give EMPTY_BRANCH_DIRTY_WORKTREE an executable recovery path (the
 * self-healing `hint` + `nextCommandArgs` convention, same shape as
 * TASK_NOT_FOUND): the worker WROTE its work but never committed it, so the
 * recovery is a `send` back to THAT worker telling it to commit its own work
 * with its own message — never an auto-commit here, the commit message
 * belongs to whoever did the work. The branch name rides the daemon's error
 * message (only the message survives the RPC wire), so it is lifted back out
 * for the prompt. The clean-worktree variant (EMPTY_BRANCH) deliberately
 * gets NO recovery path: "worker reported success but delivered nothing" is
 * a signal a human must look at, not something to auto-retry.
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
 * Give `delete`'s dirty-worktree refusal the same executable recovery `land`
 * gets. This is the refusal an unattended cleanup loop hits most, and the
 * recovery is deliberately NOT `--force`: uncommitted files in a task
 * worktree are somebody's unlanded work, so the first move is to send the
 * worker back to commit it, exactly as EMPTY_BRANCH_DIRTY_WORKTREE does.
 * Discarding the work stays a decision a caller has to make in words.
 *
 * The generic boundary ({@link splitDaemonCode} in `toApiError`) already
 * lifts `DIRTY_WORKTREE` into `code` on its own; this adds only the two
 * self-healing fields, which need the task id the boundary does not have.
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
 * again. The Worktrees page's delete has always done this; the CLI only had
 * the materialise half, so a script reclaiming idle checkouts had to reach
 * for `delete`, which takes the task record with it.
 *
 * Routed through the SAME `worktree.remove` RPC that page uses, deliberately:
 * that path tears the session down first, takes the salvage snapshot on every
 * force, refuses a dirty tree without one, and clears the task's worktree
 * pointer afterwards. A verb that only unlinked the directory would reopen
 * every hole those gates close.
 *
 * The two refusals below are this verb's own, because the RPC has none: the
 * page is a human clicking one row, while this is scriptable and its caller
 * is often an agent inside the very worktree it names. `land` refuses the
 * same two edges for the same reason (`removeLandedWorktree`).
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
  if (wt === canonicalize(task.repo)) {
    throw new ApiError(
      `refusing to remove ${worktreePath} — it is the project's own checkout, not a Rove worktree`,
      "BASE_CHECKOUT",
    )
  }
  const rel = relative(wt, canonicalize(process.cwd()))
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
    throw new ApiError(
      `refusing to remove the caller's own worktree (${worktreePath}) — re-run from outside it`,
      "CALLER_WORKTREE",
    )
  }
  // `residue` = git deregistered the worktree but could not delete the
  // directory. The removal is as complete as git can make it, so this is a
  // reported outcome, not an error — and the only time that leftover path is
  // ever named.
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
