/**
 * Framework-free KV core (src/tui-react/context/kv-core.ts) — the
 * KVProvider's persistence half. These tests pin its semantics:
 *
 *   - DIRTY-KEY MERGE on flush: only keys THIS core `set()` reach disk; a
 *     key another process wrote after hydration passes through untouched
 *     (the multi-process lost-update bug).
 *   - `seed()` (the signal-default path) is in-memory only — reading a
 *     default must never persist it.
 *   - `set(key, undefined)` serializes as a DELETION.
 *   - `clear()` is the one whole-file write: it wipes even foreign keys.
 *   - Writes are debounced (250ms) — no disk write before the window.
 */

import { mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createKvCore } from "../../src/tui-react/context/kv-core"
import {
  type TabsSnapshotKv,
  sweepOrphanTabsSnapshots,
  terminalTabsKey,
} from "../../src/tui-react/workspace/terminal-tabs-persist"

let savedHome: string | undefined

beforeEach(() => {
  savedHome = process.env.KOBE_HOME_DIR
})

afterEach(() => {
  // Reflect.deleteProperty (not `= undefined`): assigning undefined to a
  // process.env key stores the string "undefined" under node.
  if (savedHome === undefined) Reflect.deleteProperty(process.env, "KOBE_HOME_DIR")
  else process.env.KOBE_HOME_DIR = savedHome
  vi.useRealTimers()
})

function isolatedHome(initial?: Record<string, unknown>): string {
  const home = mkdtempSync(join(tmpdir(), "kobe-kv-core-"))
  process.env.KOBE_HOME_DIR = home
  if (initial) writeState(home, initial)
  return home
}

function statePath(home: string): string {
  return join(home, ".config", "rove", "state.json")
}

function writeState(home: string, state: Record<string, unknown>): void {
  mkdirSync(join(home, ".config", "rove"), { recursive: true })
  writeFileSync(statePath(home), JSON.stringify(state, null, 2), "utf8")
}

function readState(home: string): Record<string, unknown> {
  return JSON.parse(readFileSync(statePath(home), "utf8")) as Record<string, unknown>
}

