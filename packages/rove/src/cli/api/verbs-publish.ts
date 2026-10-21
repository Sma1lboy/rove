/**
 * `publish`: hand a task's work back through the remote rather than merging it
 * here. Pushes the task's branch from its worktree and opens (or finds) its PR
 * with `gh`. It is what `land` means for a task that lives on another machine:
 * the hub never sees that worktree, so the branch travels through the remote
 * (`machines/forward.ts` turns a forwarded `land` into this).
 */

import { spawnSync } from "node:child_process"
import type { SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import { F } from "./flags.ts"
import { daemonOf } from "./handler-helpers.ts"
import { ApiError, type VerbSpec } from "./types.ts"

function run(cwd: string, cmd: string, args: readonly string[]): { ok: boolean; out: string } {
  const res = spawnSync(cmd, args, { cwd, encoding: "utf8", timeout: 120_000 })
  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`.trim()
  return { ok: res.status === 0, out: res.error ? String(res.error.message) : out }
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
    const push = run(cwd, "git", ["push", "-u", remote, task.branch])
    if (!push.ok) throw new ApiError(`git push to ${remote} failed: ${push.out}`, "PUSH_FAILED")

    const existing = run(cwd, "gh", ["pr", "view", task.branch, "--json", "url", "-q", ".url"])
    if (existing.ok && existing.out.startsWith("http"))
      return { branch: task.branch, pushed: true, pr: { url: existing.out } }
    const base = task.baseRef ? ["--base", String(task.baseRef)] : []
    const created = run(cwd, "gh", ["pr", "create", "--fill", "--head", task.branch, ...base])
    const url = created.out.split("\n").find((line) => line.startsWith("http"))
    if (created.ok && url) return { branch: task.branch, pushed: true, pr: { url } }
    return { branch: task.branch, pushed: true, pr: null, prError: created.out || "gh pr create failed" }
  },
}
