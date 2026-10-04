/**
 * What the GUI's real terminal can do with pixels, for the pane emulators to
 * consult. Installed once by the process that owns the tty (the workspace GUI);
 * every other process (daemon, pty-host, `rove api`) never installs, so pane
 * emulators there forward and answer nothing.
 */

import type { CellPixelSize } from "./cell-pixel-size"

export interface TerminalGraphics {
  /** Cell size in pixels measured at boot; null when the terminal declined. */
  readonly cellPixelSize: CellPixelSize | null
  /** Writes raw Kitty graphics commands to the outer terminal; null when it does not speak them. */
  readonly writeKitty: ((data: Buffer) => void) | null
}

/**
 * Terminals that draw Kitty graphics WITH Unicode placeholders. Read from the
 * GUI's own env: panes scrub these before spawning children. A multiplexer
 * swallows the APC, so nesting disables it.
 */
export function outerTerminalDrawsKittyPlaceholders(env: Readonly<Record<string, string | undefined>>): boolean {
  if (env.TMUX || env.STY || env.ZELLIJ) return false
  return (
    env.TERM_PROGRAM === "ghostty" ||
    env.TERM === "xterm-ghostty" ||
    env.TERM === "xterm-kitty" ||
    !!env.GHOSTTY_RESOURCES_DIR ||
    !!env.KITTY_WINDOW_ID
  )
}

export function createTerminalGraphics(opts: {
  env: Readonly<Record<string, string | undefined>>
  /** stdout is a real terminal; a redirect draws nothing. */
  stdoutIsTTY: boolean
  cellPixelSize: CellPixelSize | null
  write: (data: Buffer) => void
}): TerminalGraphics {
  const kitty = opts.stdoutIsTTY && outerTerminalDrawsKittyPlaceholders(opts.env)
  return { cellPixelSize: opts.cellPixelSize, writeKitty: kitty ? opts.write : null }
}

let current: TerminalGraphics | null = null

export function installTerminalGraphics(graphics: TerminalGraphics | null): void {
  current = graphics
}

export function terminalGraphics(): TerminalGraphics | null {
  return current
}

/** The GUI's terminal draws Kitty graphics; false outside the GUI. */
export function terminalDrawsKitty(): boolean {
  return current?.writeKitty != null
}
