/**
 * Status-line controller for the relay loader splash: keeps the splash quiet during a fast load,
 * fades in the current loading phase once waiting crosses `SLOW_DELAY_MS`, and surfaces unpaired
 * instructions or connection errors right away.
 */

export const SLOW_DELAY_MS = 1500

export interface RelayStatusView {
  show(text: string, tone: "loading" | "info" | "error", retryLabel?: string): void
}

export interface RelayStatusTimer {
  set(fn: () => void, ms: number): ReturnType<typeof setTimeout>
  clear(id: ReturnType<typeof setTimeout>): void
}

const DEFAULT_TIMER: RelayStatusTimer = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (id) => clearTimeout(id),
}

export interface RelayStatusController {
  loading(text: string): void
  info(text: string): void
  error(text: string, retryLabel: string): void
  done(): void
}

export function createRelayStatus(
  view: RelayStatusView,
  delayMs = SLOW_DELAY_MS,
  timer: RelayStatusTimer = DEFAULT_TIMER,
): RelayStatusController {
  let pending: string | null = null
  let revealed = false
  let settled = false
  let handle: ReturnType<typeof setTimeout> | null = null

  const cancel = (): void => {
    if (handle !== null) {
      timer.clear(handle)
      handle = null
    }
  }

  return {
    loading(text) {
      if (settled) return
      pending = text
      if (revealed) {
        view.show(text, "loading")
        return
      }
      if (handle === null) {
        handle = timer.set(() => {
          handle = null
          revealed = true
          if (!settled && pending !== null) view.show(pending, "loading")
        }, delayMs)
      }
    },
    info(text) {
      if (settled) return
      settled = true
      cancel()
      view.show(text, "info")
    },
    error(text, retryLabel) {
      if (settled) return
      settled = true
      cancel()
      view.show(text, "error", retryLabel)
    },
    done() {
      settled = true
      cancel()
    },
  }
}
