/** @jsxImportSource @opentui/react */
import { expect, test } from "bun:test"
import { BoxRenderable, RGBA, StyledText, TextRenderable } from "@opentui/core"
import { TerminalRowPainter } from "../../src/tui-react/panes/terminal/terminal-row-painter"
import type { TerminalRow } from "../../src/tui/panes/terminal/pty-types"
import { ATTR } from "../../src/tui/panes/terminal/sgr"
import { rowsToStyledText } from "../../src/tui/panes/terminal/sgr-to-text-chunk"
import { resolveInverseAttributes, sealRowEndAttributes } from "../../src/tui/panes/terminal/terminal-render"
import { renderComponent } from "./harness"

const colors = { foreground: [234, 231, 223], background: [20, 20, 19] } as const

async function setup() {
  const handle = await renderComponent(<box />, { width: 30, height: 8 })
  const grid = new BoxRenderable(handle.renderer, { width: 20, height: 5, left: 3, top: 1 })
  handle.renderer.root.add(grid)
  const painter = new TerminalRowPainter(grid, handle.renderer)
  return { handle, grid, painter }
}

test("changing one row retains the other text buffers and clears the shortened tail", async () => {
  const { handle, grid, painter } = await setup()
  try {
    const rows: TerminalRow[] = [[{ text: "unchanged" }], [{ text: "long input here" }], [{ text: "footer" }]]
    painter.paint(rows, 20, colors)
    expect(await handle.frame()).toContain("long input here")
    const nodes = grid.getChildren()
    const originalContent = nodes.map((node) => (node instanceof TextRenderable ? node.content : null))
    rows[1] = [{ text: "short" }]
    painter.paint(rows, 20, colors)
    const frame = await handle.frame()
    expect(frame).toContain("short")
    expect(frame).not.toContain("input here")
    expect(grid.getChildren()).toEqual(nodes)
    for (const y of [0, 2]) {
      const node = nodes[y]
      expect(node instanceof TextRenderable && node.content === originalContent[y]).toBe(true)
    }
    const changed = nodes[1]
    expect(changed instanceof TextRenderable && changed.content !== originalContent[1]).toBe(true)
    painter.paint(rows.slice(0, 1), 20, colors)
    expect(await handle.frame()).not.toContain("footer")
    expect(nodes[1]?.isDestroyed).toBe(true)
    painter.dispose()
    expect(grid.getChildren()).toHaveLength(0)
    painter.dispose()
  } finally {
    handle.destroy()
  }
})

test("row buffers paint the same cells and styles as the multiline renderer", async () => {
  const { handle, grid, painter } = await setup()
  const rows: TerminalRow[] = [
    [{ text: "中文 e\u0301 🦊" }],
    [
      { text: "▀▀", fg: [255, 0, 0], bg: [0, 0, 255] },
      { text: "   ", bg: [0, 255, 0] },
    ],
    [{ text: "inverse", attributes: ATTR.INVERSE }],
    [{ text: "underlined-wide-tail-", attributes: ATTR.UNDERLINE }],
  ]
  try {
    painter.paint(rows, 20, colors)
    const retained = await handle.spans()
    painter.dispose()
    const old = new TextRenderable(handle.renderer, {
      fg: RGBA.fromInts(...colors.foreground),
      wrapMode: "none",
      selectable: false,
      content: new StyledText(
        rowsToStyledText(
          sealRowEndAttributes(
            resolveInverseAttributes(rows, colors.foreground, colors.background),
            20,
            colors.foreground,
            colors.background,
          ),
        ),
      ),
    })
    grid.add(old)
    expect(await handle.spans()).toEqual(retained)
  } finally {
    handle.destroy()
  }
})

test("width and theme changes repaint retained rows; destroying the grid releases them safely", async () => {
  const { handle, grid, painter } = await setup()
  try {
    const rows: TerminalRow[] = [[{ text: "inverse", attributes: ATTR.INVERSE }]]
    painter.paint(rows, 20, colors)
    const node = grid.getChildren()[0]
    if (!(node instanceof TextRenderable)) throw new Error("missing row")
    const before = node.content
    painter.paint(rows, 10, colors)
    expect(node.content).not.toBe(before)
    const resized = node.content
    painter.paint(rows, 10, { foreground: [255, 0, 0], background: [0, 0, 255] })
    expect(node.content).not.toBe(resized)
    const spans = JSON.stringify(await handle.spans())
    expect(spans).toContain('"0":255,"1":0,"2":0,"3":255')
    grid.destroyRecursively()
    painter.paint(rows, 10, colors)
    painter.dispose()
    expect(node.isDestroyed).toBe(true)
  } finally {
    handle.destroy()
  }
})
