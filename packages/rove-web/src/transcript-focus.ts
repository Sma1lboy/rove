/** A palette conversation hit asks the Chat tab to open on the message it matched. */

import { showPanel } from "./panel-state.ts"
import { createStore } from "./store.ts"
import type { HitRef } from "./transcript-data.ts"
import { zen } from "./ui.ts"

export interface TranscriptTarget {
  readonly taskId: string
  readonly hit: HitRef
  /** Tells one request from the next, so asking for the same message twice scrolls twice. */
  readonly nonce: number
}

/** Set by a hit, cleared by the tab once it has scrolled there (or found the message gone). */
export const transcriptTarget = createStore<TranscriptTarget | null>(null)

let nonce = 0

/** Open the task's Chat tab (leaving zen, and on a phone switching to it) scrolled to `hit`'s message. */
export function openTranscriptAt(taskId: string, hit: HitRef): void {
  transcriptTarget.set({ taskId, hit, nonce: ++nonce })
  showPanel(taskId, "chat")
  if (zen.get()) zen.set(false)
}
