/**
 * The last screen of a terminal, held over its xterm while a replay is parsed and the engine repaints:
 * the old frame stays until the new content is ready instead of a blank or half-drawn one.
 */

import type { SerializeAddon } from "@xterm/addon-serialize"
import type { IDisposable, Terminal } from "@xterm/xterm"
import { terminalTheme } from "./prefs-theme.ts"
import { FONT_FAMILY, XTERM_THEME } from "./term-look.ts"
import { TERM_SNAPSHOT } from "./ui/shell.ts"

/** A cover that no one lowers (a reattach that never settles) goes away on its own after this. */
const COVER_CAP_MS = 1500

export interface TermCover {
  /** The screen as HTML, for a cover raised now or by the next mount of this terminal. */
  snapshot(): string
  /** Put `html` over the terminal (replacing any cover already up). */
  raise(html: string): void
  lower(): void
  readonly raised: boolean
}

export function createCover(term: Terminal, host: HTMLElement, serialize: SerializeAddon): TermCover {
  let cover: HTMLElement | null = null
  let resize: IDisposable | null = null
  let cap: number | null = null
  // xterm sizes its cells from measured glyphs and settles them after the first render, so the
  // snapshot's rows and columns follow every resize instead of a value read at mount.
  const fit = () => {
    const screen = term.element?.querySelector<HTMLElement>(".xterm-screen")
    if (!cover || !screen || term.rows <= 0 || term.cols <= 0) return
    const ctx = document.createElement("canvas").getContext("2d")
    if (ctx) ctx.font = `${term.options.fontSize ?? 13}px ${FONT_FAMILY}`
    const glyph = ctx?.measureText("W").width ?? 0
    cover.style.setProperty("--row-h", `${screen.clientHeight / term.rows}px`)
    if (glyph > 0) cover.style.letterSpacing = `${screen.clientWidth / term.cols - glyph}px`
  }
  const lower = () => {
    cover?.remove()
    cover = null
    resize?.dispose()
    resize = null
    if (cap !== null) window.clearTimeout(cap)
    cap = null
  }
  return {
    snapshot: () => serialize.serializeAsHTML({ scrollback: 0, includeGlobalBackground: true }),
    raise(html) {
      lower()
      cover = document.createElement("div")
      cover.className = TERM_SNAPSHOT
      cover.innerHTML = html
      cover.style.backgroundColor = (terminalTheme.get() ?? XTERM_THEME).background ?? ""
      host.append(cover)
      fit()
      requestAnimationFrame(fit)
      resize = term.onResize(fit)
      cap = window.setTimeout(lower, COVER_CAP_MS)
    },
    lower,
    get raised() {
      return cover !== null
    },
  }
}
