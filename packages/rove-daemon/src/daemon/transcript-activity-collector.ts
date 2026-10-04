/**
 * Daemon-side transcript-activity collector: one guarded probe per local
 * worktree producing `{ mtimeMs, completionId, completionAt }` on the
 * `transcript.activity` channel, so W Ops panes on one worktree don't each
 * stat/parse the transcript store (per pane: a readdir+stat on a 2.5–20s
 * timer plus a JSONL re-parse every 1.5s). Pane-local probes remain only as the
 * no-daemon / old-daemon fallback.
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  HARD CONSTRAINT — this collector does FILESYSTEM reads ONLY.         ║
 * ║  Quiescence hashing and pane-local state writes STAY in the Ops pane  ║
 * ║  process (ops/host.tsx). This file MUST NOT import anything that      ║
 * ║  drives the TUI.                                                      ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * Shared poll-scheduling guards: one probe per worktree in flight, next run
 * waits `max(minInterval, 5 × last duration)`, hard backoff after a timeout.
 * The per-worktree `EngineTurnDetector` lives across ticks, so a quiescent
 * worktree re-stats the dir but does NOT re-parse the JSONL.
 *
 * Remote (`ssh://`) projects are skipped — their transcripts aren't on this
 * filesystem. Publishes the FULL map only when membership or a value
 * changed, so the bus's last-value replay gives a late subscriber everything
 * in one frame. A failed/timed-out probe keeps the entry's last value.
 * `stop()` holds no subprocess or filesystem handles to release.
 */

import type { DaemonTask as Task, VendorId } from "./contracts.ts"
import { logDaemonError } from "./crash-log.ts"
import type { DaemonEventBus } from "./event-bus.ts"
import { type PollCadenceConfig, type PollScheduleState, maybeStartScheduledRun } from "./poll-scheduling.ts"
import type { TranscriptActivityPayload } from "./protocol.ts"
import type { DaemonRuntimeAdapter, EngineTurnDetectorAdapter as EngineTurnDetector } from "./runtime.ts"
import { startTicker } from "./ticker.ts"

function isRemoteRepoKey(value: string): boolean {
  return value.startsWith("ssh://")
}

/** Tick cadence — matches the Ops pane's 1.5s turn-detector poll (the most responsive consumer). */
export const DEFAULT_TRANSCRIPT_ACTIVITY_TICK_MS = 1_500
/** Kill a probe that runs longer than this; a JSONL parse this slow self-thins via backoff. */
export const TRANSCRIPT_ACTIVITY_TIMEOUT_MS = 4_000
/** After a timeout, leave the worktree alone for this long before retrying. */
export const TRANSCRIPT_ACTIVITY_SLOW_RETRY_MS = 60_000
/** Floor between successful probes per worktree. */
export const TRANSCRIPT_ACTIVITY_MIN_INTERVAL_MS = 1_500

/** One worktree's fs-derived transcript facts — the channel's per-key value. */
export interface TranscriptActivityEntry {
  /** Newest engine-transcript mtime (epoch ms); `0` when no transcript yet. */
  readonly mtimeMs: number
  /** Engine-owned latest-completion marker id; `null` when none/unsupported. */
  readonly completionId: string | null
  /** The marker's timestamp (epoch ms); `0` when absent. */
  readonly completionAt: number
}

/** Entry-wise equality — a probe round-tripping to the same facts is a publish no-op. */
export function sameTranscriptActivityEntry(a: TranscriptActivityEntry, b: TranscriptActivityEntry): boolean {
  return a.mtimeMs === b.mtimeMs && a.completionId === b.completionId && a.completionAt === b.completionAt
}

/** The task-list slice the collector needs — `Orchestrator` satisfies it. */
export interface TaskLister {
  listTasks(): readonly Task[]
}

/**
 * Injectable probe; gets the long-lived detector so its mtime memo survives
 * ticks. Throw/reject keeps the entry's last value. The signal is the cadence
 * timeout; fs reads ignore it (no child to kill — cadence is the throttle).
 */
