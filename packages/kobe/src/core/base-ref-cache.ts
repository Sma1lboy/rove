/**
 * Async, cached base-ref resolution for the daemon's per-worktree polls.
 *
 * Same ladder as `cli/api/branch-signals.ts` (`origin/HEAD` → `origin/main`
 * → `origin/master` → `main` → `master`, then the base checkout's branch),
 * but that one uses `spawnSync`, which would block the daemon's event loop
 * on its 2-second tick. This one is async and MEMOISED.
 *
 * TTL, not permanent: a repo that gains `origin` or renames its base must
 * start reporting drift without a restart. "None resolves" is cached too, or
 * a remote-less repo pays the ladder every tick.
 *
 * Candidates are read from ref FILES (loose, then `packed-refs`); spawning
 * only when git dirs are unreadable (measured: 19 worktrees cost 75 `git`
 * processes per TTL otherwise). A RECORDED base ref keeps its `rev-parse`
 * fallback: it may be a tag or sha, which a ref-file miss can't disprove.
 *
 * A candidate that resolves is not yet a base: two branches can share no
 * history (an orphan `main` beside a live `develop`), so each must pass
 * `git merge-base <ref> HEAD`. That spawn is amortised by FINGERPRINT (HEAD
 * sha + each resolving candidate's name and sha, read from files): on TTL
 * expiry a matching fingerprint renews the entry, so idle worktrees spawn
 * nothing and `merge-base` runs once per HEAD-or-base movement.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  DEFAULT_BASE_REF_CANDIDATES,
  type GitDirs,
  readHeadSha,
  readRefSha,
  resolveGitDirs,
} from "@sma1lboy/kobe-daemon/daemon/worktree-probe"
import { readOnlyGitProcessEnv } from "../lib/git-env.ts"
import { spawnCapture } from "../lib/poll-scheduling.ts"

/** How long a resolution (including "none") is trusted. Exported as a test seam. */
export const BASE_REF_TTL_MS = 5 * 60_000

interface Entry {
  readonly ref: string | null
  readonly at: number
  /** Fingerprint the `merge-base` verdicts were taken on; `null` (unreadable
   *  git dirs) never matches. */
  readonly fingerprint: string | null
}

const cache = new Map<string, Entry>()

/** Test seam for the process-wide cache. Keep exported (knip can't see the test). */
export function resetBaseRefCache(): void {
  cache.clear()
}

async function git(worktreePath: string, args: readonly string[], signal: AbortSignal) {
  return await spawnCapture("git", [...args], { cwd: worktreePath, env: readOnlyGitProcessEnv(), signal })
}

async function refExists(worktreePath: string, ref: string, signal: AbortSignal): Promise<boolean> {
  return (await git(worktreePath, ["rev-parse", "--verify", "--quiet", ref], signal)).status === 0
}

/** Whether `ref` and HEAD have a common ancestor. */
async function sharesHistory(worktreePath: string, ref: string, signal: AbortSignal): Promise<boolean> {
  return (await git(worktreePath, ["merge-base", ref, "HEAD"], signal)).status === 0
}

/**
 * The BASE CHECKOUT's branch (first `worktree list --porcelain` record), for
 * unreadable git dirs. Null when detached or the read fails.
 */
