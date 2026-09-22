/**
 * Daemon-side worktree-changes collector: the single `git status
 * --porcelain=v1` per local worktree behind the sidebar's `+N −M` chips,
 * fanned out on `worktree.changes`. Daemon-connected panes spawn zero git
 * processes; the pane-local poller is only the no-daemon fallback.
 *
 * Guards against a SLOW repo (shared via `poll-scheduling`):
 *   - **in-flight dedupe** — one `git status` per worktree; mid-run ticks drop.
 *   - **timeout + SIGKILL** at {@link WORKTREE_CHANGES_TIMEOUT_MS}.
 *   - **hard backoff** — a timed-out worktree waits {@link WORKTREE_CHANGES_SLOW_RETRY_MS}.
 *   - **adaptive cadence** — next run waits `max(minIntervalMs, 5 × last duration)`.
 *
 * Guard against an UNCHANGED repo (19 idle tasks measured 1280 `git`
 * processes and 14.7s CPU per 62s to publish 19 frames):
 *   - **quiet backoff** — `worktreeFingerprint` stats the git files a change
 *     would touch; while unmoved and no engine is working there, the poll
 *     relaxes to {@link WORKTREE_CHANGES_QUIET_INTERVAL_MS}. The fingerprint
 *     cannot see a NESTED edit (measured, see worktree-probe.ts), so it is an
 *     accelerator, never an authority; unreadable falls through to a real poll.
 *
 * Scope: tasks with a LOCAL worktree (`ssh://` skipped). Deleted tasks drop
 * on the next tick; tasks sharing a path (`main` rows) dedupe on the path key.
 *
 * Publish contract: the FULL map, only when membership or a value changed, so
 * the bus's last-value replay gives a late subscriber everything in one frame.
 * Reads use `GIT_OPTIONAL_LOCKS=0` (never take `.git/index.lock` from under
 * the engine's commits); a failed/timed-out run keeps the last value.
 */

import type { DaemonTask as Task, WorktreeChanges } from "./contracts.ts"
import { logDaemonError } from "./crash-log.ts"
import type { DaemonEventBus } from "./event-bus.ts"
import { type PollCadenceConfig, type PollScheduleState, maybeStartScheduledRun } from "./poll-scheduling.ts"
import type { WorktreeChangesPayload } from "./protocol.ts"
import type { DaemonRuntimeAdapter } from "./runtime.ts"
import { startTicker } from "./ticker.ts"
import { runGitStatus } from "./worktree-status-runner.ts"
export { runGitStatus, parseAheadBehind, countPorcelain, type AheadBehind } from "./worktree-status-runner.ts"
import { worktreeFingerprint } from "./worktree-probe.ts"

/** Shared empty set — avoids allocating one per tick per collector. */
const EMPTY_PATHS: ReadonlySet<string> = new Set<string>()

function isRemoteRepoKey(value: string): boolean {
  return value.startsWith("ssh://")
}

function sameWorktreeChanges(a: WorktreeChanges, b: WorktreeChanges): boolean {
  // Every published field must be compared, or its chip freezes at the first read.
  return a.added === b.added && a.deleted === b.deleted && a.behind === b.behind && a.ahead === b.ahead
}

/** Tick cadence — matches the sidebar's ~2s `branchTick` the pane pollers rode. */
export const DEFAULT_WORKTREE_CHANGES_TICK_MS = 2_000
/** Bound filesystem and git pressure across the entire collector, not per path. */
export const WORKTREE_CHANGES_CONCURRENCY = 4
/** Kill a `git status` that runs longer than this; the repo is too big to poll. */
export const WORKTREE_CHANGES_TIMEOUT_MS = 4_000
/** After a timeout, leave the worktree alone for this long before retrying. */
export const WORKTREE_CHANGES_SLOW_RETRY_MS = 60_000
/** Floor between successful polls per worktree. */
export const WORKTREE_CHANGES_MIN_INTERVAL_MS = 1_500
/**
 * Poll floor for a quiet-probe, engine-idle worktree: the safety net under
 * {@link worktreeFingerprint} and that worktree's WORST-CASE staleness. A
 * moved fingerprint or a working engine drops it to
 * {@link WORKTREE_CHANGES_MIN_INTERVAL_MS} on the next tick.
 *
 * Measured: at a 15s floor an idle fleet forked 18 `git status` per worktree
 * per 5 minutes (same at 20 and 50 worktrees; ~3600 at 200). A minute costs a
 * third of that. Working engines are exempt (flagged within ~10s) and
 * ahead/behind rides ref files the fingerprint sees, so only a hand-made file
 * in a subdirectory of an engine-idle worktree can lag up to a minute.
 */