export type TranscriptActivityRunner = (
  worktreePath: string,
  vendor: VendorId,
  detector: EngineTurnDetector,
  signal: AbortSignal,
) => Promise<TranscriptActivityEntry>

/**
 * Completion marker AND newest transcript mtime from ONE directory scan via
 * `detector.latestActivity`. A detector without completion markers
 * (copilot/custom) yields mtime 0 here; the production binding in
 * {@link startTranscriptActivityCollector} instead falls back to the vendor's
 * `latestTranscriptMtime` (copilot has a store the detector doesn't read).
 * FILESYSTEM-only, no subprocess.
 */
export async function runTranscriptActivity(
  worktreePath: string,
  vendor: VendorId,
  detector: EngineTurnDetector,
  _signal: AbortSignal,
): Promise<TranscriptActivityEntry> {
  const { marker, mtimeMs } = await detector.latestActivity(worktreePath)
  const resolvedMtime = detector.supportsCompletionMarkers() ? mtimeMs : 0
  return { mtimeMs: resolvedMtime, completionId: marker?.id ?? null, completionAt: marker?.timestampMs ?? 0 }
}

/**
 * Worktree → vendor for tasks with a non-empty LOCAL worktree (`ssh://` repo
 * or path excluded). Tasks sharing a path collapse; the FIRST in list order
 * picks the vendor, keeping the vendor-specific completion marker stable. A
 * task with no vendor gets `defaultVendor` — required so it can't diverge
 * from kobe's `DEFAULT_TASK_VENDOR`, which the runtime adapter injects.
 */
export function trackedWorktrees(tasks: readonly Task[], defaultVendor: VendorId): Map<string, VendorId> {
  const map = new Map<string, VendorId>()
  for (const task of tasks) {
    if (!task.worktreePath) continue
    if (isRemoteRepoKey(task.repo) || isRemoteRepoKey(task.worktreePath)) continue
    if (map.has(task.worktreePath)) continue
    map.set(task.worktreePath, task.vendor ?? defaultVendor)
  }
  return map
}

interface CollectorEntry extends PollScheduleState {
  /** The vendor whose transcript store this worktree's probe reads. */
  vendor: VendorId
  /** Long-lived detector — its mtime-gated memo survives across ticks. */
  detector: EngineTurnDetector
  /** Last successful facts, absent until the first probe lands. */
  value?: TranscriptActivityEntry
}

export interface TranscriptActivityCollectorOptions {
  readonly cadence?: PollCadenceConfig
  /** Injectable probe — tests avoid real transcripts/fs. */
  readonly run?: TranscriptActivityRunner
  /**
   * Consumer gate: `false` makes `tick()` do no probes and no publish. The
   * timer keeps ticking, so the first tick after a pane subscribes
   * repopulates. Omit to collect every tick.
   */
  readonly hasSubscribers?: () => boolean
  readonly createDetector?: (vendor: VendorId) => EngineTurnDetector
  /** Vendor for a task that names none; kobe injects `DEFAULT_TASK_VENDOR`. */
  readonly defaultVendor: VendorId
}

/** `tick()` is synchronous and never throws: prune, start due probes, publish on change. */
export class TranscriptActivityCollector {
  private readonly entries = new Map<string, CollectorEntry>()
  private stopped = false

  constructor(
    private readonly orch: TaskLister,
    private readonly bus: DaemonEventBus,
    private readonly options: TranscriptActivityCollectorOptions,
  ) {}

