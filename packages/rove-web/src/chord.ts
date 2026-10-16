/**
 * A key press as `RoveKeymap` spells it: the candidate strings the TUI's `matchKey()` mints,
 * most specific first, so one comparison covers defaults and the user's `keybindings.yaml`.
 * Modifier order is the dispatcher's (ctrl, cmd, alt, shift).
 */

export interface KeyPress {
  readonly key: string
  readonly code?: string
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly altKey: boolean
  readonly shiftKey: boolean
}

const NAMED: Readonly<Record<string, string>> = {
  Enter: "return",
  " ": "space",
  Escape: "escape",
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  PageUp: "pageup",
  PageDown: "pagedown",
}

/** Option rewrites the typed character on a Mac, so name the physical key instead. */
function nameOf(e: KeyPress): string {
  if (e.altKey && e.code) {
    const letter = /^Key([A-Z])$/.exec(e.code)
    if (letter?.[1]) return letter[1].toLowerCase()
    const digit = /^Digit(\d)$/.exec(e.code)
    if (digit?.[1]) return digit[1]
  }
  return NAMED[e.key] ?? e.key.toLowerCase()
}

export function chordCandidates(e: KeyPress): string[] {
  const name = nameOf(e)
  const base = name === "return" ? ["return", "enter"] : [name]
  const mods: string[] = []
  if (e.ctrlKey) mods.push("ctrl")
  if (e.metaKey) mods.push("cmd")
  if (e.altKey) mods.push("alt")
  const single = name.length === 1
  if (e.shiftKey && !single) mods.push("shift")
  if (mods.length === 0) return e.shiftKey && single ? [...base.map((n) => `shift+${n}`), ...base] : base
  // A browser can tell Ctrl+Shift+Z from Ctrl+Z, and the grammar has no chord for it: no candidate.
  if (e.shiftKey && single) return []
  return base.map((n) => `${mods.join("+")}+${n}`)
}

/** A stroke as it is read: `shift+p` is the typed `P`, anything else stays as the keymap spells it. */
export function strokeText(chord: string): string {
  return chord.startsWith("shift+") && chord.length === "shift+".length + 1
    ? chord.slice("shift+".length).toUpperCase()
    : chord
}
