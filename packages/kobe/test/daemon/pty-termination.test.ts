import type { PtyChild, PtyExit } from "@sma1lboy/kobe-daemon/daemon/pty-driver"
import { settledWithin, signalProcessGroup, terminatePtyChild } from "@sma1lboy/kobe-daemon/daemon/pty-termination"
import { describe, expect, test } from "vitest"

/**
 * `pid = 1` on purpose: `signalProcessGroup` only reaches for
 * `process.kill(-pid)` when `pid > 1`, so a fake child can never signal a
 * real process group that happens to share its made-up pid.
 */
class FakeChild implements PtyChild {
  readonly pid = 1
  readonly signals: NodeJS.Signals[] = []
  private settle!: (exit: PtyExit) => void
  readonly exited = new Promise<PtyExit>((resolve) => {
    this.settle = resolve
  })
  private gone = false
  /** A driver that has no group to signal (node-pty on Windows) supplies
   *  this; the POSIX drivers do not. */
  readonly endTree?: () => Promise<string>
  constructor(endTree?: (child: FakeChild) => Promise<string>) {
    if (endTree) this.endTree = () => endTree(this)
  }
  write(): void {}
  resize(): void {}
  close(): void {}
  /** node-pty: `kill()` after the child exited throws. */
  kill(signal: NodeJS.Signals): void {
    this.signals.push(signal)
    if (this.gone) throw new Error("Cannot kill a pty that has already exited")
    this.settle({ code: null, signal })
  }
  /** What a successful `taskkill` does from the child's point of view. */
  endFromOutside(): void {
    this.gone = true
    this.settle({ code: 1, signal: null })
  }
}

describe("terminatePtyChild", () => {
  test("a driver with endTree has the whole tree ended BEFORE the pty handle is released, then waits", async () => {
    const order: string[] = []
    const child = new FakeChild(async (self) => {
      order.push(`tree:${self.pid}:handleReleased=${self.signals.length > 0}`)
      self.endFromOutside()
      return "taskkill /T /F /PID 1: SUCCESS"
    })
    let settled = false
    await terminatePtyChild(
      child,
      () => {
        settled = true
      },
      (line) => order.push(`log:${line}`),
    )
    expect(settled).toBe(true)
    // The tree kill ran first, with the console still open for it to walk —
    // the pseudo console is only released afterwards, and the throw node-pty
    // makes on an already-exited child is swallowed the way a dead POSIX
    // child's is (no "sent SIGKILL" line: the fallback threw before it).
    expect(order).toEqual(["tree:1:handleReleased=false", "log:taskkill /T /F /PID 1: SUCCESS"])
    expect(child.signals).toEqual(["SIGKILL"])
  })

  test("a driver without endTree gets the signal escalation — the process group is the tree there", async () => {
    // Keyed on the driver, not on the platform: this FakeChild's pid is made
    // up, and a platform-keyed `taskkill /F` would reach whatever real
    // process holds that pid on a Windows test runner.
    const child = new FakeChild()
    await terminatePtyChild(child, () => {})
    expect(child.signals).toEqual(["SIGTERM"])
  })

  test("a tree kill that reports failure still releases the handle and reports the session dead", async () => {
    // The child is already gone (taskkill: "not found"), the pty's exit will
    // never arrive: the bounded wait is what keeps a deletion from hanging.
    const child = new FakeChild(
      async (self) => `taskkill /T /F /PID ${self.pid} did not complete: ERROR: The process "1" not found.`,
    )
    const lines: string[] = []
    let settled = false
    await terminatePtyChild(
      child,
      () => {
        settled = true
      },
      (line) => lines.push(line),
    )
    expect(settled).toBe(true)
    expect(lines[0]).toContain("not found")
    expect(child.signals).toEqual(["SIGKILL"])
  })
})

describe("settledWithin", () => {
  test("reports a resolved exit, and a rejected one just the same", async () => {
    expect(await settledWithin(Promise.resolve(0), 50)).toBe(true)
    // An exit is an exit however the runtime reports it — treating a rejection
    // as "still running" would escalate to SIGKILL against a dead process.
    expect(await settledWithin(Promise.reject(new Error("spawn lost")), 50)).toBe(true)
  })

  test("gives up on a promise that never settles instead of hanging the caller", async () => {
    // The node-pty driver's `exited` resolves only when ConPTY delivers
    // onExit; one wedged child must not hang killAll() and the host shutdown.
    expect(await settledWithin(new Promise(() => {}), 20)).toBe(false)
  })

  test("does not leave a pending timer holding the event loop open", async () => {
    // A leaked timer would keep the pty host process alive past idle-exit.
    const before = process.getActiveResourcesInfo?.().filter((r) => r === "Timeout").length ?? 0
    await settledWithin(Promise.resolve(0), 60_000)
    const after = process.getActiveResourcesInfo?.().filter((r) => r === "Timeout").length ?? 0
    expect(after).toBeLessThanOrEqual(before)
  })
})

describe("signalProcessGroup", () => {
  test("Windows goes straight to the child — it has no process group to signal", () => {
    let fellBack = false
    signalProcessGroup(
      4242,
      "SIGTERM",
      () => {
        fellBack = true
      },
      "win32",
    )
    expect(fellBack).toBe(true)
  })

  test("POSIX tries the group first and only falls back when that fails", () => {
    let fellBack = false
    // pid 1 is excluded on purpose: `kill(-1)` is "every process I may signal".
    signalProcessGroup(
      1,
      "SIGTERM",
      () => {
        fellBack = true
      },
      "linux",
    )
    expect(fellBack).toBe(true)

    fellBack = false
    // A pid whose group does not exist: kill(-pid) throws ESRCH, and the
    // child-only fallback must still run.
    signalProcessGroup(
      2147483646,
      "SIGTERM",
      () => {
        fellBack = true
      },
      "linux",
    )
    expect(fellBack).toBe(true)
  })

  test("a fallback that throws on an already-dead child is swallowed", () => {
    expect(() =>
      signalProcessGroup(
        4242,
        "SIGKILL",
        () => {
          throw new Error("Cannot kill a pty that has already exited")
        },
        "win32",
      ),
    ).not.toThrow()
  })
})
