/**
 * `publish`: hand a task's work back through the remote rather than merging it
 * here. Pushes the task's branch from its worktree and opens (or finds) its PR
 * with `gh`. It is what `land` means for a task that lives on another machine:
 * the hub never sees that worktree, so the branch travels through the remote
 * (`machines/forward.ts` turns a forwarded `land` into this).
 */

import { errorMessage } from "@/lib/error-message"
import type { SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import { runAsync } from "../../lib/run-async.ts"
import { F } from "./flags.ts"
import { daemonOf } from "./handler-helpers.ts"
import { ApiError, type VerbContext, type VerbSpec } from "./types.ts"
import { attachSessionPr } from "./verbs-pr.ts"

/** The PR is the deliverable: record it on the task's row, but a failed attach must not hide a PR that exists. */
async function published(ctx: VerbContext, taskId: string, branch: string, url: string): Promise<unknown> {
  const attached = await attachSessionPr(ctx, taskId, url).then(
    () => ({}),
    (err: unknown) => ({ attachError: errorMessage(err) }),
  )
  return { branch, pushed: true, pr: { url }, ...attached }
}

async function run(cwd: string, cmd: string, args: readonly string[]): Promise<{ ok: boolean; out: string }> {
  const res = await runAsync(cmd, args, { cwd, timeoutMs: 120_000 })
  return { ok: res.ok, out: res.error ?? `${res.stdout}${res.stderr}`.trim() }
}

export const PUBLISH_VERB: VerbSpec = {
  name: "publish",
  group: "lifecycle",
  summary:
    "Push a task's branch to its remote (`origin` unless --remote) and open its pull request with `gh`, or return the one already open. What `land` does for a task on another machine. Returns { branch, pushed, pr: { url } | null, prError? } — `prError` says why no PR (gh missing or not signed in, a non-GitHub remote, no commits ahead); the push still happened. Refuses a task with no worktree or no branch.",
  flags: [
    F.taskId(),
    { name: "remote", type: "string", placeholder: "NAME", description: "Remote to push to. Default: origin." },
  ],
  handler: async (ctx) => {
    const taskId = ctx.args.require("task-id")
    const { task } = await daemonOf(ctx).request<{ task: SerializedTask }>("task.get", { taskId })
    if (!task.worktreePath || !task.branch) {
      throw new ApiError(`task ${taskId} has no worktree or branch to publish`, "NO_WORKTREE", {
        nextCommandArgs: ["api", "ensure-worktree", "--task-id", taskId],
      })
    }
    const cwd = task.worktreePath
    const remote = ctx.args.str("remote") ?? "origin"
    const push = await run(cwd, "git", ["push", "-u", remote, task.branch])
    if (!push.ok) throw new ApiError(`git push to ${remote} failed: ${push.out}`, "PUSH_FAILED")

    const existing = await run(cwd, "gh", ["pr", "view", task.branch, "--json", "url", "-q", ".url"])
    if (existing.ok && existing.out.startsWith("http")) return published(ctx, taskId, task.branch, existing.out)
    const base = task.baseRef ? ["--base", String(task.baseRef)] : []
    const created = await run(cwd, "gh", ["pr", "create", "--fill", "--head", task.branch, ...base])
    const url = created.out.split("\n").find((line) => line.startsWith("http"))
    if (created.ok && url) return published(ctx, taskId, task.branch, url)
    return { branch: task.branch, pushed: true, pr: null, prError: created.out || "gh pr create failed" }
  },
}
