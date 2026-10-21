/**
 * `--repo` names a repo, not only a path. A repo id is `host/owner/name` (the
 * normalized `origin`); a path is just one machine's checkout of it. This module
 * reads what a `--repo` value means and turns an id into a checkout on THIS
 * machine: the primary one if marked, else a clean one, else any; a fork (same
 * history, other origin) only when asked; a fresh clone only when asked.
 */

import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { isRemoteRepoKey } from "../state/remote-repos.ts"
import { loadStateFile, updateStateFile } from "../state/store.ts"
import { type RepoIdentity, normalizeRemoteUrl, repoIdentity } from "./repo-identity.ts"

export type RepoRef =
  | { readonly kind: "path"; readonly path: string }
  /** `id` is `host/owner/name`; `cloneUrl` is what `git clone` gets when asked to fetch it. */
  | { readonly kind: "id"; readonly id: string; readonly cloneUrl: string }

const URL_LIKE = /^[a-z][a-z0-9+.-]*:\/\//i
const SCP_LIKE = /^[^@/\s]+@[^:/\s]+:[^\s]+$/
const SEGMENT = /^[A-Za-z0-9_.-]+$/

/**
 * What a `--repo` value means. A path wins whenever it could be one: absolute, `~`/`.`-led, or an
 * existing relative directory under `cwd`. `ssh://…` stays the remote-project key it already is.
 * Otherwise a remote URL, `host/owner/name` (host has a dot; GitLab subgroups too) or `owner/name` (GitHub) is an id.
 */
export function parseRepoRef(raw: string, cwd: string = process.cwd(), exists = existsSync): RepoRef {
  const value = raw.trim()
  const asPath: RepoRef = { kind: "path", path: value }
  if (value === "" || isRemoteRepoKey(value)) return asPath
  if (URL_LIKE.test(value) || SCP_LIKE.test(value)) {
    return { kind: "id", id: normalizeRemoteUrl(value), cloneUrl: value }
  }
  if (isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value) || /^[~.\\]/.test(value)) return asPath
  if (exists(resolve(cwd, value))) return asPath
  const parts = value.replace(/\.git$/i, "").split("/")
  if (!parts.every((p) => SEGMENT.test(p))) return asPath
  if (parts.length === 2) {
    const id = `github.com/${parts.join("/")}`.toLowerCase()
    return { kind: "id", id, cloneUrl: `https://${id}.git` }
  }
  if (parts.length >= 3 && parts[0]?.includes(".")) {
    const id = parts.join("/").toLowerCase()
    return { kind: "id", id, cloneUrl: `https://${id}.git` }
  }
  return asPath
}

/** A repo's id: its normalized origin, else `root:<sha>`, else null. */
export function repoIdOf(identity: RepoIdentity | null): string | null {
  if (!identity) return null
  if (identity.origin) return identity.origin
  return identity.root ? `root:${identity.root}` : null
}

export interface Checkout {
  readonly path: string
  readonly identity: RepoIdentity
}

export interface CheckoutMatch {
  readonly path: string
  /** `root` = same first commit; `origin` = same remote. */
  readonly via: "root" | "origin"
  /** Same history but a different origin: another fork of the repo. */
  readonly fork: boolean
}

/** Every candidate that is `want`, in candidate order. */
export function findCheckouts(want: RepoIdentity, candidates: readonly Checkout[]): CheckoutMatch[] {
  const out: CheckoutMatch[] = []
  for (const c of candidates) {
    const sameRoot = Boolean(want.root && c.identity.root === want.root)
    const sameOrigin = Boolean(want.origin && c.identity.origin === want.origin)
    if (!sameRoot && !sameOrigin) continue
    const fork = sameRoot && !sameOrigin && Boolean(want.origin && c.identity.origin)
    out.push({ path: c.path, via: sameRoot ? "root" : "origin", fork })
  }
  return out
}

/**
 * The one checkout to use: forks only with `allowFork`; then the primary, a clean one, the first.
 * `fork` names the fork that was skipped when nothing else matched, so the caller can say so.
 */
export function pickCheckout(
  matches: readonly CheckoutMatch[],
  opts: { readonly primary?: string; readonly allowFork?: boolean; readonly isClean?: (path: string) => boolean },
): { readonly path: string | null; readonly fork?: string } {
  const usable = matches.filter((m) => opts.allowFork || !m.fork)
  if (usable.length === 0) {
    const fork = matches.find((m) => m.fork)?.path
    return fork ? { path: null, fork } : { path: null }
  }
  const primary = usable.find((m) => m.path === opts.primary)
  if (primary) return { path: primary.path }
  if (usable.length > 1 && opts.isClean) {
    const clean = usable.find((m) => opts.isClean?.(m.path))
    if (clean) return { path: clean.path }
  }
  return { path: usable[0]?.path ?? null }
}

export function isCleanCheckout(path: string): boolean {
  const res = spawnSync("git", ["-C", path, "status", "--porcelain", "--untracked-files=no"], {
    encoding: "utf8",
    timeout: 5000,
  })
  return res.status === 0 && res.stdout.trim() === ""
}

export const REPO_PRIMARY_KEY = "repoPrimary"

/** repo id → the checkout path this machine prefers for it. */
export function primaryCheckouts(state: Record<string, unknown> = loadStateFile() as Record<string, unknown>) {
  const raw = state[REPO_PRIMARY_KEY]
  const out: Record<string, string> = {}
  if (raw && typeof raw === "object") {
    for (const [id, path] of Object.entries(raw)) if (typeof path === "string") out[id] = path
  }
  return out
}

/** Mark (or with `path` null, unmark) this machine's primary checkout of `id`. */
export function setPrimaryCheckout(id: string, path: string | null): void {
  updateStateFile((state) => {
    const next = primaryCheckouts(state as Record<string, unknown>)
    if (path === null) Reflect.deleteProperty(next, id)
    else next[id] = path
    ;(state as Record<string, unknown>)[REPO_PRIMARY_KEY] = next
    return true
  })
}

/** Where `--clone` puts a repo it fetches: `~/.rove/repos/<host>/<owner>/<name>`. */
export function cloneDirFor(id: string, home: string = homedir()): string {
  return join(home, ".rove", "repos", ...id.split("/"))
}

/** Clone `ref` into its clone dir (or reuse a checkout already there). Throws with git's message. */
export function cloneRepo(ref: { readonly id: string; readonly cloneUrl: string }, home?: string): string {
  const dir = cloneDirFor(ref.id, home)
  if (repoIdentity(dir)) return dir
  mkdirSync(dirname(dir), { recursive: true })
  const res = spawnSync("git", ["clone", ref.cloneUrl, dir], { encoding: "utf8", timeout: 600_000 })
  if (res.status !== 0) throw new Error((res.stderr || res.stdout || "git clone failed").trim())
  return dir
}
