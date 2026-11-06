/** The `send` guard against a `succeeded:` report from a worker whose branch has no commits. */

import type { SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import { workspaceCapabilities } from "@sma1lboy/rove-daemon/workspace"
import type { DaemonRpc } from "../daemon-session.ts"
import { ownSession } from "./dispatcher.ts"
import { ApiError, type VerbContext } from "./types.ts"

/**
 * Refuse a `succeeded:` report from a worker whose branch carries no commits —
 * at `send`, where the claim enters, rather than at `land`'s EMPTY_BRANCH after
 * the coordinator may have archived the siblings.
 *
 * Deliberately narrow: a false NEGATIVE is cheap, a false POSITIVE blocks a
 * worker from reporting at all:
 *   - only a VERIFIED self session (the same identity `send` already trusts
 *     for dispatcher routing) — an unverified env names a stranger's branch;
 *   - only a MANAGED task: `main`/`dir` tasks have no Rove-created branch, and
 *     an agent on a main checkout legitimately reads `ahead: 0`;
 *   - only a DEFINITE `ahead === 0`. An unresolvable base reads null — an
 *     honest unknown, never grounds to refuse.
 *
 * Investigation and review tasks genuinely succeed with no commits, so
 * `--allow-empty` (the `git commit` spelling) says so outright.
 */
export async function assertNotEmptySuccess(daemon: DaemonRpc, ctx: VerbContext, prompt: string): Promise<void> {
  if (ctx.args.bool("allow-empty")) return
  // Fullwidth colon too: a CJK IME types `succeeded：` without the agent noticing.
  if (!/^\s*succeeded\s*[:\uff1a]/i.test(prompt)) return
  const self = await ownSession(daemon)
  if (!self) return
  let sender: SerializedTask
  try {
    sender = (await daemon.request<{ task: SerializedTask }>("task.get", { taskId: self.taskId })).task
  } catch {
    return // stale id / unreadable task — an unknown is never grounds to refuse
  }
  if (!workspaceCapabilities(sender).ownsBranch) return
  if (!sender.worktreePath) return
  // A throwing read is an unknown, and an unknown never refuses.
  let ahead: number | null
  try {
    // Against the task's RECORDED base (`add --base-branch`), like `collect`,
    // never the origin/main guess: on a branch cut from `release/2.x` the
    // guess reads an empty branch as `ahead: 2` and can false-positive too.
    ahead = (await ctx.runtime.readBranchSignals(sender.worktreePath, sender.baseRef)).ahead
  } catch {
    return
  }
  if (ahead !== 0) return
  const branch = sender.branch || "your branch"
  throw new ApiError(
    `refusing to report success: ${branch} has 0 commits — "succeeded" means COMMITTED, and this report would reach the coordinator as a clean success with nothing to land`,
    "EMPTY_SUCCESS_REPORT",
    {
      taskId: self.taskId,
      branch,
      hint: "commit your work with a real message and send again — or, if this task genuinely produced no commits (an investigation or a review), re-send with --allow-empty to say so explicitly",
      // Carry the caller's target forward, or the verbatim retry re-resolves
      // via the active-task fallback and could land in a DIFFERENT task.
      nextCommandArgs: [
        "api",
        "send",
        ...(ctx.args.str("task-id") ? ["--task-id", ctx.args.str("task-id") as string] : []),
        ...(ctx.args.str("tab") ? ["--tab", ctx.args.str("tab") as string] : []),
        "--allow-empty",
        "--prompt",
        prompt,
      ],
    },
  )
}
