/** `gates.json` on disk: an unreadable file is never overwritten, and pruning keeps every open or owed gate. */

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { GatesStore, MAX_CLOSED_GATES } from "@sma1lboy/rove-daemon/daemon/gates-store"
import { afterEach, describe, expect, it } from "vitest"

describe("gates store on disk", () => {
  const dirs: string[] = []
  afterEach(async () => {
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
  })

  it("refuses to overwrite a gates file it could not read", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rove-gates-"))
    dirs.push(dir)
    const path = join(dir, "gates.json")
    writeFileSync(path, '{"version":1,"gates":"oops"}')
    const gates = new GatesStore(path)
    await expect(gates.init()).rejects.toThrow(/unreadable/)
    await expect(gates.raise({ taskId: "t", question: "q" })).rejects.toThrow(/never loaded/)
    expect(readFileSync(path, "utf8")).toContain("oops")
  })

  it("prunes closed gates to the newest 200 but never an open or owed one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rove-gates-"))
    dirs.push(dir)
    const path = join(dir, "gates.json")
    const mk = (n: number, status: string, extra: Record<string, unknown> = {}) => ({
      id: `g-${n}`,
      taskId: "t",
      tabId: null,
      question: "q",
      options: [],
      status,
      createdAt: "2026-10-01T00:00:00.000Z",
      ...extra,
    })
    const closed = Array.from({ length: MAX_CLOSED_GATES + 20 }, (_, i) => mk(i + 3, "withdrawn"))
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        nextId: 400,
        // The oldest two are the ones that must survive: open, and answered-but-owed.
        gates: [
          mk(1, "open"),
          mk(2, "answered", { handoff: "undelivered", answer: { text: "x", by: "cli", at: "" } }),
          ...closed,
        ],
      }),
    )
    const gates = new GatesStore(path)
    await gates.init()
    await gates.raise({ taskId: "t", question: "trigger" })
    const kept = gates.list({ status: "all" })
    expect(kept.filter((g) => g.status === "withdrawn")).toHaveLength(MAX_CLOSED_GATES)
    expect(kept.find((g) => g.id === "g-1")?.status).toBe("open")
    expect(kept.find((g) => g.id === "g-2")?.handoff).toBe("undelivered")
    expect(kept.find((g) => g.id === "g-3")).toBeUndefined()
    expect(kept.some((g) => g.id === "g-400")).toBe(true)
  })
})
