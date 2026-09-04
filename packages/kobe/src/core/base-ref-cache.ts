/**
 * Async, cached base-ref resolution for the daemon's per-worktree polls.
 *
 * `cli/api/branch-signals.ts` owns the ladder itself (`origin/HEAD` →
 * `origin/main` → `origin/master` → `main` → `master`, then the base
 * checkout's own branch) but resolves it with `spawnSync`, which is correct
 * for a one-shot CLI read and wrong on the daemon's 2-second tick: several
 * synchronous `git` calls per worktree per tick would block the daemon's
 * event loop for every other client. So this is the same ladder, spawned
 * asynchronously and MEMOISED — a worktree's base ref does not move between
 * ticks.
 *
 * The cache has a TTL rather than being permanent: a repo that gains an
 * `origin` remote, or whose base branch is renamed, has to be able to start
 * reporting drift without a daemon restart. A negative answer (no base
 * resolves at all) is cached too, for the same TTL — otherwise a repo with no
 * remote pays the full ladder every tick forever.
 *
 * Even once per TTL, the ladder is not free: 19 worktrees paid 75 `git`
 * processes (one `symbolic-ref` + three `rev-parse` each) every five
 * minutes. The candidates it probes are all plain branch names, so it reads
 * the ref FILES instead — loose refs, then `packed-refs` — and only falls
 * back to spawning when the worktree's git dirs are unreadable. A RECORDED
 * base ref keeps its `rev-parse` fallback: the user may have passed a tag or
 * a sha, which a ref-file read cannot disprove.
 *
 * ## Why a candidate that resolves is not yet a base
 *
 * Two branches can both exist and share no history at all — an abandoned
 * orphan `main` beside a live `develop` is the shape that produced this
 * check. Taking the first candidate that merely RESOLVES makes the sidebar's
 * drift chip count against a branch that never touched the work. So each
 * candidate must survive `git merge-base <ref> HEAD`, and that answer cannot
 * be read out of a ref file.
 *
 * The spawn is paid for by the memo instead of by the tick. A verdict can
 * only change when HEAD or one of the candidate refs moves, so the entry
 * carries the FINGERPRINT it was reached on (HEAD's sha plus every resolving
 * candidate's name and sha, all read from files). On TTL expiry the
 * fingerprint is re-read for free; when it matches and the cached answer came
 * off the ladder, the entry is simply renewed. Steady state at 19 idle
 * worktrees is therefore the same zero spawns as before — one `merge-base`
 * is paid per worktree per HEAD-or-base movement, which is the same moment
 * `behind-cache.ts` re-spawns the drift count anyway.
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

/** How long a resolution (including "none") is trusted.
 *  Test seam — `test/core/base-ref-cache.test.ts` steps time across it to
 *  prove an idle renewal spawns nothing. Keep exported. */
export const BASE_REF_TTL_MS = 5 * 60_000

interface Entry {
  readonly ref: string | null
  readonly at: number
  /**
   * HEAD + resolving candidates, as read from ref files, at the moment the
   * `merge-base` verdicts behind `ref` were taken. `null` when the git dirs
   * were unreadable, which never matches and so never skips re-resolution.
   */
  readonly fingerprint: string | null
}

const cache = new Map<string, Entry>()

/** Test seam — the daemon keeps one process-wide cache, so
 *  `test/core/base-ref-cache.test.ts` has to clear it between fixtures.
 *  Keep exported: knip cannot see the test's use of it. */
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
 * The branch the BASE CHECKOUT is on, for a worktree whose git dirs will not
 * read — the same question `land` asks before it merges. `git worktree list
 * --porcelain` names the main working tree in its first record. Null when
 * that record has no branch (a detached base checkout) or the read fails.
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
  /** Resolving ladder candidates, in ladder order, then the base checkout's
   *  branch — the whole ordered list `merge-base` is asked about. */
  readonly names: string[]
  /** HEAD + every name's sha. `null` when any of them would not read, which
   *  never matches a stored fingerprint and so never skips re-resolution. */
  readonly fingerprint: string | null
}

/**
 * The ladder read from ref files. Returns `undefined` — distinct from an
 * empty list, which means "nothing to measure against" — when the worktree's
 * git dirs cannot be resolved, which is the caller's signal to spawn `git`.
 *
 * `refs/remotes/origin/HEAD` is a symref file (`ref: refs/remotes/origin/x`)
 * or a `packed-refs` entry; both are read here rather than through
 * `git symbolic-ref`. The base checkout's branch is `commonDir/HEAD` — a
 * linked worktree's common dir IS the main working tree's git dir, so that
 * file holds the same branch `git worktree list --porcelain` reports in its
 * first record.
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
 * The base to measure this worktree against: the task's RECORDED fork point
 * when it still resolves, else the cached ladder. `null` when nothing
 * resolves — callers then report no drift rather than a fabricated zero.
 *
 * A recorded ref is verified but NOT cached: it is per-task, cheap (one
 * `rev-parse`), and caching it under the worktree path would be wrong for a
 * path two tasks share.
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
  // Renewal without spawning: the same HEAD against the same refs gives the
  // same `merge-base` verdicts, so an answer taken on this exact fingerprint
  // still holds — including "none resolved", which a repo with no remote
  // would otherwise re-probe every TTL forever. A repo that GAINS a candidate
  // (a new `origin` remote, a renamed base) changes the fingerprint, which is
  // what the TTL was there to catch.
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
