/**
 * Git-HEAD poller for the sidebar's main-task rows' live branch hint
 * (`○ kobe   main`), computed at display time so an external checkout shows
 * on the next render.
 *
 * Async via `background-poll.ts`: even an O(1) ref-read spawnSync per row
 * per ~2s tick blocks the render thread on slow disk/NFS. Yields
 * `(detached)` for detached HEAD, `""` (hint skipped) for any failure.
 * Never throws — the sidebar must always render, which is why this doesn't
 * reuse the orchestrator's `currentBranch` (throws on detached HEAD).
 */

import { stat } from "node:fs/promises"
import { join } from "node:path"
import { readOnlyGitProcessEnv } from "@/lib/git-env"
import { recordSpawn } from "@/lib/spawn-profile"
import { createBackgroundPoller, spawnCapture } from "../../lib/background-poll"

/** Kill a ref read that runs longer than this — O(1) commands, tight leash. */
const BRANCH_POLL_TIMEOUT_MS = 2_000
/** After a timeout, leave the repo alone for this long before retrying. */
const BRANCH_SLOW_RETRY_MS = 30_000
/** Floor between successful polls — matches the sidebar's ~2s tick. */
const BRANCH_MIN_POLL_INTERVAL_MS = 1_500

/**
 * Per-repo `.git/HEAD` mtime+size cache: the branch name is a pure function
 * of HEAD (checkout rewrites it, commits don't), so an unchanged fingerprint
 * skips the spawn. Without it, 5 projects ≈ 150 spawns/min steady state;
 * with it, one ~µs `stat` per row per tick. Unstatable HEAD (linked-worktree
 * `.git` file, permissions) always spawns.
 */
const headCache = new Map<string, { fingerprint: string; value: string }>()

async function headFingerprint(repo: string): Promise<string | null> {
  try {
    const st = await stat(join(repo, ".git", "HEAD"))
    return `${st.mtimeMs}:${st.size}`
  } catch {
    return null
  }
}

/** Resolve `repo`'s short branch name. Exported (with injectable `spawn`)
 *  for tests; render code goes through the poller. */
export async function resolveBranchHead(
  repo: string,
  signal: AbortSignal,
  spawn: typeof spawnCapture = spawnCapture,
): Promise<string> {
  // Fingerprint before the spawn, so a mid-resolve HEAD change mismatches
  // next tick and re-resolves.
  const fingerprint = await headFingerprint(repo)
  if (fingerprint !== null) {
    const cached = headCache.get(repo)
    if (cached && cached.fingerprint === fingerprint) return cached.value
  }
  // symbolic-ref, not `rev-parse --abbrev-ref`: it exits non-zero on
  // detached HEAD instead of printing `HEAD`.
  let value = ""
  // Only a genuine resolve is cached: a timed-out "" against a valid
  // fingerprint would blank the label forever.
  let resolved = false
  recordSpawn("sidebar.gitHead", ["git", "symbolic-ref", "--short", "HEAD"], repo)
  const ref = await spawn("git", ["symbolic-ref", "--short", "HEAD"], {
    cwd: repo,
    env: readOnlyGitProcessEnv(),
    signal,
  })
  const name = ref.status === 0 ? ref.stdout.trim() : ""
  if (name && name !== "HEAD") {
    value = name
    resolved = true
  } else {
    // Confirm detached so an unreadable repo isn't mislabelled.
    const head = await spawn("git", ["rev-parse", "--verify", "HEAD"], {
      cwd: repo,
      env: readOnlyGitProcessEnv(),
      signal,
    })
    if (head.status === 0) {
      value = "(detached)"
      resolved = true
    }
  }
  if (resolved && fingerprint !== null) headCache.set(repo, { fingerprint, value })
  return value
}

const poller = createBackgroundPoller<string>({
  initial: "",
  timeoutMs: BRANCH_POLL_TIMEOUT_MS,
  slowRetryMs: BRANCH_SLOW_RETRY_MS,
  minIntervalMs: BRANCH_MIN_POLL_INTERVAL_MS,
  run: (repo, signal) => resolveBranchHead(repo, signal),
})

/** Last known branch, `"(detached)"`, or `""` until a poll lands / on failure. */
export function currentBranch(repo: string): string {
  return poller.read(repo)
}

/** Maybe start an async read; safe every tick (dedupe + interval floor). */
export function pollCurrentBranch(repo: string): void {
  poller.poll(repo)
}

/** Test hook: drop all cached entries/backoff state. */
export function resetGitHeadPoller(): void {
  poller.reset()
  headCache.clear()
}
