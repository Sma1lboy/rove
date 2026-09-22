/**
 * The single chord → macOS-glyph formatter for footer, F1 and status bar
 * (`ctrl+q` → `⌃ Q`, `shift+tab` → `⇧ tab`). Modifier glyphs concatenate, then
 * a SPACE, then the key, so icons read apart from the letter; named keys become
 * glyphs (`⏎ ⎋ ↑`) except `tab`, which stays a word; `prefix X` is the two-step
 * PureTUI chord, shown as `<prefix glyph> X`.
 */

const MODIFIER_GLYPH: Record<string, string> = {
  ctrl: "⌃",
  control: "⌃",
  alt: "⌥",
  opt: "⌥",
  option: "⌥",
  shift: "⇧",
  cmd: "⌘",
  command: "⌘",
  meta: "⌘",
  super: "⌘",
}

const KEY_GLYPH: Record<string, string> = {
  enter: "⏎",
  return: "⏎",
  esc: "⎋",
  escape: "⎋",
  space: "␣",
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
  backspace: "⌫",
  delete: "⌦",
  del: "⌦",
  pgup: "⇞",
  pageup: "⇞",
  pgdn: "⇟",
  pagedown: "⇟",
  home: "↖",
  end: "↘",
}

/**
 * `upper` is true for MODIFIER chords (`⌃ Q`) and false for BARE keys, which
 * stay as pressed (`n`, not `N`; a deliberate `M` = Shift+M keeps its case).
 */
function formatKey(k: string, upper: boolean): string {
  // Compound hints (`j/k`, `enter/esc`, `[/]`): format each side (`⏎/⎋`, not `ENTER/ESC`).
  if (k.includes("/")) {
    return k
      .split("/")
      .map((part) => formatKey(part, upper))
      .join("/")
  }
  const low = k.toLowerCase()
  if (low === "tab") return "tab" // tab needs no glyph — just the word
  const named = KEY_GLYPH[low]
  if (named) return named
  if (/^f\d{1,2}$/.test(low)) return low.toUpperCase() // f1 → F1 (function keys)
  if (!upper) return k // bare key: keep as typed (n, M, j/k pieces, symbols)
  if (/^[a-z]$/.test(low)) return k.toUpperCase() // modified single letter → uppercase
  return k.replace(/[a-z]+/gi, (run) => run.toUpperCase()) // modified composite (hjkl → HJKL)
}

/**
 * `prefixGlyph` defaults to the PureTUI default `⌃A`.
 *
 *   formatChord("ctrl+q")      → "⌃ Q"
 *   formatChord("shift+tab")   → "⇧ tab"
 *   formatChord("ctrl+enter")  → "⌃ ⏎"
 *   formatChord("prefix f")    → "⌃A F"
 *   formatChord("j/k")         → "j/k"
 *   formatChord("ctrl+hjkl")   → "⌃ HJKL"
 */
export function formatChord(chord: string, prefixGlyph = "⌃A"): string {
  const s = chord.trim()
  if (!s) return s
  const pm = /^prefix\s+(.+)$/i.exec(s)
  if (pm) {
    const suffix = pm[1] ?? ""
    return `${prefixGlyph} ${suffix.includes("+") ? formatChord(suffix, prefixGlyph) : formatKey(suffix, true)}`
  }
  const parts = s.split("+")
  if (parts.length === 1) return formatKey(parts[0] ?? "", false) // bare key — keep its case
  const key = parts[parts.length - 1] ?? ""
  const mods = parts.slice(0, -1).map((p) => MODIFIER_GLYPH[p.toLowerCase().trim()] ?? p)
  return `${mods.join("")} ${formatKey(key, true)}`
}
