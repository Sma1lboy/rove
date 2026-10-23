/**
 * The CLI publishes a tab snapshot for sessions it starts.
 *
 * The sidebar tree lists a worktree's tabs from `terminalTabs.<taskId>`,
 * which only a mounted `TerminalTabs` ever wrote — so a headless start
 * (`rove api add --prompt`, `rove api send`, a routine firing) ran a live
 * engine that the tree could not see, and rendered the worktree with no tabs
 * at all. Since headless start is how agent-driven work enters rove, that was
 * most of the fleet.
 *
 * The write-once rule is the load-bearing half: a mounted TUI owns tab state
 * for real (ordinals, titles, splits), and `rove api send` into a task you
 * have open reuses that session — so clobbering its snapshot with a one-tab
 * stub would actively destroy state.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  allocateTab,
  closeTabsSnapshot,
  markCliTabSession,
  publishCliTabSnapshot,
  readTabsSnapshot,
  renameTabsSnapshot,
} from "../../src/cli/api/tab-snapshot.ts"
import { mintEngineTab, tabsDaemon } from "./tabs-daemon-fake.ts"

let home: string
let originalHome: string | undefined

const statePath = (): string => join(home, ".config", "rove", "state.json")

function writeState(state: Record<string, unknown>): void {
  mkdirSync(join(home, ".config", "rove"), { recursive: true })
  writeFileSync(statePath(), JSON.stringify(state), "utf8")
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "rove-cli-tabsnap-"))
  originalHome = process.env.ROVE_HOME_DIR
  process.env.ROVE_HOME_DIR = home
})

afterEach(() => {
  if (originalHome === undefined) {
    // biome-ignore lint/performance/noDelete: the var must be truly unset when it started unset.
    delete process.env.ROVE_HOME_DIR
  } else process.env.ROVE_HOME_DIR = originalHome
  rmSync(home, { recursive: true, force: true })
})

/** The writers go through the daemon only: state.json stays exactly as the test left it. */
function expectStateUntouched(before: Record<string, unknown>): void {
  expect(JSON.parse(readFileSync(statePath(), "utf8"))).toEqual(before)
}

describe("publishCliTabSnapshot", () => {
  it("seeds the canonical first engine tab so the tree can render a row", async () => {
    writeState({})
    const daemon = tabsDaemon()
    await publishCliTabSnapshot(daemon.client, "t1")
    const snapshot = daemon.tabs("t1")
    // `tab-1` matches the pty key the CLI launch path uses (`engineSessionKey`
    // → `<taskId>::tab-1`), so the row and the live process agree.
    expect(snapshot?.tabs).toHaveLength(1)
    expect(snapshot?.tabs[0]).toMatchObject({ id: "tab-1", kind: "engine" })
    expect(snapshot?.activeId).toBe("tab-1")
    expect(daemon.applied.map((a) => a.ops.map((op) => op.op))).toEqual([["seed"]])
    expectStateUntouched({})
  })

  it("never overwrites an existing record — a mounted TUI owns tab state", async () => {
    const mine = {
      tabs: [{ kind: "engine", id: "tab-7", title: "mine", ordinal: 7 }],
      activeId: "tab-7",
      nextOrdinal: 8,
    }
    const daemon = tabsDaemon({ seed: { t1: mine } })
    await publishCliTabSnapshot(daemon.client, "t1")
    expect(daemon.tabs("t1")).toEqual(mine)
  })

  it("records the pinned session id + spawned when the delivery started the session", async () => {
    const daemon = tabsDaemon()
    await publishCliTabSnapshot(daemon.client, "t1", "uuid-abc")
    // The dead-reattach rule (engineTabArgv) reads exactly these two fields
    // to `--resume` the conversation after a pty-host restart.
    expect(daemon.tabs("t1")?.tabs[0]).toMatchObject({ id: "tab-1", sessionId: "uuid-abc", spawned: true })
  })

  it("never throws when the daemon refuses", async () => {
    const refusing = {
      request: async () => {
        throw new Error("task not found: t1")
      },
    }
    await expect(publishCliTabSnapshot(refusing, "t1")).resolves.toBeUndefined()
  })
})

describe("markCliTabSession", () => {
  it("patches an existing minted tab with its session id once the session started", async () => {
    const daemon = tabsDaemon()
    const id = await mintEngineTab(daemon.client, "t1")
    await markCliTabSession(daemon.client, "t1", id, "uuid-xyz")
    const tabs = daemon.tabs("t1")?.tabs ?? []
    expect(tabs.find((t) => t.id === id)).toMatchObject({ sessionId: "uuid-xyz", spawned: true })
    // The canonical tab keeps having no id — its session was never CLI-pinned.
    expect(tabs.find((t) => t.id === "tab-1")).not.toHaveProperty("sessionId")
    expect(daemon.applied.at(-1)?.ops).toEqual([{ op: "patch", id, set: { sessionId: "uuid-xyz", spawned: true } }])
  })

  it("leaves a non-engine tab alone", async () => {
    const daemon = tabsDaemon()
    const shell = await allocateTab(daemon.client, "t1", { kind: "command", title: null, command: ["/bin/sh"] })
    expect(await markCliTabSession(daemon.client, "t1", shell.id, "uuid")).toBeUndefined()
    expect(daemon.tabs("t1")?.tabs.find((t) => t.id === shell.id)).not.toHaveProperty("spawned")
  })
})

