/**
 * Daemon-side worktree-changes collector.
 *
 * Before this, EVERY pane process polled `git status` itself for the
 * sidebar's per-row `+N −M` chips (`tui/panes/sidebar/worktree-changes-poller.ts`
 * riding `tui/lib/background-poll.ts`) — N panes × M tasks of duplicated
 * background subprocesses doing identical work. The daemon is now the
 * SINGLE collector: one guarded `git status --porcelain=v1` per local
 * worktree, fanned out on the `worktree.changes` channel. Panes render
 * the pushes and spawn ZERO git processes while daemon-connected; the
 * pane-local poller survives only as the no-daemon fallback.
 *
 * The scheduling guards are the SAME ones the TUI poller uses against
 * huge-repo `git status` stalls (shared via `@/lib/poll-scheduling`, extracted from background-poll so
 * the daemon doesn't import the TUI's solid-js signal layer):
 *
 *   - **in-flight dedupe** — one `git status` per worktree at a time;
 *     ticks landing mid-run are dropped.
 *   - **timeout + SIGKILL** — a status walk exceeding
 *     {@link WORKTREE_CHANGES_TIMEOUT_MS} is aborted and the child killed.
 *   - **hard backoff** — a timed-out worktree is left alone for
 *     {@link WORKTREE_CHANGES_SLOW_RETRY_MS} (the repo is too big to poll
 *     at tick cadence).
 *   - **adaptive cadence** — the next run waits
 *     `max(minIntervalMs, 5 × last duration)`, so slow-but-finishing
 *     repos self-thin without a special case.
 *
 * Collection scope: every task with a LOCAL worktree. Remote (`ssh://`)
 * projects are skipped — their worktrees aren't on this filesystem.
 * Deleted tasks' entries DROP from the published map on the next
 * tick. `main` tasks collect like any other (worktreePath = repo root —
 * the PROJECTS rows show the same chip); tasks sharing a worktree path
 * (main rows of the same repo) dedupe naturally on the path key.
 *
 * Publish contract: the FULL map, republished only when membership or a
 * value actually changed — the bus's last-value replay then hands a late
 * subscriber the whole picture in one frame, and unchanged ticks cost
 * subscribers nothing. Reads are `GIT_OPTIONAL_LOCKS=0` (inspect, don't
 * write — never take `.git/index.lock` from under the engine's own
 * commits) and best-effort: a failed/timed-out run keeps the entry's last
 * value, never throws, never publishes garbage.
 */

import { spawn } from "node:child_process"
import type { DaemonTask as Task, WorktreeChanges } from "./contracts.ts"
import { logDaemonError } from "./crash-log.ts"
import type { DaemonEventBus } from "./event-bus.ts"
import { type PollCadenceConfig, type PollScheduleState, maybeStartScheduledRun } from "./poll-scheduling.ts"
import type { WorktreeChangesPayload } from "./protocol.ts"
import type { DaemonRuntimeAdapter } from "./runtime.ts"
import { startTicker } from "./ticker.ts"

function isRemoteRepoKey(value: string): boolean {
  return value.startsWith("ssh://")
}

function sameWorktreeChanges(a: WorktreeChanges, b: WorktreeChanges): boolean {
  return a.added === b.added && a.deleted === b.deleted && a.behind === b.behind
}

/** Tick cadence — matches the sidebar's ~2s `branchTick` the pane pollers rode. */
export const DEFAULT_WORKTREE_CHANGES_TICK_MS = 2_000
/** Kill a `git status` that runs longer than this; the repo is too big to poll. */
export const WORKTREE_CHANGES_TIMEOUT_MS = 4_000
/** After a timeout, leave the worktree alone for this long before retrying. */
export const WORKTREE_CHANGES_SLOW_RETRY_MS = 60_000
/** Floor between successful polls per worktree. */
export const WORKTREE_CHANGES_MIN_INTERVAL_MS = 1_500

/** The task-list slice the collector needs — `Orchestrator` satisfies it. */
export interface TaskLister {
  listTasks(): readonly Task[]
}

/**
 * Injectable status runner (tests swap the real `git status` out). Throw /
 * reject to keep the entry's last value.
 */
export type WorktreeStatusRunner = (
  worktreePath: string,
  signal: AbortSignal,
  /** The owning task's RECORDED base ref (`add --base-branch`), when it has
   *  one. The runner falls back to its own resolution when this is absent or
   *  no longer resolves — an honest guess beats a stale certainty. */
  baseRef?: string,
) => Promise<WorktreeChanges>

