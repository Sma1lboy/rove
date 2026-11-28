/**
 * Selecting never copies. An engine that draws its own selection sends its copy as OSC 52 when the
 * mouse lets go; that text is held for the copy chord. An OSC 52 that follows a key is the engine's
 * own copy command and goes straight to the clipboard.
 */

import type { Terminal } from "@xterm/xterm"
import { SHIFT_ENTER, isCopyChord, isShiftEnter } from "./term-keys.ts"
import { osc52Text } from "./term-osc52.ts"
import type { createTyping } from "./term-typing.ts"

/** An engine answers a release within a frame or two; a later write is its own doing. */
const RELEASE_COPY_MS = 500

export function createCopyHold(copy: (text: string) => void, now: () => number = () => performance.now()) {
  let held = ""
  let releasedAt = Number.NEGATIVE_INFINITY
  return {
    /** A key was pressed: what the engine copies next was asked for. */
    key(): void {
      releasedAt = Number.NEGATIVE_INFINITY
    },
    /** A new drag starts: the last held text is no longer what is selected. */
    press(): void {
      held = ""
    },
    release(): void {
      releasedAt = now()
    },
    osc52(text: string): void {
      if (now() - releasedAt < RELEASE_COPY_MS) held = text
      else copy(text)
    },
    text: (): string => held,
  }
}

/** The terminal's copy and paste keys, and the engine's OSC 52 copies. Returns the detach. */
export function attachCopy(
  term: Terminal,
  el: HTMLElement,
  typing: ReturnType<typeof createTyping>,
  copyText: (text: string) => Promise<boolean>,
  pasteImage: () => Promise<void>,
): () => void {
  const hold = createCopyHold((text) => void copyText(text))
  // Copy: ctrl+c with a selection copies and drops it, otherwise it stays the interrupt (TUI `copySelectionIfAny`).
  term.attachCustomKeyEventHandler((e) => {
    if (e.type === "keydown") hold.key()
    // Its keypress is swallowed too, or xterm would still send the CR.
    if (isShiftEnter(e)) {
      e.preventDefault()
      if (e.type === "keydown") typing.input(SHIFT_ENTER)
      return false
    }
    // On a Mac, Ctrl+V would ask the engine to read the rove machine's clipboard, not this browser's.
    // Elsewhere it is the browser's own paste, which the paste event already covers.
    const ctrlV =
      e.type === "keydown" && e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "v"
    if (ctrlV && /Mac|iPhone|iPad/.test(navigator.platform)) {
      void pasteImage()
      return false
    }
    const chord = isCopyChord(e)
    if (!chord) return true
    // Ctrl+Shift+C is also the browser's "inspect element": in the terminal it only ever copies.
    if (chord === "copy" && e.ctrlKey) e.preventDefault()
    // Ctrl+C with only the engine's selection goes to the engine: it copies or interrupts by its own rule.
    const text = term.getSelection() || (chord === "copy" ? hold.text() : "")
    if (text.trim().length === 0) return chord === "interrupt-or-copy"
    void copyText(text)
    term.clearSelection()
    return false
  })

  const onDown = (e: MouseEvent) => e.button === 0 && hold.press()
  const onUp = (e: MouseEvent) => e.button === 0 && hold.release()
  el.addEventListener("mousedown", onDown)
  document.addEventListener("mouseup", onUp)
  const osc52 = term.parser.registerOscHandler(52, (data) => {
    const text = osc52Text(data)
    if (text) hold.osc52(text)
    return true
  })
  return () => {
    el.removeEventListener("mousedown", onDown)
    document.removeEventListener("mouseup", onUp)
    osc52.dispose()
  }
}
