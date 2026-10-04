import type { TerminalStyleRewrite } from "@/types/terminal-presentation"
import { ATTR, type Chunk, type RGB, ansi256ToRgb } from "./sgr"

const XTERM_COLOR_MODE_DEFAULT = 0
const XTERM_COLOR_MODE_PALETTE = 1 << 24
const XTERM_COLOR_MODE_RGB = 3 << 24

type XtermCellLike = {
  getChars(): string
  getWidth(): number
  isFgDefault(): boolean
  isBgDefault(): boolean
  isFgPalette(): boolean
  isBgPalette(): boolean
  isFgRGB(): boolean
  isBgRGB(): boolean
  getFgColorMode(): number
  getBgColorMode(): number
  getFgColor(): number
  getBgColor(): number
  isAttributeDefault(): boolean
  isBold(): boolean | number
  isDim(): boolean | number
  isItalic(): boolean | number
  isUnderline(): boolean | number
  isBlink(): boolean | number
  isInverse(): boolean | number
  isInvisible(): boolean | number
  isStrikethrough(): boolean | number
}

type RenderStyle = {
  fg: string
  bg: string
  attrs: number
}

const DEFAULT_RENDER_STYLE: RenderStyle = Object.freeze({ fg: "", bg: "", attrs: 0 })

/** Resolve a `colorKey` token (`""` / `rgb:<packed>` / `pal:<index>`) straight to RGB, no ANSI. */
function colorKeyToRGB(key: string): RGB | undefined {
  if (key === "") return undefined
  const sep = key.indexOf(":")
  const value = Number(key.slice(sep + 1))
  if (key.startsWith("rgb:")) return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
  if (key.startsWith("pal:")) return ansi256ToRgb(value)
  return undefined
}

function colorKey(cell: XtermCellLike, kind: "fg" | "bg"): string {
  const isDefault = kind === "fg" ? cell.isFgDefault() : cell.isBgDefault()
  if (isDefault) return ""
  const mode = kind === "fg" ? cell.getFgColorMode() : cell.getBgColorMode()
  const color = kind === "fg" ? cell.getFgColor() : cell.getBgColor()
  if (mode === XTERM_COLOR_MODE_RGB || (kind === "fg" ? cell.isFgRGB() : cell.isBgRGB())) return `rgb:${color}`
  if (mode === XTERM_COLOR_MODE_PALETTE || (kind === "fg" ? cell.isFgPalette() : cell.isBgPalette())) {
    return `pal:${color}`
  }
  if (mode === XTERM_COLOR_MODE_DEFAULT) return ""
  return ""
}

function cellAttributes(cell: XtermCellLike): number {
  let attrs = 0
  if (cell.isBold()) attrs |= ATTR.BOLD
  if (cell.isDim()) attrs |= ATTR.DIM
  if (cell.isItalic()) attrs |= ATTR.ITALIC
  if (cell.isUnderline()) attrs |= ATTR.UNDERLINE
  if (cell.isBlink()) attrs |= ATTR.BLINK
  if (cell.isInverse()) attrs |= ATTR.INVERSE
  // xterm's "invisible" flag is the SGR 8 concealed attribute → ATTR.HIDDEN.
  if (cell.isInvisible()) attrs |= ATTR.HIDDEN
  if (cell.isStrikethrough()) attrs |= ATTR.STRIKETHROUGH
  return attrs
}

function matchingStyleRewrite(
  cell: XtermCellLike,
  styleRewrites: readonly TerminalStyleRewrite[] | undefined,
): TerminalStyleRewrite | undefined {
  if (!styleRewrites || styleRewrites.length === 0 || !cell.isFgDefault() || cell.isBgDefault()) return undefined
  const background = colorKeyToRGB(colorKey(cell, "bg"))
  return styleRewrites.find((rewrite) => sameRgb(background, rewrite.matchBackground))
}

function rgbKey([red, green, blue]: readonly [number, number, number]): string {
  return `rgb:${(red << 16) | (green << 8) | blue}`
}

function cellStyle(cell: XtermCellLike, styleRewrites?: readonly TerminalStyleRewrite[]): RenderStyle {
  const style = {
    fg: colorKey(cell, "fg"),
    bg: colorKey(cell, "bg"),
    attrs: cellAttributes(cell),
  }
  const rewrite = matchingStyleRewrite(cell, styleRewrites)
  return rewrite ? { ...style, fg: rgbKey(rewrite.foreground), bg: rgbKey(rewrite.background) } : style
}

