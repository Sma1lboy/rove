/** How a web terminal looks: the default theme, the font stack and the font size. */

import type { Terminal } from "@xterm/xterm"
import { isNarrow, onNarrowChange } from "./layout.ts"
import { terminalFontFamily } from "./prefs-theme.ts"

/** The phone layout reads a step larger: 45 columns on a 390px screen. */
export const termFontSize = (): number => (isNarrow() ? 14 : 13)

/** Keeps a mounted terminal's size and theme font family in step with viewport and theme changes. */
export const followFontSize = (term: Terminal, refit: () => void): (() => void) => {
  const offNarrow = onNarrowChange(() => {
    term.options.fontSize = termFontSize()
    refit()
  })
  const offFont = terminalFontFamily.subscribe(() => {
    const next = terminalFontFamily.get() ?? FONT_FAMILY
    if (term.options.fontFamily !== next) {
      term.options.fontFamily = next
      refit()
    }
  })
  return () => {
    offNarrow()
    offFont()
  }
}

/** The TUI's default `claude` theme, dark (`theme/claude.json`). */
export const XTERM_THEME = {
  background: "#141413",
  foreground: "#eae7df",
  cursor: "#cc785c",
  cursorAccent: "#141413",
  selectionBackground: "#33312e",
  black: "#141413",
  red: "#ec6f74",
  green: "#9aca86",
  yellow: "#e8c96b",
  blue: "#61aaf2",
  magenta: "#9b87f5",
  cyan: "#d4967e",
  white: "#a9a39a",
  brightBlack: "#6b665f",
  brightRed: "#ec6f74",
  brightGreen: "#9aca86",
  brightYellow: "#e8c96b",
  brightBlue: "#61aaf2",
  brightMagenta: "#9b87f5",
  brightCyan: "#e0ab96",
  brightWhite: "#eae7df",
}

/**
 * The bundled JetBrains Mono, then the bundled Nerd Font symbols (`tailwind.css`), so the icons
 * engines draw (Claude Code's status line, prompt themes) render on a machine with no Nerd Font
 * installed. The browser falls back per glyph, so only the icon code points come from the second.
 */
export const NERD_SYMBOLS_FAMILY = "Rove Nerd Symbols"
export const FONT_FAMILY = [
  '"JetBrains Mono"',
  `"${NERD_SYMBOLS_FAMILY}"`,
  '"SF Mono"',
  "ui-monospace",
  "Menlo",
  "monospace",
].join(", ")
