/**
 * Cheap "did anything git-visible move?" probe for the worktree-changes
 * collector, plus the ref-sha reads its behind-count cache is keyed on.
 *
 * The collector's cost is process spawns: `git status` + `rev-list` per
 * worktree per 2s tick, measured at 1280 `git` processes and 14.7s of CPU
 * in 62 seconds across 19 idle tasks, to publish 19 frames. Everything here
 * is `stat`/small-file reads instead — no subprocess, no lock, no walk.
 *
 * ## What the fingerprint can and cannot see — read before trusting it
 *
 * It sees GIT-METADATA movement — staging (`index`), checkout/commit (`HEAD`
 * and the branch's ref file), fetch or ref update (`FETCH_HEAD`,
 * `packed-refs`, the base ref files) — and entries CREATED, DELETED or
 * RENAMED directly in the worktree root.
 *
 * It does NOT see a content edit of an existing file, at any depth, nor a
 * new file in a subdirectory. Measured, not assumed: appending to
 * `src/deep/f.ts` moved neither `.git/index` nor the worktree root's mtime,
 * and creating `src/deep/untracked.ts` moved only `src/deep`'s own mtime,
 * which nothing here stats — `git status` reports both. (Our polls run
 * `GIT_OPTIONAL_LOCKS=0`, so they never refresh-write the index either.)
 * A directory's mtime tracks its entry list, not its contents, and seeing
 * through that costs the recursive walk this exists to avoid.
 *
 * So this is an ACCELERATOR, not an authority: a moved fingerprint means
 * "poll now", an unmoved one only means "the fast poll may relax". The
 * collector keeps a safety poll behind it, and everything ambiguous — a
 * missing file, an unreadable HEAD, a worktree that is not a git checkout —
 * returns `null`, which the collector reads as "poll".
 */

import { readFileSync, statSync } from "node:fs"
import { isAbsolute, join, resolve } from "node:path"

/**
 * The base branches the daemon falls back to when a task recorded none —
 * kobe's `base-ref-cache.ts` ladder, in its order. Kept here because the
 * fingerprint has to stat these ref files too: the collector is handed the
 * task's RECORDED base ref, which is usually absent, and the real base is
 * resolved later inside the runner. Without them a `git fetch` that only
 * advanced `origin/main` was invisible to the probe (`FETCH_HEAD` catches a
 * fetch, but not a local `update-ref` or a ref moved by another worktree).
 */
export const DEFAULT_BASE_REF_CANDIDATES = ["origin/main", "origin/master", "main", "master"] as const

/** Where a worktree's own git dir and its repo-wide common dir live. */
export interface GitDirs {
  /** Per-worktree git dir: `<repo>/.git`, or `<repo>/.git/worktrees/<name>`. */
  readonly gitDir: string
  /** Repo-wide dir holding shared refs + `packed-refs`. Equals `gitDir` for
   *  a primary checkout; a linked worktree points back at the main one. */
  readonly commonDir: string
}

function mtime(path: string): number | null {
  const st = statSync(path, { throwIfNoEntry: false })
  return st ? st.mtimeMs : null
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8")
  } catch {
    return null
  }
}

/**
 * Resolve a worktree's `gitDir`/`commonDir`, without `git rev-parse`.
 * `.git` is a directory in a primary checkout and a `gitdir: <path>` FILE in
 * a linked worktree; the linked one names its repo-wide dir in `commondir`
 * (usually the relative `../..`). `null` when `.git` is missing or
 * unreadable — the caller then treats the worktree as unprobeable.
 */
export function resolveGitDirs(worktreePath: string): GitDirs | null {
  const dotGit = join(worktreePath, ".git")
  const st = statSync(dotGit, { throwIfNoEntry: false })
  if (!st) return null
  let gitDir = dotGit
  if (!st.isDirectory()) {
    const pointer = readText(dotGit)?.match(/^gitdir:\s*(.+)$/m)?.[1]?.trim()
    if (!pointer) return null
    gitDir = isAbsolute(pointer) ? pointer : resolve(worktreePath, pointer)
  }
  const common = readText(join(gitDir, "commondir"))?.trim()
  const commonDir = common ? (isAbsolute(common) ? common : resolve(gitDir, common)) : gitDir
  return { gitDir, commonDir }
}

