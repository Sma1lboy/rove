/**
 * "对方正在输入" while the WeChat agent works on a message. The indicator is
 * shown as soon as a message is handed over and kept alive while the agent's
 * task is running; it clears when the turn ends (done, waiting on the owner,
 * errored), after the warm-up if the turn never starts, or at the ceiling.
 *
 * The agent's reply goes out from its own `rove weixin send` process, so the
 * bridge cannot see it; the turn ending is the signal instead.
 */

export interface TypingDeps {
  /** Show (`true`) or clear (`false`) the indicator. Failures are the caller's to log. */
  readonly send: (typing: boolean) => Promise<void>
  readonly isRunning: () => Promise<boolean>
  readonly sleep: (ms: number) => Promise<unknown>
  readonly now: () => number
  readonly log: (message: string) => void
}

export interface TypingTimings {
  /** iLink drops the indicator after a few seconds without a refresh. */
  readonly keepaliveMs: number
  /** How long to wait for the turn to show as running before giving up. */
  readonly warmupMs: number
  readonly maxMs: number
}

export const TYPING_TIMINGS: TypingTimings = { keepaliveMs: 5_000, warmupMs: 30_000, maxMs: 15 * 60_000 }

export interface TypingHandle {
  stop(): void
  /** Resolves once the indicator has been cleared. */
  readonly done: Promise<void>
}

export function startTyping(deps: TypingDeps, timings: TypingTimings = TYPING_TIMINGS): TypingHandle {
  let stopped = false
  const send = (typing: boolean) =>
    deps.send(typing).catch((err) => deps.log(`typing ${typing ? "on" : "off"} failed: ${String(err)}`))

  async function run(): Promise<void> {
    const startedAt = deps.now()
    let seenRunning = false
    await send(true)
    try {
      while (!stopped) {
        await deps.sleep(timings.keepaliveMs)
        if (stopped) break
        const elapsed = deps.now() - startedAt
        if (elapsed >= timings.maxMs) break
        const running = await deps.isRunning().catch(() => false)
        if (running) seenRunning = true
        else if (seenRunning || elapsed >= timings.warmupMs) break
        await send(true)
      }
    } finally {
      await send(false)
    }
  }

  return {
    stop: () => {
      stopped = true
    },
    done: run(),
  }
}
