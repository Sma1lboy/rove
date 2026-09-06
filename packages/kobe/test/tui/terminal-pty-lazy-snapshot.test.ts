import { describe, expect, it, vi } from "vitest"
import { FakeTransportPty, rowsText, settleRefresh } from "./pty-fake"

/**
 * Lazy snapshot rebuild for unwatched PTYs.
 *
 * Why this matters: the workspace keeps every task's engine PTYs alive in
 * the registry, but only the visible tab subscribes via `onData`. Before
 * the lazy path, EVERY live PTY re-converted its full grid + 200-row
 * scrollback margin at output cadence (~60Hz) even though its only reader
 * was the 1.5s turn-status poll's `capture()` — N background streaming
 * sessions burned N× a full-screen conversion for nothing. These tests pin
 * the contract: no subscriber → no eager rebuild; `capture()` and a late
 * `onData` subscribe still always see fresh content.
 */

describe("XtermTaskPty lazy snapshot (no subscribers)", () => {
  it("defers the rebuild until capture(), then serves it without re-converting", async () => {
    const pty = new FakeTransportPty({ taskId: "t1", cwd: "/wt" })
    // biome-ignore lint/suspicious/noExplicitAny: reaching a private method to observe laziness
    const refresh = vi.spyOn(pty as any, "refreshSnapshot")

    await pty.pump("hello from background\r\n")
    await settleRefresh()
    // Output landed but nobody is watching — no conversion ran.
    expect(refresh).not.toHaveBeenCalled()

    // The turn poll's read path: capture() rebuilds once, lazily.
    expect(rowsText(pty.capture())).toContain("hello from background")
    expect(refresh).toHaveBeenCalledTimes(1)

    // Clean now — a second read doesn't rebuild again.
    pty.capture()
    pty.captureCursor()
    expect(refresh).toHaveBeenCalledTimes(1)

    pty.kill()
  })

  it("primes a late onData subscriber with fresh content, not the stale snapshot", async () => {
    const pty = new FakeTransportPty({ taskId: "t1", cwd: "/wt" })
    await pty.pump("first output\r\n")
    await settleRefresh()

    const primed: string[] = []
    pty.onData((snap) => primed.push(rowsText(snap)))
    expect(primed).toHaveLength(1)
    expect(primed[0]).toContain("first output")

    pty.kill()
  })

  it("keeps the eager push path for live subscribers", async () => {
    const pty = new FakeTransportPty({ taskId: "t1", cwd: "/wt" })
    const seen: string[] = []
    pty.onData((snap) => seen.push(rowsText(snap)))

    await pty.pump("streamed line\r\n")
    await settleRefresh()
    // No capture() needed — the subscriber was pushed the fresh snapshot.
    expect(seen.some((s) => s.includes("streamed line"))).toBe(true)

    pty.kill()
  })
})
