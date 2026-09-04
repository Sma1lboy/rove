/**
 * The quick-task composer's REGISTRATION gate, now that two chip rows want the
 * same three keys.
 *
 * `dispatchKeyEvent` calls `preventDefault()` on every matched binding, so a
 * chord that exists on a text field is a chord that field's input never sees.
 * `enter` on PROMPT is the one that matters most: it is the whole "type a
 * prompt, hit enter" path, and it works only because `return` is absent from
 * the list while PROMPT is focused. Adding ATTEMPTS put a second `left` /
 * `right` / `return` triple in the file — this pins that neither triple leaks
 * onto a text field, and that each chip row steps its OWN value.
 */

import { quickTaskBindings } from "@/tui-react/component/quick-task-bindings"
import type { KeyEvent } from "@opentui/core"
import { describe, expect, test } from "vitest"

function handlers() {
  const calls: string[] = []
  return {
    calls,
    h: {
      cycleField: (d: 1 | -1) => calls.push(`field${d}`),
      stepAttempts: (d: 1 | -1) => calls.push(`attempts${d}`),
      stepEngine: (d: 1 | -1) => calls.push(`engine${d}`),
      commit: () => calls.push("commit"),
      pasteAttachment: () => calls.push("paste"),
      removeLastAttachment: () => calls.push("remove"),
    },
  }
}

/** The bindings under test ignore the event entirely — arrow chords carry no
 *  payload. A bare cast keeps the call honest without faking 16 fields. */
const KEY = {} as KeyEvent

const keysOn = (field: Parameters<typeof quickTaskBindings>[0]) =>
  quickTaskBindings(field, handlers().h).map((b) => b.key)

describe("quickTaskBindings registration gating", () => {
  test("text fields register neither arrows nor enter", () => {
    for (const field of ["prompt", "branch"] as const) {
      expect(keysOn(field)).not.toContain("return")
      expect(keysOn(field)).not.toContain("left")
      expect(keysOn(field)).not.toContain("right")
    }
  })

  test("each chip row registers them, and steps its own value", () => {
    for (const field of ["attempts", "engine"] as const) {
      expect(keysOn(field)).toEqual(expect.arrayContaining(["left", "right", "return"]))
    }

    const attempts = handlers()
    for (const b of quickTaskBindings("attempts", attempts.h)) if (b.key === "left" || b.key === "right") b.cmd(KEY)
    expect(attempts.calls).toEqual(["attempts-1", "attempts1"])

    const engine = handlers()
    for (const b of quickTaskBindings("engine", engine.h)) if (b.key === "left" || b.key === "right") b.cmd(KEY)
    expect(engine.calls).toEqual(["engine-1", "engine1"])
  })

  test("field-independent chords stay on every field", () => {
    for (const field of ["prompt", "attempts", "engine", "branch"] as const) {
      expect(keysOn(field)).toEqual(expect.arrayContaining(["tab", "shift+tab", "ctrl+e", "ctrl+v", "ctrl+x"]))
    }
  })
})
