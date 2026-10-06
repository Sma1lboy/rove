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

describe("task row extras", () => {
  const now = 10_000_000
  const pr = (over: Record<string, unknown>) => ({
    provider: "github",
    lifecycle: "open",
    checkState: "pending",
    ...over,
  })

  test("manual order, pin and timestamps come from the daemon list even without live signals", () => {
    const rows = taskRows(
      [
        task({ id: "a", pinned: false, createdAt: "c1", updatedAt: "u1" } as never),
        task({ id: "b", pinned: true, createdAt: "c2", updatedAt: "u2" } as never),
      ],
      null,
      null,
      ENGINES,
      now,
    )
    const b = rows.find((r) => r.id === "b")
    const a = rows.find((r) => r.id === "a")
    expect([a?.order, b?.order]).toEqual([0, 1])
    expect(b).toMatchObject({ pinned: true, createdAt: "c2", updatedAt: "u2" })
    // No live signals: nothing is invented.
    expect(a).not.toHaveProperty("changes")
    expect(a).not.toHaveProperty("rowTokens")
  })

  test("changes are keyed by worktree: counts, unreadable, and absent when not collected", () => {
    const extras = {
      changes: new Map([
        ["/w/ok", { added: 3, deleted: 1, ahead: 2, behind: 0 }],
        ["/w/bare", { added: 0, deleted: 0 }],
        ["/w/bad", null],
      ]),
      tokens: new Map(),
    }
    const rows = taskRows(
      [
        task({ id: "ok", worktreePath: "/w/ok" }),
        task({ id: "bare", worktreePath: "/w/bare" }),
        task({ id: "bad", worktreePath: "/w/bad" }),
        task({ id: "new", worktreePath: "/w/new" }),
      ],
      null,
      null,
      ENGINES,
      now,
      extras,
    )
    const by = (id: string) => rows.find((r) => r.id === id)
    expect(by("ok")?.changes).toEqual({ added: 3, deleted: 1, ahead: 2, behind: 0 })
    // A real clean worktree reads zero; an untracked one reads nothing.
    expect(by("bare")?.changes).toEqual({ added: 0, deleted: 0 })
    expect(by("bad")?.changes).toEqual({ unreadable: true })
    expect(by("new")).not.toHaveProperty("changes")
    // The daemon has not supplied the channel at all.
    const none = taskRows([task({ id: "ok", worktreePath: "/w/ok" })], null, null, ENGINES, now, {
      changes: null,
      tokens: new Map(),
    })
    expect(none[0]).not.toHaveProperty("changes")
  })

  test("row tokens drop expired ones and carry expiresAt for the phone", () => {
    const tokens = new Map([
      [
        "a",
        [
          { source: "plug", key: "k1", text: "live", tone: "info" as const, expiresAt: now + 5000 },
          { source: "plug", key: "k2", text: "gone", expiresAt: now - 1 },
          { source: "cli", key: "k3", text: "plain", expiresAt: now + 1 },
        ],
      ],
      ["b", [{ source: "plug", key: "k", text: "old", expiresAt: now - 10 }]],
    ])
    const rows = taskRows([task({ id: "a" }), task({ id: "b" })], null, null, ENGINES, now, { changes: null, tokens })
    expect(rows.find((r) => r.id === "a")?.rowTokens).toEqual([
      { text: "live", tone: "info", source: "plug", expiresAt: now + 5000 },
      { text: "plain", source: "cli", expiresAt: now + 1 },
    ])
    expect(rows.find((r) => r.id === "b")).not.toHaveProperty("rowTokens")
  })

  test("pr chip follows the sidebar rules: conflict beats failing beats passing; stale on lastError", () => {
    const chipOf = (prStatus: unknown) => {
      const [row] = taskRows([task({ id: "x", prStatus } as never)], null, null, ENGINES, now)
      return [row?.prChip, row?.prChipStale]
    }
    expect(chipOf(pr({ mergeable: "CONFLICTING", checkState: "passing" }))).toEqual(["conflict", false])
    expect(chipOf(pr({ checkState: "failing" }))).toEqual(["failing", false])
    expect(chipOf(pr({ checkState: "passing", lastError: "offline" }))).toEqual(["passing", true])
    expect(chipOf(pr({ checkState: "pending" }))).toEqual([null, false])
    expect(chipOf(undefined)).toEqual([null, false])
  })

  test("pr.mergeable is passed through when the forge reported it", () => {
    const [row] = taskRows(
      [task({ id: "x", prStatus: pr({ mergeable: "MERGEABLE", number: 4 }) } as never)],
      null,
      null,
      ENGINES,
      now,
    )
    expect(row?.pr).toEqual({ number: 4, lifecycle: "open", checkState: "pending", mergeable: "MERGEABLE" })
    const [bare] = taskRows([task({ id: "y", prStatus: pr({}) } as never)], null, null, ENGINES, now)
    expect(bare?.pr).not.toHaveProperty("mergeable")
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
