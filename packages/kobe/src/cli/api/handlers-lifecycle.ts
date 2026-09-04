/**
 * Verb handlers for the `lifecycle` group: `delete`, `land`, `adopt`.
 *
 * Split from `handlers-tasks.ts`, which owns reads and prompt delivery.
 * These three END a task — worktree teardown, branch merge, taking over an
 * existing checkout — so each carries a recovery story for a teardown that
 * got half-way (a dirty worktree, a branch with unmerged commits), which is
 * a different failure mode from "the prompt did not land".
 */

import { errorMessage } from "@/lib/error-message"
import type { SerializedTask } from "@sma1lboy/kobe-daemon/daemon/protocol"
import { resolveCommandProtocol } from "../../engine/engine-presets.ts"
import { DIRTY_WORKTREE_CODE, EMPTY_BRANCH_DIRTY_WORKTREE_CODE } from "../../orchestrator/errors.ts"
import type { DaemonRpc } from "../daemon-session.ts"
import { verifiedSelfSession } from "./dispatcher.ts"
import { daemonOf } from "./handler-helpers.ts"
import { ApiError, type VerbContext, splitDaemonCode } from "./types.ts"

/** How long `delete --wait` follows a deletion before reporting `pending`.
 *  A worktree teardown is filesystem-bound; this is generous headroom, not a
 *  deadline the deletion itself respects. */
const DELETE_WAIT_TIMEOUT_MS = 60_000
const DELETE_POLL_INTERVAL_MS = 250

export async function deleteTask(ctx: VerbContext): Promise<unknown> {
  const daemon = daemonOf(ctx)
  const taskId = ctx.args.require("task-id")
  const force = ctx.args.bool("force") ?? false
  // Branch deletion is opt-in (same flag as `land`): delete drops the
  // worktree + task entry, git keeps the branch as the durable record.
  const deleteBranch = ctx.args.bool("delete-branch") ?? false
  // Deleting somebody else's task destroys their worktree and every tab in
  // it, so the daemon's audit line has to name WHO asked. Same verified
  // identity `send`/`add` use, never the bare env: unverifiable
  // stays unattributed rather than blaming a stranger's session.
  const self = await verifiedSelfSession()
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
