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
 *   - `terminalTabs.*` keys are refused: the daemon owns terminal tabs.
 *   - `clear()` is the one whole-file write: it wipes even foreign keys.
 *   - Writes are debounced (250ms) — no disk write before the window.
 */

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { type KvWriteFailure, createKvCore } from "../../src/tui-react/context/kv-core"

let savedHome: string | undefined

beforeEach(() => {
  savedHome = process.env.ROVE_HOME_DIR
})

afterEach(() => {
  // Reflect.deleteProperty (not `= undefined`): assigning undefined to a
  // process.env key stores the string "undefined" under node.
  if (savedHome === undefined) Reflect.deleteProperty(process.env, "ROVE_HOME_DIR")
  else process.env.ROVE_HOME_DIR = savedHome
  vi.useRealTimers()
})

function isolatedHome(initial?: Record<string, unknown>): string {
  const home = mkdtempSync(join(tmpdir(), "rove-kv-core-"))
  process.env.ROVE_HOME_DIR = home
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
    // Another rove process writes a DIFFERENT key after our hydration.
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
    // ENUMERABLE in the snapshot, so a sweep that walks Object.keys and
    // re-deletes re-sets it on every change — each set a new snapshot
    // identity, each identity a re-run of the sweep effect: an infinite
    // setState loop (React #185). Deletion must actually shrink Object.keys.
    isolatedHome({ "draft.dead": { text: "" }, kept: 1 })
    const kv = createKvCore()
    kv.set("draft.dead", undefined)
    expect(Object.keys(kv.snapshot())).toEqual(["kept"])
    // Idempotent: deleting an absent key must not mint a new snapshot
    // identity (that identity churn is what re-armed the sweep effect).
    const before = kv.snapshot()
    kv.set("draft.dead", undefined)
    expect(kv.snapshot()).toBe(before)
  })

  it("an orphan sweep triggered by kv snapshot changes converges instead of recursively rearming itself", () => {
    isolatedHome({ "draft.orphan": { text: "" }, "draft.live": { text: "x" } })
    const kv = createKvCore()
    let sweeps = 0
    const runSweep = () => {
      sweeps++
      if (sweeps > 5) throw new Error("orphan sweep recursively rearmed")
      for (const key of Object.keys(kv.snapshot())) {
        if (key.startsWith("draft.") && key !== "draft.live") kv.set(key, undefined)
      }
    }
    const unsubscribe = kv.subscribe(runSweep)

    // Models a subscribed effect: the first sweep changes the KV identity and
    // triggers one follow-up sweep. The follow-up sees no orphan, performs no
    // write, and the subscription chain settles.
    runSweep()

    expect(sweeps).toBe(2)
    expect(Object.keys(kv.snapshot())).toEqual(["draft.live"])
    unsubscribe()
    expect(kv.flush()).toBe(true)
  })

  it("refuses a terminalTabs.* write: not in memory, not dirty, never on disk", () => {
    const home = isolatedHome({ "terminalTabs.t": { tabs: [], nextOrdinal: 1 } })
    const kv = createKvCore()
    const before = kv.snapshot()
    const changed = vi.fn()
    const unsubscribe = kv.subscribe(changed)
    kv.set("terminalTabs.x", { tabs: [], nextOrdinal: 1 })
    kv.set("terminalTabs.t", undefined)
    expect(kv.snapshot()).toBe(before)
    expect(kv.get("terminalTabs.x")).toBeUndefined()
    expect(changed).not.toHaveBeenCalled()
    unsubscribe()
    // Nothing dirty: another process's later write survives our flush.
    writeState(home, { "terminalTabs.t": { tabs: [], nextOrdinal: 1 }, theirs: 1 })
    expect(kv.flush()).toBe(true)
    expect(readState(home)).toEqual({ "terminalTabs.t": { tabs: [], nextOrdinal: 1 }, theirs: 1 })
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

  it("reports a failed flush to onWriteError subscribers, once per key", () => {
    const home = isolatedHome({})
    // Break the write deterministically: a DIRECTORY where the lockfile goes
    // makes `acquireSync`'s link fail EEXIST, then reading the holder fails
    // EISDIR — which is not contention, so it propagates immediately.
    mkdirSync(`${statePath(home)}.lock`, { recursive: true })
    const kv = createKvCore()
    const failures: KvWriteFailure[] = []
    const off = kv.onWriteError((failure) => failures.push(failure))

    kv.set("activeTheme", "tokyonight")
    expect(kv.flush()).toBe(false)
    expect(failures).toHaveLength(1)
    expect(failures[0]?.keys).toEqual(["activeTheme"])
    expect(failures[0]?.file).toBe(statePath(home))

    // A read-only state dir fails EVERY 250ms flush and dirty keys survive a
    // failure, so the same key must not raise a toast per keystroke.
    kv.set("activeTheme", "gruvbox")
    expect(kv.flush()).toBe(false)
    expect(failures).toHaveLength(1)

    // A NEW key is still worth saying out loud.
    kv.set("sidebar.width", 40)
    expect(kv.flush()).toBe(false)
    expect(failures).toHaveLength(2)
    expect(failures[1]?.keys).toEqual(["sidebar.width"])

    off()
    kv.set("another", 1)
    expect(kv.flush()).toBe(false)
    expect(failures).toHaveLength(2)
  })

  it("re-reports a key after a write lands in between", () => {
    const home = isolatedHome({})
    const lock = `${statePath(home)}.lock`
    mkdirSync(lock, { recursive: true })
    const kv = createKvCore()
    const failures: KvWriteFailure[] = []
    kv.onWriteError((failure) => failures.push(failure))

    kv.set("activeTheme", "tokyonight")
    expect(kv.flush()).toBe(false)
    rmSync(lock, { recursive: true, force: true })
    expect(kv.flush()).toBe(true)

    mkdirSync(lock, { recursive: true })
    kv.set("activeTheme", "gruvbox")
    expect(kv.flush()).toBe(false)
    expect(failures).toHaveLength(2)
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

  // The inbox visit log is written on every task switch; a snapshot change there re-renders every useKV consumer.
  it("setQuiet() persists and reads back without notifying subscribers; a later set() wins", () => {
    const home = isolatedHome({ visits: ["old"] })
    const kv = createKvCore()
    let notified = 0
    kv.subscribe(() => notified++)
    kv.setQuiet("visits", ["new"])
    expect(notified).toBe(0)
    expect(kv.get("visits")).toEqual(["new"])
    expect(kv.flush()).toBe(true)
    expect(readState(home)).toEqual({ visits: ["new"] })

    kv.set("visits", ["set"])
    expect(notified).toBe(1)
    expect(kv.get("visits")).toEqual(["set"])
  })

  it("reload() applies a hand edit to state.json and notifies subscribers", () => {
    const home = isolatedHome({ activeTheme: "tokyonight", removed: 1 })
    const kv = createKvCore()
    let notified = 0
    kv.subscribe(() => notified++)
    writeState(home, { activeTheme: "nord", added: true })
    expect(kv.reload()).toEqual({ ok: true, changed: 3 })
    expect(kv.snapshot()).toEqual({ activeTheme: "nord", added: true })
    expect(notified).toBe(1)
    expect(kv.reload()).toEqual({ ok: true, changed: 0 })
    expect(notified).toBe(1)
  })

  it("reload() keeps a pending edit and restores a seeded default the file no longer carries", () => {
    const home = isolatedHome({ zen: true })
    const kv = createKvCore()
    kv.seed("zen", false)
    kv.seed("toast", "bottom")
    kv.set("sound", "on")
    writeState(home, { other: "x" })
    expect(kv.reload().ok).toBe(true)
    expect(kv.snapshot()).toEqual({ other: "x", sound: "on", zen: false, toast: "bottom" })
    expect(readState(home)).toEqual({ other: "x", sound: "on" })
  })

  it("follow() adopts another process's write from the daemon push, keeping unflushed edits, tab keys and per-window layout", () => {
    vi.useFakeTimers()
    isolatedHome({ disabledEngineIds: [], "terminalTabs.t1": { tabs: [] }, "sidebar.collapsed": false })
    const kv = createKvCore()
    kv.set("diffComments.t1", ["mine"])
    kv.follow({ disabledEngineIds: ["codex"], savedRepos: ["/b"], "sidebar.collapsed": true })
    expect(kv.snapshot()).toEqual({
      disabledEngineIds: ["codex"],
      savedRepos: ["/b"],
      "diffComments.t1": ["mine"],
      "terminalTabs.t1": { tabs: [] },
      // Another window's rail fold stays its own.
      "sidebar.collapsed": false,
    })
  })

  it("follow() suppresses identical quiet echoes but publishes changed remote values", () => {
    vi.useFakeTimers()
    isolatedHome({ "lastActive.taskId": "t1" })
    const kv = createKvCore()
    let notified = 0
    kv.subscribe(() => notified++)
    kv.setQuiet("inboxVisits", ["t1"])
    vi.advanceTimersByTime(400)
    kv.follow({ inboxVisits: ["t1"] })
    expect(notified).toBe(0)
    kv.follow({ inboxVisits: ["t2", "t1"] })
    expect(kv.get("inboxVisits")).toEqual(["t2", "t1"])
    expect(kv.get("lastActive.taskId")).toBe("t1")
    expect(notified).toBe(1)
  })

  it.each([undefined, ["original"]])(
    "notifies when a remote quiet value reverts to the old snapshot: %j",
    (original) => {
      isolatedHome(original === undefined ? {} : { inboxVisits: original })
      const kv = createKvCore()
      kv.setQuiet("inboxVisits", ["local"])
      kv.flush()
      let notified = 0
      kv.subscribe(() => notified++)
      kv.follow(original === undefined ? {} : { inboxVisits: original })
      expect(kv.get("inboxVisits")).toEqual(original)
      expect(notified).toBe(1)
      kv.follow(original === undefined ? {} : { inboxVisits: original })
      expect(notified).toBe(1)
    },
  )

  it("keeps pending writes off an invalid file until repair, across debounce and exit flushes", () => {
    vi.useFakeTimers()
    const home = isolatedHome({ activeTheme: "tokyonight", keep: 42 })
    const kv = createKvCore()
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      kv.set("sound", "on")
      const broken = '{"activeTheme":"nord",'
      writeFileSync(statePath(home), broken)
      expect(kv.reload().ok).toBe(false)
      vi.advanceTimersByTime(400)
      expect(readFileSync(statePath(home), "utf8")).toBe(broken)
      kv.setQuiet("visits", 3)
      kv.set("sound", "off")
      vi.advanceTimersByTime(400)
      expect(kv.flush()).toBe(false)
      expect(readFileSync(statePath(home), "utf8")).toBe(broken)
      expect(readdirSync(join(home, ".config", "rove"))).toEqual(["state.json"])
      expect(kv.get("sound")).toBe("off")
      expect(kv.get("visits")).toBe(3)

      writeState(home, { activeTheme: "nord", keep: 42, external: true })
      expect(kv.flush()).toBe(true)
      expect(readState(home)).toEqual({ activeTheme: "nord", keep: 42, external: true, sound: "off", visits: 3 })
      expect(kv.reload().ok).toBe(true)
      expect(kv.snapshot()).toEqual(readState(home))
    } finally {
      log.mockRestore()
    }
  })

  // Reload runs while the user is editing; a typo must not move their file aside.
  it("reload() on invalid JSON changes nothing and leaves the file in place", () => {
    const home = isolatedHome({ activeTheme: "tokyonight" })
    const kv = createKvCore()
    writeFileSync(statePath(home), '{"activeTheme": "nord",', "utf8")
    const result = kv.reload()
    expect(result.ok).toBe(false)
    expect(kv.snapshot()).toEqual({ activeTheme: "tokyonight" })
    expect(readFileSync(statePath(home), "utf8")).toBe('{"activeTheme": "nord",')
  })
})
