/**
 * Daemon-side context-window collector.
 *
 * The engine already knows how full its context window is — every adapter's
 * history reader computes it (`readUsageSnapshot`), the browser renders it,
 * and the TUI threw it away. This is the missing fan-out: one guarded read per
 * LIVE ENGINE SESSION, published on `usage.context` keyed `taskId::tabId`, so
 * the workspace footer can say `ctx 62%` without any pane touching a vendor
 * transcript.
 *
 * Scope is the activity registry's live per-tab entries that carry a session
 * id — a shell tab, a task nobody has opened, and a custom engine with no
 * transcript store all contribute nothing, and therefore render nothing.
 *
 * Cadence is deliberately SLOW ({@link DEFAULT_CONTEXT_USAGE_TICK_MS}): the
 * number moves once per agent turn, not once per frame, and each read parses a
 * session transcript. It rides the same guards as the other collectors
 * (in-flight dedupe, timeout, backoff, adaptive cadence) through
 * `@/lib/poll-scheduling`'s shared shape.
 *
 * Publish contract, same as `worktree.changes`: the FULL map, republished only
 * when membership or a value actually changed, so the bus's last-value replay
 * hands a late subscriber the whole picture and quiet ticks cost nothing.
 * Reads are best-effort — a throw keeps the entry's last value.
 */

import type { DaemonActivityRegistry } from "./activity-registry.ts"
import type { DaemonOrchestrator, EngineContextUsage, VendorId } from "./contracts.ts"
import { logDaemonError } from "./crash-log.ts"
import type { DaemonEventBus } from "./event-bus.ts"
import type { DaemonRuntimeAdapter, PollCadenceConfig, PollScheduleState } from "./runtime.ts"

/** Once per ~10s: a context reading changes per TURN, not per frame. */
export const DEFAULT_CONTEXT_USAGE_TICK_MS = 10_000
/** Kill a transcript parse that runs longer than this. */
export const CONTEXT_USAGE_TIMEOUT_MS = 4_000
/** After a timeout, leave the session alone for this long. */
export const CONTEXT_USAGE_SLOW_RETRY_MS = 60_000
/** Floor between successful reads per session. */
export const CONTEXT_USAGE_MIN_INTERVAL_MS = 5_000

/** One live engine session the collector reads. Pure — unit-tested. */
export interface ContextUsageTarget {
  /** `taskId::tabId` — the published map's key. */
  readonly key: string
  readonly vendor: VendorId
  readonly sessionId: string
}

export function sameContextUsage(a: EngineContextUsage, b: EngineContextUsage): boolean {
  return (
    a.contextTokens === b.contextTokens &&
    a.contextWindowTokens === b.contextWindowTokens &&
    a.approximate === b.approximate
  )
}

/**
 * The live engine sessions worth reading: registry entries that name BOTH a
 * tab and a session id, joined to their task's vendor.
 *
 * A task-level entry with no `tabId` is skipped on purpose — the footer meter
 * is about the tab you are looking at, and a task rollup cannot say which of
 * its tabs the number belongs to. A session whose task is gone is skipped too:
 * the registry outlives a delete by one tick. Pure — unit-tested.
 */
export function contextUsageTargets(
  states: readonly { taskId: string; tabId?: string; sessionId?: string }[],
  getVendor: (taskId: string) => VendorId | undefined,
): ContextUsageTarget[] {
  const seen = new Set<string>()
  const targets: ContextUsageTarget[] = []
  for (const state of states) {
    if (!state.tabId || !state.sessionId) continue
    const vendor = getVendor(state.taskId)
    if (!vendor) continue
    const key = `${state.taskId}::${state.tabId}`
    if (seen.has(key)) continue
    seen.add(key)
    targets.push({ key, vendor, sessionId: state.sessionId })
  }
  return targets
}

interface Entry extends PollScheduleState {
  value?: EngineContextUsage
  /** The session this entry's value belongs to — a tab that started a NEW
   *  session must not keep showing the old one's occupancy. */
  sessionId?: string
}

export interface ContextUsageCollectorOptions {
  readonly cadence?: PollCadenceConfig
  /** Injectable reader — tests avoid real transcripts. */
  readonly read?: (target: ContextUsageTarget, signal: AbortSignal) => Promise<EngineContextUsage | null>
  /** Consumer gate, same as the other collectors: no subscribers, no work. */
  readonly hasSubscribers?: () => boolean
}

