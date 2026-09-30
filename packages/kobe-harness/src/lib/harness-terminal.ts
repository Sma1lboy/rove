/**
 * The one xterm configuration `/harness` photographs. The live terminal and
 * the film replay both open through here, so a replayed frame is drawn by the
 * same theme, fonts, addons and renderer policy as the take it came from.
 */

import { ClipboardAddon } from "@xterm/addon-clipboard"
import { Unicode11Addon } from "@xterm/addon-unicode11"
import { WebLinksAddon } from "@xterm/addon-web-links"
import { Terminal } from "@xterm/xterm"
import "@xterm/xterm/css/xterm.css"
import {
  loadTerminalRenderer,
  type TerminalRendererMode,
} from "./terminal-renderer.ts"

// xterm palette mirrored from the claude TUI theme (claude.json).
const CLAUDE_XTERM_THEME = {
  background: "#141413",
  foreground: "#eae7df",
  cursor: "#cc785c",
  cursorAccent: "#141413",
  selectionBackground: "#33312e",
  black: "#141413",
  red: "#d47563",
  green: "#9aca86",
  yellow: "#e8c96b",
  blue: "#61aaf2",
  magenta: "#9b87f5",
  cyan: "#d4967e",
  white: "#a9a39a",
  brightBlack: "#6b665f",
  brightRed: "#d47563",
  brightGreen: "#9aca86",
  brightYellow: "#e8c96b",
  brightBlue: "#61aaf2",
  brightMagenta: "#9b87f5",
  brightCyan: "#e0ab96",
  brightWhite: "#eae7df",
} as const

const TERMINAL_FONT_FAMILY =
  '"JetBrains Mono", "JetBrainsMono Nerd Font", "MesloLGS NF", "Symbols Nerd Font Mono", "SF Mono", ui-monospace, Menlo, monospace'

/**
 * Families in {@link TERMINAL_FONT_FAMILY} that the browser must have resolved
 * before the terminal is worth photographing. The bundled JetBrains Mono is a
 * LATIN subset, so every icon glyph an engine draws (`▶`, branch and status
 * symbols) necessarily falls through to a Nerd Font — a family the page never
 * asks for until something actually renders that character.
 */
const TERMINAL_FONT_FAMILIES = [
  '"JetBrains Mono"',
  '"JetBrainsMono Nerd Font"',
  '"MesloLGS NF"',
  '"Symbols Nerd Font Mono"',
] as const

/**
 * Warm every family in the stack, not just the first.
 *
 * `document.fonts.load()` resolves one family at a time, so awaiting only
 * JetBrains Mono leaves the Nerd Fonts to load lazily — i.e. after the first
 * frame that needs them. Interactively nobody notices; a scripted capture
 * screenshots the frame in between and photographs missing-glyph boxes (`▯▯`
 * in place of `▶▶`) where the icons belong. Each family is settled
 * independently so an absent
 * one (a machine without Nerd Fonts) cannot block the others.
 */
export async function loadTerminalFont(): Promise<void> {
  if (!("fonts" in document)) return
  await Promise.allSettled(
    TERMINAL_FONT_FAMILIES.map((family) =>
      document.fonts.load(`12px ${family}`),
    ),
  )
  try {
    // The per-family loads above cover the stack; `ready` covers anything else
    // the page is still fetching, so layout is settled before the first paint
    // a capture might grab.
    await document.fonts.ready
  } catch {
    /* fallback font stack still renders if the bundled font fails */
  }
}

export type HarnessTerminalOptions = {
  renderer: TerminalRendererMode
  /** See `ChatTerminal`'s `transparent` / `hostBackground` props. */
  transparent: boolean
  hostBackground?: string
  /** Off for replay: a timer-driven blink would make frames depend on wall time. */
  cursorBlink: boolean
}

/** Open the harness xterm in `el`. Call after {@link loadTerminalFont}. */
export function openHarnessTerminal(
  el: HTMLElement,
  {
    renderer,
    transparent,
    hostBackground,
    cursorBlink,
  }: HarnessTerminalOptions,
): Terminal {
  const term = new Terminal({
    theme: transparent
      ? {
          ...CLAUDE_XTERM_THEME,
          // Opaque host color when the harness simulates one (so OSC 11
          // reports it); near-invisible black otherwise so the page
          // backdrop shows through the unpainted cells.
          background: hostBackground ?? "rgba(0,0,0,0.01)",
        }
      : CLAUDE_XTERM_THEME,
    allowTransparency: transparent,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 12,
    cursorBlink,
    allowProposedApi: true,
    scrollback: 5000,
  })
  // Unicode 11 widths: default Unicode 6 measures emoji as one cell,
  // desyncing wrap/cursor from what the server-side PTY apps assume.
  term.loadAddon(new Unicode11Addon())
  term.unicode.activeVersion = "11"
  // OSC 52 → navigator.clipboard, so in-terminal copy (tmux/engine
  // copy chords) lands on the viewer's clipboard across the web gap.
  term.loadAddon(new ClipboardAddon())
  // Plain URLs in engine output become clickable.
  term.loadAddon(new WebLinksAddon())
  term.open(el)
  // The visual harness normally keeps this renderer policy. Its explicit
  // DOM diagnostic mode skips both accelerated addons; buffer reads stay
  // renderer-independent either way. Renderer choice is a three-way trade:
  //
  //   DOM    — always available, but each cell is its own span drawn with
  //            the font, so `customGlyphs` is off and block-drawing
  //            characters show a seam at every cell boundary.
  //   WebGL  — tiles those glyphs correctly, but fills default-background
  //            cells as solid colour, which turns into black boxes the
  //            moment the background is transparent.
  //   Canvas — draws glyphs the same way WebGL does, on a 2D context that
  //            composites over what is behind it.
  //
  // So transparency picks Canvas and opacity picks WebGL. Opaque WebGL
  // failures fall through Canvas before the final DOM fallback.
  loadTerminalRenderer(term, renderer, transparent)
  return term
}
