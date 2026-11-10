/**
 * Text that edits itself after it was typed: a voice tool that types the raw transcript, then selects
 * or deletes it and types the improved one; macOS dictation correcting a phrase; a spell-check fix.
 * xterm.js forwards only what a new `input` event inserts and ignores deletions and replacements, so the
 * PTY keeps the old text and gets the new on top. Its hidden textarea does hold the text typed so far and
 * the browser edits it as asked, so each edit of it is turned into the backspaces and text that make the
 * PTY's line match. Plain appends, keys, paste and keyboard IMEs stay with xterm. A tool may also paste
 * its transcript and later select it and paste the improved one: a pasted phrase stays part of the run.
 */

import type { Terminal } from "@xterm/xterm"

const DEL = "\x7f"
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })

/** An edit xterm does not carry out: replacements and deletions, plus dictation inserts it ignores. */
const EDIT = /^(?:insertText|insertReplacementText|insertTranscription|delete\w+|history(?:Undo|Redo))$/

/**
 * What turns a line that ends in `before` into one that ends in `after`: one DEL per character past what
 * they share (a character is one DEL whatever its width), then the rest of `after`. A line break in
 * `before` was already submitted, so nothing up to it is erased.
 */
export function editBytes(before: string, after: string): string {
  const old = Array.from(segmenter.segment(before), (part) => part.segment)
  const next = Array.from(segmenter.segment(after), (part) => part.segment)
  let kept = 0
  while (kept < old.length && kept < next.length && old[kept] === next[kept]) kept++
  const floor = old.map((c) => /[\r\n]/.test(c)).lastIndexOf(true) + 1
  return DEL.repeat(old.length - Math.max(kept, floor)) + next.slice(kept).join("")
}

// ponytail: one fixed length for every engine; an engine that folds a shorter paste into a placeholder
// needs its own limit from the engine contract.
const PASTED_RUN_MAX = 500

/**
 * A paste that can still be edited: one line, short enough that an engine keeps it in its input as typed
 * text. A long or multi-line paste may be folded into a placeholder, where a DEL per character erases more
 * than the paste.
 */
export function pasteStaysEditable(text: string): boolean {
  return text.length > 0 && text.length <= PASTED_RUN_MAX && !/[\r\n]/.test(text)
}

/**
 * The bytes for one `input` event, or null when xterm's own handling is right: a plain append of text it
 * forwards, and anything it was never asked to do (paste, a composition, a key).
 */
export function inputFix(type: string, data: string | null, before: string, after: string): string | null {
  if (!EDIT.test(type)) return null
  if (type === "insertText" && data && after === before + data) return null
  return editBytes(before, after)
}

/**
 * The bytes owed after a composition ends. `before` is what the PTY holds of the run when it began; xterm
 * then sent the textarea's text past `start`, which is the whole composition unless it rewrote text that
 * was already there.
 */
export function compositionFix(before: string, start: number, after: string): string {
  return editBytes(before + after.substring(start), after)
}

/** Follows edits of `term`'s textarea; `send` writes to the PTY. Returns its remover. */
export function attachDictationGuard(term: Terminal, send: (data: string) => void): () => void {
  const area = term.textarea
  const host = term.element
  if (!area || !host) return () => {}

  // The textarea text the PTY has been told about; `before` is the text an edit starts from. xterm also loads
  // the textarea with a terminal selection (a right-click, a Linux drag) that never went to the PTY: an edit
  // of that must not erase anything. Not every edit is preceded by a `beforeinput`.
  let known = ""
  let before = ""
  let composing = false
  let composeBefore = ""
  let composeStart = 0
  let imeKeyDown = false

  // A keyboard IME's key: xterm reads what such a key changed off the textarea itself.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.keyCode === 229 || e.key === "Process" || e.key === "Unidentified") imeKeyDown = true
  }
  const onKeyUp = () => {
    imeKeyDown = false
  }
  const onBeforeInput = () => {
    before = area.value === known ? known : ""
  }
  const onInput = (e: Event) => {
    const ev = e as InputEvent
    if (ev.target !== area) return
    if (ev.inputType === "insertFromPaste") {
      if (!pasteStaysEditable(area.value)) area.value = ""
    } else if (!ev.isComposing && !imeKeyDown) {
      const bytes = inputFix(ev.inputType, ev.data, before, area.value)
      if (bytes !== null) {
        ev.stopImmediatePropagation()
        if (bytes) send(bytes)
      }
    }
    known = before = area.value
  }
  const onCompositionStart = () => {
    composing = true
    composeBefore = area.value === known ? known : ""
    composeStart = area.value.length
  }
  // Bubbling: runs after xterm's own listener, so the timer below fires after its commit.
  const onCompositionEnd = () => {
    composing = false
    const [was, start] = [composeBefore, composeStart]
    setTimeout(() => {
      const bytes = composing ? "" : compositionFix(was, start, area.value)
      if (bytes) send(bytes)
      known = before = area.value
    }, 0)
  }
  // Pasting over selected text replaces it: the selection goes first, then xterm sends the paste.
  const onPaste = () => {
    const { selectionStart: from, selectionEnd: to, value } = area
    if (from === to || composing || value !== known) return
    const bytes = editBytes(value, value.slice(0, from) + value.slice(to))
    if (bytes) send(bytes)
  }
  // A key, like blur, ends the run: the line has moved on from what the textarea holds.
  const endRun = () => {
    if (!composing && area.value) area.value = ""
    known = before = area.value
    imeKeyDown = false
  }

  host.addEventListener("keydown", onKeyDown, true)
  host.addEventListener("keyup", onKeyUp, true)
  host.addEventListener("beforeinput", onBeforeInput, true)
  host.addEventListener("input", onInput, true)
  host.addEventListener("compositionstart", onCompositionStart, true)
  host.addEventListener("compositionend", onCompositionEnd)
  host.addEventListener("paste", onPaste, true)
  area.addEventListener("blur", endRun)
  const typed = term.onKey(endRun)
  return () => {
    host.removeEventListener("keydown", onKeyDown, true)
    host.removeEventListener("keyup", onKeyUp, true)
    host.removeEventListener("beforeinput", onBeforeInput, true)
    host.removeEventListener("input", onInput, true)
    host.removeEventListener("compositionstart", onCompositionStart, true)
    host.removeEventListener("compositionend", onCompositionEnd)
    host.removeEventListener("paste", onPaste, true)
    area.removeEventListener("blur", endRun)
    typed.dispose()
  }
}
