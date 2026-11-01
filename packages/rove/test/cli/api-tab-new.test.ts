/**
 * `rove api tab-new` through the default runtime, against a faked PTY host and
 * the daemon's real tab store: the row is the tab's identity, so its
 * allocation (the daemon's, never state.json's) is what these pin.
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
import { tabsDaemon } from "./tabs-daemon-fake.ts"

let home: string
const statePath = (): string => join(home, ".config/rove/state.json")
const target = (extra = {}) => ({
  id: "t",
  kind: "task" as const,
  worktreePath: home,
  repo: home,
  vendor: "claude" as const,
  ...extra,
})
const oneEngineTab = () => ({
  tabs: [{ kind: "engine", id: "tab-1", title: null, ordinal: 1 }],
  activeId: "tab-1",
  nextOrdinal: 2,
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

it("a shell tab is a command row with the login shell and no title, opened through the daemon", async () => {
  seed({})
  const daemon = tabsDaemon({ seed: { t: oneEngineTab() } })

  const first = await defaultApiRuntime.openTab(daemon.client, target(), "shell")
  const second = await defaultApiRuntime.openTab(daemon.client, target(), "shell")

  expect([first.tab.id, second.tab.id]).toEqual(["tab-2", "tab-3"])
  expect(first.session).toBe("t::tab-2")
  const saved = daemon.tabs("t")
  expect(saved?.tabs.map((t) => t.id)).toEqual(["tab-1", "tab-2", "tab-3"])
  expect(saved?.tabs[1]).toEqual({ kind: "command", id: "tab-2", title: null, ordinal: 2, command: ["/bin/sh"] })
  expect(saved?.nextOrdinal).toBe(4)
  // The daemon minted both ids; nothing wrote the tabs into state.json.
  expect(daemon.applied.flatMap((a) => a.ops.filter((op) => op.op === "open"))).toHaveLength(2)
  expect(JSON.parse(readFileSync(statePath(), "utf8"))).toEqual({})
  // The identity export is typed into the session this call created, once per tab.
  const typed = host.calls.filter((c) => c.name === "pty.write").map((c) => c.payload.key)
  expect(typed).toEqual(["t::tab-2", "t::tab-3"])
})

it("a home shell on a fresh task is its tab-1, never an engine tab-1 with a shell behind it", async () => {
  seed({})
  const daemon = tabsDaemon({ seed: {} })

  const opened = await defaultApiRuntime.openTab(daemon.client, target(), "shell", { home: true })

  expect(opened.session).toBe("t::tab-1")
  expect(daemon.tabs("t")?.tabs).toEqual([
    { kind: "command", id: "tab-1", title: null, ordinal: 1, command: ["/bin/sh"] },
  ])
  // A task that already has tabs keeps them: its tab-1 is not a shell to spawn into.
  await expect(
    defaultApiRuntime.openTab(tabsDaemon({ seed: { t: oneEngineTab() } }).client, target(), "shell", { home: true }),
  ).rejects.toMatchObject({ code: "SESSION_FAILED" })
})

it("two concurrent tab-news get two distinct ids from the daemon", async () => {
  seed({})
  const daemon = tabsDaemon({ seed: { t: oneEngineTab() } })

  const [a, b] = await Promise.all([
    defaultApiRuntime.openTab(daemon.client, target(), "shell"),
    defaultApiRuntime.openTab(daemon.client, target(), "shell"),
  ])

  expect(a.tab.id).not.toBe(b.tab.id)
  expect(new Set([a.session, b.session]).size).toBe(2)
  expect(
    daemon
      .tabs("t")
      ?.tabs.map((t) => t.id)
      .sort(),
  ).toEqual(["tab-1", a.tab.id, b.tab.id].sort())
})

it("an engine starts the task's own tab-1, not a second tab beside an empty one", async () => {
  seed({})
  const daemon = tabsDaemon()

  const opened = await defaultApiRuntime.openTab(daemon.client, target(), "engine")

  expect(opened.session).toBe("t::tab-1")
  expect(opened.tab).toMatchObject({ kind: "engine", id: "tab-1", spawned: true })
  expect(daemon.tabs("t")?.tabs).toEqual([opened.tab])
})

it("attaching to a session that already existed is a refusal, not a new tab", async () => {
  seed({})
  host.created = false
  const daemon = tabsDaemon()

  await expect(defaultApiRuntime.openTab(daemon.client, target(), "shell")).rejects.toMatchObject({
    code: "TAB_COLLISION",
  })

  expect(host.calls.some((c) => c.name === "pty.write")).toBe(false)
})

it("an engine refused by engine.maxLiveSessions starts nothing", async () => {
  seed({ "engine.maxLiveSessions": 1 })
  const daemon = tabsDaemon()
  host.sessions = [{ key: "other::tab-1", pid: 123, alive: true, command: ["claude"], title: "" }]

  await expect(defaultApiRuntime.openTab(daemon.client, target(), "engine")).rejects.toMatchObject({
    code: "ENGINE_LIMIT",
  })

  expect(host.calls.some((c) => c.name === "pty.openChecked")).toBe(false)
})
