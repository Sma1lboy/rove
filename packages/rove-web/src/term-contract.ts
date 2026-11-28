/**
 * The terminal's contract without xterm: the stream key, the notice the view
 * draws over a dead pane, and the handle's shape. Everything that only needs
 * these (dialog hints, the notice strip, the split actions) imports here, so
 * the 470 KB xterm stack stays out of their modules and out of the entry chunk.
 */

import type { Terminal } from "@xterm/xterm"

/** `DEFAULT_PAGE_SIZE`: lines per `ctrl+pgup` / `ctrl+pgdown`. */
export const SCROLL_PAGE_LINES = 10

export type Notice =
  | { readonly kind: "none" }
  | { readonly kind: "restored" }
  | { readonly kind: "notLive" }
  | { readonly kind: "exited"; readonly code: number | null }
  | { readonly kind: "failed"; readonly message: string }

export interface TermHandle {
  readonly term: Terminal
  readonly stream: string
  /** User scrolls (keys, the scroll chips): negative = toward older output. */
  scrollLines(lines: number): void
  scrollToTop(): void
  scrollToBottom(): void
  /** The next single key typed reaches the engine as its Ctrl chord; `onUsed` fires when it does. `null` disarms. */
  armCtrl(onUsed: (() => void) | null): void
  /** Attach again (a reset respawned the session under the same key). */
  reattach(): Promise<void>
  /** The visible screen as HTML, for a later mount of the same stream to show while it reattaches. */
  snapshot(): string
  dispose(): void
}

export function streamKey(taskId: string, tabId: string, leafId?: string): string {
  return leafId && leafId !== "leaf-1" ? `${taskId}::${tabId}::${leafId}` : `${taskId}::${tabId}`
}
