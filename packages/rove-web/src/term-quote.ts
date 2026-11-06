/**
 * Quote what is selected in a task's terminal into that task's prompt, as a fenced block with the cursor
 * after it for a comment. The touch composer takes it into its draft; on a desktop the engine's own input is
 * the terminal, so it is pasted there as a bracketed paste (a multi-line quote never submits early).
 */

import { t } from "./i18n/index.ts"
import { appendQuote, draftKey } from "./term-drafts.ts"
import type { TermHandle } from "./term-mount.ts"
import { toast } from "./ui.ts"

/** The selection as a fenced block, or null when it holds no text. The fence outgrows any backticks inside. */
export function fenceQuote(selection: string): string | null {
  const lines = selection.split("\n").map((line) => line.trimEnd())
  while (lines[0] === "") lines.shift()
  while (lines.at(-1) === "") lines.pop()
  if (lines.length === 0) return null
  const longest = Math.max(0, ...Array.from(lines.join("\n").matchAll(/`+/g), (m) => m[0].length))
  const fence = "`".repeat(Math.max(3, longest + 1))
  return `${fence}\n${lines.join("\n")}\n${fence}\n`
}

/** The composer under this tab's terminal, when it is on screen (touch only). */
function visibleComposer(key: string): HTMLFormElement | null {
  const form = document.querySelector<HTMLFormElement>(`[data-composer="${CSS.escape(key)}"]`)
  return form && form.offsetParent !== null ? form : null
}

/** True = the quote went to the prompt (the selection is dropped); false = it stayed, with a toast when it matters. */
export function quoteSelection(handle: TermHandle, taskId: string, tabId: string, atMenu: boolean): boolean {
  const quote = fenceQuote(handle.term.getSelection())
  if (quote === null) return false
  const key = draftKey(taskId, tabId)
  const composer = visibleComposer(key)
  if (composer) {
    appendQuote(key, quote)
    handle.term.clearSelection()
    const field = composer.querySelector("textarea")
    field?.focus()
    field?.setSelectionRange(field.value.length, field.value.length)
    return true
  }
  if (atMenu) {
    toast(t("quote.atMenu"), "error")
    return false
  }
  // Without bracketed paste xterm turns the newlines into Enter and the engine would send the half-written prompt.
  if (!handle.term.modes.bracketedPasteMode) {
    toast(t("quote.notReady"), "error")
    return false
  }
  handle.term.paste(quote)
  handle.term.clearSelection()
  handle.term.focus()
  return true
}
