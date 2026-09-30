import { useRenderer } from "@opentui/react"
import { useSyncExternalStore } from "react"
import { type TerminalSize, terminalSizeStore } from "../../tui/lib/terminal-size-store"

/** Terminal size on the renderer's one shared `resize` listener (see `terminal-size-store`). */
export function useTerminalSize(): TerminalSize {
  const store = terminalSizeStore(useRenderer())
  return useSyncExternalStore(store.subscribe, store.snapshot)
}