  tick(): void {
    if (this.stopped) return
    if (this.options.hasSubscribers && !this.options.hasSubscribers()) return
    try {
      const tracked = trackedWorktrees(this.orch.listTasks(), this.options.defaultVendor)
      // Pruning an entry that had published facts republishes so subscribers drop it.
      let pruned = false
      for (const path of this.entries.keys()) {
        if (tracked.has(path)) continue
        const entry = this.entries.get(path)
        if (entry?.value) pruned = true
        this.entries.delete(path)
      }
      if (pruned) this.publish()
      for (const [path, vendor] of tracked) this.maybeCollect(path, vendor)
    } catch (err) {
      logDaemonError("transcript-activity", err)
    }
  }

  /** Stop publishing; in-flight probes resolve into a stopped collector and no-op. */
  stop(): void {
    this.stopped = true
  }

  private maybeCollect(worktreePath: string, vendor: VendorId): void {
    let entry = this.entries.get(worktreePath)
    if (!entry) {
      entry = { inFlight: false, nextAllowedAt: 0, vendor, detector: this.createDetector(vendor) }
      this.entries.set(worktreePath, entry)
    } else if (entry.vendor !== vendor) {
      // Re-vendored: completion markers must come from the new vendor's store.
      entry.vendor = vendor
      entry.detector = this.createDetector(vendor)
    }
    const cadence = this.options.cadence ?? {
      timeoutMs: TRANSCRIPT_ACTIVITY_TIMEOUT_MS,
      slowRetryMs: TRANSCRIPT_ACTIVITY_SLOW_RETRY_MS,
      minIntervalMs: TRANSCRIPT_ACTIVITY_MIN_INTERVAL_MS,
    }
    const run = this.options.run ?? runTranscriptActivity
    const current = entry
    maybeStartScheduledRun(
      current,
      cadence,
      (signal) => run(worktreePath, current.vendor, current.detector, signal),
      (value) => {
        if (this.stopped) return
        // Pruned while the probe ran — must not resurrect it in the published map.
        if (this.entries.get(worktreePath) !== current) return
        if (current.value && sameTranscriptActivityEntry(current.value, value)) return
        current.value = value
        this.publish()
      },
    )
  }

  private publish(): void {
    const activity: TranscriptActivityPayload["activity"] = {}
    for (const [path, entry] of this.entries) {
      if (entry.value) activity[path] = entry.value
    }
    this.bus.publish("transcript.activity", { activity })
  }

  private createDetector(vendor: VendorId): EngineTurnDetector {
    return (
      this.options.createDetector?.(vendor) ?? {
        latestActivity: async () => ({ marker: null, mtimeMs: 0 }),
        latestActivityInFile: async () => null,
        supportsCompletionMarkers: () => false,
      }
    )
  }
}

/**
 * Production interval binding; returns `stop()`. `tickMs <= 0` disables (no-op
 * stop) — socket-suite tests use it to stay fs-free. `hasSubscribers` is the
 * consumer gate above.
 */
export function startTranscriptActivityCollector(
  orch: TaskLister,
  runtime: Pick<DaemonRuntimeAdapter, "createEngineTurnDetector" | "latestTranscriptMtime" | "defaultTaskVendor">,
  bus: DaemonEventBus,
  tickMs: number = DEFAULT_TRANSCRIPT_ACTIVITY_TICK_MS,
  hasSubscribers?: () => boolean,
): () => void {
  const collector = new TranscriptActivityCollector(orch, bus, {
    hasSubscribers,
    createDetector: runtime.createEngineTurnDetector,
    defaultVendor: runtime.defaultTaskVendor,
    run: async (path, vendor, detector, signal) => {
      const { marker, mtimeMs } = await detector.latestActivity(path)
      const resolvedMtime = detector.supportsCompletionMarkers()
        ? mtimeMs
        : await runtime.latestTranscriptMtime(vendor, path)
      void signal
      return { mtimeMs: resolvedMtime, completionId: marker?.id ?? null, completionAt: marker?.timestampMs ?? 0 }
    },
  })
  return startTicker({
    name: "transcript-activity-collector",
    tickMs,
    immediate: true,
    run: () => collector.tick(),
    onStop: () => collector.stop(),
  })
}
