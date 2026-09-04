/**
 * The pure half of `tab-snapshot.ts`: joining a persisted tab snapshot against
 * hosted-session liveness (`joinTaskTabs`) and the `.running` rule built on it
 * (`hasLiveEngineTab`). Both are total functions over their arguments.
 *
 * Split from `api-tab-snapshot.test.ts`, which covers the WRITERS — those need
 * a temp HOME and a real `state.json` on disk, and this half touches no
 * filesystem at all. Keeping them together meant every read-side case paid for
 * a home fixture it never used.
 */

import { describe, expect, it } from "vitest"
import { hasLiveEngineTab, joinTaskTabs } from "../../src/cli/api/tab-snapshot.ts"
import type { TabsState } from "../../src/tui/workspace/terminal-tabs-core.ts"

describe("hasLiveEngineTab (the get-task/collect .running rule)", () => {
  const snapshot = (tabs: unknown[]): TabsState =>
    ({ tabs, activeId: "tab-1", nextOrdinal: tabs.length + 1 }) as unknown as TabsState

  it("counts a live LATER engine tab when tab-1 is dead — the issue-#5 bug", () => {
    const snap = snapshot([
      { kind: "engine", id: "tab-1", title: null, ordinal: 1 },
      { kind: "engine", id: "tab-2", title: null, ordinal: 2 },
    ])
    const sessions = [
      { key: "t1::tab-1", alive: false },
      { key: "t1::tab-2", alive: true },
    ]
    expect(hasLiveEngineTab(snap, "t1", sessions)).toBe(true)
  })

  it("a live canonical tab-1 counts even with no snapshot (headless start, snapshot write failed)", () => {
    expect(hasLiveEngineTab(undefined, "t1", [{ key: "t1::tab-1", alive: true }])).toBe(true)
  })

  it("non-engine tabs and other tasks' sessions never count", () => {
    const snap = snapshot([
      { kind: "engine", id: "tab-1", title: null, ordinal: 1 },
      { kind: "command", id: "tab-2", title: "editor", ordinal: 2, command: ["nvim"] },
    ])
    const sessions = [
      { key: "t1::tab-1", alive: false },
      { key: "t1::tab-2", alive: true }, // command tab — a paste target this must never bless
      { key: "t2::tab-1", alive: true }, // someone else's task
    ]
    expect(hasLiveEngineTab(snap, "t1", sessions)).toBe(false)
  })

  it("a split's extra shell leaf does not make the tab read alive", () => {
    const snap = snapshot([{ kind: "engine", id: "tab-2", title: null, ordinal: 2 }])
    expect(hasLiveEngineTab(snap, "t1", [{ key: "t1::tab-2::leaf-2", alive: true }])).toBe(false)
  })

  // keepAlive `exec`s a login shell where an engine exits, so the PTY outlives
  // the engine by hours. Session liveness alone reported those tasks as
  // running the whole time.
  it("a live PTY whose ENGINE is gone does not count as running", () => {
    const snap = snapshot([{ kind: "engine", id: "tab-1", title: null, ordinal: 1 }])
    const sessions = [{ key: "t1::tab-1", alive: true }]
    expect(hasLiveEngineTab(snap, "t1", sessions, new Map([["t1::tab-1", false]]))).toBe(false)
    expect(hasLiveEngineTab(snap, "t1", sessions, new Map([["t1::tab-1", true]]))).toBe(true)
  })

  it("a tab nothing walked still counts — 'couldn't look' is not 'stopped'", () => {
    const snap = snapshot([{ kind: "engine", id: "tab-1", title: null, ordinal: 1 }])
    expect(hasLiveEngineTab(snap, "t1", [{ key: "t1::tab-1", alive: true }], new Map())).toBe(true)
  })
})