function styleEquals(a: RenderStyle, b: RenderStyle): boolean {
  return a.fg === b.fg && a.bg === b.bg && a.attrs === b.attrs
}

function renderStyleToChunkFields(style: RenderStyle): Pick<Chunk, "fg" | "bg" | "attributes"> {
  const fg = colorKeyToRGB(style.fg)
  const bg = colorKeyToRGB(style.bg)
  return {
    ...(fg ? { fg } : {}),
    ...(bg ? { bg } : {}),
    ...(style.attrs !== 0 ? { attributes: style.attrs } : {}),
  }
}

/** Solid-block glyphs that read as pure color fills when fg == bg. */
function isSolidBlock(chars: string): boolean {
  return chars === "▀" || chars === "▄" || chars === "█"
}

/**
 * Same pixel color? The one definition behind solid-block substitution,
 * shared by converter and comparator, on RESOLVED RGB: keys differ for the
 * same color (`pal:231` vs `rgb:16777215`, common in half-block renderers),
 * and a converter/comparator split on that re-rendered the pane forever.
 *
 * Two undefined (default) paints are NOT a fill: that block is a real glyph.
 */
function paintsSamePixel(fg: RGB | undefined, bg: RGB | undefined): boolean {
  if (fg === undefined || bg === undefined) return false
  return fg[0] === bg[0] && fg[1] === bg[1] && fg[2] === bg[2]
}

function isVisibleCell(cell: XtermCellLike): boolean {
  const chars = cell.getChars()
  if (chars !== "" && chars !== " ") return true
  return !cell.isAttributeDefault() || !cell.isFgDefault() || !cell.isBgDefault()
}

/**
 * Program-wide scratch cell for `getCell(x, cell)`; the no-arg form allocates
 * per cell on the render hot path. `@xterm/headless` exports no `CellData`
 * constructor and `getNullCell()` needs a buffer, so it's seeded lazily from
 * the first `getCell`.
 *
 * Safe ONLY because nothing retains a cell across iterations (`cellStyle`
 * and `getChars()` copy out immediately); a stashed cell would be clobbered.
 */
let scratchCell: XtermCellLike | undefined

export type XtermLineLike = {
  length: number
  getCell(index: number, cell?: XtermCellLike): XtermCellLike | undefined
}

function getCellReusing(line: XtermLineLike, x: number): XtermCellLike | undefined {
  if (scratchCell === undefined) {
    // First-ever call: no scratch yet, so this one fresh cell becomes it.
    const seeded = line.getCell(x)
    if (seeded) scratchCell = seeded
    return seeded
  }
  return line.getCell(x, scratchCell)
}

/**
 * One xterm line → style runs, coalescing same-style cells (no ANSI round
 * trip). `minLast` keeps the cursor column emitted even over trailing
 * blanks, matching the snapshot the cursor overlay uses.
 */
export function xtermLineToChunks(
  line: XtermLineLike,
  minLast = -1,
  styleRewrites?: readonly TerminalStyleRewrite[],
): Chunk[] {
  // `Math.max` keeps the `minLast` seed; `last = x` would drop trailing
  // typed spaces and freeze the cursor overlay at end-of-text.
  let last = Math.min(line.length - 1, minLast)
  for (let x = 0; x < line.length; x++) {
    const cell = getCellReusing(line, x)
    if (!cell || cell.getWidth() === 0) continue
    if (isVisibleCell(cell)) last = Math.max(last, x)
  }
  if (last === -1) return []

  const out: Chunk[] = []
  let active = DEFAULT_RENDER_STYLE
  // Whether `active` paints fg and bg as one color — recomputed only when
  // the style changes, so the per-cell path stays allocation-free.
  let activeIsFill = false
  let buf = ""
  const flush = () => {
    if (buf === "") return
    out.push({ text: buf, ...renderStyleToChunkFields(active) })
    buf = ""
  }
  for (let x = 0; x <= last; x++) {
    const cell = getCellReusing(line, x)
    if (!cell || cell.getWidth() === 0) continue
    const next = cellStyle(cell, styleRewrites)
    if (!styleEquals(active, next)) {
      flush()
      active = next
      activeIsFill = paintsSamePixel(colorKeyToRGB(next.fg), colorKeyToRGB(next.bg))
    }
    const chars = cell.getChars() || " "
    // fg == bg solid blocks become bg-only spaces, so the host's
    // minimum-contrast (iTerm) can't darken the glyph half — zebra stripes
    // in half-block renderers (carbonyl, the video plugin).
    buf += isSolidBlock(chars) && activeIsFill ? " " : chars
  }
  flush()
  return out
}