export const WORKTREE_CHANGES_QUIET_INTERVAL_MS = 60_000

/** The task-list slice the collector needs — `Orchestrator` satisfies it. */
export interface TaskLister {
  listTasks(): readonly Task[]
}

/** Injectable status runner. Throw / reject to keep the entry's last value. */
export type WorktreeStatusRunner = (
  worktreePath: string,
  signal: AbortSignal,
  /** The task's recorded base ref (`add --base-branch`); the runner resolves
   *  its own when absent or no longer resolving. */
  baseRef?: string,
) => Promise<WorktreeChanges>

/**
 * Tracked paths (non-empty LOCAL worktrees; `ssh://` excluded) → the owning
 * task's recorded base ref. Tasks sharing a path collapse to one slot.
 */
export function trackedWorktreePaths(tasks: readonly Task[]): Map<string, string | undefined> {
  const paths = new Map<string, string | undefined>()
  for (const task of tasks) {
    if (!task.worktreePath) continue
    if (isRemoteRepoKey(task.repo) || isRemoteRepoKey(task.worktreePath)) continue
    // First task that RECORDS a base ref wins: `get` === undefined covers "not
    // seen" and "seen, no base", so a `main` row can't erase it in any order.
    if (paths.get(task.worktreePath) === undefined) paths.set(task.worktreePath, task.baseRef)
  }
  return paths
}

/** A failed `git status`, published as UNREADABLE rather than omitted (an
 *  absent key reads as clean). Returned, not thrown, because `onValue` never
 *  fires for a rejected run. */
const UNREADABLE = Symbol("worktree-changes-unreadable")

interface CollectorEntry extends PollScheduleState {
  /** Last successful counts, absent until the first run lands. */
  value?: WorktreeChanges | typeof UNREADABLE
  /** Change fingerprint sampled when the last run STARTED (before it, so a
   *  write landing mid-run is not swallowed). `null` = it was unreadable. */
  probe?: string | null
  /** When a poll must happen even while the probe stays quiet. */
  quietUntil?: number
}

export interface WorktreeChangesCollectorOptions {
  readonly publishDelayMs?: number
  readonly cadence?: PollCadenceConfig
  /** Injectable status runner — tests avoid real git/worktrees. */
  readonly run?: WorktreeStatusRunner
  /**
   * Consumer gate: while it returns `false`, `tick()` does no work (no spawns,
   * no publish) so a daemon with zero subscribed panes doesn't walk git for
   * nobody. The first tick after a pane subscribes repopulates. Omit to
   * collect every tick.
   */
  readonly hasSubscribers?: () => boolean
  /**
   * Task ids whose engine is working; their worktrees skip quiet backoff,
   * since an engine writing `src/**` is exactly the nested case the probe
   * can't see. Omit to treat every worktree as idle.
   */
  readonly activeTaskIds?: () => Iterable<string>
  /** Poll floor for a quiet, engine-idle worktree. Tests shrink it. */
  readonly quietIntervalMs?: number
  /** Change probe (tests inject); defaults to {@link worktreeFingerprint}. */
  readonly probe?: (worktreePath: string, baseRef?: string) => string | null
}

/**
 * `tick()` is synchronous and never throws: prunes untracked worktrees,
 * starts guarded runs for due ones, and publishes (batched over a short
 * timer) only when membership or a value changed.
 */