describe("joinTaskTabs", () => {
  it("maps snapshot fields and joins per-tab liveness on the tab's own key", () => {
    const snap = {
      tabs: [
        { kind: "engine", id: "tab-1", title: "renamed", ordinal: 1, lastTitle: "building", autoTitle: "first prompt" },
        { kind: "engine", id: "tab-2", title: null, ordinal: 2, vendor: "codex", liveVendor: "codex" },
      ],
      activeId: "tab-2",
      nextOrdinal: 3,
    } as unknown as TabsState
    const rows = joinTaskTabs(snap, "t1", [
      { key: "t1::tab-2", alive: true },
      { key: "t1::tab-1::leaf-2", alive: true }, // split shell leaf — not the tab itself
    ])
    expect(rows).toEqual([
      {
        id: "tab-1",
        kind: "engine",
        title: "renamed",
        vendor: null,
        liveVendor: null,
        lastTitle: "building",
        autoTitle: "first prompt",
        alive: false,
        engineAlive: false,
        exit: null,
      },
      {
        id: "tab-2",
        kind: "engine",
        title: null,
        vendor: "codex",
        liveVendor: "codex",
        lastTitle: null,
        autoTitle: null,
        alive: true,
        engineAlive: null,
        exit: null,
      },
    ])
  })

  const vendorSnap = (tabs: unknown[]): TabsState =>
    ({ tabs, activeId: "tab-1", nextOrdinal: tabs.length + 1 }) as unknown as TabsState

  it("a live foreground-walk verdict overrides the recorded liveVendor", () => {
    const snap = vendorSnap([
      { kind: "command", id: "tab-1", title: null, ordinal: 1 }, // shell, user typed claude
      { kind: "engine", id: "tab-2", title: null, ordinal: 2, liveVendor: "codex" }, // ctrl+C'd
      { kind: "engine", id: "tab-3", title: null, ordinal: 3, liveVendor: "codex" }, // not walked
    ])
    const rows = joinTaskTabs(
      snap,
      "t1",
      [
        { key: "t1::tab-1", alive: true },
        { key: "t1::tab-2", alive: true },
        { key: "t1::tab-3", alive: true },
      ],
      {},
      new Map([
        ["t1::tab-1", "claude"], // shell running a live engine → lights up
        ["t1::tab-2", null], // walked, engine-free → goes dark
        // tab-3 absent: couldn't look → recorded value stands
      ]),
    )
    expect(rows.map((r) => r.liveVendor)).toEqual(["claude", null, "codex"])
  })

  it("a dead tab never takes a walk verdict — recorded liveVendor stands", () => {
    const snap = vendorSnap([{ kind: "engine", id: "tab-1", title: null, ordinal: 1, liveVendor: "claude" }])
    const rows = joinTaskTabs(snap, "t1", [{ key: "t1::tab-1", alive: false }], {}, new Map([["t1::tab-1", null]]))
    expect(rows[0]?.liveVendor).toBe("claude")
  })

  // An unreachable pty host answers nothing. Rendering that as `alive: false`
  // asserts a death nobody observed, and a cleanup loop deletes worktrees on
  // it — so every liveness field on every row goes to `null` instead.
  it("an unasked pty host leaves every liveness field null, not false", () => {
    const snap = { tabs: [{ kind: "engine", id: "tab-1", title: null, ordinal: 1 }] } as unknown as TabsState
    const rows = joinTaskTabs(snap, "t1", null)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.alive).toBeNull()
    expect(rows[0]?.engineAlive).toBeNull()
    expect(rows[0]?.exit).toBeNull()
  })

  it("a task with no snapshot still lists its live sessions as unregistered rows", () => {
    // Returning [] here would make an alive engine invisible to the
    // discovery read.
    expect(joinTaskTabs(undefined, "t1", [{ key: "t1::tab-1", alive: true }])).toEqual([
      {
        id: "tab-1",
        kind: "engine",
        title: null,
        vendor: null,
        liveVendor: null,
        lastTitle: null,
        autoTitle: null,
        alive: true,
        engineAlive: null,
        exit: null,
        unregistered: true,
      },
    ])
  })

  it("surfaces an alive session the snapshot does not list — the invisible engine", () => {
    // The shape: snapshot holds only tab-2, yet the pty host has tab-1 +
    // tab-2 alive, so tab-1 runs for hours with zero UI presence.
    const snap = {
      tabs: [{ kind: "engine", id: "tab-2", title: null, ordinal: 2 }],
      activeId: "tab-2",
      nextOrdinal: 3,
    } as unknown as TabsState
    const rows = joinTaskTabs(snap, "t1", [
      { key: "t1::tab-1", alive: true },
      { key: "t1::tab-2", alive: true },
    ])
    expect(rows.map((r) => ({ id: r.id, alive: r.alive, unregistered: r.unregistered ?? false }))).toEqual([
      { id: "tab-2", alive: true, unregistered: false },
      { id: "tab-1", alive: true, unregistered: true },
    ])
  })

  it("dead sessions and split leaves never mint unregistered rows", () => {
    const snap = {
      tabs: [{ kind: "engine", id: "tab-2", title: null, ordinal: 2 }],
      activeId: "tab-2",
      nextOrdinal: 3,
    } as unknown as TabsState
    const rows = joinTaskTabs(snap, "t1", [
      { key: "t1::tab-1", alive: false }, // dead — the exit records answer for it
      { key: "t1::tab-2::leaf-1", alive: true }, // split leaf — belongs to tab-2
      { key: "t1::tab-2", alive: true },
    ])
    expect(rows.map((r) => r.id)).toEqual(["tab-2"])
  })

  const oneTabSnap = (id: string): TabsState =>
    ({ tabs: [{ kind: "engine", id, title: null, ordinal: 1 }], activeId: id, nextOrdinal: 2 }) as TabsState

  it("surfaces a dead tab's abnormal exit from the live host session", () => {
    const exit = { code: 1, signal: null, at: "2026-08-11T00:00:00.000Z" }
    const rows = joinTaskTabs(oneTabSnap("tab-1"), "t1", [{ key: "t1::tab-1", alive: false, exit }])
    expect(rows[0]).toMatchObject({ alive: false, exit })
  })

  it("falls back to the durable exit record when the host has no session (idle-exited)", () => {
    const exit = { code: null, signal: "SIGKILL", at: "2026-08-11T00:00:00.000Z" }
    const rows = joinTaskTabs(oneTabSnap("tab-1"), "t1", [], { "t1::tab-1": exit })
    expect(rows[0]).toMatchObject({ alive: false, exit })
  })

  it("takes the durable record's banner code when the live host's exit has none", () => {
    // The host's in-memory exit is fresher but carries only a wait status, and
    // a SIGKILLed session has no code in one. The record for the same death
    // recovered the engine's from the wrapper banner.
    const at = "2026-08-11T00:00:00.000Z"
    const rows = joinTaskTabs(
      oneTabSnap("tab-1"),
      "t1",
      [{ key: "t1::tab-1", alive: false, exit: { code: null, signal: "SIGKILL", at } }],
      {
        "t1::tab-1": { code: 143, signal: null, at, layer: "pty", tail: ["Engine exited (code 143)."] },
      },
    )
    expect(rows[0]?.exit).toMatchObject({ code: 143, signal: "SIGKILL", layer: "pty" })
  })

  it("does not borrow a code from a record describing a DIFFERENT death", () => {
    const rows = joinTaskTabs(
      oneTabSnap("tab-1"),
      "t1",
      [{ key: "t1::tab-1", alive: false, exit: { code: null, signal: "SIGKILL", at: "2026-08-11T02:00:00.000Z" } }],
      { "t1::tab-1": { code: 143, signal: null, at: "2026-08-11T00:00:00.000Z", layer: "pty" } },
    )
    expect(rows[0]?.exit).toMatchObject({ code: null, signal: "SIGKILL" })
  })

  it("keeps clean exits quiet: code 0 reports exit null — the no-noise rule", () => {
    const exit = { code: 0, signal: null, at: "2026-08-11T00:00:00.000Z" }
    const rows = joinTaskTabs(oneTabSnap("tab-1"), "t1", [{ key: "t1::tab-1", alive: false, exit }])
    expect(rows[0]?.exit).toBeNull()
  })

  it("an alive tab never reports an exit, even with a stale record for its key", () => {
    const stale = { code: 1, signal: null, at: "2026-08-10T00:00:00.000Z" }
    const rows = joinTaskTabs(oneTabSnap("tab-1"), "t1", [{ key: "t1::tab-1", alive: true }], { "t1::tab-1": stale })
    expect(rows[0]).toMatchObject({ alive: true, exit: null })
  })

  it("a dead tab carries the durable record's output tail, so the cause is readable", () => {
    const record = {
      code: 1,
      signal: null,
      at: "2026-08-11T00:00:00.000Z",
      tail: ["Error: ENOSPC: no space left on device", "  at write (node:fs)"],
    }
    const rows = joinTaskTabs(oneTabSnap("tab-1"), "t1", [], { "t1::tab-1": record })
    // `layer` is added by the join: this key is structurally the PTY layer.
    expect(rows[0]?.exit).toEqual({ ...record, layer: "pty" })
  })

  it("a stale record never captions a NEWER death — different `at`, no tail borrowed", () => {
    // The key was reopened and died again: the host's fresh exit wins, and the
    // previous incarnation's tail must not be attached to it as if it were the
    // cause. Wrong output on a real death is worse than no output.
    const fresh = { code: 137, signal: "SIGKILL", at: "2026-08-12T00:00:00.000Z" }
    const older = { code: 1, signal: null, at: "2026-08-11T00:00:00.000Z", tail: ["from the PREVIOUS incarnation"] }
    const rows = joinTaskTabs(oneTabSnap("tab-1"), "t1", [{ key: "t1::tab-1", alive: false, exit: fresh }], {
      "t1::tab-1": older,
    })
    expect(rows[0]?.exit).toEqual({ ...fresh, layer: "pty" })
    expect(rows[0]?.exit).not.toHaveProperty("tail")
  })

  it("a snapshot claiming a live engine loses to the pty truth: dead reads dead, with its cause", () => {
    // The round-health divergence (the reason `list`'s cached `running` lies):
    // a mounted TUI recorded `liveVendor: claude` on this tab, then the engine
    // crashed. The snapshot still SAYS an engine is there. Process truth must
    // win on `alive`/`running`, and the exit cause must come back with it —
    // a coordinator polling this must never be told the worker is still going.
    const snap = {
      tabs: [{ kind: "engine", id: "tab-1", title: null, ordinal: 1, liveVendor: "claude" }],
      activeId: "tab-1",
      nextOrdinal: 2,
    } as unknown as TabsState
    const record = { code: 1, signal: null, at: "2026-08-11T00:00:00.000Z", tail: ["Fatal: engine exited"] }
    const sessions = [{ key: "t1::tab-1", alive: false }]

    const rows = joinTaskTabs(snap, "t1", sessions, { "t1::tab-1": record })
    expect(rows[0]).toMatchObject({ id: "tab-1", alive: false, exit: record })
    expect(hasLiveEngineTab(snap, "t1", sessions)).toBe(false)
  })

  // The live incident: a worker's engine was SIGTERMed, `inspect` held the
  // whole record, and `get-task`/`collect` answered `exit: null` for two
  // hours. Two independent reasons, both gone now — the row only looked for
  // an exit when the SESSION was dead (an engine-layer record is by
  // definition the session-alive case), and it looked under the bare key
  // while engine records live under `<key>#engine`.
  describe("engine-layer exit on a tab whose session outlived its engine", () => {
    const engineRecord = {
      code: 143,
      signal: null,
      at: "2026-08-11T00:00:00.000Z",
      layer: "engine" as const,
      tail: ["  ⚠ Engine exited (code 143). Check Settings → Engines and fix the launch command."],
    }
    const alive = [{ key: "t1::tab-1", alive: true }]

    it("reports the death the store already holds", () => {
      const rows = joinTaskTabs(
        oneTabSnap("tab-1"),
        "t1",
        alive,
        { "t1::tab-1#engine": engineRecord },
        undefined,
        new Map([["t1::tab-1", false]]),
      )
      expect(rows[0]).toMatchObject({ alive: true, engineAlive: false, exit: engineRecord })
    })

    it("says nothing while an engine is running — a stale record must not caption a live one", () => {
      // The tab restarted its engine after the death. The record is history.
      const rows = joinTaskTabs(
        oneTabSnap("tab-1"),
        "t1",
        alive,
        { "t1::tab-1#engine": engineRecord },
        undefined,
        new Map([["t1::tab-1", true]]),
      )
      expect(rows[0]).toMatchObject({ engineAlive: true, exit: null })
    })

    it("says nothing when no walk answered — `null` is not a verdict", () => {
      const rows = joinTaskTabs(oneTabSnap("tab-1"), "t1", alive, { "t1::tab-1#engine": engineRecord })
      expect(rows[0]).toMatchObject({ engineAlive: null, exit: null })
    })

    it("a pty-layer death of the session itself wins — the later, larger event", () => {
      const ptyRecord = { code: 1, signal: null, at: "2026-08-12T00:00:00.000Z" }
      const rows = joinTaskTabs(oneTabSnap("tab-1"), "t1", [{ key: "t1::tab-1", alive: false }], {
        "t1::tab-1": ptyRecord,
        "t1::tab-1#engine": engineRecord,
      })
      expect(rows[0]?.exit).toEqual({ ...ptyRecord, layer: "pty" })
    })
  })
})
