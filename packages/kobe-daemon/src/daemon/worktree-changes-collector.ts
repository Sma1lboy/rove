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
 * Those all defend against a SLOW repo. One more, on a different axis,
 * defends against an UNCHANGED one — 19 idle tasks cost 1280 `git` processes
 * and 14.7s of CPU per 62 seconds to publish 19 frames, because every tick
 * re-derived an answer that had not moved:
 *
 *   - **quiet backoff** — before spawning anything, `worktreeFingerprint`
 *     stats the git files an observable change would touch. While it is
 *     unmoved AND the worktree has no working engine, the poll relaxes to
 *     {@link WORKTREE_CHANGES_QUIET_INTERVAL_MS}. The fingerprint cannot see
 *     a NESTED edit (see worktree-probe.ts — measured, not assumed), so it
 *     is an accelerator, never an authority: the relaxed poll still runs, and
 *     anything unreadable falls straight through to the real poll.
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
  // `ahead` belongs here for the same reason `behind` does: a field the
  // publisher does not compare is a field whose chip freezes at whatever it
  // read first — the row would show `↑1` forever while the worker kept
  // committing.
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
 * Poll floor for a worktree whose change probe is quiet and whose engine is
 * idle — the safety net under {@link worktreeFingerprint}, which cannot see
 * a nested edit. This is the WORST-CASE staleness for such a worktree; a
 * fingerprint that moves, or an engine that starts working, drops it back to
 * {@link WORKTREE_CHANGES_MIN_INTERVAL_MS} on the next tick.
 *
 * The safety net is what the whole fleet pays for, every minute, forever: at
 * a 15s floor a fully idle fleet still forked 18 `git status` per worktree
 * per 5 minutes — measured at both 20 and 50 worktrees, so flat per worktree
 * and linear in the fleet, projecting to ~3600 processes at 200. A minute
 * buys the same safety for a third of the processes. Nothing a person
 * watches goes stale for it: an engine writing in there is exempt (the
 * activity registry flags one within ~10s), and the ahead/behind half of the
 * chip rides ref files the fingerprint DOES see. What can now lag by up to a
 * minute is the `+N -M` count of a file someone created in a subdirectory,
 * by hand, in a worktree with no engine running.
 */
export const WORKTREE_CHANGES_QUIET_INTERVAL_MS = 60_000

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

/** A run whose `git status` failed: no counts exist, and the path must be
 *  published as UNREADABLE rather than silently omitted. Returned in place of
 *  a throw so the scheduler's success path can carry it — `onValue` never
 *  fires for a rejected run, which is how an unreadable worktree used to leave
 *  the map entirely and read as clean on every subscriber. */
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
  /**
   * Task ids whose engine is currently working. Their worktrees keep the
   * full {@link WORKTREE_CHANGES_MIN_INTERVAL_MS} cadence regardless of the
   * change probe: an engine writing `src/**` is precisely the nested case
   * the probe is blind to, and the sidebar chip for a task being worked on
   * is the one people watch. Omit to treat every worktree as idle.
   */
  readonly activeTaskIds?: () => Iterable<string>
  /** Poll floor for a quiet, engine-idle worktree. Tests shrink it. */
  readonly quietIntervalMs?: number
  /** Change probe (tests inject); defaults to {@link worktreeFingerprint}. */
  readonly probe?: (worktreePath: string, baseRef?: string) => string | null
}

/**
 * Tick-driven collector. `tick()` is synchronous and never throws: it
 * prunes entries for worktrees the daemon stopped tracking (deleted/remote
 * tasks), starts guarded status runs for due worktrees, and
 * publishes the full map when — and only when — membership or a value
 * changed. Run completions batch publications over a short timer window. Exposed as a class so tests drive `tick()` directly
 * with a fake lister/bus/runner; `startWorktreeChangesCollector` is the
 * production interval binding.
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
    // Consumer gate: with zero subscribed panes there is nobody to render
    // the counts, so skip the whole pass — no git spawns, no publish. The
    // first tick once a pane subscribes repopulates the map and the bus
    // replays it to the late subscriber.
    if (this.options.hasSubscribers && !this.options.hasSubscribers()) return
    try {
      const tasks = this.orch.listTasks()
      const tracked = trackedWorktreePaths(tasks)
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
    // Quiet backoff: skip the spawns only when the probe read cleanly, read
    // the SAME thing as at the last run's start, no engine is writing in
    // there, and the safety poll is not yet due. Every other case — a first
    // tick (`probe` absent), an unreadable probe (`null`, which never equals
    // itself here because the strict compare is against a string), a moved
    // fingerprint — falls through and polls.
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
        // Recorded here, not above: `maybeStartScheduledRun` may decline
        // (in flight, or inside the cadence window), and a fingerprint
        // recorded for a run that never happened would suppress the next one.
        entry.probe = probe
        entry.quietUntil = Date.now() + quietIntervalMs
        // Resolve, don't reject, on a failed status: `maybeStartScheduledRun`
        // only calls back on success, so a rejection would drop the path from
        // the published map — and an absent key is what the sidebar draws as a
        // clean row. A TIMEOUT still rejects the run (the signal aborts and the
        // callback is skipped either way), so a slow repo keeps its last value
        // and backs off exactly as before.
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
        // The entry may have been pruned (task deleted) while the
        // status ran — a completion for an untracked path must not resurrect
        // it in the published map.
        if (this.entries.get(worktreePath) !== entry) return
        // A failed status on a worktree that HAS read cleanly keeps its last
        // counts, the same "stale, not wrong" contract the PR chip keeps for a
        // provider it could not reach. UNREADABLE is published only when there
        // is no good value to go stale from — which is the case that used to
        // fall out of the map and read as a clean row.
        if (value === UNREADABLE && entry.value !== undefined && entry.value !== UNREADABLE) return
        // Publish-on-change only: a status returning the same counts is a
        // no-op for every subscriber.
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
    // `unreadable` only rides when non-empty, so the common payload is byte-
    // identical to what this channel has always published.
    this.bus.publish("worktree.changes", unreadable.length > 0 ? { changes, unreadable } : { changes })
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
  /** Task ids with a working engine — see `activeTaskIds` on the options. */
  activeTaskIds?: () => Iterable<string>,
): () => void {
  const collector = new WorktreeChangesCollector(orch, bus, {
    hasSubscribers,
    run: runtime.runWorktreeStatus,
    ...(activeTaskIds ? { activeTaskIds } : {}),
  })
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
