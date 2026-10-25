/**
 * `rove api tab-revive` through the default runtime, against a faked PTY host
 * and the daemon's real tab store: what the host is asked to open, and the row
 * the daemon holds afterwards.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
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
        if (name === "pty.open") return { replay: "", alive: true, created: host.created, respawned: !host.created }
        return {}
      },
    },
    close() {},
  }),
}))
vi.mock("../../src/engine/trust-worktree.ts", () => ({ trustEngineWorktree() {} }))

import { ApiError, invokeVerb } from "../../src/cli/api-cmd.ts"
import { defaultApiRuntime } from "../../src/cli/api/runtime.ts"
import { FakeClient, stubRuntime } from "./api-handler-fixtures.ts"
import { tabsDaemon } from "./tabs-daemon-fake.ts"

let home: string
const target = () => ({ id: "t", kind: "task" as const, worktreePath: home, repo: home, vendor: "claude" as const })
const engineRow = (extra = {}) => ({ kind: "engine", id: "tab-1", title: null, ordinal: 1, ...extra })
const state = (...tabs: unknown[]) => ({ tabs, activeId: "tab-1", nextOrdinal: tabs.length + 1 })
const opened = () => host.calls.find((c) => c.name === "pty.open" || c.name === "pty.openChecked")
const launchLine = (): string => String((opened()?.payload.command as string[])[2])

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "rove-api-tab-revive-"))
  vi.stubEnv("ROVE_HOME_DIR", home)
  vi.stubEnv("SHELL", "/bin/sh")
  host.sessions = []
  host.calls = []
  host.created = true
  mkdirSync(join(home, ".config/rove"), { recursive: true })
  writeFileSync(join(home, ".config/rove/state.json"), "{}")
})
afterEach(() => vi.unstubAllEnvs())

it("a tab with a running PTY is left alone", async () => {
  host.sessions = [{ key: "t::tab-1", pid: 123, alive: true, command: ["claude"], title: "" }]
  const daemon = tabsDaemon({ seed: { t: state(engineRow({ sessionId: "abc", spawned: true })) } })

  const out = await defaultApiRuntime.reviveTab(daemon.client, target(), "tab-1", home)

  expect(out).toEqual({ revived: false, alive: true, resumed: false })
  expect(opened()).toBeUndefined()
})

it("an engine tab whose key the host lost resumes its persisted conversation, never a prompt", async () => {
  const daemon = tabsDaemon({ seed: { t: state(engineRow({ sessionId: "abc-123", spawned: true })) } })

  const out = await defaultApiRuntime.reviveTab(daemon.client, target(), "tab-1", home)

  expect(out).toEqual({ revived: true, resumed: true, sessionId: "abc-123" })
  expect(opened()?.payload).toMatchObject({ key: "t::tab-1", cwd: home })
  expect(launchLine()).toContain("--resume abc-123")
  expect(daemon.tabs("t")?.tabs[0]).toMatchObject({ sessionId: "abc-123", spawned: true })
})

it("a freeze-restored engine tab is respawned in place with the resume launch", async () => {
  host.created = false
  host.sessions = [{ key: "t::tab-1", pid: null, alive: false, restored: true, command: ["claude", "first prompt"] }]
  const daemon = tabsDaemon({ seed: { t: state(engineRow({ sessionId: "abc-123", spawned: true })) } })

  const out = await defaultApiRuntime.reviveTab(daemon.client, target(), "tab-1", home)

  expect(out).toMatchObject({ revived: true, resumed: true })
  expect(launchLine()).toContain("--resume abc-123")
  expect(launchLine()).not.toContain("first prompt")
})

it("an engine tab with no recorded conversation starts fresh and records the id it pinned", async () => {
  const daemon = tabsDaemon({ seed: { t: state(engineRow()) } })

  const out = await defaultApiRuntime.reviveTab(daemon.client, target(), "tab-1", home)

  expect(out.resumed).toBe(false)
  expect(out.sessionId).toMatch(/^[0-9a-f-]{36}$/)
  expect(launchLine()).toContain(`--session-id ${out.sessionId}`)
  expect(launchLine()).not.toContain("--resume")
  expect(daemon.tabs("t")?.tabs[0]).toMatchObject({ sessionId: out.sessionId, spawned: true })
})

it("without $SHELL the relaunch runs in the shell a TUI reattach uses, where a shell-function preset lives", async () => {
  vi.stubEnv("SHELL", "")
  // Dynamic on purpose: the shell resolver caches per module instance, so the
  // unset $SHELL only takes effect on modules evaluated after the stub.
  vi.resetModules()
  const { defaultApiRuntime: fresh } = await import("../../src/cli/api/runtime.ts")
  const { defaultShell } = await import("../../src/tui/panes/terminal/pty-types.ts")
  const daemon = tabsDaemon({ seed: { t: state(engineRow()) } })

  await fresh.reviveTab(daemon.client, target(), "tab-1", home)

  const [shell, flags] = opened()?.payload.command as string[]
  expect(shell).toBe(defaultShell())
  expect(flags).toBe("-ilc")
})

it("a shell tab reopens its login shell and exports its ids again", async () => {
  const shell = { kind: "command", id: "tab-2", title: null, ordinal: 2, command: ["/bin/sh"] }
  const daemon = tabsDaemon({ seed: { t: state(engineRow(), shell) } })

  const out = await defaultApiRuntime.reviveTab(daemon.client, target(), "tab-2", home)

  expect(out).toEqual({ revived: true, resumed: false })
  expect(opened()?.payload).toMatchObject({ key: "t::tab-2", cwd: home, command: ["/bin/sh"] })
  expect(host.calls.find((c) => c.name === "pty.write")?.payload.data).toContain("ROVE_TAB_ID=tab-2")
})

it("a dead non-restored engine corpse is cleared, then reopened", async () => {
  host.sessions = [{ key: "t::tab-1", pid: null, alive: false, command: ["claude"] }]
  const daemon = tabsDaemon({ seed: { t: state(engineRow({ sessionId: "abc-123", spawned: true })) } })

  const out = await defaultApiRuntime.reviveTab(daemon.client, target(), "tab-1", home)

  expect(out).toMatchObject({ revived: true, resumed: true })
  const names = host.calls.map((c) => c.name)
  expect(host.calls.find((c) => c.name === "pty.kill")?.payload).toMatchObject({ key: "t::tab-1" })
  expect(names.indexOf("pty.kill")).toBeLessThan(names.findIndex((n) => n === "pty.open" || n === "pty.openChecked"))
})

it("a dead non-restored shell corpse is cleared, then reopened", async () => {
  const shell = { kind: "command", id: "tab-2", title: null, ordinal: 2, command: ["/bin/sh"] }
  host.sessions = [{ key: "t::tab-2", pid: null, alive: false, command: ["/bin/sh"] }]
  const daemon = tabsDaemon({ seed: { t: state(engineRow(), shell) } })

  const out = await defaultApiRuntime.reviveTab(daemon.client, target(), "tab-2", home)

  expect(out).toEqual({ revived: true, resumed: false })
  expect(host.calls.some((c) => c.name === "pty.kill")).toBe(true)
  expect(opened()?.payload).toMatchObject({ key: "t::tab-2" })
})

it("with replaceExited a running session whose engine is gone is closed, then relaunched", async () => {
  host.sessions = [{ key: "t::tab-1", pid: 123, alive: true, command: ["/bin/zsh", "-ilc", "claude"], title: "" }]
  const daemon = tabsDaemon({ seed: { t: state(engineRow({ sessionId: "abc-123", spawned: true })) } })

  const out = await defaultApiRuntime.reviveTab(daemon.client, target(), "tab-1", home, { replaceExited: true })

  expect(out).toMatchObject({ revived: true, resumed: true })
  const names = host.calls.map((c) => c.name)
  expect(host.calls.find((c) => c.name === "pty.kill")?.payload).toMatchObject({ key: "t::tab-1", wait: true })
  expect(names.indexOf("pty.kill")).toBeLessThan(names.findIndex((n) => n === "pty.open" || n === "pty.openChecked"))
  expect(launchLine()).toContain("--resume abc-123")
})

it("a session whose first start failed before its tab was recorded relaunches as the task's own tab-1", async () => {
  host.sessions = [{ key: "t::tab-1", pid: 123, alive: true, command: ["/bin/zsh", "-ilc", "claude"], title: "" }]
  const daemon = tabsDaemon({ seed: {} })

  const out = await defaultApiRuntime.reviveTab(daemon.client, target(), "tab-1", home, { replaceExited: true })

  expect(out).toMatchObject({ revived: true, resumed: false })
  expect(daemon.tabs("t")?.tabs[0]).toMatchObject({ id: "tab-1", kind: "engine" })
  expect(opened()?.payload).toMatchObject({ key: "t::tab-1" })
})

it("a freeze-restored corpse is respawned in place, never killed", async () => {
  host.created = false
  host.sessions = [{ key: "t::tab-1", pid: null, alive: false, restored: true, command: ["claude"] }]
  const daemon = tabsDaemon({ seed: { t: state(engineRow()) } })

  await defaultApiRuntime.reviveTab(daemon.client, target(), "tab-1", home)

  expect(host.calls.some((c) => c.name === "pty.kill")).toBe(false)
})

it("a tab the task does not hold is TAB_NOT_FOUND and opens nothing", async () => {
  const daemon = tabsDaemon({ seed: { t: state(engineRow()) } })

  await expect(defaultApiRuntime.reviveTab(daemon.client, target(), "tab-9", home)).rejects.toMatchObject({
    code: "TAB_NOT_FOUND",
  })

  expect(opened()).toBeUndefined()
})

it("a split leaf is refused with the verb that reopens it", async () => {
  const run = invokeVerb("tab-revive", ["--task-id", "t", "--tab", "tab-1::leaf-2"], {
    client: new FakeClient(),
    runtime: stubRuntime(),
  })

  await expect(run).rejects.toBeInstanceOf(ApiError)
  await expect(run).rejects.toMatchObject({
    code: "BAD_FLAG",
    data: { nextCommandArgs: expect.arrayContaining(["tab-split", "reset", "leaf-2"]) },
  })
})
