/**
 * `rove api tab-split` through the default runtime, against a faked PTY host
 * and the daemon's real tab store: the layout is stored as one `patch` of the
 * tab's `splitTree` (`tabs.apply`), never written into state.json.
 */

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

const host = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; payload: Record<string, unknown> }>,
  failOpen: false,
}))
vi.mock("../../src/engine/hosted-session.ts", async (original) => ({
  ...(await original<object>()),
  ensureHostedSessionHost: async () => ({
    rpc: {
      request: async (name: string, payload: Record<string, unknown> = {}) => {
        host.calls.push({ name, payload })
        if (name === "pty.open") {
          if (host.failOpen) throw new Error("host refused")
          return { replay: "", alive: true, created: true }
        }
        if (name === "pty.list") return { sessions: [], admissionToken: "test" }
        return {}
      },
    },
    close() {},
  }),
}))

import { defaultApiRuntime } from "../../src/cli/api/runtime.ts"
import { type TabsDaemon, tabsDaemon } from "./tabs-daemon-fake.ts"

let home: string
let daemon: TabsDaemon
const statePath = (): string => join(home, ".config/rove/state.json")
const ENGINE = { kind: "engine", id: "tab-1", title: null, ordinal: 1 }

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "rove-api-tab-split-"))
  vi.stubEnv("ROVE_HOME_DIR", home)
  host.calls = []
  host.failOpen = false
  mkdirSync(join(home, ".config/rove"), { recursive: true })
  writeFileSync(statePath(), "{}")
  daemon = tabsDaemon({ seed: { t: { tabs: [ENGINE], activeId: "tab-1", nextOrdinal: 2 } } })
})
afterEach(() => {
  vi.unstubAllEnvs()
  expect(readFileSync(statePath(), "utf8")).toBe("{}")
})

it("open stores the new tree as one splitTree patch; close collapses it back to null", async () => {
  const opened = await defaultApiRuntime.splitTab(daemon.client, "t", "tab-1", home, {
    kind: "open",
    orientation: "row",
    from: "",
  })

  expect(opened).toMatchObject({ leaf: "leaf-2", changed: true })
  expect(daemon.applied).toEqual([
    { taskId: "t", ops: [{ op: "patch", id: "tab-1", set: { splitTree: expect.objectContaining({}) } }] },
  ])
  expect(JSON.stringify(daemon.tabs("t")?.tabs[0]?.splitTree)).toContain("leaf-2")
  expect(host.calls.find((c) => c.name === "pty.open")?.payload.key).toBe("t::tab-1::leaf-2")

  const closed = await defaultApiRuntime.splitTab(daemon.client, "t", "tab-1", home, { kind: "close", leaf: "leaf-2" })

  expect(closed).toMatchObject({ leaf: "leaf-2", changed: true })
  expect(daemon.tabs("t")?.tabs[0]?.splitTree).toBeNull()
})

it("a refused shell takes the split back; an unknown tab is TAB_NOT_FOUND and sends nothing", async () => {
  host.failOpen = true
  await expect(
    defaultApiRuntime.splitTab(daemon.client, "t", "tab-1", home, { kind: "open", orientation: "row", from: "" }),
  ).rejects.toMatchObject({ code: "SESSION_FAILED" })
  expect(daemon.tabs("t")?.tabs[0]?.splitTree ?? null).toBeNull()

  const sent = daemon.applied.length
  await expect(
    defaultApiRuntime.splitTab(daemon.client, "t", "tab-9", home, { kind: "rename", leaf: "leaf-1", title: "x" }),
  ).rejects.toMatchObject({ code: "TAB_NOT_FOUND" })
  expect(daemon.applied).toHaveLength(sent)
})
