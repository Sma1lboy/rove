import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import type { RoveDaemonClient } from "@sma1lboy/rove-daemon/client"
import type { SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import type { RowStatus, TabStatus, TaskStatus } from "@sma1lboy/rove-daemon/daemon/row-status"
import { argvToParams } from "@sma1lboy/rove/src/cli/api/invoke.ts"
import { kvStatePath } from "@sma1lboy/rove/src/env.ts"
import { loadOrCreateToken } from "../src/auth.ts"
import type { BridgeApi } from "../src/ops/types.ts"
import {
  type EngineRow,
  createRoveOps,
  engineFor,
  newTabInvocation,
  remoteRowStatus,
  taskRows,
} from "../src/rove-ops.ts"

const ENGINES: EngineRow[] = [
  { id: "alpha", name: "Alpha", command: "alpha", protocol: "alpha", builtin: true, enabled: true },
  { id: "alpha-fast", name: "Alpha Fast", command: "alpha --fast", protocol: "alpha", builtin: false, enabled: true },
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

function tab(over: Partial<TabStatus> & Pick<TabStatus, "kind" | "since">): TabStatus {
  return { alive: true, restored: false, tracked: true, ...over }
}

/** A task whose one tab is the rollup. */
function daemonStatus(rollup: RowStatus): TaskStatus {
  return { task: rollup, tabs: { "tab-1": tab(rollup) } }
}

describe("task rows", () => {
  const now = 10_000_000

  test("groups like `rove api context` and sorts what needs a person first, main tasks included", () => {
    const rows = taskRows(
      [task({ id: "busy" }), task({ id: "blocked" }), task({ id: "main", kind: "main" }), task({ id: "dark" })],
      {
        tasks: {
          busy: daemonStatus({ kind: "running", state: "running", since: now - 1000 }),
          blocked: daemonStatus({ kind: "needs-input", state: "permission_needed", since: now - 1000 }),
          main: daemonStatus({ kind: "idle", state: "idle", since: now - 1000 }),
        },
        liveness: true,
      },
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

  test("each row carries the daemon's rollup and its tabs' statuses as row.status sent them", () => {
    const tabs = {
      "tab-1": tab({ kind: "attention", reason: "rate_limited", state: "rate_limited", since: now - 5 }),
      "tab-2": tab({ kind: "running", state: "running", since: now - 9 }),
    }
    const rollup = { kind: "attention", reason: "rate_limited", state: "rate_limited", since: now - 5 } as const
    const [row, dark] = taskRows(
      [task({ id: "a" }), task({ id: "b" })],
      { tasks: { a: { task: rollup, tabs } }, liveness: true },
      ENGINES,
      now,
    )
    expect(row?.rowStatus).toEqual(rollup)
    expect(row?.tabStatus).toEqual(tabs)
    // The engine state clients still read is the rollup's, not a separate reading.
    expect(row?.activity).toEqual({ state: "rate_limited", forMs: 5, since: now - 5 })
    expect(dark).not.toHaveProperty("rowStatus")
    expect(dark).not.toHaveProperty("tabStatus")
  })

  test("a task whose tabs the daemon reports dead waits on you once the death settles", () => {
    const at = now - 120_000
    const [row] = taskRows(
      [task({ id: "a" })],
      {
        tasks: {
          a: {
            task: { kind: "idle", state: "turn_complete", since: at },
            tabs: { "tab-1": tab({ kind: "idle", state: "turn_complete", since: at, alive: false }) },
          },
        },
        liveness: true,
      },
      ENGINES,
      now,
    )
    expect(row?.group).toBe("waiting-on-you")
    // Another machine's statuses say nothing about liveness, so the same reading is only finished work.
    const [far] = taskRows(
      [task({ id: "a" })],
      remoteRowStatus(new Map([["a", { state: "turn_complete", at }]])),
      ENGINES,
      now,
    )
    expect(far?.group).toBe("ready-for-review")
    expect(far?.rowStatus).toMatchObject({ kind: "idle", state: "turn_complete" })
  })

  test("a task being deleted is flagged so the phone can grey it out", () => {
    const [row] = taskRows(
      [task({ id: "gone", deletion: { phase: "running" } as SerializedTask["deletion"] })],
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

  test("a task on an engine switched off still shows that engine's name", () => {
    const off = ENGINES.map((e) => (e.id === "alpha-fast" ? { ...e, enabled: false } : e))
    expect(engineFor(task({ id: "d", vendor: "alpha", command: "alpha --fast" } as never), off)).toEqual({
      id: "alpha-fast",
      name: "Alpha Fast",
    })
  })
})

describe("engines.list enabled flag", () => {
  test("follows Settings → Engines at once, though the engine scan itself is cached", async () => {
    const prev = process.env.ROVE_HOME_DIR
    process.env.ROVE_HOME_DIR = mkdtempSync(join(tmpdir(), "bridge-engines-"))
    const switchOff = (ids: string[]) => {
      mkdirSync(dirname(kvStatePath()), { recursive: true })
      writeFileSync(kvStatePath(), JSON.stringify({ disabledEngineIds: ids }))
    }
    let scans = 0
    const api: BridgeApi = {
      verb: async <T>() => {
        scans++
        return { engines: [{ id: "alpha", name: "Alpha", command: "alpha", protocol: "alpha", builtin: false }] } as T
      },
      rpc: () => Promise.reject(new Error("unused")),
    }
    try {
      const ops = createRoveOps({} as RoveDaemonClient, undefined, api)
      expect((await ops.engines()).map((e) => e.enabled)).toEqual([true])
      switchOff(["alpha"])
      expect((await ops.engines()).map((e) => e.enabled)).toEqual([false])
      switchOff([])
      expect((await ops.engines()).map((e) => e.enabled)).toEqual([true])
      expect(scans).toBe(1)
    } finally {
      if (prev === undefined) Reflect.deleteProperty(process.env, "ROVE_HOME_DIR")
      else process.env.ROVE_HOME_DIR = prev
    }
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
    const none = taskRows([task({ id: "ok", worktreePath: "/w/ok" })], null, ENGINES, now, {
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
    const rows = taskRows([task({ id: "a" }), task({ id: "b" })], null, ENGINES, now, { changes: null, tokens })
    expect(rows.find((r) => r.id === "a")?.rowTokens).toEqual([
      { text: "live", tone: "info", source: "plug", expiresAt: now + 5000 },
      { text: "plain", source: "cli", expiresAt: now + 1 },
    ])
    expect(rows.find((r) => r.id === "b")).not.toHaveProperty("rowTokens")
  })

  test("pr chip follows the sidebar rules: conflict beats failing beats passing; stale on lastError", () => {
    const chipOf = (prStatus: unknown) => {
      const [row] = taskRows([task({ id: "x", prStatus } as never)], null, ENGINES, now)
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
      ENGINES,
      now,
    )
    expect(row?.pr).toEqual({ number: 4, lifecycle: "open", checkState: "pending", mergeable: "MERGEABLE" })
    const [bare] = taskRows([task({ id: "y", prStatus: pr({}) } as never)], null, ENGINES, now)
    expect(bare?.pr).not.toHaveProperty("mergeable")
  })

  test("session PRs ride the row: polled ones like pr, unpolled ones unknown with the number from the URL", () => {
    const url = (n: number) => `https://github.com/o/r/pull/${n}`
    const sessionPrs = [
      { url: url(7), addedAt: "2026-10-27T00:00:00.000Z" },
      { url: url(8), addedAt: "2026-10-27T00:00:00.000Z", status: pr({ number: 8, checkState: "failing" }) },
    ]
    const [row] = taskRows([task({ id: "m", sessionPrs } as never)], null, ENGINES, now)
    expect(row?.sessionPrs).toEqual([
      { number: 7, url: url(7), lifecycle: "unknown", checkState: "unknown" },
      { number: 8, url: url(8), lifecycle: "open", checkState: "failing" },
    ])
    const [none] = taskRows([task({ id: "n" })], null, ENGINES, now)
    expect(none).not.toHaveProperty("sessionPrs")
  })

  test("a row another machine served names it; this Mac's rows carry no machine at all", () => {
    const origin = (stale?: true) => ({ machineId: "narwhal", hostLabel: "narwhal", ...(stale ? { stale } : {}) })
    const rows = taskRows(
      [
        task({ id: "mine" }),
        task({ id: "stamped-local", origin: { machineId: "local", hostLabel: "local" } }),
        task({ id: "far", origin: origin() }),
        task({ id: "far-offline", origin: origin(true) }),
      ],
      null,
      ENGINES,
      now,
    )
    const machineOf = (id: string) => rows.find((r) => r.id === id)?.machine
    expect(machineOf("mine")).toBeUndefined()
    expect(machineOf("stamped-local")).toBeUndefined()
    expect(machineOf("far")).toEqual({ id: "narwhal", label: "narwhal" })
    expect(machineOf("far-offline")).toEqual({ id: "narwhal", label: "narwhal", stale: true })
  })

  test("the serving daemon's repo id reaches local and remote rows alike; none stays absent", () => {
    const remote = { machineId: "narwhal", hostLabel: "narwhal" }
    const rows = taskRows(
      [
        task({ id: "mine", repoId: "github.com/me/rove" }),
        task({ id: "far", repoId: "github.com/me/rove", origin: remote }),
        task({ id: "bare" }),
      ],
      null,
      ENGINES,
      now,
    )
    const row = (id: string) => rows.find((r) => r.id === id)
    expect([row("mine")?.repoId, row("far")?.repoId, row("far")?.machine?.id]).toEqual([
      "github.com/me/rove",
      "github.com/me/rove",
      "narwhal",
    ])
    expect("repoId" in (row("bare") ?? {})).toBe(false)
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

describe("tab.new verb choice", () => {
  test("a prompt rides `send`; no prompt opens the tab empty through `tab-new`", () => {
    expect(newTabInvocation("T1", { kind: "engine", prompt: "hi", engine: "codex" }).verb).toBe("send")
    const empty = newTabInvocation("T1", { kind: "shell" })
    expect(empty.verb).toBe("tab-new")
    expect(argvToParams(empty.verb, empty.argv)).toEqual({ "task-id": "T1", kind: "shell" })
  })

  test("`latest` asks for the project's last engine; a named engine wins", () => {
    expect(newTabInvocation("T1", { kind: "engine", latest: true }).argv).toContain("--latest")
    expect(newTabInvocation("T1", { kind: "engine", engine: "codex", latest: true }).argv).not.toContain("--latest")
  })

  test("an engine tab is a child task: the reply names it so a client can open it", async () => {
    const verbs: Array<{ name: string; reply: unknown }> = [
      { name: "send", reply: { taskId: "T1", childTaskId: "KID", session: "KID::tab-1" } },
      { name: "tab-new", reply: { taskId: "T1", childTaskId: "KID", tabId: "tab-1", session: "KID::tab-1" } },
    ]
    for (const { name, reply } of verbs) {
      const api: BridgeApi = {
        verb: async <T>() => reply as T,
        rpc: () => Promise.reject(new Error("unused")),
      }
      const ops = createRoveOps({} as RoveDaemonClient, undefined, api)
      const request = name === "send" ? { kind: "engine" as const, prompt: "go" } : { kind: "engine" as const }
      expect(await ops.newTab("T1", request)).toEqual({ tabId: "tab-1", taskId: "KID" })
    }
  })
})

describe("phone text that starts with --", () => {
  test("reaches the verb as the value, not a flag", async () => {
    const calls: { name: string; argv: readonly string[] }[] = []
    const api: BridgeApi = {
      async verb<T>(name: string, argv: readonly string[]) {
        calls.push({ name, argv })
        return { taskId: "T2", tabId: "tab-2" } as T
      },
      rpc: () => Promise.reject(new Error("unused")),
    }
    const ops = createRoveOps({} as RoveDaemonClient, undefined, api)
    await ops.newTab("T1", { kind: "engine", prompt: "--force-push is broken" })
    await ops.createTask({ repo: "/r", title: "--help", prompt: "--yes, do it" })
    expect(argvToParams(calls[0].name, calls[0].argv)).toMatchObject({ prompt: "--force-push is broken", tab: "new" })
    expect(argvToParams(calls[1].name, calls[1].argv)).toMatchObject({ title: "--help", prompt: "--yes, do it" })
  })
})

describe("task.delete children", () => {
  test("`cascade` rides the delete verb; without it the daemon promotes the children", async () => {
    const calls: { name: string; argv: readonly string[] }[] = []
    const api: BridgeApi = {
      async verb<T>(name: string, argv: readonly string[]) {
        calls.push({ name, argv })
        return { queued: true } as T
      },
      rpc: () => Promise.reject(new Error("unused")),
    }
    const ops = createRoveOps({} as RoveDaemonClient, undefined, api)
    await ops.deleteTask("T1", true, true)
    await ops.deleteTask("T1", false)
    expect(argvToParams(calls[0].name, calls[0].argv)).toMatchObject({
      "task-id": "T1",
      force: "true",
      cascade: "true",
    })
    expect(argvToParams(calls[1].name, calls[1].argv)).not.toHaveProperty("cascade")
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
