import { describe, expect, it, vi } from "vitest"
import type { CursorPos, TerminalRow } from "../../src/tui/panes/terminal/pty-types"
import { xtermLineToChunks } from "../../src/tui/panes/terminal/xterm-chunks"
import { FakeTransportPty, settleRefresh } from "./pty-fake"

vi.mock("../../src/tui/panes/terminal/xterm-chunks", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../src/tui/panes/terminal/xterm-chunks")>()
  return { ...mod, xtermLineToChunks: vi.fn(mod.xtermLineToChunks) }
})

function makePty(): FakeTransportPty {
  return new FakeTransportPty({ taskId: "t1", cwd: "/wt", cols: 40, rows: 10, scrollback: 20 })
}

/** Regression pin for the unconditional terminal refresh path introduced by 4562c600. */
describe("XtermTaskPty redraw budget", () => {
  it("does not publish parsed control traffic when the rendered state is unchanged", async () => {
    const pty = makePty()
    const onData = vi.fn()
    const onTitle = vi.fn()
    pty.onData(onData)
    pty.onTitleChange(onTitle)

    await pty.pump("seed")
    await settleRefresh()
    const before = pty.capture()
    onData.mockClear()
    onTitle.mockClear()
    vi.mocked(xtermLineToChunks).mockClear()

    await pty.pump("\x1b]2;vim\x07")
    await settleRefresh()
    expect(onTitle).toHaveBeenCalledWith("vim")
    expect(onData).not.toHaveBeenCalled()
    expect(pty.capture()).toBe(before)

    await pty.pump("\x1b[1;5H")
    await settleRefresh()
    expect(onData).not.toHaveBeenCalled()
    expect(pty.capture()).toBe(before)

    await pty.pump("\x1b[?2026h\x1b[1;5H\x1b[?2026l")
    await settleRefresh()
    expect(onData).not.toHaveBeenCalled()
    expect(pty.capture()).toBe(before)
    expect(xtermLineToChunks).not.toHaveBeenCalled()

    pty.kill()
  })

  /**
   * The frozen-scrollback fast path in `dirtyRowsMatchSnapshot` skips
   * re-deriving rows below `baseY` that the rebuild path already cached under
   * an absolute line id. Its one hazard: once the window saturates,
   * `baseY`/`length`/`start` all stay CONSTANT while content scrolls, so
   * `sameMeta` cannot see the move — only the absolute-id identity compare
   * can. If that compare ever went away, a saturated buffer would publish a
   * stale window forever.
   */
  it("still detects a shift once the scrollback window is saturated", async () => {
    const pty = makePty() // rows 10 + scrollback 20 -> saturates at 30 lines
    const text = (rows: readonly TerminalRow[]) => rows.map((r) => r.map((c) => c.text).join("")).join("\n")

    for (let i = 0; i < 60; i++) await pty.pump(`line-${i}\r\n`)
    await settleRefresh()
    const saturated = pty.capture()
    expect(text(saturated)).toContain("line-59")
    const topBefore = text(saturated).split("\n")[0]

    // A sync-marked frame, which is what forces dirty={kind:"all"} — exactly
    // the case the fast path short-circuits.
    await pty.pump("\x1b[?2026hline-60\r\n\x1b[?2026l")
    await settleRefresh()

    const shifted = pty.capture()
    expect(shifted).not.toBe(saturated)
    expect(text(shifted)).toContain("line-60")
    expect(text(shifted).split("\n")[0]).not.toBe(topBefore)
    pty.kill()
  })

  it("publishes real text changes exactly once", async () => {
    const pty = makePty()
    const onData = vi.fn<(rows: readonly TerminalRow[], cursor: CursorPos | null) => void>()
    pty.onData(onData)

    await pty.pump("seed")
    await settleRefresh()
    const before = pty.capture()
    onData.mockClear()

    await pty.pump("!")
    await settleRefresh()

    expect(onData).toHaveBeenCalledTimes(1)
    expect(pty.capture()).not.toBe(before)
    pty.kill()
  })

  it("publishes style-only cell changes", async () => {
    const pty = makePty()
    const onData = vi.fn()
    pty.onData(onData)

    await pty.pump("A")
    await settleRefresh()
    const before = pty.capture()
    onData.mockClear()

    await pty.pump("\r\x1b[31mA")
    await settleRefresh()

    expect(onData).toHaveBeenCalledTimes(1)
    expect(pty.capture()).not.toBe(before)
    expect(pty.capture()[0]?.[0]?.fg).toBeDefined()
    pty.kill()
  })

  it("applies engine style rewrites only on the alternate screen", async () => {
    const pty = new FakeTransportPty({
      taskId: "t1",
      cwd: "/wt",
      cols: 40,
      rows: 10,
      defaultColors: { foreground: "#eae7df", background: "#141413" },
      alternateScreenStyleRewrites: [
        { matchBackground: [48, 48, 47], foreground: [20, 20, 19], background: [234, 231, 223] },
      ],
    })
    pty.onData(() => {})

    await pty.pump("\x1b[48;2;48;48;47mcomposer")
    await settleRefresh()
    expect(pty.capture()[0]?.[0]?.fg).toBeUndefined()
    expect(pty.capture()[0]?.[0]?.bg).toEqual([48, 48, 47])

    await pty.pump("\x1b[?1049h\x1b[0m\x1b[48;2;48;48;47mtranscript")
    await settleRefresh()
    expect(pty.capture()[0]?.[0]).toMatchObject({ fg: [20, 20, 19], bg: [234, 231, 223] })

    await pty.pump("\x1b[?1049l")
    await settleRefresh()
    expect(pty.capture()[0]?.[0]?.fg).toBeUndefined()
    expect(pty.capture()[0]?.[0]?.bg).toEqual([48, 48, 47])
    pty.kill()
  })

  it("publishes cursor-only changes while preserving snapshot identity", async () => {
    const pty = makePty()
    const seen: Array<{ rows: readonly TerminalRow[]; cursor: CursorPos | null }> = []
    pty.onData((rows, cursor) => seen.push({ rows, cursor }))

    await pty.pump("seed")
    await settleRefresh()
    const before = pty.capture()
    seen.length = 0

    await pty.pump("\x1b[D")
    await settleRefresh()

    expect(seen).toHaveLength(1)
    expect(seen[0]?.rows).toBe(before)
    expect(seen[0]?.cursor).toEqual({ x: 3, y: 0 })
    pty.kill()
  })

  it("publishes cursor visibility changes without inventing row changes", async () => {
    const pty = makePty()
    const seen: Array<{ rows: readonly TerminalRow[]; cursor: CursorPos | null }> = []
    pty.onData((rows, cursor) => seen.push({ rows, cursor }))

    await pty.pump("seed")
    await settleRefresh()
    const before = pty.capture()
    seen.length = 0

    await pty.pump("\x1b[?25l")
    await settleRefresh()
    expect(seen).toEqual([{ rows: before, cursor: null }])

    const hiddenRows = pty.capture()
    seen.length = 0
    await pty.pump("\x1b[10C")
    await settleRefresh()
    expect(seen).toHaveLength(0)
    expect(pty.capture()).toBe(hiddenRows)

    await pty.pump("\x1b[?25h")
    await settleRefresh()
    expect(seen).toHaveLength(1)
    expect(seen[0]?.cursor).toEqual({ x: 14, y: 0 })
    pty.kill()
  })

  it("restores the input cursor after a hidden-cursor alternate-screen pager exits", async () => {
    const pty = makePty()
    const seen: Array<CursorPos | null> = []
    pty.onData((_rows, cursor) => seen.push(cursor))

    await pty.pump("input")
    await settleRefresh()
    await pty.pump("\x1b[?1049h\x1b[?25lpager")
    await settleRefresh()
    expect(seen.at(-1)).toBeNull()

    await pty.pump("\x1b[?1049l\x1b[?25h")
    await settleRefresh()
    expect(seen.at(-1)).toEqual({ x: 5, y: 0 })
    pty.kill()
  })
})