export class ContextUsageCollector {
  private readonly entries = new Map<string, Entry>()
  private stopped = false

  constructor(
    private readonly registry: Pick<DaemonActivityRegistry, "currentNonIdle">,
    private readonly orch: Pick<DaemonOrchestrator, "getTask">,
    private readonly bus: DaemonEventBus,
    private readonly runtime: Pick<DaemonRuntimeAdapter, "readEngineContextUsage">,
    private readonly options: ContextUsageCollectorOptions = {},
  ) {}

  tick(): void {
    if (this.stopped) return
    if (this.options.hasSubscribers && !this.options.hasSubscribers()) return
    try {
      const targets = contextUsageTargets(this.registry.currentNonIdle(), (id) => this.orch.getTask(id)?.vendor)
      const live = new Set(targets.map((t) => t.key))
      let pruned = false
      for (const key of [...this.entries.keys()]) {
        if (live.has(key)) continue
        if (this.entries.get(key)?.value) pruned = true
        this.entries.delete(key)
      }
      if (pruned) this.publish()
      for (const target of targets) this.collect(target)
    } catch (err) {
      logDaemonError("context-usage", err)
    }
  }

  stop(): void {
    this.stopped = true
  }

  private collect(target: ContextUsageTarget): void {
    let entry = this.entries.get(target.key)
    if (!entry) {
      entry = { inFlight: false, nextAllowedAt: 0 }
      this.entries.set(target.key, entry)
    }
    // A tab that started a new session drops the old reading immediately
    // rather than showing it until the next successful read lands — and the
    // drop is PUBLISHED, or the footer keeps drawing the previous
    // conversation's occupancy at exactly the moment it is most wrong.
    if (entry.sessionId !== undefined && entry.sessionId !== target.sessionId) {
      const had = entry.value !== undefined
      entry.value = undefined
      entry.nextAllowedAt = 0
      entry.sessionId = target.sessionId
      if (had) this.publish()
    }
    entry.sessionId = target.sessionId
    const cadence = this.options.cadence ?? {
      timeoutMs: CONTEXT_USAGE_TIMEOUT_MS,
      slowRetryMs: CONTEXT_USAGE_SLOW_RETRY_MS,
      minIntervalMs: CONTEXT_USAGE_MIN_INTERVAL_MS,
    }
    const read =
      this.options.read ?? ((t: ContextUsageTarget) => this.runtime.readEngineContextUsage(t.vendor, t.sessionId))
    const startedAt = Date.now()
    if (entry.inFlight || startedAt < entry.nextAllowedAt) return
    entry.inFlight = true
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), cadence.timeoutMs)
    const held = entry
    void read(target, controller.signal)
      .then((value) => {
        if (controller.signal.aborted || this.stopped) return
        // Pruned (task deleted) mid-read: a completion must not resurrect it.
        if (this.entries.get(target.key) !== held) return
        if (!value) return
        if (held.value && sameContextUsage(held.value, value)) return
        held.value = value
        this.publish()
      })
      .catch(() => {})
      .finally(() => {
        clearTimeout(timer)
        const finishedAt = Date.now()
        held.nextAllowedAt = controller.signal.aborted
          ? startedAt + cadence.slowRetryMs
          : finishedAt + Math.max(cadence.minIntervalMs, (finishedAt - startedAt) * 5)
        held.inFlight = false
      })
  }

  private publish(): void {
    const context: Record<string, EngineContextUsage> = {}
    for (const [key, entry] of this.entries) if (entry.value) context[key] = entry.value
    this.bus.publish("usage.context", { context })
  }
}

/** Start the production collector on an interval; `tickMs <= 0` disables it. */
export function startContextUsageCollector(
  registry: Pick<DaemonActivityRegistry, "currentNonIdle">,
  orch: Pick<DaemonOrchestrator, "getTask">,
  bus: DaemonEventBus,
  runtime: Pick<DaemonRuntimeAdapter, "readEngineContextUsage">,
  tickMs: number = DEFAULT_CONTEXT_USAGE_TICK_MS,
  hasSubscribers?: () => boolean,
): () => void {
  if (tickMs <= 0) return () => {}
  const collector = new ContextUsageCollector(registry, orch, bus, runtime, { hasSubscribers })
  collector.tick()
  const timer = setInterval(() => collector.tick(), tickMs)
  timer.unref?.()
  return () => {
    clearInterval(timer)
    collector.stop()
  }
}
