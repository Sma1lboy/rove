/**
 * `repo-match`: which of THIS machine's checkouts is a given repo. A hub that
 * forwards `add --repo <its own path>` asks the target this first and swaps in
 * the answer (`machines/forward.ts`), so a dispatch names the repo, not a path.
 */

import type { SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import { matchRepo, normalizeRemoteUrl, repoIdentity } from "../../machines/repo-identity.ts"
import { getSavedRepos } from "../../state/repos.ts"
import { daemonOf } from "./handler-helpers.ts"
import { ApiError, type VerbSpec } from "./types.ts"

export const REPO_MATCH_VERB: VerbSpec = {
  name: "repo-match",
  group: "discover",
  summary:
    "Find this machine's checkout of a repo by identity: `--root` (its first commit) wins, else `--origin` (normalized remote URL, `host/owner/name`). Searches the saved repos and every task's repo. Returns { repo } (null when no checkout matches) and { searched }.",
  flags: [
    {
      name: "origin",
      type: "string",
      placeholder: "URL",
      description: "Remote URL; any git form, compared normalized.",
    },
    { name: "root", type: "string", placeholder: "SHA", description: "The repo's root commit." },
  ],
  handler: async (ctx) => {
    const origin = ctx.args.str("origin")
    const root = ctx.args.str("root")
    if (!origin && !root) throw new ApiError("pass --origin or --root", "BAD_FLAG")
    const { tasks } = await daemonOf(ctx).request<{ tasks: SerializedTask[] }>("task.list")
    const paths = [...new Set([...getSavedRepos(), ...tasks.map((t) => t.repo)])]
    const candidates = paths.flatMap((path) => {
      const identity = repoIdentity(path)
      return identity ? [{ path, identity }] : []
    })
    const repo = matchRepo(
      { ...(origin ? { origin: normalizeRemoteUrl(origin) } : {}), ...(root ? { root } : {}) },
      candidates,
    )
    return { repo, searched: candidates.length }
  },
}
