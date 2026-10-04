/**
 * The sidebar's ~2s poll clock — one process-wide interval that runs only
 * while something subscribes. Rows fire their git polls from it without
 * rendering; a row whose output depends on the time (an age label, an
 * expiring token) subscribes through `useSyncExternalStore` and re-renders
 * alone. Same shape as `spinner-frame-store.ts`.
 */

import { MAIN_BRANCH_POLL_MS } from "../panes/sidebar/view-core"

type Listener = () => void

const listeners = new Set<Listener>()
let tickCount = 0
let timer: ReturnType<typeof setInterval> | null = null

function tick(): void {
  tickCount++
  for (const listener of listeners) {
    try {
      listener()
    } catch {
      /* one subscriber must not break the others */
    }
  }
}

export function sidebarPollClockSnapshot(): number {
  return tickCount
}

export function subscribeSidebarPollClock(listener: Listener): () => void {
  listeners.add(listener)
  if (timer === null) {
    timer = setInterval(tick, MAIN_BRANCH_POLL_MS)
    timer.unref?.()
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }
}