/** One lock-free `git` read in a worktree; null stdout on any non-zero exit. */
function runGit(worktreePath: string, args: readonly string[], signal: AbortSignal): Promise<string | null> {
  return new Promise((resolve) => {
    let stdout = ""
    let settled = false
    const finish = (status: number | null) => {
      if (settled) return
      settled = true
      resolve(status === 0 ? stdout : null)
    }
    const child = spawn("git", args.slice(), {
      cwd: worktreePath,
      stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      signal,
      killSignal: "SIGKILL",
    })
    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += String(chunk)
    })
    child.on("error", () => finish(null))
    child.on("close", finish)
  })
}

/**
 * How far the worktree is BEHIND `baseRef`. `null` when the ref does not
 * resolve or the count is unreadable — the chip then does not draw, which is
 * the honest answer for a repo with no base rather than a fabricated zero.
 *
 * The daemon does NOT own the `origin/HEAD → origin/main → main → master`
 * fallback ladder: that lives in kobe's `cli/api/branch-signals.ts`, and the
 * PRODUCTION runner is kobe's `runtime.runWorktreeStatus`, which resolves it
 * before calling in. This default runner (tests, and any daemon wired without
 * a runtime) only measures against a base it was handed.
 */
async function countBehind(worktreePath: string, baseRef: string, signal: AbortSignal): Promise<number | null> {
  const out = await runGit(worktreePath, ["rev-list", "--count", `HEAD..${baseRef}`], signal)
  if (out === null) return null
  const n = Number.parseInt(out.trim(), 10)
  return Number.isInteger(n) && n >= 0 ? n : null
}

/** Aggregate `git status --porcelain=v1` output into `+N −M`. */
export function countPorcelain(stdout: string): { added: number; deleted: number } {
  let added = 0
  let deleted = 0
  for (const line of stdout.split("\n")) {
    if (line.length < 3 || line.startsWith("##")) continue
    if (line[0] === "D" || line[1] === "D") deleted++
    else added++
  }
  return { added, deleted }
}

/** The default runner: async `git status --porcelain=v1`, lock-free read,
 *  plus the behind-count when a base ref was supplied. */
export async function runGitStatus(
  worktreePath: string,
  signal: AbortSignal,
  baseRef?: string,
): Promise<WorktreeChanges> {
  const stdout = await runGit(worktreePath, ["status", "--porcelain=v1"], signal)
  if (stdout === null) throw new Error("git status failed")
  const counts = countPorcelain(stdout)
  if (!baseRef) return counts
  const behind = await countBehind(worktreePath, baseRef, signal)
  return behind === null ? counts : { ...counts, behind }
}

/**
 * The worktree paths the collector tracks: tasks with a
 * non-empty LOCAL worktree. Remote (`ssh://`) projects are excluded by
 * repo key — their worktrees live on another host. Pure — unit-tested.
 * Returns a Map of path → the owning task's recorded base ref, so tasks
 * sharing a path (e.g. `main` rows whose worktreePath is the repo root)
 * collapse to one collection slot.
 */
export function trackedWorktreePaths(tasks: readonly Task[]): Map<string, string | undefined> {
  const paths = new Map<string, string | undefined>()
  for (const task of tasks) {
    if (!task.worktreePath) continue
    if (isRemoteRepoKey(task.repo) || isRemoteRepoKey(task.worktreePath)) continue
    // Tasks sharing a path collapse to one slot, and the first one that
    // RECORDS a base ref wins it: `get` returning undefined covers both
    // "not seen yet" and "seen, but it had no base", so a `main` row (which
    // records none) cannot erase a based task's answer whichever order they
    // list in.
    if (paths.get(task.worktreePath) === undefined) paths.set(task.worktreePath, task.baseRef)
  }
  return paths
}

interface CollectorEntry extends PollScheduleState {
  /** Last successful counts, absent until the first run lands. */
  value?: WorktreeChanges
}

export interface WorktreeChangesCollectorOptions {
  readonly cadence?: PollCadenceConfig
  /** Injectable status runner — tests avoid real git/worktrees. */
  readonly run?: WorktreeStatusRunner
  /**
   * Consumer gate (KOB — idle-daemon collector pause). When supplied and it
   * returns `false`, `tick()` does NO work (no `git status` spawns, no
   * publish) — a gui-less `kobe daemon start` / freshly-respawned `daemon
   * restart` with zero subscribed panes must not run N git walks every 2s
   * for nobody. The timer keeps ticking, so the FIRST tick after a pane
   * subscribes repopulates, and the bus's last-value replay hands that late
   * subscriber the current map. Omit (or return `true`) to collect every
   * tick — what tests that drive `tick()` directly use.
   */
  readonly hasSubscribers?: () => boolean
}