/** Candidate files a ref could live in, loose, per-worktree first. */
function looseRefPaths(dirs: GitDirs, ref: string): string[] {
  const rel = ref.startsWith("refs/") ? ref : `refs/remotes/${ref}`
  const alt = ref.startsWith("refs/") ? null : `refs/heads/${ref}`
  const names = alt ? [rel, alt] : [rel]
  const out: string[] = []
  for (const name of names) {
    out.push(join(dirs.gitDir, name))
    if (dirs.commonDir !== dirs.gitDir) out.push(join(dirs.commonDir, name))
  }
  return out
}

/**
 * The sha a ref currently points at, read from the loose ref file or
 * `packed-refs`. `null` when it resolves to neither — the caller then falls
 * back to `git`, which knows about ref namespaces, symrefs and
 * alternates that this deliberately does not.
 */
export function readRefSha(dirs: GitDirs, ref: string): string | null {
  for (const path of looseRefPaths(dirs, ref)) {
    const raw = readText(path)?.trim()
    if (raw && /^[0-9a-f]{40,64}$/.test(raw)) return raw
  }
  const packed = readText(join(dirs.commonDir, "packed-refs"))
  if (!packed) return null
  const wanted = new Set(looseRefPaths(dirs, ref).map((p) => p.replace(/^.*?(refs\/)/, "$1")))
  for (const line of packed.split("\n")) {
    if (!line || line.startsWith("#") || line.startsWith("^")) continue
    const [sha, name] = line.split(" ", 2)
    if (sha && name && wanted.has(name.trim())) return sha
  }
  return null
}

/** The sha `HEAD` points at, following one symref level. `null` if unreadable. */
export function readHeadSha(dirs: GitDirs): string | null {
  const head = readText(join(dirs.gitDir, "HEAD"))?.trim()
  if (!head) return null
  if (/^[0-9a-f]{40,64}$/.test(head)) return head
  const ref = head.match(/^ref:\s*(.+)$/)?.[1]?.trim()
  return ref ? readRefSha(dirs, ref) : null
}

/**
 * A string that changes when anything the probe CAN see moved. `null` means
 * "cannot tell" — a missing `.git`, an unreadable `HEAD`, any throw — and
 * the caller must poll.
 *
 * Base refs are included because they are what moves the behind-count: a
 * fetch that advances `origin/main` changes `packed-refs`, `FETCH_HEAD`, or
 * that ref's own file. The {@link DEFAULT_BASE_REF_CANDIDATES} are stat'd
 * alongside any supplied `baseRef` — a task usually records none, and the
 * real base is only resolved later, inside the status runner.
 */
export function worktreeFingerprint(worktreePath: string, baseRef?: string): string | null {
  try {
    const dirs = resolveGitDirs(worktreePath)
    if (!dirs) return null
    const head = readText(join(dirs.gitDir, "HEAD"))?.trim()
    if (!head) return null
    const parts: (number | string | null)[] = [
      head,
      mtime(worktreePath),
      mtime(join(dirs.gitDir, "index")),
      mtime(join(dirs.gitDir, "HEAD")),
      mtime(join(dirs.gitDir, "FETCH_HEAD")),
      mtime(join(dirs.commonDir, "FETCH_HEAD")),
      mtime(join(dirs.commonDir, "packed-refs")),
    ]
    const headRef = head.match(/^ref:\s*(.+)$/)?.[1]?.trim()
    if (headRef) for (const path of looseRefPaths(dirs, headRef)) parts.push(mtime(path))
    parts.push(mtime(join(dirs.commonDir, "refs/remotes/origin/HEAD")))
    for (const ref of baseRef ? [baseRef, ...DEFAULT_BASE_REF_CANDIDATES] : DEFAULT_BASE_REF_CANDIDATES) {
      for (const path of looseRefPaths(dirs, ref)) parts.push(mtime(path))
    }
    return parts.join("|")
  } catch {
    return null
  }
}
