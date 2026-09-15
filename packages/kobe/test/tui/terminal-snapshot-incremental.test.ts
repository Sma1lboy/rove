import { Terminal } from "@xterm/headless"
import { afterEach, expect, it, vi } from "vitest"
import { XtermSnapshotEngine, type XtermSnapshotRefreshResult } from "../../src/tui/panes/terminal/pty-xterm-snapshot"
import * as chunks from "../../src/tui/panes/terminal/xterm-chunks"
import { XtermRefreshTracker } from "../../src/tui/panes/terminal/xterm-refresh"

afterEach(() => vi.restoreAllMocks())

it("allocates chunks only for the changed row and agrees with a fresh snapshot after scroll and resize", async () => {
  const term = new Terminal({ cols: 20, rows: 6, scrollback: 3, allowProposedApi: true })
  const tracker = new XtermRefreshTracker(term)
  const engine = new XtermSnapshotEngine()
  let last: XtermSnapshotRefreshResult | null = null
  const write = (data: string) => new Promise<void>((resolve) => term.write(data, resolve))
  const refresh = () => {
    const result = engine.refresh(
      term,
      term.rows,
      3,
      tracker,
      last?.snapshot ?? [],
      last?.cursor ?? null,
      last?.snapshotWindow ?? null,
    )
    if (!result) throw new Error("unexpected synchronized output")
    last = result
    return result
  }
  const fresh = () => {
    const otherTracker = new XtermRefreshTracker(term)
    try {
      otherTracker.markAll()
      return new XtermSnapshotEngine().refresh(term, term.rows, 3, otherTracker, [], null, null)
    } finally {
      otherTracker.dispose()
    }
  }
  try {
    await write("one\r\ntwo\r\nthree\r\nfour\r\nfive\r\nsix")
    refresh()
    const convert = vi.spyOn(chunks, "xtermLineToChunks")
    await write("\x1b[3;1Hchanged")
    const changed = refresh()
    expect(convert).toHaveBeenCalledTimes(1)
    expect(changed.snapshot).toEqual(fresh()?.snapshot)
    // Saturate scrollback: length/baseY stop changing while rows move.
    await write("\x1b[6;1H\r\nseven\r\neight\r\nnine\r\nten\r\neleven")
    expect(refresh().snapshot).toEqual(fresh()?.snapshot)
    term.resize(12, 4)
    tracker.markAll()
    engine.invalidate()
    expect(refresh().snapshot).toEqual(fresh()?.snapshot)
    await write("\x1b[?1049h\x1b[2Jalternate")
    expect(refresh().snapshot).toEqual(fresh()?.snapshot)
    await write("\x1b[?1049l")
    expect(refresh().snapshot).toEqual(fresh()?.snapshot)
  } finally {
    tracker.dispose()
    engine.invalidate()
    term.dispose()
  }
})
