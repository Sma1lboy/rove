/**
 * The CLI publishes a tab snapshot for sessions it starts.
 *
 * The sidebar tree lists a worktree's tabs from `terminalTabs.<taskId>`,
 * which only a mounted `TerminalTabs` ever wrote — so a headless start
 * (`kobe api add --prompt`, `kobe api send`, a routine firing) ran a live
 * engine that the tree could not see, and rendered the worktree with no tabs
 * at all. Since headless start is how agent-driven work enters kobe, that was
 * most of the fleet.
 *
 * The write-once rule is the load-bearing half: a mounted TUI owns tab state
 * for real (ordinals, titles, splits), and `kobe api send` into a task you
 * have open reuses that session — so clobbering its snapshot with a one-tab
 * stub would actively destroy state.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  closeTabsSnapshot,
  joinTaskTabs,
  markCliTabSession,
  mintCliTab,
  publishCliTabSnapshot,
  readTabsSnapshot,
} from "../../src/cli/api/tab-snapshot.ts"
import { hasLiveEngineTab } from "../../src/cli/api/task-running.ts"
import type { TabsState } from "../../src/tui/workspace/terminal-tabs-core.ts"

let home: string
let originalHome: string | undefined

const statePath = (): string => join(home, ".config", "rove", "state.json")

function writeState(state: Record<string, unknown>): void {
  mkdirSync(join(home, ".config", "rove"), { recursive: true })
  writeFileSync(statePath(), JSON.stringify(state), "utf8")
}

function readState(): Record<string, unknown> {
  return JSON.parse(readFileSync(statePath(), "utf8"))
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "kobe-cli-tabsnap-"))
  originalHome = process.env.KOBE_HOME_DIR
  process.env.KOBE_HOME_DIR = home
})

afterEach(() => {
  if (originalHome === undefined) {
    // biome-ignore lint/performance/noDelete: the var must be truly unset when it started unset.
    delete process.env.KOBE_HOME_DIR
  } else process.env.KOBE_HOME_DIR = originalHome
  rmSync(home, { recursive: true, force: true })
})

describe("publishCliTabSnapshot", () => {
  it("seeds the canonical first engine tab so the tree can render a row", () => {
    writeState({})
    publishCliTabSnapshot("t1")
    const snapshot = readState()["terminalTabs.t1"] as { tabs: { id: string; kind: string }[]; activeId: string }
    // `tab-1` matches the pty key the CLI launch path uses (`engineSessionKey`
    // → `<taskId>::tab-1`), so the row and the live process agree.
    expect(snapshot.tabs).toHaveLength(1)
    expect(snapshot.tabs[0]).toMatchObject({ id: "tab-1", kind: "engine" })
    expect(snapshot.activeId).toBe("tab-1")
  })

  it("never overwrites an existing snapshot — a mounted TUI owns tab state", () => {
    const mine = {
      tabs: [{ kind: "engine", id: "tab-7", title: "mine", ordinal: 7 }],
      activeId: "tab-7",
      nextOrdinal: 8,
    }
    writeState({ "terminalTabs.t1": mine })
    publishCliTabSnapshot("t1")
    expect(readState()["terminalTabs.t1"]).toEqual(mine)
  })

  it("leaves other tasks' snapshots untouched", () => {
    writeState({ "terminalTabs.other": { tabs: [], activeId: "tab-1", nextOrdinal: 2 }, unrelated: "keep" })
    publishCliTabSnapshot("t1")
    const state = readState()
    expect(state["terminalTabs.other"]).toEqual({ tabs: [], activeId: "tab-1", nextOrdinal: 2 })
    expect(state.unrelated).toBe("keep")
    expect(state["terminalTabs.t1"]).toBeDefined()
  })

  it("ignores an empty task id instead of writing a junk key", () => {
    writeState({})
    publishCliTabSnapshot("")
    expect(Object.keys(readState())).toEqual([])
  })

  it("records the pinned session id + spawned when the delivery started the session", () => {
    writeState({})
    publishCliTabSnapshot("t1", "uuid-abc")
    const snapshot = readState()["terminalTabs.t1"] as {
      tabs: { id: string; sessionId?: string; spawned?: boolean }[]
    }
    // The dead-reattach rule (engineTabArgv) reads exactly these two fields
    // to `--resume` the conversation after a pty-host restart.
    expect(snapshot.tabs[0]).toMatchObject({ id: "tab-1", sessionId: "uuid-abc", spawned: true })
  })
})

describe("markCliTabSession", () => {
  it("patches an existing minted tab with its session id once the session started", () => {
    writeState({})
    const id = mintCliTab("t1")
    markCliTabSession("t1", id, "uuid-xyz")
    const snapshot = readState()["terminalTabs.t1"] as {
      tabs: { id: string; sessionId?: string; spawned?: boolean }[]
    }
    expect(snapshot.tabs.find((t) => t.id === id)).toMatchObject({ sessionId: "uuid-xyz", spawned: true })
    // The canonical tab keeps having no id — its session was never CLI-pinned.
    expect(snapshot.tabs.find((t) => t.id === "tab-1")?.sessionId).toBeUndefined()
  })

  it("is a no-op for an unknown tab or a missing snapshot", () => {
    writeState({})
    markCliTabSession("t1", "tab-9", "uuid-xyz")
    expect(readState()).toEqual({})
  })
})

describe("mintCliTab", () => {
  it("consumes the snapshot's nextOrdinal so CLI and TUI ids never collide", () => {
    writeState({
      "terminalTabs.t1": {
        tabs: [{ kind: "engine", id: "tab-1", title: null, ordinal: 1 }],
        activeId: "tab-1",
        nextOrdinal: 4, // TUI already minted tab-2/tab-3 and closed them
      },
    })
    const id = mintCliTab("t1")
    expect(id).toBe("tab-4")
    const snapshot = readState()["terminalTabs.t1"] as {
      tabs: { id: string }[]
      activeId: string
      nextOrdinal: number
    }
    expect(snapshot.tabs.map((t) => t.id)).toEqual(["tab-1", "tab-4"])
    expect(snapshot.activeId).toBe("tab-4")
    expect(snapshot.nextOrdinal).toBe(5)
  })

  it("seeds a task with no snapshot and mints tab-2 alongside the canonical tab", () => {
    writeState({})
    const id = mintCliTab("t1")
    expect(id).toBe("tab-2")
    const snapshot = readState()["terminalTabs.t1"] as { tabs: { id: string }[] }
    expect(snapshot.tabs.map((t) => t.id)).toEqual(["tab-1", "tab-2"])
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
  it("uses ctrl+w semantics, including closing the last tab", () => {
    writeState({
      "terminalTabs.t1": {
        tabs: [{ kind: "command", id: "tab-4", title: "shell", ordinal: 4, command: ["/bin/zsh"] }],
        activeId: "tab-4",
        nextOrdinal: 5,
      },
      unrelated: "keep",
    })
    expect(closeTabsSnapshot("t1", "tab-4")).toMatchObject({ id: "tab-4", kind: "command" })
    const state = readState()
    expect((state["terminalTabs.t1"] as TabsState).tabs).toEqual([])
    expect(state.unrelated).toBe("keep")
  })

  it("does not write when the tab is absent", () => {
    const snapshot = { tabs: [], activeId: "tab-1", nextOrdinal: 2 }
    writeState({ "terminalTabs.t1": snapshot })
    expect(closeTabsSnapshot("t1", "tab-9")).toBeUndefined()
    expect(readState()["terminalTabs.t1"]).toEqual(snapshot)
  })
})
