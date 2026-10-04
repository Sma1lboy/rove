/**
 * The tab strip and the sidebar rail must describe one tab the same way.
 *
 * Lives on the render track because `tab-strip.tsx` pulls in opentui, which
 * needs bun's runner (same reason as `sidebar-completion-seen.test.ts`).
 *
 * Mutation target is the WIRE between the two vocabularies, not either table
 * alone: reverting `activityTurnState`'s `rate_limited → error` fold turns
 * this red, and so does reverting `TURN_GLYPHS`. Asserting only one of the
 * two would stay green through a revert of the other, and the failure mode is
 * precisely the two halves disagreeing.
 */
import { describe, expect, it } from "bun:test"
import type { TaskActivityState } from "../../src/engine/hook-events"
import { TURN_GLYPHS } from "../../src/tui-react/workspace/tab-strip"
import { chipAttentionKind } from "../../src/tui/lib/notify-state"
import { activityTurnState } from "../../src/tui/workspace/turn-state-merge"

const glyphOf = (state: TaskActivityState): string => {
  const turn = activityTurnState(state)
  if (turn === null) throw new Error(`no chip for ${state}`)
  return TURN_GLYPHS[turn]
}

describe("tab strip glyphs agree with the sidebar rail", () => {
  it("draws rate limited, error, and dead as three different marks", () => {
    // The rail's own vocabulary (row-view.ts): ◷ rate limited, † dead.
    expect(glyphOf("rate_limited")).toBe("◷")
    expect(glyphOf("dead")).toBe("†")
    expect(glyphOf("error")).toBe("!")
    // Whatever the marks are, they must be DISTINCT: the three ask for three
    // different actions (wait / look / restart), and one `!` for all three is
    // the defect.
    expect(new Set([glyphOf("rate_limited"), glyphOf("error"), glyphOf("dead")]).size).toBe(3)
  })

  it("still raises an attention notification for all three", () => {
    // Splitting the chip vocabulary must not silently drop the toast that
    // `rate_limited` gets by riding on `error`.
    for (const state of ["rate_limited", "error", "dead"] as const) {
      expect(chipAttentionKind(activityTurnState(state) ?? "")).toBe("error")
    }
  })
})
