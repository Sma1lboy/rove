/**
 * SGR parser (ECMA-48 §8.3.117) for the pipe fallback backend and any SGR
 * reaching the render path; the default backend is already emulated by
 * `@xterm/headless`. Pure and opentui-free.
 */

import { parse } from "@ansi-tools/parser"

/**
 * 0-255 RGB instead of opentui's RGBA: importing opentui drags in tree-sitter
 * `.scm` assets vitest's loader refuses. `./sgr-to-text-chunk.ts` converts at render.
 */
export type RGB = readonly [r: number, g: number, b: number]

/** Must match opentui's `TextAttributes` bit-for-bit; hard-coded for the vitest reason on {@link RGB}. */
export const ATTR = Object.freeze({
  BOLD: 1, // 1 << 0
  DIM: 2, // 1 << 1
  ITALIC: 4, // 1 << 2
  UNDERLINE: 8, // 1 << 3
  BLINK: 16, // 1 << 4
  INVERSE: 32, // 1 << 5
  HIDDEN: 64, // 1 << 6
  STRIKETHROUGH: 128, // 1 << 7
})

export interface Style {
  fg: RGB | undefined
  bg: RGB | undefined
  attributes: number
}

export interface Chunk {
  readonly text: string
  readonly fg?: RGB
  readonly bg?: RGB
  readonly attributes?: number
}

const EMPTY_STYLE: Style = Object.freeze({
  fg: undefined,
  bg: undefined,
  attributes: 0,
})

/**
 * ANSI 256-color: 0-15 system palette, 16-231 6×6×6 cube, 232-255 grayscale.
 * Not opentui's `ansi256IndexToRgb`, to stay opentui-free (see {@link RGB}).
 */
export function ansi256ToRgb(index: number): RGB {
  if (index < 0) return [0, 0, 0]
  if (index < 16) return SYSTEM_PALETTE[index] ?? [0, 0, 0]
  if (index < 232) {
    // Steps {0, 95, 135, 175, 215, 255}, as xterm's table.
    const i = index - 16
    const r = Math.floor(i / 36)
    const g = Math.floor((i / 6) % 6)
    const b = i % 6
    const step = (n: number) => (n === 0 ? 0 : 55 + 40 * n)
    return [step(r), step(g), step(b)]
  }
  if (index < 256) {
    // Grayscale ramp. 24 entries from #080808 to #eeeeee, step 10.
    const gray = 8 + 10 * (index - 232)
    return [gray, gray, gray]
  }
  return [0, 0, 0]
}

/**
 * Basic-16 palette: Tokyo Night's terminal ANSI colors (also a bundled UI
 * theme), not xterm's primaries. Tools like ls/eza color by bare slot
 * (30-37/90-97), so these picks set the embedded terminal's look; 256-color
 * and truecolor decode is bit-exact regardless.
 */
const SYSTEM_PALETTE: readonly RGB[] = [
  [21, 22, 30], // black       #15161e
  [247, 118, 142], // red      #f7768e
  [158, 206, 106], // green    #9ece6a
  [224, 175, 104], // yellow   #e0af68
  [122, 162, 247], // blue     #7aa2f7
  [187, 154, 247], // magenta  #bb9af7
  [125, 207, 255], // cyan     #7dcfff
  [169, 177, 214], // white    #a9b1d6
  [65, 72, 104], // bright black    #414868
  [255, 137, 157], // bright red    #ff899d
  [158, 224, 68], // bright green   #9ee044
  [250, 186, 74], // bright yellow  #faba4a
  [141, 176, 255], // bright blue   #8db0ff
  [199, 169, 255], // bright magenta #c7a9ff
  [164, 218, 255], // bright cyan   #a4daff
  [192, 202, 245], // bright white  #c0caf5
]

/**
 * Apply one (possibly chained, `\x1b[1;31;48;5;238m`) SGR escape. 38/48
 * consume their follow-up params; unknown params are skipped, never thrown on.
 */
