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

/** Fire the binding registered for `key` on `field`, recording into `calls`. */
const press = (field: Parameters<typeof quickTaskBindings>[0], ...keys: string[]) => {
  const { calls, h } = handlers()
  const bindings = quickTaskBindings(field, h)
  keys.map((key) => bindings.find((b) => b.key === key)?.cmd(KEY))
  return calls
}

describe("quickTaskBindings registration gating", () => {
  test.each(["prompt", "branch"] as const)("text field %s registers neither arrows nor enter", (field) => {
    expect(keysOn(field).filter((key) => ["return", "left", "right", "h", "l"].includes(key))).toEqual([])
  })

  test.each(["attempts", "engine"] as const)("chip row %s registers them, and steps its own value", (field) => {
    expect(keysOn(field)).toEqual(expect.arrayContaining(["left", "right", "h", "l", "return"]))
    expect(press(field, "left", "right")).toEqual([`${field}-1`, `${field}1`])
  })

  test("h / l are the arrow twins on a chip row", () => {
    expect(press("attempts", "h", "l")).toEqual(["attempts-1", "attempts1"])
  })

  test.each(["prompt", "attempts", "engine", "branch"] as const)("field-independent chords stay on %s", (field) => {
    expect(keysOn(field)).toEqual(expect.arrayContaining(["tab", "shift+tab", "ctrl+e", "ctrl+v", "ctrl+x"]))
  })
})
