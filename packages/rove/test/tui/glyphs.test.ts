/**
 * The glyph presets (`tui/lib/glyphs.ts`): every preset must fill every slot
 * at one cell, and a spinner frame must never read as a settled badge.
 */

import { describe, expect, it } from "vitest"
import { charWidth } from "../../src/lib/display-width.ts"
import { GLYPH_SET_NAMES } from "../../src/state/glyph-set.ts"
import { GLYPH_SETS, type GlyphSet } from "../../src/tui/lib/glyphs.ts"
import { buildSidebarRowView } from "../../src/tui/panes/sidebar/row-view.ts"
import { type Task, toTaskId } from "../../src/types/task.ts"

const cells = (s: string): number => [...s].reduce((n, ch) => n + charWidth(ch.codePointAt(0) ?? 0), 0)

describe("glyph presets", () => {
  it.each(GLYPH_SET_NAMES)("%s fills every slot with one-cell glyphs", (name) => {
    const set: GlyphSet = GLYPH_SETS[name]
    expect(Object.keys(set).sort()).toEqual(Object.keys(GLYPH_SETS.braille).sort())
    expect(set.spinner.length).toBeGreaterThan(1)
    const glyphs = Object.values(set).flat()
    expect(glyphs.filter((glyph) => cells(glyph) !== 1)).toEqual([])
  })

  it.each(GLYPH_SET_NAMES)("%s spinner frames never reuse a settled badge", (name) => {
    const set: GlyphSet = GLYPH_SETS[name]
    const badges = new Set([set.idle, set.unseen, set.needsInput, set.attention])
    expect(set.spinner.filter((frame) => badges.has(frame))).toEqual([])
  })

  it("ascii is 7-bit only", () => {
    const all = Object.values(GLYPH_SETS.ascii).flat().join("")
    expect(all).toMatch(/^[\x20-\x7e]+$/)
  })

  it("the rail draws from the preset it is given", () => {
    const task = {
      id: toTaskId("t1"),
      title: "t",
      repo: "/repo",
      branch: "main",
      worktreePath: "/wt",
      kind: "task",
      status: "in_progress",
      vendor: "claude",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    } as Task
    const row = (state: "running" | "turn_complete" | "idle", glyphs: GlyphSet) =>
      buildSidebarRowView({
        task,
        status:
          state === "idle"
            ? undefined
            : {
                kind: state === "running" ? "running" : "unseen",
                since: Date.parse("2026-01-01T00:00:00.000Z"),
                state,
              },
        lifecycle: { subagents: 2 },
        spinnerFrame: 0,
        subtitleBudget: 40,
        truncateBranch: (branch) => branch,
        glyphs,
      })
    const star = GLYPH_SETS.starburst
    expect(star.spinner).toContain(row("running", star).stateGlyph)
    expect(row("running", star).subtitleText).toBe(`${star.subagent}2 main`)
    expect(row("turn_complete", star).stateGlyph).toBe(star.unseen)
    expect(row("idle", GLYPH_SETS.ascii).stateGlyph).toBe("o")
  })
})