export class WorktreeChangesCollector {
  private readonly entries = new Map<string, CollectorEntry>()
  private stopped = false
  private readonly queued = new Map<string, { baseRef?: string; busy: boolean }>()
  private active = 0
  private readonly activePaths = new Set<string>()
  private drainHandle: ReturnType<typeof setImmediate> | undefined
  private publishTimer: ReturnType<typeof setTimeout> | undefined
  private readonly controllers = new Set<AbortController>()

  constructor(
    private readonly orch: TaskLister,
    private readonly bus: DaemonEventBus,
    private readonly options: WorktreeChangesCollectorOptions = {},
  ) {}

  tick(): void {
    if (this.stopped) return
    if (this.options.hasSubscribers && !this.options.hasSubscribers()) return
    try {
      const tasks = this.orch.listTasks()
      const tracked = trackedWorktreePaths(tasks)
      // A pruned entry that had published counts forces a republish.
      let pruned = false
      for (const path of this.entries.keys()) {
        if (tracked.has(path)) continue
        const entry = this.entries.get(path)
        // An in-flight run for a pruned path checks membership before publishing.
        if (entry?.value) pruned = true
        this.entries.delete(path)
        this.queued.delete(path)
      }
      for (const path of this.queued.keys()) if (!tracked.has(path)) this.queued.delete(path)
      if (pruned) this.publish()
      const busy = this.busyPaths(tasks)
      for (const [path, baseRef] of tracked) {
        if (!this.entries.get(path)?.inFlight) this.queued.set(path, { baseRef, busy: busy.has(path) })
      }
      this.drain()
    } catch (err) {
      logDaemonError("worktree-changes", err)
    }
  }

  /** Cancel queued work, abort running children and suppress late publications. */
  stop(): void {
    this.stopped = true
    this.queued.clear()
    if (this.drainHandle) clearImmediate(this.drainHandle)
    if (this.publishTimer) clearTimeout(this.publishTimer)
    for (const controller of this.controllers) controller.abort()
  }

  private drain(): void {
    if (this.stopped || this.options.hasSubscribers?.() === false) return
    const limit = WORKTREE_CHANGES_CONCURRENCY
    for (const [path, demand] of this.queued) {
      if (this.active >= limit) break
      if (this.activePaths.has(path)) continue
      this.queued.delete(path)
      try {
        this.maybeCollect(path, demand.baseRef, demand.busy)
      } catch (err) {
        logDaemonError("worktree-changes", err)
      }
    }
  }

  private runFinished(path: string): void {
    this.active--
    this.activePaths.delete(path)
    if (this.stopped || this.drainHandle) return
    this.drainHandle = setImmediate(() => {
      this.drainHandle = undefined
      this.drain()
    })
  }

  /** Worktrees whose task has a working engine — exempt from quiet backoff. */
  private busyPaths(tasks: readonly Task[]): ReadonlySet<string> {
    const ids = this.options.activeTaskIds?.()
    if (!ids) return EMPTY_PATHS
    const active = new Set(ids)
    if (active.size === 0) return EMPTY_PATHS
    const paths = new Set<string>()
    for (const task of tasks) if (task.worktreePath && active.has(task.id)) paths.add(task.worktreePath)
    return paths
  }

