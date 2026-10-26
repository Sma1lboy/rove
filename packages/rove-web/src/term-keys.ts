/** The keys a phone's soft keyboard lacks, as the bytes a terminal sends for them. */

export type TermKey = { readonly id: string; readonly cap: string; readonly bytes: (appCursor: boolean) => string }

const arrow = (id: string, cap: string, final: string): TermKey => ({
  id,
  cap,
  // DECCKM: a full-screen app that asked for application cursor keys reads `ESC O x`, not `ESC [ x`.
  bytes: (appCursor) => `\x1b${appCursor ? "O" : "["}${final}`,
})

export const TERM_KEYS: readonly TermKey[] = [
  { id: "esc", cap: "esc", bytes: () => "\x1b" },
  { id: "tab", cap: "tab", bytes: () => "\t" },
  { id: "backtab", cap: "⇧tab", bytes: () => "\x1b[Z" },
  { id: "interrupt", cap: "^C", bytes: () => "\x03" },
  arrow("up", "↑", "A"),
  arrow("down", "↓", "B"),
  arrow("left", "←", "D"),
  arrow("right", "→", "C"),
]

/** One typed character as its Ctrl chord (`c` → ETX); anything without one passes through. */
export function ctrlChord(data: string): string {
  if (data.length !== 1) return data
  const code = data.toUpperCase().charCodeAt(0)
  if (code === 0x20) return "\x00"
  if (code === 0x3f) return "\x7f"
  return code >= 0x40 && code <= 0x5f ? String.fromCharCode(code & 0x1f) : data
}
