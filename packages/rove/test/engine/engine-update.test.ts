/** Telling a running engine from the newer CLI installed under its name since it started. */

import { describe, expect, it } from "vitest"
import { type EngineUpdateDeps, engineUpdates, parseEtime } from "../../src/engine/engine-update.ts"

const NOW = 1_000_000_000_000
const MIN = 60_000

/** One engine started `startedMinAgo` minutes ago whose binary changed `changedMinAgo` minutes ago. */
function deps(startedMinAgo: Record<number, number>, changedMinAgo: Record<string, number>): EngineUpdateDeps {
  return {
    now: () => NOW,
    elapsed: async (pids) =>
      pids
        .filter((pid) => pid in startedMinAgo)
        .map((pid) => `  ${pid}       ${String(startedMinAgo[pid]).padStart(2, "0")}:00`)
        .join("\n"),
    which: (name) => (name === "claude" ? "/home/u/.local/bin/claude" : null),
    changedAt: async (path) => (path in changedMinAgo ? NOW - (changedMinAgo[path] as number) * MIN : null),
  }
}

describe("engineUpdates", () => {
  it("flags an engine whose binary was reinstalled after it started, and not one installed before", async () => {
    const result = await engineUpdates(
      new Map([
        ["t1::tab-1", { pid: 11, argv: "claude --resume abc" }],
        ["t1::tab-2", { pid: 12, argv: "node /usr/lib/node_modules/codex/bin/codex.js" }],
      ]),
      deps({ 11: 30, 12: 30 }, { "/home/u/.local/bin/claude": 5, "/usr/lib/node_modules/codex/bin/codex.js": 90 }),
    )
    expect(Object.fromEntries(result)).toEqual({ "t1::tab-1": true, "t1::tab-2": false })
  })

  it("answers null, never false, when it could not look", async () => {
    const result = await engineUpdates(
      new Map([
        ["no-engine", null],
        ["gone-from-ps", { pid: 99, argv: "claude" }],
        ["not-on-path", { pid: 11, argv: "mystery-cli" }],
        ["relative", { pid: 11, argv: "./bin/claude" }],
      ]),
      deps({ 11: 30 }, { "/home/u/.local/bin/claude": 5 }),
    )
    expect([...result.values()]).toEqual([null, null, null, null])
    const failedPs = await engineUpdates(new Map([["k", { pid: 11, argv: "claude" }]]), {
      ...deps({}, {}),
      elapsed: async () => {
        throw new Error("ps timed out")
      },
    })
    expect(failedPs.get("k")).toBeNull()
  })
})

describe("parseEtime", () => {
  it("reads every POSIX elapsed-time form", () => {
    expect(parseEtime("05:09")).toBe(309)
    expect(parseEtime("02:05:09")).toBe(2 * 3600 + 309)
    expect(parseEtime("3-02:05:09")).toBe(3 * 86400 + 2 * 3600 + 309)
    expect(parseEtime("soon")).toBeNull()
  })
})
