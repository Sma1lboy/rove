/**
 * ESC-interrupt observer.
 *
 * An ESC interrupt fires NO hook (claude-code's abort returns before stop
 * hooks), so the hook-driven `running` badge would stay lit until the ~10min
 * lapse watchdog. The only event-grade signal is the engine's OSC title
 * flipping from the working frame to rest (`engineTitleTurnHint`).
 *
 * Hook `running` + title "rest" arms a confirm timer; if it still disagrees
 * on fire, `report` sends `turn-interrupted` to the daemon.
 *
 * The delay guards the Stop race: on a NATURAL end the title flips a beat
 * before Stop lands, and an interrupt report after Stop would eat the
 * unseen-● lamp (reduce(turn_complete, turn-interrupted) → idle). Any hook
 * move away from `running` in the window disarms; Stop always wins.
 */

import { engineTitleTurnHint } from "../../engine/registry"
import type { VendorId } from "../../types/vendor"

/**
 * Must outlive a natural end's title→Stop gap (a spawned `kobe hook` + one
 * RPC, well under 1s); 2.5s covers a loaded machine while still feeling
 * immediate.
 */
const INTERRUPT_CONFIRM_MS = 2500

/** One tab's inputs per observation pass. */
export interface InterruptObservation {
  /** The tab's RAW live OSC title (undecorated stripping breaks the signal). */
  readonly rawTitle: string | undefined
  /** The tab's resolved live engine identity (turn-target probe). */
  readonly vendor: VendorId | undefined
  /** Whether the daemon's hook state currently claims `running` for this tab. */
  readonly hookRunning: boolean
}

export interface InterruptObserverOptions {
  /** Fire-time re-check that the hook STILL claims `running`, read from live
   *  state so a Stop during the window wins. */
  readonly confirm: (tabId: string) => boolean
  /** Report the confirmed interrupt (fire-and-forget daemon RPC). */
  readonly report: (tabId: string) => void
  readonly confirmMs?: number
}

/** True when the observation says "engine at rest under a running claim". */
function disagrees(obs: InterruptObservation): boolean {
  if (!obs.hookRunning || !obs.vendor || obs.rawTitle === undefined) return false
  return engineTitleTurnHint(obs.vendor, obs.rawTitle) === "rest"
}

export class InterruptObserver {
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(private readonly opts: InterruptObserverOptions) {}

  /** Arm on a fresh disagreement (never re-arm while pending); disarm once it clears. */
  observe(tabId: string, obs: InterruptObservation): void {
    if (disagrees(obs)) {
      if (this.pending.has(tabId)) return
      const timer = setTimeout(() => {
        this.pending.delete(tabId)
        if (this.opts.confirm(tabId)) this.opts.report(tabId)
      }, this.opts.confirmMs ?? INTERRUPT_CONFIRM_MS)
      timer.unref?.()
      this.pending.set(tabId, timer)
      return
    }
    this.disarm(tabId)
  }

  private disarm(tabId: string): void {
    const timer = this.pending.get(tabId)
    if (timer === undefined) return
    clearTimeout(timer)
    this.pending.delete(tabId)
  }

  dispose(): void {
    for (const timer of this.pending.values()) clearTimeout(timer)
    this.pending.clear()
  }
}
