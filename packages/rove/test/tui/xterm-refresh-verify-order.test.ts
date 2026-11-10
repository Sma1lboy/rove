import { Terminal } from "@xterm/headless"
import { describe, expect, it } from "vitest"
import { xtermLineToChunks } from "../../src/tui/panes/terminal/xterm-chunks"
import { dirtyRowsMatchSnapshot, snapshotMeta } from "../../src/tui/panes/terminal/xterm-refresh"

const write = (term: Terminal, data: string) => new Promise<void>((done) => term.write(data, done))

describe("dirtyRowsMatchSnapshot", () => {
  /** A streaming reply rewrites the last rows 60 times a second; comparing every row above them first cost more CPU than the repaint. */
  it("finds a change on the last row without reading the rows above it", async () => {
    const rows = 40
    const term = new Terminal({ cols: 80, rows, scrollback: 0, allowProposedApi: true })
    for (let y = 0; y < rows; y++) await write(term, `\x1b[${y + 1};1Hrow ${y}`)
    const active = term.buffer.active
    const meta = snapshotMeta(active, rows, 0)
    const snapshot = Array.from({ length: rows }, (_, y) =>
      xtermLineToChunks(active.getLine(y) as NonNullable<ReturnType<typeof active.getLine>>),
    )
    await write(term, `\x1b[${rows};1Hchanged`)

    let read = 0
    const counted = {
      type: active.type,
      baseY: active.baseY,
      cursorX: active.cursorX,
      cursorY: active.cursorY,
      length: active.length,
      getLine(y: number) {
        read++
        return active.getLine(y)
      },
    }
    expect(dirtyRowsMatchSnapshot(counted, snapshot, meta, meta, { kind: "all" }, true)).toBe(false)
    expect(read).toBe(1)
  })
})
