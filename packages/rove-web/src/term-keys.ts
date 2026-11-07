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
