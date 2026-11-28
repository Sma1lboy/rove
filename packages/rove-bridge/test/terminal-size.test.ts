/** A size-less attach (the phone) follows the PTY's size on a host that pushes `pty.size` and on one that doesn't. */

import { describe, expect, test } from "bun:test"
import { TerminalForwarder } from "../src/terminal.ts"
import { FakePty } from "./server-harness.ts"

/** A host predating `cols`/`rows` on open and the `pty.size` push: only a peek tells the size. */
class LegacyPty extends FakePty {
  size = { cols: 200, rows: 50 }
  override async request<T>(name: string, payload?: unknown): Promise<T> {
    this.calls.push([name, payload])
    if (name === "pty.list") return { sessions: this.sessions } as T
    if (name === "pty.open") return { replay: "", alive: true, offset: 10 } as T
    if (name === "pty.peek") return { data: "", offset: 10, ...this.size } as T
    return {} as T
  }
}

function forwarder(pty: FakePty) {
  const pushes: Array<{ event: string; data: unknown }> = []
  const fwd = new TerminalForwarder(pty, (frame) => pushes.push(JSON.parse(frame)), 5)
  const sizes = () => pushes.filter((p) => p.event === "term.size").map((p) => p.data)
  const until = async (ok: () => boolean) => {
    for (let i = 0; i < 200 && !ok(); i++) await new Promise((r) => setTimeout(r, 5))
  }
  return { fwd, sizes, until }
}

describe("a size-less attach follows the PTY's size", () => {
  test("on a legacy host: the attach reports it and a poll pushes each change until a push arrives", async () => {
    const pty = new LegacyPty()
    const { fwd, sizes, until } = forwarder(pty)
    const attached = await fwd.attach("T1", "tab-1", "/wt")
    expect(attached).toMatchObject({ cols: 200, rows: 50 })

    pty.size = { cols: 120, rows: 40 }
    await until(() => sizes().length > 0)
    expect(sizes()).toEqual([{ stream: "T1::tab-1", cols: 120, rows: 40 }])

    // The host turns out to push after all: polling stops.
    pty.emit("pty.size", { key: "T1::tab-1", cols: 90, rows: 30 })
    const peeks = () => pty.calls.filter(([n]) => n === "pty.peek").length
    const before = peeks()
    pty.size = { cols: 60, rows: 20 }
    await new Promise((r) => setTimeout(r, 30))
    expect(peeks()).toBe(before)
    expect(sizes()).toEqual([
      { stream: "T1::tab-1", cols: 120, rows: 40 },
      { stream: "T1::tab-1", cols: 90, rows: 30 },
    ])
    fwd.dispose()
  })

  test("on a host that reports its size on open, nothing is polled", async () => {
    const pty = new FakePty()
    const { fwd } = forwarder(pty)
    await fwd.attach("T1", "tab-1", "/wt")
    await new Promise((r) => setTimeout(r, 30))
    expect(pty.calls.some(([n]) => n === "pty.peek")).toBe(false)
    fwd.dispose()
  })
})
