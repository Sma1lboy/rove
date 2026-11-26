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

function readLink(path: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(join(path, REMOTE_WORKSPACE_FILE), "utf8")) as Record<string, unknown>
  } catch {
    return undefined
  }
}

/** The repo a link directory's worktree belongs to, as that machine named it; undefined for any other directory. */
function linkedRepoId(path: string): string | undefined {
  const id = readLink(path)?.repoId
  return typeof id === "string" && id ? id : undefined
}

/** Where a link directory's worktree is: the machine's alias and the path there. */
export function linkedWorkspace(path: string): { machine: string; path: string } | undefined {
  const link = readLink(path)
  return typeof link?.machine === "string" && typeof link.path === "string"
    ? { machine: link.machine, path: link.path }
    : undefined
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

const memo = new Map<string, { readonly id: string | undefined; readonly at: number }>()
/** How long "no id" holds: a folder becomes a repo (`git init`, a first commit) without Rove hearing of it. */
const NO_ID_TTL_MS = 30_000

/**
 * {@link computeRepoId}, memoized per path for the process: git runs once per existing repo. A repo
 * that later gains an origin keeps its first id until restart; a path with no id is asked again after
 * {@link NO_ID_TTL_MS}. A missing path is not memoized.
 */
export function repoIdOf(path: string, now = Date.now()): string | undefined {
  if (!path) return undefined
  const hit = memo.get(path)
  if (hit && (hit.id !== undefined || now - hit.at < NO_ID_TTL_MS)) return hit.id
  if (!existsSync(path)) return undefined
  const id = computeRepoId(path)
  memo.set(path, { id, at: now })
  return id
}
