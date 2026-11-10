/**
 * The row that the pixel-smooth scroll's offset uncovers. xterm paints exactly `rows` rows, so while the screen
 * layer sits up to half a row away from the grid, a band at the pane's edge has nothing to show. This draws the
 * neighbouring row of the buffer (the one above the viewport, or the one below it) onto a canvas that rides
 * inside `.xterm-screen`, so it moves with the screen, and clips it to exactly that band: at rest, and anywhere
 * outside the band, the pane is what xterm painted.
 */

import type { IBufferCell, ITheme, Terminal } from "@xterm/xterm"

type Rgb = string

/** The 256-colour palette: the theme's sixteen, then xterm's 6x6x6 cube and 24 greys. */
export function paletteColor(index: number, theme: ITheme): Rgb {
  const ansi = [
    theme.black,
    theme.red,
    theme.green,
    theme.yellow,
    theme.blue,
    theme.magenta,
    theme.cyan,
    theme.white,
    theme.brightBlack,
    theme.brightRed,
    theme.brightGreen,
    theme.brightYellow,
    theme.brightBlue,
    theme.brightMagenta,
    theme.brightCyan,
    theme.brightWhite,
  ]
  if (index < 16) return ansi[index] ?? "#ffffff"
  if (index >= 232) {
    const v = 8 + (index - 232) * 10
    return `rgb(${v},${v},${v})`
  }
  const n = index - 16
  const level = (c: number) => (c === 0 ? 0 : 55 + c * 40)
  return `rgb(${level(Math.floor(n / 36))},${level(Math.floor(n / 6) % 6)},${level(n % 6)})`
}

type CellLike = Pick<
  IBufferCell,
  "isBold" | "isDim" | "isInverse" | "isFgDefault" | "isBgDefault" | "isFgRGB" | "isBgRGB" | "getFgColor" | "getBgColor"
>

/** A cell's text and background colours as xterm draws them (inverse swaps, bold brightens the first eight). */
export function cellColors(cell: CellLike, theme: ITheme): { readonly fg: Rgb; readonly bg: Rgb } {
  const defaultFg = theme.foreground ?? "#ffffff"
  const defaultBg = theme.background ?? "#000000"
  let fg = defaultFg
  if (!cell.isFgDefault()) {
    const value = cell.getFgColor()
    fg = cell.isFgRGB()
      ? `#${value.toString(16).padStart(6, "0")}`
      : paletteColor(cell.isBold() && value < 8 ? value + 8 : value, theme)
  }
  let bg = defaultBg
  if (!cell.isBgDefault()) {
    const value = cell.getBgColor()
    bg = cell.isBgRGB() ? `#${value.toString(16).padStart(6, "0")}` : paletteColor(value, theme)
  }
  return cell.isInverse() ? { fg: bg, bg: fg } : { fg, bg }
}

export interface EdgeStrips {
  /** Show the band of `offsetPx` (positive: the screen moved down, the band is at the top) with the neighbouring row. */
  show(offsetPx: number, rowPx: number): void
  /** Draw the rows again, for output that landed while a band is on screen. */
  refresh(): void
  /** Hide both strips. */
  hide(): void
  /** Let the strips ease with the screen layer's `transition`. */
  transition(css: string): void
  dispose(): void
}

interface Strip {
  readonly side: "top" | "bottom"
  canvas: HTMLCanvasElement | null
  /** What the canvas shows now. */
  key: string
}

