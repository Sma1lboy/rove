import { describe, expect, it } from "vitest"
import { createCast } from "../pty-cast.mjs"
import { FakeSocket, setup } from "./pty-fakes.ts"

describe("PTY session cast recording", () => {
  it("records one cast per tab across a respawn and hands it over once", async () => {
    let clock = 0
    const { manager, ptys } = setup({
      createCast: ({ cols, rows }) => createCast({ cols, rows, now: () => clock }),
    })
    const attach = (ws: FakeSocket) =>
      manager.attachSocket({ ws, tabId: "tab", taskId: "task", mode: "shell", cols: 80, rows: 24 })

    const first = new FakeSocket()
    await attach(first)
    clock = 500
    ptys[0].emitData("hello")
    first.message(JSON.stringify({ type: "resize", cols: 100, rows: 30 }))
    clock = 1_250
    expect(manager.markCast("tab", "beat")).toBe(true)
    ptys[0].emitExit()

    // The TUI quit and the page reattached: same tab, fresh process.
    await attach(new FakeSocket())
    clock = 2_000
    ptys[1].emitData("again")

    const [header, ...events] = (manager.takeCast("tab") ?? "").trim().split("\n").map((l) => JSON.parse(l))
    expect(header).toEqual({ version: 2, width: 80, height: 24 })
    expect(events).toEqual([
      [0.5, "o", "hello"],
      [0.5, "r", "100x30"],
      [1.25, "m", "beat"],
      [1.25, "o", "\x1bc"],
      [1.25, "r", "80x24"],
      [2, "o", "again"],
    ])
    expect(manager.takeCast("tab")).toBeNull()
  })

  it("records nothing without a cast factory", async () => {
    const { manager, ptys } = setup()
    await manager.attachSocket({ ws: new FakeSocket(), tabId: "tab", taskId: "task", mode: "shell", cols: 80, rows: 24 })
    ptys[0].emitData("hello")
    expect(manager.markCast("tab", "beat")).toBe(false)
    expect(manager.takeCast("tab")).toBeNull()
  })
})
