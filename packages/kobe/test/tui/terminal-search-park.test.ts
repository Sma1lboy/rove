/**
 * The parked search hit, across a scrollback trim and a reflow.
 *
 * `matches` is recomputed on every PTY frame. Keeping the user's place as an
 * ARRAY POSITION means a trim — which drops hits off the front and shifts
 * every survivor down a slot — silently re-points it at a neighbouring
 * occurrence while the counter still reads the old number.
 */

import { describe, expect, it } from "vitest"
import { type ParkedHit, parkHit, resolveParkedIndex } from "../../src/tui/panes/terminal/terminal-search"
import type { SelectionRange } from "../../src/tui/panes/terminal/terminal-selection"

const hit = (row: number): SelectionRange => ({ anchor: { row, col: 0 }, head: { row, col: 3 } })

// Five hits at absolute lines 100, 102, 104, 105, 106.
const BEFORE = [hit(0), hit(2), hit(4), hit(5), hit(6)]
const WINDOW_BEFORE = { epoch: 1, startLine: 100 }
// The bounded ring trimmed lines 100 and 101: the first hit is gone and every
// survivor moved two rows up AND one slot down the array.
const AFTER = [hit(0), hit(2), hit(3), hit(4)]
const WINDOW_AFTER = { epoch: 1, startLine: 102 }

describe("resolveParkedIndex", () => {
  it("keeps naming the SAME occurrence after a scrollback trim", () => {
    const parked = parkHit(BEFORE, 2, WINDOW_BEFORE) as ParkedHit
    expect(parked).toEqual({ kind: "line", epoch: 1, line: 104, col: 0 })
    // The array position moved from 2 to 1; the occurrence did not.
    const at = resolveParkedIndex(parked, AFTER, WINDOW_AFTER)
    expect(at).toBe(1)
    expect(WINDOW_AFTER.startLine + (AFTER[at]?.anchor.row ?? -1)).toBe(104)
    // Position-parking is what used to happen, and it names a different hit.
    expect(WINDOW_AFTER.startLine + (AFTER[2]?.anchor.row ?? -1)).toBe(105)
  })

  it("falls forward to the next surviving hit when the parked line was trimmed away", () => {
    const parked = parkHit(BEFORE, 0, WINDOW_BEFORE) as ParkedHit // line 100, trimmed
    const at = resolveParkedIndex(parked, AFTER, WINDOW_AFTER)
    expect(at).toBe(0)
    expect(WINDOW_AFTER.startLine + (AFTER[at]?.anchor.row ?? -1)).toBe(102)
  })

  it("clamps to the last hit when everything at or after the parked line is gone", () => {
    const parked = { kind: "line", epoch: 1, line: 999, col: 0 } as const
    expect(resolveParkedIndex(parked, BEFORE, WINDOW_BEFORE)).toBe(BEFORE.length - 1)
  })

  it("drops the park when a reflow resets line numbering, rather than mis-mapping it", () => {
    const parked = parkHit(BEFORE, 2, WINDOW_BEFORE) as ParkedHit
    expect(resolveParkedIndex(parked, AFTER, { epoch: 2, startLine: 0 })).toBe(-1)
  })

  it("two hits on the same line are told apart by column", () => {
    const matches = [
      { anchor: { row: 0, col: 0 }, head: { row: 0, col: 3 } },
      { anchor: { row: 0, col: 10 }, head: { row: 0, col: 13 } },
    ]
    const parked = parkHit(matches, 1, WINDOW_BEFORE) as ParkedHit
    expect(resolveParkedIndex(parked, matches, WINDOW_BEFORE)).toBe(1)
  })

  it("without a window there are no stable ids — the position is all there is", () => {
    expect(parkHit(BEFORE, 3, null)).toEqual({ kind: "position", at: 3 })
    expect(resolveParkedIndex({ kind: "position", at: 3 }, BEFORE, null)).toBe(3)
    expect(resolveParkedIndex({ kind: "position", at: 3 }, BEFORE.slice(0, 2), null)).toBe(1)
  })

  it("no park and no matches resolve to nothing parked", () => {
    expect(resolveParkedIndex(null, BEFORE, WINDOW_BEFORE)).toBe(-1)
    expect(resolveParkedIndex(parkHit(BEFORE, 0, WINDOW_BEFORE), [], WINDOW_BEFORE)).toBe(-1)
    expect(parkHit(BEFORE, 99, WINDOW_BEFORE)).toBeNull()
  })
})
