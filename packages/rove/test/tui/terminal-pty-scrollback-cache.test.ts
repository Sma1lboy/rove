import { describe, expect, it, vi } from "vitest"
import type { TerminalRow } from "../../src/tui/panes/terminal/pty-types"
import { XtermTaskPty } from "../../src/tui/panes/terminal/pty-xterm-base"
import { xtermLineToChunks } from "../../src/tui/panes/terminal/xterm-chunks"

vi.mock("../../src/tui/panes/terminal/xterm-chunks", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../src/tui/panes/terminal/xterm-chunks")>()
  return { ...mod, xtermLineToChunks: vi.fn(mod.xtermLineToChunks) }
})

/**
 * Frozen-scrollback conversion cache.
 *
 * Why this matters: the active tab's refresh converted the full window —
 * live grid + 200-row scrollback margin — on every 16ms refresh while an
 * engine streams, though scrollback lines are immutable once they leave
 * the live grid. The cache keys converted rows by an absolute line id
 * anchored to an xterm marker (so ids survive buffer trimming) and cuts
 * per-refresh work to roughly the live grid.
 *
 * Correctness oracle: `resize()` to the SAME dimensions invalidates the
 * whole cache and rebuilds from scratch — so cached-path output must be
 * chunk-for-chunk identical to the post-invalidation rebuild.
 */

class FakeTransportPty extends XtermTaskPty {
  protected transportWrite(_data: string): void {}
  protected transportResize(_cols: number, _rows: number): void {}
  protected transportKill(): void {}
  pump(data: string): void {
    this.feed(data)
  }
  /**
   * Resolve once xterm has parsed every chunk fed so far. `term.write`
   * queues, yielding between chunks, so its callbacks fire in feed order —
   * an empty trailing write is therefore acknowledged only after all the
   * real ones. This is the drain the tests below need before they read a
   * snapshot.
   */
  drain(): Promise<void> {
    return new Promise((resolve) => this.term.write("", () => resolve()))
  }
}

function rowsText(rows: readonly TerminalRow[]): string {
  return rows.map((row) => row.map((chunk) => chunk.text).join("")).join("\n")
}

/**
 * Wait for the emulator, not for the clock. This was a fixed 80ms sleep,
 * which is not an upper bound on anything: feeding 250 wrapped lines takes
 * ~100ms of parse time on an idle laptop and longer on a loaded CI runner,
 * so a snapshot taken after the sleep could contain only the first third of
 * what was written. That surfaced as `expected 'resize L1 …' to contain
 * 'resize L250'` on the Windows job, where the tail of the feed had simply
 * not been parsed yet.
 */
function settle(pty: FakeTransportPty): Promise<void> {
  return pty.drain()
}

const COLS = 40
const ROWS = 10
// Injected explicitly: keeps the trimming scenarios (600 lines >> rows +
// margin) deterministic regardless of the persisted Settings → Terminal
// scrollback preference the ctor would otherwise read from state.json.
const SCROLLBACK = 200

function makePty(): FakeTransportPty {
  return new FakeTransportPty({ taskId: "t1", cwd: "/wt", cols: COLS, rows: ROWS, scrollback: SCROLLBACK })
}

/** Differential check: cached snapshot vs full rebuild after invalidation. */
function expectCacheMatchesFullRebuild(pty: FakeTransportPty): void {
  const cached = pty.capture()
  pty.resize(COLS, ROWS) // same dims — wipes the cache, reconverts everything
  const rebuilt = pty.capture()
  expect(cached.length).toBe(rebuilt.length)
  expect(JSON.stringify(cached)).toBe(JSON.stringify(rebuilt))
}

