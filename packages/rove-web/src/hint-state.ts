/** First-use pane hints (TUI `hints.<pane>.used`): a pane's fuller key line shows until its keys are used once. Kept per browser. */

import { createStore } from "./store.ts"

export type HintPane = "sidebar" | "files"

const key = (pane: HintPane): string => `rove.web.hintUsed.${pane}`

export const hintsUsed = createStore<Readonly<Record<HintPane, boolean>>>({
  sidebar: localStorage.getItem(key("sidebar")) === "1",
  files: localStorage.getItem(key("files")) === "1",
})

/** Safe per keypress: it writes once. */
export function markHintUsed(pane: HintPane): void {
  if (hintsUsed.get()[pane]) return
  localStorage.setItem(key(pane), "1")
  hintsUsed.set({ ...hintsUsed.get(), [pane]: true })
}