describe("allocateTab", () => {
  it("takes the daemon's counter, so CLI and TUI ids never collide", async () => {
    const daemon = tabsDaemon({
      seed: {
        t1: {
          tabs: [{ kind: "engine", id: "tab-1", title: null, ordinal: 1 }],
          activeId: "tab-1",
          nextOrdinal: 4, // TUI already minted tab-2/tab-3 and closed them
        },
      },
    })
    const id = await mintEngineTab(daemon.client, "t1", "codex", "codex --yolo")
    expect(id).toBe("tab-4")
    const snapshot = daemon.tabs("t1")
    expect(snapshot?.tabs.map((t) => t.id)).toEqual(["tab-1", "tab-4"])
    expect(snapshot?.tabs[1]).toMatchObject({ kind: "engine", vendor: "codex", engineCommand: "codex --yolo" })
    expect(snapshot?.nextOrdinal).toBe(5)
    // The daemon mints the id: the open carries none.
    const open = daemon.applied[0]?.ops.find((op) => op.op === "open")
    expect(open && "row" in open ? open.row.id : "absent").toBeUndefined()
  })

  it("seeds a task with no record and mints tab-2 alongside the canonical tab", async () => {
    const daemon = tabsDaemon()
    expect(await mintEngineTab(daemon.client, "t1")).toBe("tab-2")
    expect(daemon.tabs("t1")?.tabs.map((t) => t.id)).toEqual(["tab-1", "tab-2"])
  })

  it("never hands out a closed id again", async () => {
    const daemon = tabsDaemon()
    const first = await mintEngineTab(daemon.client, "t1")
    await closeTabsSnapshot(daemon.client, "t1", first)
    expect(await mintEngineTab(daemon.client, "t1")).not.toBe(first)
  })

  it("throws when the daemon refuses instead of inventing an id", async () => {
    const refusing = {
      request: async () => {
        throw new Error("task not found: t1")
      },
    }
    await expect(mintEngineTab(refusing, "t1")).rejects.toThrow("task not found")
  })
})

describe("readTabsSnapshot", () => {
  it("returns the persisted snapshot and undefined for absent/malformed keys", () => {
    const snap = { tabs: [{ kind: "engine", id: "tab-1", title: null, ordinal: 1 }], activeId: "tab-1", nextOrdinal: 2 }
    writeState({ "terminalTabs.t1": snap, "terminalTabs.bad": { tabs: "nope" } })
    expect(readTabsSnapshot("t1")).toEqual(snap)
    expect(readTabsSnapshot("bad")).toBeUndefined()
    expect(readTabsSnapshot("missing")).toBeUndefined()
  })
})

describe("closeTabsSnapshot", () => {
  it("uses ctrl+w semantics, including closing the last tab, and sends a close op", async () => {
    writeState({ unrelated: "keep" })
    const daemon = tabsDaemon({
      seed: {
        t1: {
          tabs: [{ kind: "command", id: "tab-4", title: "shell", ordinal: 4, command: ["/bin/zsh"] }],
          activeId: "tab-4",
          nextOrdinal: 5,
        },
      },
    })
    expect(await closeTabsSnapshot(daemon.client, "t1", "tab-4")).toMatchObject({ id: "tab-4", kind: "command" })
    expect(daemon.tabs("t1")?.tabs).toEqual([])
    // The emptied strip keeps the TUI's re-seed hint.
    expect(daemon.applied).toEqual([
      { taskId: "t1", ops: [{ op: "close", id: "tab-4", reopenAs: { kind: "command" } }] },
    ])
    expectStateUntouched({ unrelated: "keep" })
  })

  it("is undefined, and sends nothing, for a tab the daemon does not hold", async () => {
    const daemon = tabsDaemon({ seed: { t1: { tabs: [], nextOrdinal: 2 } } })
    expect(await closeTabsSnapshot(daemon.client, "t1", "tab-9")).toBeUndefined()
    expect(await closeTabsSnapshot(daemon.client, "nope", "tab-1")).toBeUndefined()
    expect(daemon.applied).toEqual([])
  })
})

describe("renameTabsSnapshot", () => {
  it("patches the title, is a no-op for the same name, and misses an unknown tab", async () => {
    const daemon = tabsDaemon({
      seed: { t1: { tabs: [{ kind: "engine", id: "tab-1", title: null, ordinal: 1 }], nextOrdinal: 2 } },
    })
    expect(await renameTabsSnapshot(daemon.client, "t1", "tab-1", "  review  ")).toBe(true)
    expect(daemon.tabs("t1")?.tabs[0]?.title).toBe("review")
    expect(await renameTabsSnapshot(daemon.client, "t1", "tab-1", "review")).toBe(true)
    expect(await renameTabsSnapshot(daemon.client, "t1", "tab-9", "x")).toBe(false)
    expect(daemon.applied).toEqual([{ taskId: "t1", ops: [{ op: "patch", id: "tab-1", set: { title: "review" } }] }])
  })
})
