/**
 * Who owns the mouse owns the selection — the two halves of that gate.
 *
 * The PRESS half is `encodeMouseButton`: `Terminal.tsx` starts a selection
 * only when the press was NOT forwarded, so "the app got the click" and "the
 * pane keeps its selection" are the same predicate read from opposite sides.
 * The FLIP half is `appTookMouse`, for the app that arrives after the fact —
 * `vim` typed at a prompt where text is still highlighted.
 */

import { describe, expect, it } from "vitest"
import { encodeMouseButton } from "../../src/tui/panes/terminal/keys-pure"
import { appTookMouse } from "../../src/tui/panes/terminal/terminal-selection"

/** What the pane does with a left press at (10,3), per #785's routing. */
const pressStartsSelection = (
  mouseTracking: "none" | "x10" | "vt200" | "drag" | "any",
  modifiers?: { shift?: boolean },
): boolean => {
  // The shift bypass is checked before the PTY is consulted at all.
  if (modifiers?.shift) return true
  return encodeMouseButton({ mouseTracking }, "down", 0, 10, 3, modifiers) === null
}

describe("press: the app's mouse tracking decides who gets the click", () => {
  it("yields the press in a mouse-aware app, so no selection starts", () => {
    for (const mode of ["x10", "vt200", "drag", "any"] as const) {
      expect(pressStartsSelection(mode)).toBe(false)
    }
  })

  it("keeps the press at a plain prompt, so a selection starts", () => {
    expect(pressStartsSelection("none")).toBe(true)
  })

  it("keeps the press when shift bypasses a mouse-aware app", () => {
    expect(pressStartsSelection("any", { shift: true })).toBe(true)
  })
})

describe("flip: an app that takes the mouse under a live selection", () => {
  it("clears when tracking turns on mid-selection", () => {
    expect(appTookMouse(false, true)).toBe(true)
  })

  it("leaves a shift-bypass selection alone — the app already owned the mouse", () => {
    expect(appTookMouse(true, true)).toBe(false)
  })

  it("does not clear at a plain prompt, or when the app gives the mouse back", () => {
    expect(appTookMouse(false, false)).toBe(false)
    expect(appTookMouse(true, false)).toBe(false)
  })
})
