/**
 * `pr-attach`: record a pull request on a task's row. The branch-based PR poller
 * only sees a task's own branch; this is the one input for PRs its session opened
 * from any other directory (a `main` coordinator's hand-made worktrees).
 */

import { spawnSync } from "node:child_process"
import { canonicalPrUrl } from "@sma1lboy/rove-daemon/daemon/session-prs"
import { simpleRpc } from "./handler-helpers.ts"
import { ApiError, type VerbContext, type VerbSpec } from "./types.ts"
import { resolveTarget } from "./verbs-edit.ts"

const ACCEPTED = "a PR URL (https://github.com/OWNER/REPO/pull/N) or a PR number of the repo in the current directory"

/** A bare number is looked up with `gh` in the caller's cwd, so it names that directory's repo. */
function urlForNumber(n: string): string | undefined {
  const res = spawnSync("gh", ["pr", "view", n, "--json", "url", "-q", ".url"], { encoding: "utf8", timeout: 30_000 })
  return res.status === 0 ? canonicalPrUrl(String(res.stdout ?? "").trim()) : undefined
}

/** Attach `url` to `taskId` through the daemon; the reply carries the canonical URL. */
export async function attachSessionPr(
  ctx: VerbContext,
  taskId: string,
  url: string,
): Promise<{ taskId: string; url: string }> {
  return simpleRpc<{ taskId: string; url: string }>(ctx, "task.addSessionPr", { taskId, url })
}

export const PR_ATTACH_VERB: VerbSpec = {
  name: "pr-attach",
  group: "edit",
  summary:
    "Show a pull request on a task's row, with its live state. Run it once after opening a PR from ANY directory (a worktree Rove does not track); `publish` already does it for the PRs it opens. Idempotent: attaching the same PR again changes nothing. Without --task-id it targets your own task. Returns { taskId, url }.",
  flags: [
    {
      name: "url",
      type: "string",
      required: true,
      placeholder: "URL|N",
      description: `The pull request: ${ACCEPTED}.`,
    },
    {
      name: "task-id",
      type: "string",
      placeholder: "ID",
      description: "The task to attach to. Default: the task this session runs in.",
    },
  ],
  handler: async (ctx) => {
    const raw = ctx.args.require("url").trim()
    const url = /^\d+$/.test(raw) ? urlForNumber(raw) : canonicalPrUrl(raw)
    if (!url) {
      throw new ApiError(`--url ${raw} is not ${ACCEPTED}`, "BAD_FLAG", {
        hint: "pass the URL `gh pr create` printed",
      })
    }
    return attachSessionPr(ctx, await resolveTarget(ctx, "pr-attach"), url)
  },
}
