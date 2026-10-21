/**
 * Which checkout on another machine is "the same repo" as a path here. A path
 * means nothing across machines (`/home/me/rove` vs `/Users/me/i/rove`), so a
 * verb forwarded with `--repo <local path>` is re-pointed at the target's own
 * checkout, matched by the repo's root commit when both sides have it, else by
 * its normalized `origin` URL.
 */

import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { normalizeRemoteUrl } from "@sma1lboy/rove-daemon/repo-id"

// One normalizer for both sides: the daemon's task `repoId` and this match must agree.
export { normalizeRemoteUrl }

export interface RepoIdentity {
  /** `origin` normalized to `host/owner/name`, lowercased; absent with no origin. */
  readonly origin?: string
  /** The first parentless commit; absent in a shallow clone or an empty repo. */
  readonly root?: string
}

function git(cwd: string, args: readonly string[]): string | null {
  const res = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", timeout: 5000 })
  return res.status === 0 ? res.stdout.trim() : null
}

/** The identity of the git checkout at `path`, or null when it is not one. */
export function repoIdentity(path: string): RepoIdentity | null {
  if (!existsSync(path) || git(path, ["rev-parse", "--git-dir"]) === null) return null
  const origin = git(path, ["remote", "get-url", "origin"])
  const roots = git(path, ["rev-list", "--max-parents=0", "HEAD"])
  const root = roots?.split("\n").filter(Boolean).sort()[0]
  return { ...(origin ? { origin: normalizeRemoteUrl(origin) } : {}), ...(root ? { root } : {}) }
}

/** True when `path` is a git checkout on THIS machine (worth translating before a forward). */
export function isLocalCheckout(path: string): boolean {
  return existsSync(join(path, ".git")) || (existsSync(path) && git(path, ["rev-parse", "--git-dir"]) !== null)
}

/**
 * The candidate that is the same repo as `want`: a shared root commit wins (the
 * same history, whatever the remote is called); otherwise the same origin.
 */
export function matchRepo(
  want: RepoIdentity,
  candidates: ReadonlyArray<{ readonly path: string; readonly identity: RepoIdentity }>,
): string | null {
  if (want.root) {
    const byRoot = candidates.find((c) => c.identity.root === want.root)
    if (byRoot) return byRoot.path
  }
  if (want.origin) {
    const byOrigin = candidates.find((c) => c.identity.origin === want.origin)
    if (byOrigin) return byOrigin.path
  }
  return null
}

/**
 * Commits on `ref` in the checkout at `path` that no remote has: ahead of its upstream, or — with
 * no upstream — not contained in any remote-tracking branch. Null when `ref` is not a local ref
 * here (a name only the other machine knows), so the caller has nothing to judge.
 */
export function unpushedCommits(path: string, ref: string): number | null {
  if (git(path, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]) === null) return null
  const ahead = git(path, ["rev-list", "--count", `${ref}@{upstream}..${ref}`])
  if (ahead !== null) return Number.parseInt(ahead, 10) || 0
  // No upstream: count what no remote-tracking branch reaches.
  const lone = git(path, ["rev-list", "--count", ref, "--not", "--remotes"])
  return lone === null ? null : Number.parseInt(lone, 10) || 0
}