  private maybeCollect(worktreePath: string, baseRef?: string, busy = false): void {
    let entry = this.entries.get(worktreePath)
    if (!entry) {
      entry = { inFlight: false, nextAllowedAt: 0 }
      this.entries.set(worktreePath, entry)
    }
    // Skip only when the probe read cleanly, matches the last run's start, no
    // engine is busy, and the safety poll isn't due. First tick, `null`
    // probe, or a moved fingerprint all poll.
    const now = Date.now()
    const probe = (this.options.probe ?? worktreeFingerprint)(worktreePath, baseRef)
    const quietUntil = entry.quietUntil ?? 0
    if (!busy && probe !== null && probe === entry.probe && now < quietUntil) return
    const quietIntervalMs = this.options.quietIntervalMs ?? WORKTREE_CHANGES_QUIET_INTERVAL_MS
    const cadence = this.options.cadence ?? {
      timeoutMs: WORKTREE_CHANGES_TIMEOUT_MS,
      slowRetryMs: WORKTREE_CHANGES_SLOW_RETRY_MS,
      minIntervalMs: WORKTREE_CHANGES_MIN_INTERVAL_MS,
    }
    const run = this.options.run ?? runGitStatus
    maybeStartScheduledRun(
      entry,
      cadence,
      (signal) => {
        // Recorded only once a run actually starts; a fingerprint for a
        // declined run would suppress the next one.
        entry.probe = probe
        entry.quietUntil = Date.now() + quietIntervalMs
        // A failed status resolves UNREADABLE (a rejection would drop the path,
        // which draws as clean). A TIMEOUT still rejects, so a slow repo keeps
        // its last value and backs off.
        this.active++
        this.activePaths.add(worktreePath)
        const controller = new AbortController()
        this.controllers.add(controller)
        const abort = () => controller.abort()
        signal.addEventListener("abort", abort, { once: true })
        return (async () => {
          try {
            return await run(worktreePath, controller.signal, baseRef)
          } catch {
            return UNREADABLE
          } finally {
            signal.removeEventListener("abort", abort)
            this.controllers.delete(controller)
            this.runFinished(worktreePath)
          }
        })()
      },
      (value) => {
        if (this.stopped) return
        // Pruned mid-run: must not resurrect the path.
        if (this.entries.get(worktreePath) !== entry) return
        // Stale, not wrong: UNREADABLE only when there's no good value to keep.
        if (value === UNREADABLE && entry.value !== undefined && entry.value !== UNREADABLE) return
        if (entry.value === value) return
        if (
          entry.value &&
          entry.value !== UNREADABLE &&
          value !== UNREADABLE &&
          sameWorktreeChanges(entry.value, value)
        )
          return
        entry.value = value
        this.publish()
      },
    )
  }

  private publish(): void {
    if (this.publishTimer || this.stopped) return
    this.publishTimer = setTimeout(() => {
      this.publishTimer = undefined
      if (!this.stopped) this.publishNow()
    }, this.options.publishDelayMs ?? 10)
  }

  private publishNow(): void {
    const changes: WorktreeChangesPayload["changes"] = {}
    const unreadable: string[] = []
    for (const [path, entry] of this.entries) {
      if (entry.value === UNREADABLE) unreadable.push(path)
      else if (entry.value) changes[path] = entry.value
    }
    // `unreadable` rides only when non-empty (wire-compatible common payload).
    this.bus.publish("worktree.changes", unreadable.length > 0 ? { changes, unreadable } : { changes })
  }
}

/**
 * Start the production collector; returns `stop()`. `tickMs <= 0` disables
 * (no-op stop), like the server's other pollers. `hasSubscribers` is the
 * consumer gate described on the options.
 */
export function startWorktreeChangesCollector(
  orch: TaskLister,
  runtime: Pick<DaemonRuntimeAdapter, "runWorktreeStatus">,
  bus: DaemonEventBus,
  tickMs: number = DEFAULT_WORKTREE_CHANGES_TICK_MS,
  hasSubscribers?: () => boolean,
  /** Task ids with a working engine — see `activeTaskIds` on the options. */
  activeTaskIds?: () => Iterable<string>,
): () => void {
  const collector = new WorktreeChangesCollector(orch, bus, {
    hasSubscribers,
    run: runtime.runWorktreeStatus,
    ...(activeTaskIds ? { activeTaskIds } : {}),
  })
  // No `gate`: the subscriber check lives inside `collector.tick()`.
  return startTicker({
    name: "worktree-changes-collector",
    tickMs,
    immediate: true,
    run: () => collector.tick(),
    onStop: () => collector.stop(),
  })
}
