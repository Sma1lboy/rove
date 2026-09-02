/**
 * PtyHost death records: which endings reach `onSessionExit`.
 *
 * The record is what `pty-exit-watch.ts` replays as an engine death — a `dead`
 * activity state, a durable Inbox episode, and a red toast. A session someone
 * CLOSED is not a death: its child still exits under a signal, so nothing
 * downstream can tell it from a crash. Deleting a task tears its sessions
 * down that way, so without the distinction every successful delete toasts
 * an error.
 *
 * Driven through a fake `PtyDriver`, like `pty-host-freeze.test.ts`.
 */

import type { PtyChild, PtyDriver, PtyExit } from "@sma1lboy/kobe-daemon/daemon/pty-driver"
import { PtyHost } from "@sma1lboy/kobe-daemon/daemon/pty-host"
import type { PtySessionEndInfo } from "@sma1lboy/kobe-daemon/daemon/pty-observability"
import { describe, expect, it } from "vitest"

class FakeChild {
  static nextPid = 2000
  readonly pid = FakeChild.nextPid++
  private settle!: (exit: PtyExit) => void
  readonly exited = new Promise<PtyExit>((resolve) => {
    this.settle = resolve
  })
  constructor(private readonly onData: (data: string | Uint8Array) => void) {}
  write(data: string): void {
    this.onData(data)
  }
  resize(): void {}
  close(): void {}
  kill(signal: NodeJS.Signals): void {
    this.settle({ code: null, signal })
  }
  /** Test-only: the child dies on its own (a crash, or an outside `kill -9`). */
  die(signal: NodeJS.Signals): void {
    this.settle({ code: null, signal })
  }
}

function harness(): { host: PtyHost; children: FakeChild[]; records: PtySessionEndInfo[] } {
  const children: FakeChild[] = []
  const records: PtySessionEndInfo[] = []
  const driver: PtyDriver = (request) => {
    const child = new FakeChild(request.onData)
    children.push(child)
    return child as unknown as PtyChild
  }
  return { children, records, host: new PtyHost({ driver, onSessionExit: (info) => records.push(info) }) }
}

const SPEC = { cwd: "/wt/t1", command: ["/bin/cat"], cols: 80, rows: 24 }

/** `exited` settles a microtask before the host's onExit bookkeeping runs. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

describe("PtyHost death records", () => {
  it("records a child that died on its own", async () => {
    const h = harness()
    h.host.open("t1::tab-1", SPEC, {}, () => {})
    h.children[0].write("boom")
    h.children[0].die("SIGKILL")
    await settle()

    expect(h.records).toHaveLength(1)
    expect(h.records[0]).toMatchObject({ key: "t1::tab-1", exit: { code: null, signal: "SIGKILL" } })
    expect(h.records[0]?.tail).toContain("boom")
  })

  it("records NOTHING for a session that was killed on request", async () => {
    const h = harness()
    h.host.open("t1::tab-1", SPEC, {}, () => {})
    await h.host.kill("t1::tab-1")
    await settle()

    expect(h.records).toEqual([])
  })

  it("records nothing for the task-deletion sweep either", async () => {
    const h = harness()
    h.host.open("gone::tab-1", SPEC, {}, () => {})
    h.host.open("live::tab-1", SPEC, {}, () => {})
    h.host.sweepTasks(new Set(["live"]))
    await settle()

    expect(h.records).toEqual([])
    expect(h.host.list().map((s) => s.key)).toEqual(["live::tab-1"])
  })
})
