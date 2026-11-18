/** The keys a phone's soft keyboard lacks, as the bytes a terminal sends for them. */

export type TermKey = { readonly id: string; readonly cap: string; readonly bytes: (appCursor: boolean) => string }

const arrow = (id: string, cap: string, final: string): TermKey => ({
  id,
  cap,
  // DECCKM: a full-screen app that asked for application cursor keys reads `ESC O x`, not `ESC [ x`.
  bytes: (appCursor) => `\x1b${appCursor ? "O" : "["}${final}`,
})

const ENTER: TermKey = { id: "enter", cap: "⏎", bytes: () => "\r" }

export const TERM_KEYS: readonly TermKey[] = [
  { id: "esc", cap: "esc", bytes: () => "\x1b" },
  { id: "tab", cap: "tab", bytes: () => "\t" },
  { id: "backtab", cap: "⇧tab", bytes: () => "\x1b[Z" },
  { id: "interrupt", cap: "^C", bytes: () => "\x03" },
  arrow("up", "↑", "A"),
  arrow("down", "↓", "B"),
  arrow("left", "←", "D"),
  arrow("right", "→", "C"),
  ENTER,
]

const digit = (n: number): TermKey => ({ id: `option-${n}`, cap: String(n), bytes: () => String(n) })

/**
 * Shown first while the tab's engine waits at a menu (its row reads `?`): the menu takes digits and
 * Enter as keys. Typed into the composer instead, they would be pasted and Enter would take the
 * highlighted option, whatever was typed.
 */
export const MENU_KEYS: readonly TermKey[] = [digit(1), digit(2), digit(3), digit(4), ENTER]

/** One typed character as its Ctrl chord (`c` → ETX); anything without one passes through. */
export function ctrlChord(data: string): string {
  if (data.length !== 1) return data
  const code = data.toUpperCase().charCodeAt(0)
  if (code === 0x20) return "\x00"
  if (code === 0x3f) return "\x7f"
  return code >= 0x40 && code <= 0x5f ? String.fromCharCode(code & 0x1f) : data
}

/** Shift+Enter as the TUI pane sends it (xterm modifyOtherKeys); xterm.js alone sends a bare CR, which submits. */
export const SHIFT_ENTER = "\x1b[27;2;13~"

type EnterPress = Pick<KeyboardEvent, "key" | "shiftKey" | "ctrlKey" | "metaKey" | "altKey" | "isComposing" | "keyCode">

/** Shift+Enter alone, not an IME commit (Safari's reports keyCode 229 with `isComposing` false). */
export function isShiftEnter(e: EnterPress): boolean {
  if (e.key !== "Enter" || !e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return false
  return !e.isComposing && e.keyCode !== 229
}

/** Copy chords the browser would not make on its own inside xterm's textarea: Cmd+C, Ctrl+Shift+C, and Ctrl+C with a selection. */
export function isCopyChord(e: KeyboardEvent): "interrupt-or-copy" | "copy" | null {
  if (e.type !== "keydown" || e.key.toLowerCase() !== "c" || e.altKey) return null
  if (e.metaKey || (e.ctrlKey && e.shiftKey)) return "copy"
  return e.ctrlKey ? "interrupt-or-copy" : null
}
