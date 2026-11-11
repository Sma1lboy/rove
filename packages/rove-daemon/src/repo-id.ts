/**
 * A repo's id across machines: a path means nothing on another machine, so tasks carry
 * `host/owner/name` (the normalized `origin`), else `root:<root commit>`, and clients group by it.
 */

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

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
  u = u.replace(/^ssh\.github\.com\//i, "github.com/") // GitHub's ssh-over-443 host
  return u.toLowerCase()
}

function git(cwd: string, args: readonly string[]): string | null {
  const res = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", timeout: 5000, windowsHide: true })
  return res.status === 0 ? res.stdout.trim() : null
}

/** In the link directory of a workspace on another machine (`add --workspace-on`): which worktree it stands for. */
export const REMOTE_WORKSPACE_FILE = ".rove-remote.json"

/** The repo a link directory's worktree belongs to, as that machine named it; undefined for any other directory. */
function linkedRepoId(path: string): string | undefined {
  try {
    const id = (JSON.parse(readFileSync(join(path, REMOTE_WORKSPACE_FILE), "utf8")) as { repoId?: unknown }).repoId
    return typeof id === "string" && id ? id : undefined
  } catch {
    return undefined
  }
}

/** Uncached: a link directory's repo, else the normalized origin, else `root:<lowest root sha>`, else undefined (not a repo, or no commits). */
export function computeRepoId(path: string): string | undefined {
  const linked = linkedRepoId(path)
  if (linked) return linked
  const origin = git(path, ["remote", "get-url", "origin"])
  if (origin) return normalizeRemoteUrl(origin)
  const root = git(path, ["rev-list", "--max-parents=0", "HEAD"])?.split("\n").filter(Boolean).sort()[0]
  return root ? `root:${root}` : undefined
}

const memo = new Map<string, string | undefined>()

/**
 * {@link computeRepoId}, memoized per path for the process: git runs once per existing path. A
 * repo that later gains an origin keeps its first id until restart. A missing path is not memoized.
 */
export function repoIdOf(path: string): string | undefined {
  if (!path) return undefined
  if (memo.has(path)) return memo.get(path)
  if (!existsSync(path)) return undefined
  const id = computeRepoId(path)
  memo.set(path, id)
  return id
}