async function baseCheckoutBranchFromGit(worktreePath: string, signal: AbortSignal): Promise<string | null> {
  const out = await git(worktreePath, ["worktree", "list", "--porcelain"], signal)
  if (out.status !== 0) return null
  const first = out.stdout.split("\n\n", 1)[0] ?? ""
  const line = first.split("\n").find((l) => l.startsWith("branch "))
  const branch = line
    ?.slice("branch ".length)
    .trim()
    .replace(/^refs\/heads\//, "")
  return branch || null
}

/** The ref a symref FILE points at (`ref: refs/…`), or null. */
function readRefSymbolic(dirs: GitDirs, ref: string): string | null {
  for (const dir of [dirs.gitDir, dirs.commonDir]) {
    try {
      const raw = readFileSync(join(dir, ref), "utf8").trim()
      const target = raw.match(/^ref:\s*(.+)$/)?.[1]?.trim()
      if (target) return target
    } catch {
      // Not present here — try the common dir, then give up.
    }
  }
  return null
}

/** Everything the ladder's verdict depends on, when it can be read from disk. */
interface Ladder {
  /** Resolving candidates in ladder order — the list `merge-base` is asked about. */
  readonly names: string[]
  /** HEAD + every name's sha; `null` when HEAD won't read (never matches). */
  readonly fingerprint: string | null
}

/**
 * The ladder from ref files. `undefined` (unlike an empty list, "nothing to
 * measure against") = git dirs unresolvable; the caller then spawns `git`.
 * The base checkout's branch is `commonDir/HEAD`: a linked worktree's common
 * dir IS the main working tree's git dir.
 */
function ladderFromFiles(worktreePath: string): Ladder | undefined {
  const dirs = resolveGitDirs(worktreePath)
  if (!dirs) return undefined
  const originHead = readRefSymbolic(dirs, "refs/remotes/origin/HEAD")?.replace(/^refs\/remotes\//, "")
  const baseCheckout = readRefSymbolic({ gitDir: dirs.commonDir, commonDir: dirs.commonDir }, "HEAD")?.replace(
    /^refs\/heads\//,
    "",
  )
  const names: string[] = []
  const head = readHeadSha(dirs)
  const parts: string[] = [`HEAD=${head}`]
  for (const guess of [
    ...(originHead ? [originHead] : []),
    ...DEFAULT_BASE_REF_CANDIDATES,
    ...(baseCheckout ? [baseCheckout] : []),
  ]) {
    if (names.includes(guess)) continue
    const sha = readRefSha(dirs, guess)
    if (sha === null) continue
    names.push(guess)
    parts.push(`${guess}=${sha}`)
  }
  return { names, fingerprint: head === null ? null : parts.join(",") }
}

/** The same list, for a worktree whose git dirs will not read. */
async function ladderFromGit(worktreePath: string, signal: AbortSignal): Promise<Ladder> {
  const head = await git(worktreePath, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], signal)
  const originHead = head.status === 0 ? head.stdout.trim() : ""
  const baseCheckout = await baseCheckoutBranchFromGit(worktreePath, signal)
  const names: string[] = []
  const candidates = [
    ...(originHead ? [originHead] : []),
    ...DEFAULT_BASE_REF_CANDIDATES,
    ...(baseCheckout ? [baseCheckout] : []),
  ]
  for (const guess of candidates) {
    if (names.includes(guess)) continue
    if (await refExists(worktreePath, guess, signal)) names.push(guess)
  }
  return { names, fingerprint: null }
}

/**
 * The task's RECORDED fork point when it resolves, else the cached ladder.
 * `null` = nothing resolves; callers report no drift, not a fabricated zero.
 * A recorded ref is NOT cached: keyed by worktree path it would be wrong for
 * a path two tasks share.
 */
export async function resolveBaseRefCached(
  worktreePath: string,
  recordedBaseRef: string | undefined,
  signal: AbortSignal,
  now: number = Date.now(),
): Promise<string | null> {
  // A recorded ref found in the ref files needs no spawn; NOT finding it
  // proves nothing (it could be a tag or a sha), so that falls back.
  if (recordedBaseRef) {
    const dirs = resolveGitDirs(worktreePath)
    if (dirs && readRefSha(dirs, recordedBaseRef) !== null) return recordedBaseRef
    if (await refExists(worktreePath, recordedBaseRef, signal)) return recordedBaseRef
  }
  const hit = cache.get(worktreePath)
  if (hit && now - hit.at < BASE_REF_TTL_MS) return hit.ref
  const ladder = ladderFromFiles(worktreePath) ?? (await ladderFromGit(worktreePath, signal))
  // Same fingerprint = same `merge-base` verdicts (including "none"); renew
  // without spawning. A new candidate changes the fingerprint.
  if (hit && ladder.fingerprint !== null && hit.fingerprint === ladder.fingerprint) {
    cache.set(worktreePath, { ...hit, at: now })
    return hit.ref
  }
  let ref: string | null = null
  for (const candidate of ladder.names) {
    if (await sharesHistory(worktreePath, candidate, signal)) {
      ref = candidate
      break
    }
  }
  cache.set(worktreePath, { ref, at: now, fingerprint: ladder.fingerprint })
  return ref
}
