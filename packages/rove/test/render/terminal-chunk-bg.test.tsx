/** @jsxImportSource @opentui/react */
/**
 * Regression probe: a terminal chunk's BACKGROUND color must survive to the
 * painted frame. Half-block renderers (carbonyl, the video plugin) draw two
 * pixels per cell as `▀` with fg = top pixel and bg = bottom pixel — if the
 * paint path drops chunk bg, every other scanline shows the theme background
 * instead ("zebra stripes" bug). Mirrors the Terminal pane's exact path:
 * rowsToStyledText → StyledText → TextRenderable.content.
 */

import { expect, test } from "bun:test"
import { StyledText, type TextRenderable } from "@opentui/core"
import { useEffect, useState } from "react"
import { ATTR, type Chunk } from "../../src/tui/panes/terminal/sgr"
import { rowsToStyledText } from "../../src/tui/panes/terminal/sgr-to-text-chunk"
import { overlayCursor } from "../../src/tui/panes/terminal/terminal-render"
import { renderComponent } from "./harness"

function HalfBlockRow() {
  const [el, setEl] = useState<TextRenderable | null>(null)
  useEffect(() => {
    if (el && !el.isDestroyed) {
      el.content = new StyledText(
        rowsToStyledText([[{ text: "▀▀▀", fg: [255, 0, 0], bg: [0, 0, 255] }], [{ text: "   ", bg: [0, 255, 0] }]]),
      )
    }
  }, [el])
  return <text ref={setEl} />
}

function DimPlaceholderCursor() {
  const [el, setEl] = useState<TextRenderable | null>(null)
  useEffect(() => {
    if (el && !el.isDestroyed) {
      const rows = overlayCursor(
        [[{ text: "Ask Codex", bg: [48, 48, 47], attributes: ATTR.DIM } as Chunk]],
        { x: 0, y: 0 },
        { foreground: [234, 231, 223], background: [20, 20, 19] },
      )
      el.content = new StyledText(rowsToStyledText(rows))
    }
  }, [el])
  return <text ref={setEl} />
}

test("chunk fg AND bg reach the painted frame (half-block zebra regression)", async () => {
  const handle = await renderComponent(<HalfBlockRow />, { width: 10, height: 4 })
  try {
    const spans = await handle.spans()
    const flat = JSON.stringify(spans)
    // Span colors serialize as RGBA buffers: {"0":r,"1":g,"2":b,"3":a}.
    expect(flat).toContain("▀")
    expect(flat).toContain('"0":255,"1":0,"2":0,"3":255') // fg red
    expect(flat).toContain('"0":0,"1":0,"2":255,"3":255') // bg blue
    // bg-only spaces are the carbonyl solid-fill case.
    expect(flat).toContain('"0":0,"1":255,"2":0,"3":255') // bg green
  } finally {
    handle.destroy()
  }
})

test("materialized cursor stays visible over a dim explicit-background placeholder", async () => {
  const handle = await renderComponent(<DimPlaceholderCursor />, { width: 20, height: 2 })
  try {
    const flat = JSON.stringify(await handle.spans())
    expect(flat).toContain("A")
    expect(flat).toContain('"0":48,"1":48,"2":47,"3":255') // cursor glyph fg
    expect(flat).toContain('"0":234,"1":231,"2":223,"3":255') // cursor block bg
    expect(flat).toContain(`"attributes":${ATTR.DIM}`)
  } finally {
    handle.destroy()
  }
})
