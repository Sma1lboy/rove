/**
 * `repo-match`: which of THIS machine's checkouts is a given repo. A hub that
 * forwards `add --repo <its own path or a repo id>` asks the target this first and
 * swaps in the answer (`machines/forward.ts`), so a dispatch names the repo, not a path.
 * `repo-list`: every repo this machine has, by id — what `--machine auto` and
 * `rove api repo-list --machine <alias>` read.
 */

import type { SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import { normalizeRemoteUrl, repoIdentity } from "../../machines/repo-identity.ts"
import {
  type Checkout,
  findCheckouts,
  isCleanCheckout,
  pickCheckout,
  primaryCheckouts,
  repoIdOf,
} from "../../machines/repo-ref.ts"
import { getSavedRepos } from "../../state/repos.ts"
import { daemonOf } from "./handler-helpers.ts"
import { ApiError, type VerbContext, type VerbSpec } from "./types.ts"

/** This machine's checkouts: the saved repos and every task's repo. */
export async function localCheckouts(ctx: VerbContext): Promise<Checkout[]> {
  const { tasks } = await daemonOf(ctx).request<{ tasks: SerializedTask[] }>("task.list")
  const paths = [...new Set([...getSavedRepos(), ...tasks.map((t) => t.repo)])]
  return paths.flatMap((path) => {
    const identity = repoIdentity(path)
    return identity ? [{ path, identity }] : []
  })
}

/** The checkout of `want` here, by the same rules a dispatch uses. */
export async function resolveLocalRepo(
  ctx: VerbContext,
  want: { readonly origin?: string; readonly root?: string },
  allowFork = false,
): Promise<{ readonly repo: string | null; readonly fork?: string; readonly checkouts: string[]; searched: number }> {
  const candidates = await localCheckouts(ctx)
  const matches = findCheckouts(want, candidates)
  const id = want.origin ?? (want.root ? `root:${want.root}` : "")
  const picked = pickCheckout(matches, {
    primary: primaryCheckouts()[id],
    allowFork,
    isClean: isCleanCheckout,
  })
  return {
    repo: picked.path,
    ...(picked.fork ? { fork: picked.fork } : {}),
    checkouts: matches.map((m) => m.path),
    searched: candidates.length,
  }
}

export const REPO_MATCH_VERB: VerbSpec = {
  name: "repo-match",
  group: "discover",
  summary:
    "Find this machine's checkout of a repo by identity: `--root` (its first commit) or `--origin` (normalized remote URL, `host/owner/name`). Several checkouts: the primary (`rove machine primary`) wins, else a clean one. A checkout with the same root but another origin is a fork and only matches with --allow-fork. Searches the saved repos and every task's repo. Returns { repo } (null when none matches), { fork } (a fork that was skipped), { checkouts } and { searched }.",
  flags: [
    {
      name: "origin",
      type: "string",
      placeholder: "URL",
      description: "Remote URL; any git form, compared normalized.",
    },
    { name: "root", type: "string", placeholder: "SHA", description: "The repo's root commit." },
    { name: "allow-fork", type: "bool", description: "Accept a fork (same root commit, other origin)." },
  ],
  handler: async (ctx) => {
    const origin = ctx.args.str("origin")
    const root = ctx.args.str("root")
    if (!origin && !root) throw new ApiError("pass --origin or --root", "BAD_FLAG")
    return resolveLocalRepo(
      ctx,
      { ...(origin ? { origin: normalizeRemoteUrl(origin) } : {}), ...(root ? { root } : {}) },
      ctx.args.bool("allow-fork") === true,
    )
  },
}

export const REPO_LIST_VERB: VerbSpec = {
  name: "repo-list",
  group: "discover",
  summary:
    "This machine's repos by id (`host/owner/name`, or `root:<sha>` with no origin): each with its checkouts and which one is primary. Read from the saved repos and every task's repo. Returns { repos: [{ id, primary, checkouts }] }.",
  flags: [],
  handler: async (ctx) => {
    const primaries = primaryCheckouts()
    const byId = new Map<string, string[]>()
    for (const c of await localCheckouts(ctx)) {
      const id = repoIdOf(c.identity)
      if (!id) continue
      byId.set(id, [...(byId.get(id) ?? []), c.path])
    }
    const repos = [...byId].map(([id, checkouts]) => ({ id, primary: primaries[id] ?? null, checkouts }))
    return { repos: repos.sort((a, b) => a.id.localeCompare(b.id)) }
  },
}
