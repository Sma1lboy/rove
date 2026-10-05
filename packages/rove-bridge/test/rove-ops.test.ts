import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { RoveDaemonClient } from "@sma1lboy/rove-daemon/client"
import type { SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import { loadOrCreateToken } from "../src/auth.ts"
import { type EngineRow, createRoveOps, engineFor, taskRows } from "../src/rove-ops.ts"

const ENGINES: EngineRow[] = [
  { id: "alpha", name: "Alpha", command: "alpha", protocol: "alpha", builtin: true },
  { id: "alpha-fast", name: "Alpha Fast", command: "alpha --fast", protocol: "alpha", builtin: false },
]

function task(over: Partial<SerializedTask> & { id: string }): SerializedTask {
  // Fixture: only the fields the grouping and row join read.
  const base = {
    title: over.id,
    repo: "/r",
    branch: `b-${over.id}`,
    worktreePath: "/w",
    kind: "task",
    status: "in_progress",
  }
  return { ...base, ...over } as SerializedTask
}

describe("task rows", () => {
  const now = 10_000_000

  test("groups like `rove api context` and sorts what needs a person first, main tasks included", () => {
    const rows = taskRows(
      [task({ id: "busy" }), task({ id: "blocked" }), task({ id: "main", kind: "main" }), task({ id: "dark" })],
      {
        busy: { state: "running", at: now - 1000 },
        blocked: { state: "permission_needed", at: now - 1000 },
        main: { state: "idle", at: now - 1000 },
      },
      new Set(["busy", "blocked", "main"]),
      ENGINES,
      now,
    )
    expect(rows.map((r) => [r.id, r.group])).toEqual([
      ["blocked", "waiting-on-you"],
      ["busy", "working"],
      ["main", "idle"],
      // No activity reading is "could not look", never idle.
      ["dark", "unknown"],
    ])
  })

  test("a task being deleted is flagged so the phone can grey it out", () => {
    const [row] = taskRows(
      [task({ id: "gone", deletion: { phase: "running" } as SerializedTask["deletion"] })],
      null,
      null,
      ENGINES,
      now,
    )
    expect(row?.deleting).toBe(true)
  })
})

describe("engine identity", () => {
  test("an exact preset command wins over the protocol's builtin; unknown engines fall back to the vendor id", () => {
    expect(engineFor(task({ id: "a", vendor: "alpha", command: "alpha --fast" } as never), ENGINES)).toEqual({
      id: "alpha-fast",
      name: "Alpha Fast",
    })
    expect(engineFor(task({ id: "b", vendor: "alpha" } as never), ENGINES)).toEqual({ id: "alpha", name: "Alpha" })
    expect(engineFor(task({ id: "c", vendor: "zeta" } as never), ENGINES)).toEqual({ id: null, name: "zeta" })
  })
})

describe("diff file path", () => {
  test("paths that could escape the worktree are refused before git or the filesystem is touched", async () => {
    // Fixture: the guard must fire before any daemon request.
    const client = { request: () => Promise.reject(new Error("daemon touched")) } as unknown as RoveDaemonClient
    const ops = createRoveOps(client)
    for (const path of ["/etc/passwd", "../outside", "a/../../b"]) {
      await expect(ops.diffFile("T1", path, "working")).rejects.toMatchObject({ code: "BAD_ARGS" })
    }
  })
})

describe("pairing token", () => {
  test("persists owner-only across restarts and rotation replaces it", () => {
    const path = join(mkdtempSync(join(tmpdir(), "rove-bridge-")), "bridge", "token")
    const first = loadOrCreateToken(path)
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(loadOrCreateToken(path)).toBe(first)
    const rotated = loadOrCreateToken(path, true)
    expect(rotated).not.toBe(first)
    expect(readFileSync(path, "utf8").trim()).toBe(rotated)
  })
})