function chunkColorMatchesCell(rgb: RGB | undefined, cell: XtermCellLike, kind: "fg" | "bg"): boolean {
  const isDefault = kind === "fg" ? cell.isFgDefault() : cell.isBgDefault()
  if (isDefault) return rgb === undefined
  if (!rgb) return false
  const mode = kind === "fg" ? cell.getFgColorMode() : cell.getBgColorMode()
  const color = kind === "fg" ? cell.getFgColor() : cell.getBgColor()
  if (mode === XTERM_COLOR_MODE_RGB || (kind === "fg" ? cell.isFgRGB() : cell.isBgRGB())) {
    return rgb[0] === ((color >> 16) & 0xff) && rgb[1] === ((color >> 8) & 0xff) && rgb[2] === (color & 0xff)
  }
  if (mode === XTERM_COLOR_MODE_PALETTE || (kind === "fg" ? cell.isFgPalette() : cell.isBgPalette())) {
    const palette = ansi256ToRgb(color)
    return rgb[0] === palette[0] && rgb[1] === palette[1] && rgb[2] === palette[2]
  }
  return false
}

function sameRgb(
  a: readonly [number, number, number] | undefined,
  b: readonly [number, number, number] | undefined,
): boolean {
  return Boolean(a && b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2])
}

function chunkStyleMatchesCell(
  chunk: Chunk,
  cell: XtermCellLike,
  styleRewrites?: readonly TerminalStyleRewrite[],
): boolean {
  const rewrite = matchingStyleRewrite(cell, styleRewrites)
  if (rewrite) {
    return (
      (chunk.attributes ?? 0) === cellAttributes(cell) &&
      sameRgb(chunk.fg, rewrite.foreground) &&
      sameRgb(chunk.bg, rewrite.background)
    )
  }
  return (
    (chunk.attributes ?? 0) === cellAttributes(cell) &&
    chunkColorMatchesCell(chunk.fg, cell, "fg") &&
    chunkColorMatchesCell(chunk.bg, cell, "bg")
  )
}

/** Compare xterm cells with their rendered chunks without allocating a replacement row. */
export function xtermLineMatchesChunks(
  line: XtermLineLike | undefined,
  row: readonly Chunk[],
  minLast = -1,
  styleRewrites?: readonly TerminalStyleRewrite[],
): boolean {
  if (!line) return row.length === 0
  let last = Math.min(line.length - 1, minLast)
  for (let x = 0; x < line.length; x++) {
    const cell = getCellReusing(line, x)
    if (!cell || cell.getWidth() === 0) continue
    if (isVisibleCell(cell)) last = Math.max(last, x)
  }
  if (last === -1) return row.length === 0

  let chunkIndex = 0
  let textOffset = 0
  for (let x = 0; x <= last; x++) {
    const cell = getCellReusing(line, x)
    if (!cell || cell.getWidth() === 0) continue
    const chunk = row[chunkIndex]
    if (!chunk || !chunkStyleMatchesCell(chunk, cell, styleRewrites)) return false
    const raw = cell.getChars() || " "
    // Same substitution as the converter; `chunkStyleMatchesCell` proved the
    // chunk colors are this cell's, so reading them off the chunk can't drift.
    const text = isSolidBlock(raw) && paintsSamePixel(chunk.fg, chunk.bg) ? " " : raw
    if (!chunk.text.startsWith(text, textOffset)) return false
    textOffset += text.length
    if (textOffset === chunk.text.length) {
      chunkIndex++
      textOffset = 0
    } else if (textOffset > chunk.text.length) {
      return false
    }
  }
  return chunkIndex === row.length && textOffset === 0
}
