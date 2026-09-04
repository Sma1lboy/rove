/**
 * `dispatchKeyEvent` edge-case suites split out of keymap-dispatch.test.ts
 * (file-size cap): the modal barrier, the dev-only shadowed-match warning,
 * and shift+letter chord minting. The core dispatch/prefix behavior stays in
 * keymap-dispatch.test.ts; both files share the same makeEvt/makeReg shape.
 */

import { beforeEach, describe, expect, test, vi } from "vitest"
import { type RegisteredBinding, dispatchKeyEvent, insertRegistration } from "../../src/tui/lib/keymap-dispatch"

// Silence + capture the shadowed-match warning (several tests below stack two
// enabled same-chord bindings on purpose). NOTE: the warning dedupes per chord
// per PROCESS — assertions about it must each use a chord no other test in
// this file dispatches.
const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
beforeEach(() => consoleError.mockClear())

function makeEvt(
  name: string,
  mods: Partial<{ ctrl: boolean; meta: boolean; option: boolean; shift: boolean; raw: string }> = {},
) {
  let defaultPrevented = false
  return {
    name,
    raw: mods.raw,
    ctrl: mods.ctrl ?? false,
    meta: mods.meta ?? false,
    option: mods.option ?? false,
    shift: mods.shift ?? false,
    get defaultPrevented() {
      return defaultPrevented
    },
    preventDefault() {
      defaultPrevented = true
    },
  }
}

function makeReg(id: number, key: string, cmd: () => void, enabled = true): RegisteredBinding {
  return {
    id,
    config: () => ({ enabled, bindings: [{ key, cmd }] }),
  }
}

