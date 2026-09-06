/**
 * `killIfGeneration` dispatches the child's teardown and answers immediately.
 * Two things had to be true about that answer and were not:
 *
 *   - it said `killed: true` before any signal had been sent, so
 *     `rove api tab-close` and every pane teardown reported a successful kill
 *     over a PTY that might still be running;
 *   - the dispatched promise was a bare `void`, so a teardown that threw
 *     surfaced as an anonymous `unhandledRejection` — the one thing
 *     `daemon/crash-log.ts` exists to stop.
 *
 * The reachable throw: `onExit` fans the `pty.exit` frame out to every
 * attached sink without a guard, so a sink whose socket blew up rejects
 * `endChild`.
 */

import type { PtyChild, PtyDriver, PtyExit } from "@sma1lboy/kobe-daemon/daemon/pty-driver"
import { PtyHost } from "@sma1lboy/kobe-daemon/daemon/pty-host"
import { describe, expect, it, vi } from "vitest"

const SPEC = { cwd: "/wt/t1", command: ["/bin/cat"], cols: 80, rows: 24 }
const KEY = "t1::tab-1"

/**
 * `pid = 1` on purpose: `signalProcessGroup` only reaches for
 * `process.kill(-pid)` when `pid > 1`, so a fake child can never signal a
 * real process group that happens to share its made-up pid.
 */
class FakeChild {
  readonly pid = 1
  private settle!: (exit: PtyExit) => void
  readonly exited = new Promise<PtyExit>((resolve) => {
    this.settle = resolve
  })
  constructor(private readonly settleOnKill: boolean) {}
  write(): void {}
  resize(): void {}
  close(): void {}
  kill(signal: NodeJS.Signals): void {
    if (this.settleOnKill) this.settle({ code: null, signal })
  }
}

function hostWithChild(settleOnKill = true): { host: PtyHost; generation: () => string } {
  const driver: PtyDriver = () => new FakeChild(settleOnKill) as unknown as PtyChild
  const host = new PtyHost({ driver })
  return {
    host,
    generation: () => {
      const info = host.list().find((s) => s.key === KEY)
      if (!info?.generation) throw new Error("no session generation")
      return info.generation
    },
  }
}

describe("PtyHost.killIfGeneration", () => {
  it("reports the compare-and-remove it completed, not a kill it only dispatched", () => {
    const { host, generation } = hostWithChild()
    host.open(KEY, SPEC, {}, () => {})
    expect(host.killIfGeneration(KEY, generation())).toEqual({ accepted: true })
    // Idempotent, and still discriminated on the two checked refusals.
    expect(host.killIfGeneration(KEY, "whatever")).toEqual({ accepted: false, reason: "missing-session" })
  })

  it("refuses a stale generation without touching the live session", () => {
    const { host, generation } = hostWithChild()
    host.open(KEY, SPEC, {}, () => {})
    expect(host.killIfGeneration(KEY, "an-older-generation")).toEqual({
      accepted: false,
      reason: "generation-mismatch",
    })
    expect(generation()).toEqual(expect.any(String))
  })

  it("routes a failed teardown to daemon.log under a tag", async () => {
    // A child that ignores both signals: the teardown reaches `onSettled` only
    // after the SIGTERM + SIGKILL grace elapses, which is what puts the sink
    // throw inside `endChild`'s own promise rather than the child's natural
    // exit handler.
    const { host, generation } = hostWithChild(false)
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true)
    try {
      host.open(KEY, SPEC, {}, () => {
        throw new Error("client socket is gone")
      })
      expect(host.killIfGeneration(KEY, generation())).toEqual({ accepted: true })
      // The tag is what a post-mortem greps; without the `.catch` this same
      // rejection reaches the process as an anonymous unhandledRejection.
      await vi.waitFor(
        () => {
          const written = stderr.mock.calls.map((call) => String(call[0])).join("")
          expect(written).toContain("daemon error [pty-kill]")
          expect(written).toContain("client socket is gone")
        },
        { timeout: 5000 },
      )
    } finally {
      stderr.mockRestore()
    }
  })
})
