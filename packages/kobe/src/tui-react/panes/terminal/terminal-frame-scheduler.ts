import type { CliRenderer } from "@opentui/core"
import { flushSync } from "@opentui/react"
import type { TerminalRefreshScheduler } from "../../../tui/panes/terminal/pty-types"

const schedulers = new WeakMap<CliRenderer, TerminalRefreshScheduler>()

/** Build all dirty terminal snapshots and commit their rows before this frame
 * draws. A separate snapshot timer can otherwise miss the renderer's deadline. */
export function terminalFrameScheduler(renderer: CliRenderer): TerminalRefreshScheduler {
  const existing = schedulers.get(renderer)
  if (existing) return existing
  const pending = new Set<() => void>()
  const flush = async (): Promise<void> => {
    renderer.removeFrameCallback(flush)
    const batch = [...pending]
    pending.clear()
    flushSync(() => {
      for (const refresh of batch) refresh()
    })
  }
  const schedule: TerminalRefreshScheduler = (refresh) => {
    if (pending.size === 0) renderer.setFrameCallback(flush)
    pending.add(refresh)
    renderer.requestRender()
    return () => {
      pending.delete(refresh)
      if (pending.size === 0) renderer.removeFrameCallback(flush)
    }
  }
  schedulers.set(renderer, schedule)
  return schedule
}