describe("dispatchKeyEvent", () => {
  // The modal barrier: a dialog must make the
  // WHOLE background unreachable structurally, not via per-pane gates.
  describe("modal barrier", () => {
    test("cuts off every binding below it without consuming the event", () => {
      let background = 0
      const stack: RegisteredBinding[] = [
        makeReg(1, "j", () => {
          background++
        }),
        // The dialog's barrier, registered when it opened (above the panes).
        { id: 2, config: () => ({ modal: true, bindings: [{ key: "escape", cmd: () => {} }] }) },
      ]
      const evt = makeEvt("j")
      expect(dispatchKeyEvent(stack, evt)).toBe(false)
      expect(background).toBe(0)
      // No preventDefault — opentui must still route the key to the
      // dialog's own focused input (typing into a rename field).
      expect(evt.defaultPrevented).toBe(false)
    })

    test("bindings registered above the barrier (the dialog body) still fire", () => {
      let body = 0
      const stack: RegisteredBinding[] = [
        makeReg(1, "j", () => {
          throw new Error("background must be unreachable")
        }),
        { id: 2, config: () => ({ modal: true, bindings: [{ key: "escape", cmd: () => {} }] }) },
        makeReg(3, "j", () => {
          body++
        }),
      ]
      expect(dispatchKeyEvent(stack, makeEvt("j"))).toBe(true)
      expect(body).toBe(1)
    })

    test("the barrier's own keys (esc) fire and consume", () => {
      let dismissed = 0
      const stack: RegisteredBinding[] = [
        makeReg(1, "escape", () => {
          throw new Error("background esc must not fire")
        }),
        {
          id: 2,
          config: () => ({
            modal: true,
            bindings: [
              {
                key: "escape",
                cmd: () => {
                  dismissed++
                },
              },
            ],
          }),
        },
      ]
      const evt = makeEvt("escape")
      expect(dispatchKeyEvent(stack, evt)).toBe(true)
      expect(dismissed).toBe(1)
      expect(evt.defaultPrevented).toBe(true)
    })

    // Declared modal scope (insertRegistration): barrier-vs-body precedence
    // is declared data, not an accident of React committing the barrier's
    // effect before the body's (sibling tree order) — the barrier
    // carries `modalOwner`, body entries carry `modalMember`, and
    // insertRegistration slots the barrier BELOW its members. These tests pin
    // the invariant under BOTH registration orders.
    describe("declared scope — order independence", () => {
      const SCOPE = Symbol("test.modal")

      function barrier(id: number, onEsc: () => void): RegisteredBinding {
        return {
          id,
          modalOwner: SCOPE,
          config: () => ({ modal: true, bindings: [{ key: "escape", cmd: onEsc }] }),
        }
      }
      function body(id: number, key: string, cmd: () => void): RegisteredBinding {
        return { id, modalMember: SCOPE, config: () => ({ bindings: [{ key, cmd }] }) }
      }

      /** Run the barrier/body/background assertions against a built stack. */
      function assertModalContract(stack: RegisteredBinding[], counts: { body: number; bg: number; esc: number }) {
        // Body key wins (reachable above the barrier) …
        expect(dispatchKeyEvent(stack, makeEvt("j"))).toBe(true)
        expect(counts.body).toBe(1)
        // … background is cut off wholesale …
        expect(dispatchKeyEvent(stack, makeEvt("x"))).toBe(false)
        expect(counts.bg).toBe(0)
        // … and the barrier's own esc still fires (body doesn't bind it).
        expect(dispatchKeyEvent(stack, makeEvt("escape"))).toBe(true)
        expect(counts.esc).toBe(1)
      }

      test("barrier registered BEFORE the body (today's React commit order)", () => {
        const counts = { body: 0, bg: 0, esc: 0 }
        const stack: RegisteredBinding[] = []
        insertRegistration(
          stack,
          makeReg(1, "x", () => counts.bg++),
        ) // background pane
        insertRegistration(
          stack,
          barrier(2, () => counts.esc++),
        )
        insertRegistration(
          stack,
          body(3, "j", () => counts.body++),
        )
        assertModalContract(stack, counts)
      })

      test("body registered BEFORE the barrier (the order that used to break)", () => {
        const counts = { body: 0, bg: 0, esc: 0 }
        const stack: RegisteredBinding[] = []
        insertRegistration(
          stack,
          makeReg(1, "x", () => counts.bg++),
        ) // background pane
        insertRegistration(
          stack,
          body(3, "j", () => counts.body++),
        )
        insertRegistration(
          stack,
          barrier(2, () => counts.esc++),
        ) // slots BELOW its member
        assertModalContract(stack, counts)
      })

      test("body's own esc beats the barrier's esc under both orders", () => {
        for (const bodyFirst of [true, false]) {
          let bodyEsc = 0
          const stack: RegisteredBinding[] = []
          const regs = [barrier(1, () => {}), body(2, "escape", () => bodyEsc++)]
          if (bodyFirst) regs.reverse()
          for (const r of regs) insertRegistration(stack, r)
          expect(dispatchKeyEvent(stack, makeEvt("escape"))).toBe(true)
          expect(bodyEsc).toBe(1)
        }
      })

      test("plain registrations (no scope) keep pure LIFO push semantics", () => {
        const fired: number[] = []
        const stack: RegisteredBinding[] = []
        insertRegistration(
          stack,
          makeReg(1, "enter", () => fired.push(1)),
        )
        insertRegistration(
          stack,
          makeReg(2, "enter", () => fired.push(2)),
        )
        dispatchKeyEvent(stack, makeEvt("return"))
        expect(fired).toEqual([2])
      })
    })

    test("a disabled modal entry does not block (dialog closed)", () => {
      let background = 0
      const stack: RegisteredBinding[] = [
        makeReg(1, "j", () => {
          background++
        }),
        { id: 2, config: () => ({ enabled: false, modal: true, bindings: [] }) },
      ]
      expect(dispatchKeyEvent(stack, makeEvt("j"))).toBe(true)
      expect(background).toBe(1)
    })
  })

  // Why: the ctrl+w split-close bug — two ENABLED entries sharing a chord
  // resolve by LIFO order, and React stacks ancestors on top, so the
  // winner flips silently. The contract is mutual gating;
  // dispatch (dev mode, KOBE_DEV=1) flags a second enabled match so the
  // violation is loud. Production skips the scan — it would break the
  // read-one-config-on-hit budget (perf-budgets.test.ts).
  describe("shadowed-match warning (dev only)", () => {
    beforeEach(() => {
      process.env.KOBE_DEV = "1"
      return () => {
        Reflect.deleteProperty(process.env, "KOBE_DEV")
      }
    })

    test("warns ONCE when two enabled entries match the same chord", () => {
      const stack: RegisteredBinding[] = [
        makeReg(1, "ctrl+w", () => {}), // shadowed
        makeReg(2, "ctrl+w", () => {}), // wins (top)
      ]
      dispatchKeyEvent(stack, makeEvt("w", { ctrl: true }))
      expect(consoleError).toHaveBeenCalledTimes(1)
      expect(String(consoleError.mock.calls[0]?.[0])).toContain("ctrl+w")
      // Dedupe: the same stuck violation must not spam every keypress.
      dispatchKeyEvent(stack, makeEvt("w", { ctrl: true }))
      expect(consoleError).toHaveBeenCalledTimes(1)
    })

    test("a gated-off (disabled) lower entry is fall-through, not a shadow", () => {
      const stack: RegisteredBinding[] = [
        makeReg(1, "ctrl+b", () => {}, /* enabled */ false),
        makeReg(2, "ctrl+b", () => {}),
      ]
      dispatchKeyEvent(stack, makeEvt("b", { ctrl: true }))
      expect(consoleError).not.toHaveBeenCalled()
    })

    test("a modal hit never warns — everything below is cut off by design", () => {
      const stack: RegisteredBinding[] = [
        makeReg(1, "ctrl+d", () => {}),
        { id: 2, config: () => ({ enabled: true, modal: true, bindings: [{ key: "ctrl+d", cmd: () => {} }] }) },
      ]
      dispatchKeyEvent(stack, makeEvt("d", { ctrl: true }))
      expect(consoleError).not.toHaveBeenCalled()
    })

    test("a modal barrier between hit and lower match stops the shadow scan", () => {
      const stack: RegisteredBinding[] = [
        makeReg(1, "ctrl+g", () => {}), // below the barrier: unreachable, not shadowed
        { id: 2, config: () => ({ enabled: true, modal: true, bindings: [] }) },
        makeReg(3, "ctrl+g", () => {}),
      ]
      dispatchKeyEvent(stack, makeEvt("g", { ctrl: true }))
      expect(consoleError).not.toHaveBeenCalled()
    })
  })

  describe("shift+letter chords", () => {
    // matchKey mints [shift+z, z] for an uppercase keypress: the shifted
    // form is a distinct bindable chord, the bare letter is the fallback
    // so pre-existing bare-letter bindings keep catching uppercase.

    test("Shift+Z fires a shift+z binding", () => {
      let fired = false
      const stack: RegisteredBinding[] = [
        makeReg(1, "shift+z", () => {
          fired = true
        }),
      ]
      expect(dispatchKeyEvent(stack, makeEvt("z", { shift: true }))).toBe(true)
      expect(fired).toBe(true)
    })

    test("Shift+Z falls back to a bare z binding when no shift+z is registered", () => {
      let fired = false
      const stack: RegisteredBinding[] = [
        makeReg(1, "z", () => {
          fired = true
        }),
      ]
      expect(dispatchKeyEvent(stack, makeEvt("z", { shift: true }))).toBe(true)
      expect(fired).toBe(true)
    })

    test("shift+z wins over bare z within one entry regardless of registration order", () => {
      const calls: string[] = []
      const stack: RegisteredBinding[] = [
        {
          id: 1,
          config: () => ({
            bindings: [
              { key: "z", cmd: () => calls.push("bare") },
              { key: "shift+z", cmd: () => calls.push("shifted") },
            ],
          }),
        },
      ]
      dispatchKeyEvent(stack, makeEvt("z", { shift: true }))
      expect(calls).toEqual(["shifted"])
    })

    test("plain z does NOT fire a shift+z binding", () => {
      let fired = false
      const stack: RegisteredBinding[] = [
        makeReg(1, "shift+z", () => {
          fired = true
        }),
      ]
      expect(dispatchKeyEvent(stack, makeEvt("z"))).toBe(false)
      expect(fired).toBe(false)
    })

    test("ctrl+shift+letter still drops shift (legacy terminals cannot distinguish)", () => {
      let fired = false
      const stack: RegisteredBinding[] = [
        makeReg(1, "ctrl+z", () => {
          fired = true
        }),
      ]
      expect(dispatchKeyEvent(stack, makeEvt("z", { ctrl: true, shift: true }))).toBe(true)
      expect(fired).toBe(true)
    })
  })
})