describe("createKvCore", () => {
  it("hydrates synchronously from state.json and falls back to defaults", () => {
    isolatedHome({ activeTheme: "tokyonight" })
    const kv = createKvCore()
    expect(kv.get("activeTheme")).toBe("tokyonight")
    expect(kv.get("missing", "fallback")).toBe("fallback")
    expect(kv.snapshot()).toEqual({ activeTheme: "tokyonight" })
  })

  it("treats a missing state file as an empty store", () => {
    isolatedHome()
    const kv = createKvCore()
    expect(kv.snapshot()).toEqual({})
  })

  it("flushes ONLY dirty keys, preserving another process's concurrent write", () => {
    const home = isolatedHome({ shared: "old", mine: "old" })
    const kv = createKvCore()
    kv.set("mine", "new")
    // Another kobe process writes a DIFFERENT key after our hydration.
    writeState(home, { shared: "theirs", mine: "old" })
    expect(kv.flush()).toBe(true)
    expect(readState(home)).toEqual({ shared: "theirs", mine: "new" })
  })

  it("serializes set(key, undefined) as a deletion", () => {
    const home = isolatedHome({ doomed: 1, kept: 2 })
    const kv = createKvCore()
    kv.set("doomed", undefined)
    expect(kv.flush()).toBe(true)
    expect(readState(home)).toEqual({ kept: 2 })
  })

  it("set(key, undefined) removes the key from the in-memory snapshot", () => {
    // A spread `{ ...s, [key]: undefined }` would keep the deleted key
    // ENUMERABLE in the snapshot, so the orphan sweep
    // (`sweepOrphanTabsSnapshots`, which walks Object.keys and re-deletes)
    // re-sets it on every task-list change — each set a new snapshot identity,
    // each identity a re-run of the sweep effect: an infinite setState loop
    // (React #185) that crashes the workspace whenever a stale
    // `terminalTabs.*` key exists. Deletion must actually shrink Object.keys.
    isolatedHome({ "terminalTabs.dead": { tabs: [] }, kept: 1 })
    const kv = createKvCore()
    kv.set("terminalTabs.dead", undefined)
    expect(Object.keys(kv.snapshot())).toEqual(["kept"])
    // Idempotent: deleting an absent key must not mint a new snapshot
    // identity (that identity churn is what re-armed the sweep effect).
    const before = kv.snapshot()
    kv.set("terminalTabs.dead", undefined)
    expect(kv.snapshot()).toBe(before)
  })

  it("an orphan sweep triggered by kv snapshot changes converges instead of recursively rearming itself", () => {
    isolatedHome({ [terminalTabsKey("orphan")]: { tabs: [] } })
    const kv = createKvCore()
    const sweepKv: TabsSnapshotKv = {
      get store() {
        return kv.snapshot()
      },
      set: kv.set,
    }
    let sweeps = 0
    const runSweep = () => {
      sweeps++
      if (sweeps > 5) throw new Error("orphan sweep recursively rearmed")
      sweepOrphanTabsSnapshots(sweepKv, ["live"])
    }
    const unsubscribe = kv.subscribe(runSweep)

    // Models useWorkspaceSelection's effect: the first sweep changes the KV
    // identity and triggers one follow-up sweep. The follow-up sees no orphan,
    // performs no write, and the subscription chain settles.
    runSweep()

    expect(sweeps).toBe(2)
    expect(Object.keys(kv.snapshot())).toEqual([])
    unsubscribe()
    expect(kv.flush()).toBe(true)
  })

  it("seed() is visible in memory but never persisted", () => {
    const home = isolatedHome({ existing: "x" })
    const kv = createKvCore()
    kv.seed("someDefault", true)
    kv.seed("existing", "would-clobber") // no-op: key already set
    expect(kv.get("someDefault")).toBe(true)
    expect(kv.get("existing")).toBe("x")
    expect(kv.flush()).toBe(true) // nothing dirty → no write needed
    expect(readState(home)).toEqual({ existing: "x" })
  })

  it("debounces writes (nothing on disk before the 250ms window)", () => {
    vi.useFakeTimers()
    const home = isolatedHome({})
    const kv = createKvCore()
    kv.set("k", "v")
    expect(readState(home)).toEqual({})
    vi.advanceTimersByTime(300)
    expect(readState(home)).toEqual({ k: "v" })
  })

  // The debounce is a real data-loss window — a state change made inside it
  // is gone if the process exits before the timer fires. The
  // KVProvider's "exit" hook calls flush() for exactly this; these pin that
  // flush actually beats the pending timer rather than racing it.
  it("flush() persists a write still inside the debounce window", () => {
    vi.useFakeTimers()
    const home = isolatedHome({})
    const kv = createKvCore()
    kv.set("completionSeen", { "task-a\u0000tab-1": 500 })
    expect(readState(home)).toEqual({}) // nothing yet — still debounced
    expect(kv.flush()).toBe(true)
    expect(readState(home)).toEqual({ completionSeen: { "task-a\u0000tab-1": 500 } })
  })

  it("flush() cancels the pending timer instead of leaving a second write armed", () => {
    vi.useFakeTimers()
    const home = isolatedHome({})
    const kv = createKvCore()
    kv.set("mine", "flushed")
    expect(kv.flush()).toBe(true)
    // Another process writes AFTER our flush. A surviving debounce timer
    // would fire here and merge our (already-written, no-longer-dirty) key
    // back over it.
    writeState(home, { mine: "flushed", theirs: "later" })
    vi.advanceTimersByTime(300)
    expect(readState(home)).toEqual({ mine: "flushed", theirs: "later" })
  })

  it("clear() wipes the whole file, including keys other processes wrote", () => {
    const home = isolatedHome({ mine: 1 })
    const kv = createKvCore()
    kv.set("mine", 2)
    writeState(home, { mine: 1, theirs: 3 })
    expect(kv.clear()).toBe(true)
    expect(kv.snapshot()).toEqual({})
    expect(readState(home)).toEqual({})
    // Pending dirty keys must not survive the wipe via a later flush.
    expect(kv.flush()).toBe(true)
    expect(readState(home)).toEqual({})
  })

  it("a failed clear keeps the snapshot and dirty patch without scheduling a later wipe", () => {
    vi.useFakeTimers()
    const home = isolatedHome({ mine: 1, kept: true })
    const kv = createKvCore()
    kv.set("mine", 2)
    const before = kv.snapshot()
    const changed = vi.fn()
    const unsubscribe = kv.subscribe(changed)
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    const path = statePath(home)
    renameSync(path, `${path}.saved`)
    mkdirSync(path)
    try {
      const cleared = kv.clear()
      expect(kv.snapshot()).toBe(before)
      expect(changed).not.toHaveBeenCalled()
      expect(cleared).toBe(false)
      expect(log).toHaveBeenCalledWith("[rove] kv clear write failed:", expect.any(Error))
    } finally {
      renameSync(path, `${path}.obstacle`)
      renameSync(`${path}.saved`, path)
      unsubscribe()
      log.mockRestore()
    }
    writeState(home, { mine: 1, kept: true, theirs: 3 })
    expect(kv.flush()).toBe(true)
    expect(readState(home)).toEqual({ mine: 2, kept: true, theirs: 3 })
    vi.advanceTimersByTime(300)
    expect(readState(home)).toEqual({ mine: 2, kept: true, theirs: 3 })
    expect(kv.clear()).toBe(true)
    expect(kv.snapshot()).toEqual({})
    expect(readState(home)).toEqual({})
  })

  it("writes state.json compact — no pretty-print indentation", () => {
    const home = isolatedHome({})
    const kv = createKvCore()
    kv.set("nested", { a: 1, b: [1, 2] })
    expect(kv.flush()).toBe(true)
    // The file is rewritten whole on EVERY flush and read only by machines,
    // so it is serialized compactly (`null, 2` would triple its bytes).
    // Round-tripping through parse must reproduce the exact bytes.
    const raw = readFileSync(statePath(home), "utf8")
    expect(raw).toBe(JSON.stringify(JSON.parse(raw)))
  })

  it("notifies subscribers on set and supports unsubscribe", () => {
    isolatedHome()
    const kv = createKvCore()
    const seen: unknown[] = []
    const unsubscribe = kv.subscribe(() => seen.push(kv.get("k")))
    kv.set("k", 1)
    kv.set("k", 2)
    unsubscribe()
    kv.set("k", 3)
    expect(seen).toEqual([1, 2])
  })
})