describe("XtermTaskPty scrollback cache", () => {
  it("publishes a stable absolute window origin across saturated scrollback shifts", async () => {
    const pty = makePty()
    for (let i = 1; i <= 300; i++) pty.pump(`origin L${i}\r\n`)
    await settle(pty)
    pty.capture()
    const before = pty.captureWindow()

    pty.pump("origin L301\r\n")
    await settle(pty)
    pty.capture()
    const shifted = pty.captureWindow()

    expect(before).not.toBeNull()
    expect(shifted?.epoch).toBe(before?.epoch)
    expect(shifted?.startLine).toBe((before?.startLine ?? 0) + 1)

    const seen: unknown[] = []
    const unsubscribe = pty.onData((_rows, _cursor, window) => seen.push(window))
    seen.length = 0
    pty.resize(COLS, ROWS)
    expect(pty.captureWindow()?.epoch).toBeGreaterThan(shifted?.epoch ?? 0)
    expect(seen).toEqual([pty.captureWindow()])
    unsubscribe()
    pty.kill()
  })

  it("keeps the window origin stable across live-grid insert/delete redraws", async () => {
    const pty = makePty()
    for (let i = 1; i <= 30; i++) pty.pump(`redraw L${i}\r\n`)
    await settle(pty)
    pty.capture()
    const before = pty.captureWindow()

    // Codex redraws its live viewport with IL/DL while output streams. Those
    // edits must not move the absolute marker that names frozen scrollback.
    pty.pump("\x1b[1;1H\x1b[M")
    await settle(pty)
    pty.capture()

    expect(before).not.toBeNull()
    expect(pty.captureWindow()).toEqual(before)

    pty.pump("\x1b[1;1H\x1b[L")
    await settle(pty)
    pty.capture()
    expect(pty.captureWindow()).toEqual(before)
    pty.kill()
  })

  it("stays chunk-identical to a full rebuild across heavy trimming (with colors)", async () => {
    const pty = makePty()
    // 600 lines >> rows+margin (210): the buffer trims hard, shifting
    // every line index — the marker-anchored ids must track the shift.
    for (let i = 1; i <= 600; i++) {
      const color = 31 + (i % 6)
      pty.pump(`\x1b[${color}mL${String(i).padStart(4, "0")}\x1b[0m plain tail\r\n`)
      if (i % 150 === 0) await settle(pty)
    }
    await settle(pty)
    const text = rowsText(pty.capture())
    expect(text).toContain("L0600")
    expect(text).not.toContain("L0300") // long-trimmed
    expectCacheMatchesFullRebuild(pty)
    pty.kill()
  })

  it("converts ~live-grid rows per refresh once the margin is warm, not the whole window", async () => {
    const pty = makePty()
    for (let i = 1; i <= 400; i++) pty.pump(`warm L${i}\r\n`)
    await settle(pty)
    pty.capture() // warm the cache through the lazy path

    vi.mocked(xtermLineToChunks).mockClear()
    pty.pump("one more line\r\n")
    await settle(pty)
    pty.capture()
    const calls = vi.mocked(xtermLineToChunks).mock.calls.length
    // Window is ROWS+200 = 210 lines; without the cache this would be ~210.
    // With it: live grid (10) + the one newly-frozen line, per refresh.
    expect(calls).toBeGreaterThan(0)
    expect(calls).toBeLessThan(60)
    pty.kill()
  })

  it("survives clear-scrollback (CSI 3J) without serving stale rows", async () => {
    const pty = makePty()
    for (let i = 1; i <= 300; i++) pty.pump(`old L${i}\r\n`)
    await settle(pty)
    pty.capture()
    pty.pump("\x1b[3J") // wipe scrollback; live grid keeps its content
    for (let i = 1; i <= 30; i++) pty.pump(`new L${i}\r\n`)
    await settle(pty)
    const text = rowsText(pty.capture())
    expect(text).toContain("new L30")
    expect(text).not.toContain("old L100")
    expectCacheMatchesFullRebuild(pty)
    pty.kill()
  })

  it("round-trips the alt screen (fullscreen app) with the normal buffer's cache intact", async () => {
    const pty = makePty()
    for (let i = 1; i <= 250; i++) pty.pump(`shell L${i}\r\n`)
    await settle(pty)
    pty.capture()

    pty.pump("\x1b[?1049h\x1b[2J\x1b[HFULLSCREEN APP")
    await settle(pty)
    expect(rowsText(pty.capture())).toContain("FULLSCREEN APP")

    pty.pump("\x1b[?1049l")
    await settle(pty)
    const text = rowsText(pty.capture())
    expect(text).toContain("shell L250")
    expect(text).not.toContain("FULLSCREEN APP")
    expectCacheMatchesFullRebuild(pty)
    pty.kill()
  })

  it("reconverts after a real resize (reflow rewrites history)", async () => {
    const pty = makePty()
    // Long lines so a width change actually rewraps scrollback.
    for (let i = 1; i <= 250; i++) pty.pump(`resize L${i} ${"x".repeat(30)}\r\n`)
    await settle(pty)
    pty.capture()
    pty.resize(COLS + 20, ROWS)
    const text = rowsText(pty.capture())
    expect(text).toContain("resize L250")
    // Post-resize snapshots keep matching full rebuilds at the new size.
    pty.pump("after resize\r\n")
    await settle(pty)
    const cached = pty.capture()
    pty.resize(COLS + 20, ROWS)
    expect(JSON.stringify(cached)).toBe(JSON.stringify(pty.capture()))
    pty.kill()
  })
})