/**
 * Tick-driven collector. `tick()` is synchronous and never throws: it
 * prunes entries for worktrees the daemon stopped tracking (deleted/remote
 * tasks), starts guarded status runs for due worktrees, and
 * publishes the full map when — and only when — membership or a value
 * changed. Run completions publish as they land (each is a real change
 * by construction). Exposed as a class so tests drive `tick()` directly
 * with a fake lister/bus/runner; `startWorktreeChangesCollector` is the
 * production interval binding.
 */
export class WorktreeChangesCollector {
  private readonly entries = new Map<string, CollectorEntry>()
  private stopped = false

  constructor(
    private readonly orch: TaskLister,
    private readonly bus: DaemonEventBus,
    private readonly options: WorktreeChangesCollectorOptions = {},
  ) {}

  tick(): void {
    if (this.stopped) return
    // Consumer gate: with zero subscribed panes there is nobody to render
    // the counts, so skip the whole pass — no git spawns, no publish. The
    // first tick once a pane subscribes repopulates the map and the bus
    // replays it to the late subscriber.
    if (this.options.hasSubscribers && !this.options.hasSubscribers()) return
    try {
      const tracked = trackedWorktreePaths(this.orch.listTasks())
      // Prune first: a task deleted since the last tick drops its
      // entry — and, when it had published counts, triggers a republish so
      // subscribers stop showing it.
      let pruned = false
      for (const path of this.entries.keys()) {
        if (tracked.has(path)) continue
        const entry = this.entries.get(path)
        // An in-flight run for a pruned path finishes into a dropped entry
        // object — its completion checks membership before publishing.
        if (entry?.value) pruned = true
        this.entries.delete(path)
      }
      if (pruned) this.publish()
      for (const [path, baseRef] of tracked) this.maybeCollect(path, baseRef)
    } catch (err) {
      logDaemonError("worktree-changes", err)
    }
  }

  /** Stop publishing; in-flight children die with their AbortSignal timers. */
  stop(): void {
    this.stopped = true
  }

  private maybeCollect(worktreePath: string, baseRef?: string): void {
    let entry = this.entries.get(worktreePath)
    if (!entry) {
      entry = { inFlight: false, nextAllowedAt: 0 }
      this.entries.set(worktreePath, entry)
    }
    const cadence = this.options.cadence ?? {
      timeoutMs: WORKTREE_CHANGES_TIMEOUT_MS,
      slowRetryMs: WORKTREE_CHANGES_SLOW_RETRY_MS,
      minIntervalMs: WORKTREE_CHANGES_MIN_INTERVAL_MS,
    }
    const run = this.options.run ?? runGitStatus
    maybeStartScheduledRun(
      entry,
      cadence,
      (signal) => run(worktreePath, signal, baseRef),
      (value) => {
        if (this.stopped) return
        // The entry may have been pruned (task deleted) while the
        // status ran — a completion for an untracked path must not resurrect
        // it in the published map.
        if (this.entries.get(worktreePath) !== entry) return
        // Publish-on-change only: a status returning the same counts is a
        // no-op for every subscriber.
        if (entry.value && sameWorktreeChanges(entry.value, value)) return
        entry.value = value
        this.publish()
      },
    )
  }

  private publish(): void {
    const changes: WorktreeChangesPayload["changes"] = {}
    for (const [path, entry] of this.entries) {
      if (entry.value) changes[path] = entry.value
    }
    this.bus.publish("worktree.changes", { changes })
  }
}

/**
 * Start the production collector on an interval. Returns a `stop()` that
 * clears the timer. Pass `tickMs <= 0` to disable (returns a no-op stop) —
 * the same disable convention as the server's other pollers; socket-suite
 * tests use it to keep servers git-free.
 *
 * `hasSubscribers` is the consumer gate (KOB — idle-daemon collector
 * pause): each tick is a no-op while it returns `false`, so a gui-less
 * daemon with zero subscribed panes stops spawning `git status` for
 * nobody. The interval keeps running, so the first tick after a pane
 * subscribes repopulates the cache. Omit to collect unconditionally.
 */
export function startWorktreeChangesCollector(
  orch: TaskLister,
  runtime: Pick<DaemonRuntimeAdapter, "runWorktreeStatus">,
  bus: DaemonEventBus,
  tickMs: number = DEFAULT_WORKTREE_CHANGES_TICK_MS,
  hasSubscribers?: () => boolean,
): () => void {
  const collector = new WorktreeChangesCollector(orch, bus, { hasSubscribers, run: runtime.runWorktreeStatus })
  // No `gate` here: the subscriber check lives inside `collector.tick()`,
  // which also owns its own per-key in-flight state.
  return startTicker({
    name: "worktree-changes-collector",
    tickMs,
    immediate: true,
    run: () => collector.tick(),
    onStop: () => collector.stop(),
  })
}