export function createEdgeStrips(term: Terminal): EdgeStrips {
  const top: Strip = { side: "top", canvas: null, key: "" }
  const bottom: Strip = { side: "bottom", canvas: null, key: "" }
  let active: Strip | null = null
  let rowHeight = 0

  // The strips ride inside `.xterm-screen`, so the screen layer's own transform carries them. A strip's canvas is
  // made the first time its band is needed.
  function draw(strip: Strip, rowPx: number) {
    const host = term.element?.querySelector<HTMLElement>(".xterm-screen")
    if (!host || term.cols <= 0) return
    if (!strip.canvas) {
      strip.canvas = document.createElement("canvas")
      strip.canvas.style.cssText = "position:absolute;left:0;pointer-events:none;display:none"
    }
    const ctx = strip.canvas.getContext("2d")
    if (!ctx) return
    if (strip.canvas.parentElement !== host) host.appendChild(strip.canvas)
    const dpr = window.devicePixelRatio || 1
    const width = host.clientWidth
    const pxW = Math.round(width * dpr)
    const pxH = Math.round(rowPx * dpr)
    if (strip.canvas.width !== pxW || strip.canvas.height !== pxH) {
      strip.canvas.width = pxW
      strip.canvas.height = pxH
      strip.key = ""
    }
    strip.canvas.style.width = `${width}px`
    strip.canvas.style.height = `${rowPx}px`
    strip.canvas.style.top = strip.side === "top" ? `${-rowPx}px` : `${rowPx * term.rows}px`
    const buffer = term.buffer.active
    const line = buffer.getLine(strip.side === "top" ? buffer.viewportY - 1 : buffer.viewportY + term.rows)
    const theme = term.options.theme ?? {}
    // A row already on the canvas is not drawn again: most frames of a gesture only move the offset.
    const key = `${line?.translateToString(false) ?? ""}|${width}|${rowPx}|${dpr}|${theme.background}|${theme.foreground}`
    if (key === strip.key) return
    strip.key = key
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = theme.background ?? "#000000"
    ctx.fillRect(0, 0, width, rowPx)
    if (!line) return
    const cellW = width / term.cols
    const family = term.options.fontFamily ?? "monospace"
    const size = term.options.fontSize ?? 13
    ctx.textBaseline = "middle"
    const cell = buffer.getNullCell()
    let font = ""
    for (let x = 0; x < term.cols; x++) {
      line.getCell(x, cell)
      const cw = cell.getWidth()
      if (cw === 0) continue
      const { fg, bg } = cellColors(cell, theme)
      if (!cell.isBgDefault() || cell.isInverse()) {
        ctx.fillStyle = bg
        ctx.fillRect(x * cellW, 0, cellW * cw, rowPx)
      }
      const chars = cell.getChars()
      if (chars === "" || chars === " " || cell.isInvisible()) continue
      const face = `${cell.isItalic() ? "italic " : ""}${cell.isBold() ? "bold " : ""}${size}px ${family}`
      // Assigning a font parses it: only when a cell's face differs from the last one drawn.
      if (face !== font) ctx.font = font = face
      ctx.globalAlpha = cell.isDim() ? 0.5 : 1
      ctx.fillStyle = fg
      ctx.fillText(chars, x * cellW, rowPx / 2 + 0.5)
      ctx.globalAlpha = 1
    }
  }

  const clip = (strip: Strip, canvas: HTMLCanvasElement, revealedPx: number, rowPx: number) => {
    // Only the revealed band shows: the rest of the row would sit in the pane's padding, which at rest is empty.
    const hidden = Math.max(0, rowPx - revealedPx)
    canvas.style.clipPath = strip.side === "top" ? `inset(${hidden}px 0 0 0)` : `inset(0 0 ${hidden}px 0)`
    canvas.style.display = ""
  }

  return {
    show(offsetPx, rowPx) {
      // An offset of zero is the screen easing home: the strip that showed keeps showing while its band closes.
      if (offsetPx !== 0) active = offsetPx > 0 ? top : bottom
      if (!active) return
      const idle = active === top ? bottom : top
      if (idle.canvas) idle.canvas.style.display = "none"
      rowHeight = rowPx
      if (offsetPx !== 0) draw(active, rowPx)
      if (active.canvas) clip(active, active.canvas, Math.abs(offsetPx), rowPx)
    },
    refresh() {
      if (active?.canvas && active.canvas.style.display !== "none") draw(active, rowHeight)
    },
    hide() {
      active = null
      if (top.canvas) top.canvas.style.display = "none"
      if (bottom.canvas) bottom.canvas.style.display = "none"
    },
    transition(css) {
      for (const strip of [top, bottom]) if (strip.canvas) strip.canvas.style.transition = css
    },
    dispose() {
      top.canvas?.remove()
      bottom.canvas?.remove()
    },
  }
}
