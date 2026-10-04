/**
 * Keep-alive for `DaemonLifetime` while the PTY host owns a live session.
 * The daemon is the only collector of hook activity events and hooks never
 * spawn one, so an idle-stopped daemon would drop every event from engines
 * still running and lose the (unpersisted) activity registry.
 *
 * `isHeld()` is a sync cached flag, refreshed by polling the host socket
 * plus `probeSoon()` on gui disconnect so the idle-grace recheck isn't
 * poll-stale. held→released calls `onRelease` (`lifetime.reevaluateIdle()`).
 * The probe never spawns a host; an unreadable host keeps the hold until absence is confirmed.
 */

import { logDaemonInfo } from "./crash-log.ts"

/** Only bounds how long a gui-less daemon outlives its last session; `probeSoon()` gives freshness. */
const DEFAULT_POLL_MS = 15_000

export interface PtyLiveHoldOptions {
  /** Null is unknown; only a confirmed false releases the hold. Never spawns. */
  readonly probe: () => Promise<boolean | null>
  /** Fired once per held→released transition; wire to `reevaluateIdle()`. */
  readonly onRelease: () => void
  readonly pollMs?: number
  /** Structured log sink (default: {@link logDaemonInfo}); injected by tests. */
  readonly log?: (event: string, message: string) => void
}

export class PtyLiveHold {
  private readonly probe: () => Promise<boolean | null>
  private readonly onRelease: () => void
  private readonly pollMs: number
  private readonly log: (event: string, message: string) => void
  private held = true
  private probed = false
  private inFlight: Promise<void> | null = null
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(options: PtyLiveHoldOptions) {
    this.probe = options.probe
    this.onRelease = options.onRelease
    this.pollMs = options.pollMs ?? DEFAULT_POLL_MS
    this.log = options.log ?? logDaemonInfo
  }

  /** Begin the initial probe and the steady-state poll. */
  start(): void {
    void this.probeSoon()
    this.timer = setInterval(() => void this.probeSoon(), this.pollMs)
    this.timer.unref?.()
  }

  /** Cached answer — sync, read by `DaemonLifetime.keepAlive`. */
  isHeld(): boolean {
    return this.held
  }

  /** Refresh now, deduped against an in-flight probe. */
  probeSoon(): Promise<void> {
    this.inFlight ??= this.refresh().finally(() => {
      this.inFlight = null
    })
    return this.inFlight
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private async refresh(): Promise<void> {
    let next: boolean | null
    try {
      next = await this.probe()
    } catch {
      return // probe contract is throw-free; on a bug, keep the last answer
    }
    const initialProbe = !this.probed
    this.probed = true
    if (next === null) {
      this.held = true
      return
    }
    if (next === this.held) return
    this.held = next
    this.log("idle", next ? "pty host has live sessions — holding daemon open" : "last live pty session gone")
    if (!next && !initialProbe) this.onRelease()
  }
}
