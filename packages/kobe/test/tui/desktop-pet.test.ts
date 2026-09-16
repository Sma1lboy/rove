/**
 * The desktop pet's two decisions, as plain values: which species a tab
 * gets, and which face an activity state draws. The renderer only paints the
 * 3-cell frame this returns, so a bug here is a pet that lies about what its
 * tab is doing — the one thing it must never do, since it claims to reflect
 * the same activity the sidebar glyph does.
 */

import { describe, expect, it } from "vitest"
import { TASK_ACTIVITY_STATES } from "../../src/engine/hook-events.ts"
import { PET_CELLS, PET_SPECIES, petFrameOf, petMoodOf, petSpeciesOf } from "../../src/tui/desktop-pet.ts"

describe("petSpeciesOf", () => {
  it("is stable across calls for the same tab id", () => {
    expect(petSpeciesOf("tab-3")).toBe(petSpeciesOf("tab-3"))
  })

  it("always hands back a real species", () => {
    for (const id of ["tab-1", "tab-2", "tab-3", "tab-17", "", "长-id"]) {
      expect(PET_SPECIES).toContain(petSpeciesOf(id))
    }
  })

  it("splits sibling tabs across species — one worktree is not all cats", () => {
    const seen = new Set(["tab-1", "tab-2", "tab-3", "tab-4"].map(petSpeciesOf))
    expect(seen.size).toBeGreaterThan(1)
  })
})

describe("petMoodOf", () => {
  it("maps every activity state the daemon can publish", () => {
    // The table is exhaustive on purpose: a new TaskActivityState must fail
    // here rather than silently falling through to `idle`.
    const expected: Record<string, string> = {
      idle: "idle",
      running: "running",
      turn_complete: "done",
      rate_limited: "waiting",
      permission_needed: "waiting",
      error: "waiting",
      dead: "waiting",
    }
    for (const state of TASK_ACTIVITY_STATES) {
      expect(petMoodOf(state)).toBe(expected[state])
    }
  })

  it("reads an unreported tab as idle — same as the row's resting glyph", () => {
    expect(petMoodOf(undefined)).toBe("idle")
  })
})

describe("petFrameOf", () => {
  it("draws every species/mood frame in exactly PET_CELLS cells", () => {
    for (const species of PET_SPECIES) {
      for (const mood of ["running", "waiting", "done", "idle"] as const) {
        expect(petFrameOf(species, mood)).toHaveLength(PET_CELLS)
      }
    }
  })

  it("gives the two species different faces of the same mood", () => {
    expect(petFrameOf("cat", "running")).not.toBe(petFrameOf("dango", "running"))
  })
})
