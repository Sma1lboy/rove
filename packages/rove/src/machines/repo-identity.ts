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

export interface RepoIdentity {
  /** `origin` normalized to `host/owner/name`, lowercased; absent with no origin. */
  readonly origin?: string
  /** The first parentless commit; absent in a shallow clone or an empty repo. */
  readonly root?: string
}

/**
 * `git@github.com:Me/Rove.git`, `https://github.com/me/rove`, `ssh://git@github.com/me/rove/`
 * all become `github.com/me/rove`. Not a URL parser: just enough to compare two remotes.
 */
export function normalizeRemoteUrl(url: string): string {
  let u = url.trim()
  u = u.replace(/^[a-z+]+:\/\//i, "") // scheme
  u = u.replace(/^[^@/]+@/, "") // user@
  u = u.replace(/^([^/:]+):(?!\d+\/)/, "$1/") // scp-style host:path (not host:port/)
  u = u.replace(/^([^/:]+):\d+\//, "$1/") // drop an explicit port
  u = u.replace(/\/+$/, "").replace(/\.git$/i, "")
  return u.toLowerCase()
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
