/**
 * `rove api tab-revive` against a faked PTY host: a persisted tab whose
 * session is gone comes back under its own key — an engine tab resuming its
 * pinned conversation, a shell tab rerunning its shell — and a live one is
 * never touched.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

vi.mock("../../src/engine/trust-worktree.ts", () => ({ trustEngineWorktree() {} }))

import { reviveTab } from "../../src/cli/api/tab-revive.ts"
import { ApiError } from "../../src/cli/api/types.ts"

let home: string
let sessions: Array<{ key: string; alive: boolean; restored?: boolean }>
let calls: Array<{ name: string; payload: Record<string, unknown> }>
const rpc = {
  request: async <T>(name: string, payload: Record<string, unknown> = {}): Promise<T> => {
    calls.push({ name, payload })
    if (name === "pty.list") return { sessions } as T
    if (name === "pty.open") return { replay: "", alive: true, created: true } as T
    return {} as T
  },
}
const task = { id: "t", kind: "task", repo: "/r", vendor: "claude" as const }
const named = (name: string) => calls.filter((c) => c.name === name)

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "rove-api-tab-revive-"))
  vi.stubEnv("ROVE_HOME_DIR", home)
  vi.stubEnv("SHELL", "/bin/sh")
  sessions = []
  calls = []
  mkdirSync(join(home, ".config/rove"), { recursive: true })
  writeFileSync(
    join(home, ".config/rove/state.json"),
    JSON.stringify({
      "terminalTabs.t": {
        tabs: [
          { kind: "engine", id: "tab-1", title: null, ordinal: 1, sessionId: "abc-123", spawned: true },
          { kind: "command", id: "tab-2", title: null, ordinal: 2, command: ["/bin/sh"] },
          { kind: "content", id: "tab-3", title: "f", ordinal: 3, relPath: "f.md" },
        ],
        activeId: "tab-1",
        nextOrdinal: 4,
      },
    }),
  )
})
afterEach(() => vi.unstubAllEnvs())

it("an engine tab with no session resumes its pinned conversation under its own key", async () => {
  const res = await reviveTab(rpc, task, "tab-1", home)
  expect(res).toEqual({ session: "t::tab-1", revived: true, alive: true })
  const open = named("pty.open")[0]?.payload
  expect(open?.key).toBe("t::tab-1")
  expect(JSON.stringify(open?.command)).toContain("--resume")
  expect(JSON.stringify(open?.command)).toContain("abc-123")
  expect(named("pty.kill")).toHaveLength(0)
  expect(named("pty.detach")).toHaveLength(1)
})

it("an ordinary corpse is killed before the respawn; a frozen one respawns in place", async () => {
  sessions = [{ key: "t::tab-1", alive: false }]
  await reviveTab(rpc, task, "tab-1", home)
  expect(named("pty.kill")[0]?.payload).toEqual({ key: "t::tab-1" })

  calls = []
  sessions = [{ key: "t::tab-1", alive: false, restored: true }]
  await reviveTab(rpc, task, "tab-1", home)
  expect(named("pty.kill")).toHaveLength(0)
  expect(named("pty.open")).toHaveLength(1)
})

it("a shell tab reruns its shell and gets its identity export", async () => {
  await reviveTab(rpc, task, "tab-2", home)
  expect(named("pty.open")[0]?.payload.command).toEqual(["/bin/sh"])
  expect(String(named("pty.write")[0]?.payload.data)).toContain("ROVE_TAB_ID=tab-2")
})

it("a live tab is left alone", async () => {
  sessions = [{ key: "t::tab-1", alive: true }]
  expect(await reviveTab(rpc, task, "tab-1", home)).toEqual({ session: "t::tab-1", revived: false, alive: true })
  expect(named("pty.open")).toHaveLength(0)
})

it("refuses a tab the task does not have, and one that runs no session", async () => {
  await expect(reviveTab(rpc, task, "tab-9", home)).rejects.toMatchObject({ code: "TAB_NOT_FOUND" })
  await expect(reviveTab(rpc, task, "tab-3", home)).rejects.toBeInstanceOf(ApiError)
  expect(named("pty.open")).toHaveLength(0)
})
