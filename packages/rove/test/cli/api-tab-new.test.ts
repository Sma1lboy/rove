/**
 * `rove api tab-new` through the default runtime, against a faked PTY host:
 * the persisted row is the tab's identity, so its allocation is what these pin.
 */

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

const host = vi.hoisted(() => ({
  sessions: [] as unknown[],
  calls: [] as Array<{ name: string; payload: Record<string, unknown> }>,
  created: true,
}))
vi.mock("../../src/engine/hosted-session.ts", async (original) => ({
  ...(await original<object>()),
  ensureHostedSessionHost: async () => ({
    rpc: {
      request: async (name: string, payload: Record<string, unknown> = {}) => {
        host.calls.push({ name, payload })
        if (name === "pty.list") return { sessions: host.sessions, admissionToken: "test" }
        if (name === "pty.open") return { replay: "", alive: true, created: host.created }
        return {}
      },
    },
    close() {},
  }),
}))
vi.mock("../../src/engine/foreground.ts", async (original) => ({
  ...(await original<object>()),
  psSnapshot: async () => "123 1 /bin/sh\n456 123 claude",
}))
vi.mock("../../src/engine/trust-worktree.ts", () => ({ trustEngineWorktree() {} }))

import { defaultApiRuntime } from "../../src/cli/api/runtime.ts"
import type { DaemonRpc } from "../../src/cli/daemon-session.ts"
import type { TabsState } from "../../src/tui/workspace/terminal-tabs-core.ts"

const daemon: DaemonRpc = {
  subscribe: async () => ({}),
  onChannel: () => () => {},
  request: async () => {
    throw new Error("unexpected daemon request")
  },
}

let home: string
const statePath = (): string => join(home, ".config/rove/state.json")
const savedTabs = (): TabsState => JSON.parse(readFileSync(statePath(), "utf8"))["terminalTabs.t"]
const target = (extra = {}) => ({
  id: "t",
  kind: "task" as const,
  worktreePath: home,
  repo: home,
  vendor: "claude" as const,
  ...extra,
})

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "rove-api-tab-new-"))
  vi.stubEnv("ROVE_HOME_DIR", home)
  vi.stubEnv("SHELL", "/bin/sh")
  host.sessions = []
  host.calls = []
  host.created = true
  mkdirSync(join(home, ".config/rove"), { recursive: true })
})
afterEach(() => vi.unstubAllEnvs())

function seed(state: Record<string, unknown>): void {
  writeFileSync(statePath(), JSON.stringify(state))
}

it("a shell tab is a command row with the login shell and no title; two opens never share an id, and a live orphan's id is skipped", async () => {
  seed({
    "terminalTabs.t": {
      tabs: [{ kind: "engine", id: "tab-1", title: null, ordinal: 1 }],
      activeId: "tab-1",
      nextOrdinal: 2,
    },
  })
  host.sessions = [{ key: "t::tab-2", alive: true }]

  const first = await defaultApiRuntime.openTab(daemon, target(), "shell")
  const second = await defaultApiRuntime.openTab(daemon, target(), "shell")

  expect([first.tab.id, second.tab.id]).toEqual(["tab-3", "tab-4"])
  expect(first.session).toBe("t::tab-3")
  const saved = savedTabs()
  expect(saved.tabs.map((t) => t.id)).toEqual(["tab-1", "tab-3", "tab-4"])
  expect(saved.tabs[1]).toEqual({ kind: "command", id: "tab-3", title: null, ordinal: 3, command: ["/bin/sh"] })
  expect(saved.nextOrdinal).toBe(5)
  // The identity export is typed into the session this call created, once per tab.
  const typed = host.calls.filter((c) => c.name === "pty.write").map((c) => c.payload.key)
  expect(typed).toEqual(["t::tab-3", "t::tab-4"])
})

it("attaching to a session that already existed is a refusal, not a new tab", async () => {
  seed({})
  host.created = false

  await expect(defaultApiRuntime.openTab(daemon, target(), "shell")).rejects.toMatchObject({ code: "TAB_COLLISION" })

  expect(host.calls.some((c) => c.name === "pty.write")).toBe(false)
})

it("an engine tab refused by engine.maxLiveSessions takes its row back", async () => {
  const tabs = { tabs: [{ kind: "engine", id: "tab-1", title: null, ordinal: 1 }], activeId: "tab-1", nextOrdinal: 2 }
  seed({ "engine.maxLiveSessions": 1, "terminalTabs.t": tabs })
  host.sessions = [{ key: "other::tab-1", pid: 123, alive: true, command: ["claude"], title: "" }]

  await expect(defaultApiRuntime.openTab(daemon, target(), "engine")).rejects.toMatchObject({ code: "ENGINE_LIMIT" })

  expect(savedTabs().tabs).toEqual(tabs.tabs)
  expect(host.calls.some((c) => c.name === "pty.openChecked")).toBe(false)
})
