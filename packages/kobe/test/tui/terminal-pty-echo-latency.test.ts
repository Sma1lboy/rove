import { describe, expect, it } from "vitest"
import { SNAPSHOT_COALESCE_MS } from "../../src/tui/panes/terminal/pty-xterm-base"
import { FakeTransportPty, settleRefresh } from "./pty-fake"

/**
 * The coalesce window's LEADING edge — keystroke-echo latency.
 *
 * Why this matters: the throttle exists so a streaming pane builds at most
 * one snapshot per rendered frame. Trailing-only, it also charged that full
 * frame to output arriving at an IDLE terminal, which is every keystroke you
 * type into a shell — the child echoes in ~0.03ms and the pane then had
 * nothing to draw for another 33ms. Measured end to end on macOS before this
 * split: p50 35.8ms from `write()` to the published snapshot, against a raw
 * PTY echo of 0.03ms.
 *
 * Both halves are pinned here, because each one alone is satisfiable by the
 * wrong implementation: "publishes immediately" passes with no coalesce at
 * all, and "coalesces a burst" passes with the trailing-only version that was
 * the bug.
 */
describe("XtermTaskPty snapshot coalesce", () => {
  it("publishes output arriving at an idle terminal without waiting a frame", async () => {
    const pty = new FakeTransportPty({ taskId: "t1", cwd: "/wt" })
    let published = 0
    pty.onData(() => {
      published++
    })

    // A subscriber that has never seen output is idle by construction.
    await pty.pump("x")
    // No `settleRefresh()`: the publish must already have happened by the
    // time xterm's parse callback returns.
    expect(published).toBe(1)

    pty.kill()
  })

  it("still coalesces a burst to one snapshot per frame", async () => {
    const pty = new FakeTransportPty({ taskId: "t2", cwd: "/wt" })
    let published = 0
    pty.onData(() => {
      published++
    })

    await pty.pump("first")
    expect(published).toBe(1)

    // Four more chunks inside the same window: the leading edge is spent, so
    // these collapse into ONE deferred refresh rather than four.
    for (const chunk of ["a", "b", "c", "d"]) await pty.pump(chunk)
    expect(published).toBe(1)

    await settleRefresh()
    expect(published).toBe(2)

    pty.kill()
  })

  it("re-arms the leading edge once the window has passed", async () => {
    const pty = new FakeTransportPty({ taskId: "t3", cwd: "/wt" })
    let published = 0
    pty.onData(() => {
      published++
    })

    await pty.pump("one")
    expect(published).toBe(1)

    // Idle longer than the window, the way a human pauses between keystrokes.
    await new Promise((resolve) => setTimeout(resolve, SNAPSHOT_COALESCE_MS + 20))
    await pty.pump("two")
    expect(published).toBe(2)

    pty.kill()
  })
})
