import { charWidth } from "../../../lib/display-width.ts"
import type { CursorPos } from "./pty"
import { ATTR, type Chunk, type RGB } from "./sgr"

/** Heuristic: acquire error means the shell is missing, so show a plain hint instead. */
export function isShellMissing(message: string): boolean {
  const m = message.toLowerCase()
  return m.includes("enoent") || m.includes("not found")
}

/**
 * Grid cells for one code point, as `displayWidth`. Zero-width marks are 0:
 * xterm folds them onto the base cell, so do NOT `|| 1` this — each would
 * drift the cursor one column right.
 */
function cellWidth(ch: string): number {
  return charWidth(ch.codePointAt(0) as number)
}

function cloneChunk(c: Chunk, text: string, attrs = c.attributes ?? 0): Chunk {
  return {
    text,
    ...(c.fg ? { fg: c.fg } : {}),
    ...(c.bg ? { bg: c.bg } : {}),
    ...(attrs !== 0 ? { attributes: attrs } : {}),
  }
}

function chunkCells(chars: readonly string[]): number {
  let w = 0
  for (const ch of chars) w += cellWidth(ch)
  return w
}

export interface TerminalRenderColors {
  readonly foreground: RGB
  readonly background: RGB
}

/** Resolve the synthetic cursor to literal colors before OpenTUI sees it. */
function cursorChunk(source: Chunk, text: string, colors: TerminalRenderColors): Chunk {
  const attributes = (source.attributes ?? 0) & ~ATTR.INVERSE
  return {
    text,
    fg: source.bg ?? colors.background,
    bg: source.fg ?? colors.foreground,
    ...(attributes !== 0 ? { attributes } : {}),
  }
}

function overlayCursorRow(row: readonly Chunk[], x: number, colors: TerminalRenderColors): Chunk[] {
  const out: Chunk[] = []
  // `x` is a CELL column; a wide (CJK / emoji) glyph is one code point but two
  // cells, so advance by display width, not 1.
  let col = 0
  let inserted = false

  for (const chunk of row) {
    if (inserted) {
      out.push(chunk)
      continue
    }
    const chars = Array.from(chunk.text)
    // Cursor lands on the char whose span [localCol, localCol + w) contains `x`.
    let localCol = col
    let hit = -1
    for (let idx = 0; idx < chars.length; idx++) {
      const w = cellWidth(chars[idx] as string)
      if (x >= localCol && x < localCol + w) {
        hit = idx
        break
      }
      localCol += w
    }
    if (hit >= 0) {
      const before = chars.slice(0, hit).join("")
      const after = chars.slice(hit + 1).join("")
      if (before) out.push(cloneChunk(chunk, before))
      out.push(cursorChunk(chunk, chars[hit] || " ", colors))
      if (after) out.push(cloneChunk(chunk, after))
      inserted = true
    } else {
      out.push(chunk)
      col += chunkCells(chars)
    }
  }

  if (!inserted) {
    // Past the emitted cells: pad to the REAL column, or the cursor freezes at
    // end-of-text while xterm's advances over typed spaces.
    if (x > col) out.push({ text: " ".repeat(x - col) })
    out.push(cursorChunk({ text: " " }, " ", colors))
  }
  return out
}

export function overlayCursor(
  rows: readonly (readonly Chunk[])[],
  cursor: CursorPos | null,
  colors: TerminalRenderColors,
): readonly (readonly Chunk[])[] {
  if (!cursor) return rows
  return rows.map((row, y) => (y === cursor.y ? overlayCursorRow(row, cursor.x, colors) : row))
}

/** Resolve reverse-video to literal colors before OpenTUI sees it. */
export function resolveInverseAttributes(
  rows: readonly (readonly Chunk[])[],
  defaultFg: RGB,
  defaultBg: RGB,
): readonly (readonly Chunk[])[] {
  return rows.map((row) => {
    let out: Chunk[] | null = null
    for (let i = 0; i < row.length; i++) {
      const chunk = row[i] as Chunk
      const attributes = chunk.attributes ?? 0
      if ((attributes & ATTR.INVERSE) === 0) {
        if (out) out.push(chunk)
        continue
      }
      out ??= row.slice(0, i)
      const resolvedAttributes = attributes & ~ATTR.INVERSE
      out.push({
        text: chunk.text,
        fg: chunk.bg ?? defaultBg,
        bg: chunk.fg ?? defaultFg,
        ...(resolvedAttributes !== 0 ? { attributes: resolvedAttributes } : {}),
      })
    }
    return out ?? row
  })
}

/**
 * LOCAL PATCH for an opentui attribute leak (not upstreamed).
 *
 * opentui's zig renderer declares `runLength` INSIDE its per-row loop
 * (`renderer.zig`, `prepareRenderFrameWithWriter`) and its SGR writer only ADDS
 * bits (`ansi.zig` emits `\e[4m`, never `\e[24m`), so a new row's first cell
 * skips the `\e[0m` reset. An attribute open at a full-width row's last column
 * (e.g. a wrapped URL) bleeds into every following row.
 *
 * Fix: clear attributes on the last visible cell of such rows, replaying
 * INVERSE as a literal fg/bg swap so a cursor/selection there keeps its
 * highlight. Underline/bold/italic lose one cell of decoration. Shorter rows
 * reset normally via the next chunk.
 */
export function sealRowEndAttributes(
  rows: readonly (readonly Chunk[])[],
  cols: number,
  defaultFg: RGB,
  defaultBg: RGB,
): readonly (readonly Chunk[])[] {
  if (cols <= 0) return rows
  const lastColumn = cols - 1
  return rows.map((row) => {
    // Seal the last VISIBLE cell, not the last chunk: the pane clips at `cols`
    // (`wrapMode="none"`) and an unwrapped backend can hand over wider rows.
    let col = 0
    for (let i = 0; i < row.length; i++) {
      const chunk = row[i] as Chunk
      const chars = Array.from(chunk.text)
      for (let j = 0; j < chars.length; j++) {
        const ch = chars[j] as string
        const w = cellWidth(ch)
        if (col + w <= lastColumn) {
          col += w
          continue
        }
        // `ch` covers the last visible column (a straddling wide glyph counts).
        const attrs = chunk.attributes ?? 0
        if (attrs === 0) return row
        // INVERSE carries information (cursor, selection), so replay it as swapped colors.
        const fg = chunk.fg ?? defaultFg
        const bg = chunk.bg ?? defaultBg
        const sealed: Chunk = (attrs & ATTR.INVERSE) !== 0 ? { text: ch, fg: bg, bg: fg } : { text: ch, fg, bg }

        const head = chars.slice(0, j).join("")
        const tail = chars.slice(j + 1).join("")
        const rebuilt = row.slice(0, i)
        if (head) rebuilt.push(cloneChunk(chunk, head))
        rebuilt.push(sealed)
        // Clipped, but kept so selection/copy read the full text.
        if (tail) rebuilt.push(cloneChunk(chunk, tail))
        return [...rebuilt, ...row.slice(i + 1)]
      }
    }
    return row
  })
}
