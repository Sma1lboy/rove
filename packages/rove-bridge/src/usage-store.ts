/**
 * The latest engine quota snapshot the orchestrator's `usageSnapshotSignal()` delivered, held
 * for the `usage.get` op. A `Map` does not survive JSON, so it is folded to plain rows here.
 * Also holds `contextUsageSignal()`'s per-session map, read one session at a time.
 */

import type { EngineContextUsage, EngineQuotaUsage } from "@sma1lboy/rove-daemon/daemon/contracts"

export interface UsageWindowRow {
  readonly kind: string
  readonly label: string
  /** Integer utilization percent, 0..100. */
  readonly percent: number
  /** Epoch-ms reset, or null when the engine did not report one. */
  readonly resetsAt: number | null
}

export interface UsageVendorRow {
  readonly vendor: string
  readonly capturedAt: number
  readonly windows: readonly UsageWindowRow[]
}

export class UsageStore {
  private rows: readonly UsageVendorRow[] | null = null
  private sessions: ReadonlyMap<string, EngineContextUsage> | null = null

  /** `null` = the daemon has not sent a snapshot yet; an empty map = it has and no engine reports quota. */
  set(snapshot: ReadonlyMap<string, EngineQuotaUsage> | null): void {
    this.rows =
      snapshot === null
        ? null
        : [...snapshot.entries()]
            .map(([vendor, usage]) => ({
              vendor,
              capturedAt: usage.capturedAt,
              windows: usage.windows.map(({ kind, label, percent, resetsAt }) => ({ kind, label, percent, resetsAt })),
            }))
            .sort((a, b) => a.vendor.localeCompare(b.vendor))
  }

  get(): readonly UsageVendorRow[] | null {
    return this.rows
  }

  setContext(map: ReadonlyMap<string, EngineContextUsage> | null): void {
    this.sessions = map
  }

  /** One session (`taskId::tabId`); null when the engine has not reported for it. */
  context(session: string): EngineContextUsage | null {
    return this.sessions?.get(session) ?? null
  }
}

/** The one the bridge process shares between its orchestrator subscription and the op table. */
export const usageStore = new UsageStore()