function applySgr(prev: Style, rawParams: readonly string[]): Style {
  // Empty params (just `\x1b[m`) means reset, same as `\x1b[0m`.
  const params: number[] =
    rawParams.length === 0 ? [0] : rawParams.map((p) => (p === "" ? 0 : Number.parseInt(p, 10) || 0))
  let fg = prev.fg
  let bg = prev.bg
  let attr = prev.attributes
  let i = 0
  while (i < params.length) {
    const p = params[i]
    if (p === undefined) break
    if (p === 0) {
      fg = undefined
      bg = undefined
      attr = 0
      i += 1
      continue
    }
    if (p === 1) {
      attr |= ATTR.BOLD
      i += 1
      continue
    }
    if (p === 2) {
      attr |= ATTR.DIM
      i += 1
      continue
    }
    if (p === 3) {
      attr |= ATTR.ITALIC
      i += 1
      continue
    }
    if (p === 4) {
      attr |= ATTR.UNDERLINE
      i += 1
      continue
    }
    if (p === 5 || p === 6) {
      attr |= ATTR.BLINK
      i += 1
      continue
    }
    if (p === 7) {
      attr |= ATTR.INVERSE
      i += 1
      continue
    }
    if (p === 8) {
      attr |= ATTR.HIDDEN
      i += 1
      continue
    }
    if (p === 9) {
      attr |= ATTR.STRIKETHROUGH
      i += 1
      continue
    }
    if (p === 22) {
      attr &= ~(ATTR.BOLD | ATTR.DIM)
      i += 1
      continue
    }
    if (p === 23) {
      attr &= ~ATTR.ITALIC
      i += 1
      continue
    }
    if (p === 24) {
      attr &= ~ATTR.UNDERLINE
      i += 1
      continue
    }
    if (p === 25) {
      attr &= ~ATTR.BLINK
      i += 1
      continue
    }
    if (p === 27) {
      attr &= ~ATTR.INVERSE
      i += 1
      continue
    }
    if (p === 28) {
      attr &= ~ATTR.HIDDEN
      i += 1
      continue
    }
    if (p === 29) {
      attr &= ~ATTR.STRIKETHROUGH
      i += 1
      continue
    }
    if (p >= 30 && p <= 37) {
      fg = ansi256ToRgb(p - 30)
      i += 1
      continue
    }
    if (p >= 90 && p <= 97) {
      fg = ansi256ToRgb(p - 90 + 8)
      i += 1
      continue
    }
    if (p === 39) {
      fg = undefined
      i += 1
      continue
    }
    if (p >= 40 && p <= 47) {
      bg = ansi256ToRgb(p - 40)
      i += 1
      continue
    }
    if (p >= 100 && p <= 107) {
      bg = ansi256ToRgb(p - 100 + 8)
      i += 1
      continue
    }
    if (p === 49) {
      bg = undefined
      i += 1
      continue
    }
    // 38;5;N (256-color) or 38;2;R;G;B. The ITU T.416 colorspace id
    // (`38;2;ID;R;G;B`) only occurs in the colon form in practice; semicolon SGR
    // is universally R;G;B, and `sgrParamsFromRaw` keeps phantom ids out.
    if (p === 38) {
      const sub = params[i + 1]
      if (sub === 5) {
        const idx = params[i + 2] ?? 0
        fg = ansi256ToRgb(idx)
        i += 3
        continue
      }
      if (sub === 2) {
        const r = params[i + 2] ?? 0
        const g = params[i + 3] ?? 0
        const b = params[i + 4] ?? 0
        fg = [r, g, b]
        i += 5
        continue
      }
      // Malformed — skip the introducer and try to recover.
      i += 1
      continue
    }
    // Extended bg, same structure as fg.
    if (p === 48) {
      const sub = params[i + 1]
      if (sub === 5) {
        const idx = params[i + 2] ?? 0
        bg = ansi256ToRgb(idx)
        i += 3
        continue
      }
      if (sub === 2) {
        const r = params[i + 2] ?? 0
        const g = params[i + 3] ?? 0
        const b = params[i + 4] ?? 0
        bg = [r, g, b]
        i += 5
        continue
      }
      i += 1
      continue
    }
    i += 1
  }
  return { fg, bg, attributes: attr }
}

/**
 * Split SGR params from the raw escape. `@ansi-tools/parser`'s `params` inject
 * a phantom colorspace id (`38;2;0;R;G;B`) for a bare true-color escape but not
 * a chained one (`\x1b[1;38;2;R;G;B m`), shifting RGB by one; the split values
 * can't tell which. `\x1b[m` yields `[""]`, a reset in `applySgr`.
 */
function sgrParamsFromRaw(raw: string): string[] {
  // Slicing, not a regex: lint forbids control chars (0x1b, 0x9b) in regex literals.
  let body = raw
  if (body.charCodeAt(0) === 0x1b)
    body = body.slice(2) // ESC `[`
  else if (body.charCodeAt(0) === 0x9b) body = body.slice(1) // 1-byte CSI
  if (body.endsWith("m")) body = body.slice(0, -1)
  return body.split(";")
}

/** One line into style runs; `initial` is the previous line's end style. */
export function parseAnsiLine(input: string, initial: Style = EMPTY_STYLE): { chunks: Chunk[]; endStyle: Style } {
  if (input.length === 0) return { chunks: [], endStyle: initial }
  const out: Chunk[] = []
  let style: Style = { ...initial }
  let buf = ""
  const flush = () => {
    if (buf.length === 0) return
    const c: Chunk = {
      text: buf,
      ...(style.fg ? { fg: style.fg } : {}),
      ...(style.bg ? { bg: style.bg } : {}),
      ...(style.attributes !== 0 ? { attributes: style.attributes } : {}),
    }
    out.push(c)
    buf = ""
  }
  const codes = parse(input)
  for (const code of codes) {
    if (code.type === "TEXT") {
      buf += code.raw
      continue
    }
    // SGR is a CSI with command "m". Other CSIs are handled by xterm or
    // unsupported in the pipe fallback, and dropped below.
    if (code.type === "CSI" && code.command === "m") {
      flush()
      style = applySgr(style, sgrParamsFromRaw(code.raw))
      continue
    }
    // OSC 8 hyperlink: underline, matching how `@xterm/headless` renders linked
    // cells so this path agrees with the real pane. Params `["", url]` open,
    // `["", ""]` close.
    if (code.type === "OSC" && code.command === "8") {
      flush()
      const url = code.params[code.params.length - 1] ?? ""
      style = { ...style, attributes: url ? style.attributes | ATTR.UNDERLINE : style.attributes & ~ATTR.UNDERLINE }
    }
    // Any other control code is dropped rather than rendered as raw bytes.
  }
  flush()
  return { chunks: out, endStyle: style }
}

/**
 * One chunk-list per `\n` row, carrying SGR state across rows. Empty trailing
 * rows are kept so cursor-capable backends index 1:1.
 */
export function parseAnsiSnapshot(input: string): Chunk[][] {
  const lines = input.split("\n")
  const rows: Chunk[][] = []
  let carry: Style = EMPTY_STYLE
  for (const line of lines) {
    const { chunks, endStyle } = parseAnsiLine(line, carry)
    rows.push(chunks)
    carry = endStyle
  }
  return rows
}
