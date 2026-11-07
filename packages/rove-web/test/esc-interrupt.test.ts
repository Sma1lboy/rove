import { describe, expect, test } from "bun:test"
import {
  type EscapePress,
  type EscapeScene,
  type FocusProbe,
  escapeGoesToTerminal,
  focusOwner,
} from "../src/esc-interrupt.ts"

/** An element `tagName` that sits inside the regions named by these selector fragments. */
function element(tagName: string, inside: readonly string[] = [], isContentEditable = false): FocusProbe {
  return {
    tagName,
    isContentEditable,
    closest: (selector) =>
      selector
        .split(",")
        .map((part) => part.trim())
        .some((part) => inside.includes(part))
        ? {}
        : null,
  }
}

const ESC: EscapePress = {
  key: "Escape",
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  isComposing: false,
  defaultPrevented: false,
}
const SHOWN: EscapeScene = { overlay: false, terminal: true }

describe("who holds focus", () => {
  test("the page after a clicked button went away, and a top-bar control, are nobody's pane", () => {
    expect(focusOwner(null)).toBe("none")
    expect(focusOwner(element("BODY"))).toBe("none")
    expect(focusOwner(element("BUTTON"))).toBe("loose")
  })

  test("xterm's helper textarea is the terminal, not a field", () => {
    expect(focusOwner(element("TEXTAREA", [".xterm"]))).toBe("terminal")
    expect(focusOwner(element("TEXTAREA"))).toBe("field")
    expect(focusOwner(element("INPUT"))).toBe("field")
    expect(focusOwner(element("DIV", [], true))).toBe("field")
  })

  test("the rail, the side panel, dialogs and menus keep their own Escape", () => {
    expect(focusOwner(element("BUTTON", [".rail"]))).toBe("pane")
    expect(focusOwner(element("DIV", [".side-panel"]))).toBe("pane")
    expect(focusOwner(element("BUTTON", ["dialog"]))).toBe("pane")
    expect(focusOwner(element("DIV", ["[role=menu]"]))).toBe("pane")
  })
})

describe("Escape that reaches the window", () => {
  test("goes to the terminal when focus is on nothing or a stray control: the engine's interrupt", () => {
    expect(escapeGoesToTerminal(ESC, "none", SHOWN)).toBe(true)
    expect(escapeGoesToTerminal(ESC, "loose", SHOWN)).toBe(true)
  })

  test("stays with whoever owns focus", () => {
    for (const owner of ["terminal", "field", "pane"] as const) {
      expect(escapeGoesToTerminal(ESC, owner, SHOWN)).toBe(false)
    }
  })

  test("stays with an open dialog, menu or page", () => {
    expect(escapeGoesToTerminal(ESC, "none", { overlay: true, terminal: true })).toBe(false)
  })

  test("stays where something earlier in the dispatch took it (prefix cancel, move mode)", () => {
    expect(escapeGoesToTerminal({ ...ESC, defaultPrevented: true }, "none", SHOWN)).toBe(false)
  })

  test("needs a terminal on screen: a phone showing the panel has none to interrupt", () => {
    expect(escapeGoesToTerminal(ESC, "none", { overlay: false, terminal: false })).toBe(false)
  })

  test("is the bare key only, and not one an IME is composing with", () => {
    for (const mod of ["ctrlKey", "metaKey", "altKey", "shiftKey", "isComposing"] as const) {
      expect(escapeGoesToTerminal({ ...ESC, [mod]: true }, "none", SHOWN)).toBe(false)
    }
    expect(escapeGoesToTerminal({ ...ESC, key: "q" }, "none", SHOWN)).toBe(false)
  })
})
