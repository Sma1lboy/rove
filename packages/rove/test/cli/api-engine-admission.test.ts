import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, it, vi } from "vitest"

const fixture = vi.hoisted(() => ({ sessions: [] as unknown[], opens: 0 }))
vi.mock("../../src/engine/hosted-session.ts", async (original) => ({
  ...(await original<object>()),
  ensureHostedSessionHost: async () => ({
    rpc: {
      request: async (name: string) => {
        if (name === "pty.list") return { sessions: fixture.sessions, admissionToken: "test" }
        if (name.startsWith("pty.open")) fixture.opens++
        throw new Error(`unexpected ${name}`)
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

import { deliverPrompt } from "../../src/cli/api/runtime.ts"
import type { DaemonRpc } from "../../src/cli/daemon-session.ts"

afterEach(() => vi.unstubAllEnvs())

it.each(["new", "tab-2"])("enforces the persisted cap through the runtime for --tab %s", async (tab) => {
  const home = mkdtempSync(join(tmpdir(), "rove-api-admission-"))
  vi.stubEnv("ROVE_HOME_DIR", home)
  fixture.opens = 0
  mkdirSync(join(home, ".config/rove"), { recursive: true })
  const statePath = join(home, ".config/rove/state.json")
  const tabs = {
    tabs: [{ id: "tab-1", kind: "engine", title: "engine", ordinal: 1 }],
    activeId: "tab-1",
    nextOrdinal: 2,
  }
  writeFileSync(statePath, JSON.stringify({ "engine.maxLiveSessions": 1, "terminalTabs.t": tabs }))
  fixture.sessions = [
    { key: "other::tab-1", pid: 123, alive: true, command: ["claude"], title: "" },
    { key: "t::tab-2", pid: null, alive: false, restored: true, command: ["codex"], title: "" },
  ]
  const daemon: DaemonRpc = {
    subscribe: async () => ({}),
    onChannel: () => () => {},
    request: async () => {
      throw new Error("unexpected daemon request")
    },
  }
  await expect(
    deliverPrompt(
      daemon,
      {
        id: "t",
        kind: "task",
        worktreePath: home,
        repo: home,
        vendor: "claude",
        tab,
        ...(tab === "new" ? { tabCommand: "codex --model chosen", tabVendor: "codex" } : { respawn: true }),
      },
      "isolated prompt",
    ),
  ).rejects.toMatchObject({
    code: "ENGINE_LIMIT",
    data: {
      nextCommandArgs: [
        "api",
        "send",
        "--task-id",
        "t",
        "--tab",
        tab,
        ...(tab === "new" ? ["--command", "codex --model chosen"] : ["--respawn"]),
        "--plain",
        "--prompt",
        "isolated prompt",
      ],
    },
  })
  expect(fixture.opens).toBe(0)
  expect(JSON.parse(readFileSync(statePath, "utf8"))["terminalTabs.t"].tabs).toEqual(tabs.tabs)
})
