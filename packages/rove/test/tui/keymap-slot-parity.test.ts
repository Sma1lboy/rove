/**
 * Slot-based dispatch of the direction-multiplexed binding ids: `bindByIds`
 * hands each handler the matched chord's index in the id's `keys` array, so
 * after a user override (and across the live-reload reset) the slot layout
 * follows the new chords (`sidebar.nav: [w, e]` → w=down, e=up).
 */

import { afterEach, describe, expect, test } from "vitest"
import { RoveKeymap, bindByIds, findBinding, resetKeymapToDefaults } from "../../src/tui/context/keybindings"
import { type Binding, type RegisteredBinding, dispatchKeyEvent } from "../../src/tui/lib/keymap-dispatch"
import { applyKeymapOverrides } from "../../src/tui/lib/keymap-overrides"

function makeEvt(name: string, ctrl = false) {
  let defaultPrevented = false
  return {
    name,
    ctrl,
    meta: false,
    option: false,
    shift: false,
    get defaultPrevented() {
      return defaultPrevented
    },
    preventDefault() {
      defaultPrevented = true
    },
  }
}

/** Register `handlers` the way a pane does and dispatch each key name. */
function fire(handlers: Record<string, Binding["cmd"]>, names: string[]): boolean[] {
  const reg: RegisteredBinding = { id: 1, config: () => ({ bindings: bindByIds(handlers) }) }
  return names.map((name) => dispatchKeyEvent([reg], makeEvt(name)))
}

// applyKeymapOverrides mutates RoveKeymap in place — restore pristine
// defaults after every test (same discipline as keymap-reload.test.ts).
afterEach(() => {
  resetKeymapToDefaults()
})

describe("slot dispatch after a user override", () => {
  test("sidebar.nav: [w, e] → w=down, e=up; defaults stop matching", () => {
    // `w`/`e` are free in the sidebar scope (`s` would conflict-warn with
    // settings.open.sidebar — conflicts apply anyway, but keep this green).
    const { warnings } = applyKeymapOverrides(RoveKeymap, [{ id: "sidebar.nav", keys: ["w", "e"] }])
    expect(warnings).toEqual([])

    const calls: string[] = []
    const handlers = {
      "sidebar.nav": (_evt: unknown, slot?: number) => {
        calls.push((slot ?? 0) % 2 === 0 ? "down" : "up")
      },
    }
    const handled = fire(handlers, ["w", "e", "j", "k"])
    expect(handled).toEqual([true, true, false, false])
    expect(calls).toEqual(["down", "up"])
  })

  test("live reload: reset + re-apply re-derives slots from the current keymap", () => {
    // Boot override…
    applyKeymapOverrides(RoveKeymap, [{ id: "files.hierarchy", keys: ["left", "right"] }])
    expect([...findBinding("files.hierarchy")!.keys]).toEqual(["left", "right"])

    // …user edits the YAML to an INVALID (odd) count; the reload path
    // resets to defaults first, then re-applies → slot validation re-runs
    // and the default layout survives.
    resetKeymapToDefaults()
    const { warnings } = applyKeymapOverrides(RoveKeymap, [{ id: "files.hierarchy", keys: ["left"] }])
    expect(warnings.some((w) => w.includes("keeping the default"))).toBe(true)
    expect([...findBinding("files.hierarchy")!.keys]).toEqual(["h", "l", "left", "right"])

    // bindByIds re-reads the keymap on every keypress, so dispatch sees
    // the restored defaults — no stale 2-chord slots.
    const calls: string[] = []
    const handlers = {
      "files.hierarchy": (_evt: unknown, slot?: number) => {
        calls.push((slot ?? 0) % 2 === 0 ? "collapse" : "expand")
      },
    }
    fire(handlers, ["h", "l", "left", "right"])
    expect(calls).toEqual(["collapse", "expand", "collapse", "expand"])
  })
})
