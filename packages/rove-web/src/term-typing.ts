import type { Terminal } from "@xterm/xterm"

/** Custom key input bypasses xterm's onKey; run the same typing effects before either path sends data. */
export function createTyping(term: Terminal) {
  const listeners = new Set<() => void>()
  const notify = () => {
    for (const listener of listeners) listener()
  }
  const keyed = term.onKey(notify)
  return {
    onKey(listener: () => void) {
      listeners.add(listener)
      return { dispose: () => void listeners.delete(listener) }
    },
    input(data: string) {
      notify()
      term.input(data, true)
    },
    dispose() {
      keyed.dispose()
      listeners.clear()
    },
  }
}
