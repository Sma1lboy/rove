/**
 * The ONLY caller of `runtime.quotaUsage(vendor)` — the vendor usage APIs are
 * rate-limited, so the whole cadence policy lives here:
 *
 *  - Have a snapshot → refresh slowly ({@link FRESH_POLL_MS}).
 *  - No snapshot / last fetch failed → exponential backoff from
 *    {@link RETRY_BASE_MS}, capped at the slow interval.
 *  - Hard floor ({@link MIN_FETCH_INTERVAL_MS}) per vendor whoever asks, so
 *    a storm of rate-limit hooks collapses onto one fetch.
 *  - Concurrent callers share one in-flight fetch per vendor.
 *
 * Memory is bounded: one entry (one snapshot) per vendor id ever seen.
 */

import type { EngineQuotaUsage, VendorId } from "./contracts.ts"
import type { DaemonEventBus } from "./event-bus.ts"
import type { DaemonRuntimeAdapter } from "./runtime.ts"
import { startTicker } from "./ticker.ts"

/** Refresh interval while a snapshot exists (usage moves slowly for display). */
export const FRESH_POLL_MS = 15 * 60 * 1000
/** First-retry delay when there is no snapshot (doubles per failure). */
export const RETRY_BASE_MS = 60 * 1000
/** Hard floor between fetch attempts for one vendor, whatever the caller. */
export const MIN_FETCH_INTERVAL_MS = 60 * 1000

interface VendorEntry {
  usage: EngineQuotaUsage | null
  /** Epoch ms of the last fetch ATTEMPT (success or not) — cadence gate. */
  attemptedAt: number
  /** Consecutive failed/empty fetches since the last success — backoff input. */
  failures: number
  inFlight: Promise<EngineQuotaUsage | null> | null
}

export class QuotaUsageCache {
  private readonly entries = new Map<string, VendorEntry>()

  constructor(
    private readonly runtime: DaemonRuntimeAdapter,
    private readonly bus: DaemonEventBus,
    private readonly now: () => number = Date.now,
  ) {}

  /** Latest cached snapshot for a vendor (no fetch), or null. */
  peek(vendor: VendorId): EngineQuotaUsage | null {
    return this.entries.get(vendor)?.usage ?? null
  }

  /**
   * Refreshes first when older than `maxAgeMs` AND the fetch floor allows —
   * a small `maxAgeMs` still can't exceed one request per {@link MIN_FETCH_INTERVAL_MS}.
   */
  async get(vendor: VendorId, maxAgeMs: number): Promise<EngineQuotaUsage | null> {
    const entry = this.entry(vendor)
    const age = this.now() - (entry.usage?.capturedAt ?? 0)
    if (entry.usage && age <= maxAgeMs) return entry.usage
    if (entry.inFlight) return entry.inFlight
    if (this.now() - entry.attemptedAt < MIN_FETCH_INTERVAL_MS) return entry.usage
    return this.fetch(vendor, entry)
  }

  /** Poller tick entry: refresh when the adaptive schedule says the vendor is due. */
  async refreshIfDue(vendor: VendorId): Promise<void> {
    const entry = this.entry(vendor)
    // 1× base after the first failure, doubling per further failure, capped
    // at the slow interval; a never-attempted vendor (attemptedAt 0) is due.
    const retryAfter = entry.failures === 0 ? 0 : Math.min(RETRY_BASE_MS * 2 ** (entry.failures - 1), FRESH_POLL_MS)
    const dueAfter = entry.usage ? FRESH_POLL_MS : retryAfter
    if (this.now() - entry.attemptedAt < dueAfter) return
    await this.fetch(vendor, entry)
  }

  private entry(vendor: VendorId): VendorEntry {
    const existing = this.entries.get(vendor)
    if (existing) return existing
    const fresh: VendorEntry = { usage: null, attemptedAt: 0, failures: 0, inFlight: null }
    this.entries.set(vendor, fresh)
    return fresh
  }

  private fetch(vendor: VendorId, entry: VendorEntry): Promise<EngineQuotaUsage | null> {
    if (entry.inFlight) return entry.inFlight
    entry.attemptedAt = this.now()
    entry.inFlight = this.runtime
      .quotaUsage(vendor)
      .catch(() => null)
      .then((usage) => {
        entry.inFlight = null
        if (usage) {
          entry.failures = 0
          const changed = JSON.stringify(usage.windows) !== JSON.stringify(entry.usage?.windows)
          entry.usage = usage
          if (changed) this.publish()
        } else {
          entry.failures += 1
        }
        return entry.usage
      })
    return entry.inFlight
  }

  /** Full-map-replace publish of every vendor that has a snapshot. */
  private publish(): void {
    const usage: Record<string, EngineQuotaUsage> = {}
    for (const [vendor, entry] of this.entries) {
      if (entry.usage) usage[vendor] = entry.usage
    }
    this.bus.publish("usage.snapshot", { usage })
  }
}

/**
 * Asks the cache to refresh vendors in play. Gated on subscribers: the
 * dashboard is the only poll consumer (the rate-limit scheduler calls `get`
 * itself). Cadence lives in the cache, so a fast tick costs comparisons only.
 */
export function startQuotaUsagePoller(
  cache: QuotaUsageCache,
  listVendors: () => readonly VendorId[],
  hasSubscribers: () => boolean,
  tickMs: number = MIN_FETCH_INTERVAL_MS,
): () => void {
  return startTicker({
    name: "quota-usage-poller",
    tickMs,
    gate: hasSubscribers,
    immediate: true,
    run: () => {
      for (const vendor of new Set(listVendors())) void cache.refreshIfDue(vendor)
    },
  })
}
