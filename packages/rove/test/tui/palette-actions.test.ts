import { describe, expect, it } from "vitest"
import { matchesHelpAction } from "../../src/tui/lib/help-groups"
import { type RegisteredBinding, prefixAction } from "../../src/tui/lib/keymap-dispatch"
import { capturePaletteActions } from "../../src/tui/lib/palette-actions"

describe("palette actions", () => {
  it("shares fuzzy name and chord lookup with help", () => {
    expect(matchesHelpAction("wkt", "Open worktrees", "x")).toBe(true)
    expect(matchesHelpAction("CTRL+A", "Open settings", "ctrl+a + ,")).toBe(true)
    expect(matchesHelpAction("xyz", "Open worktrees", "x")).toBe(false)
    expect(matchesHelpAction("  ", "Open worktrees", "x")).toBe(true)
  })
  it("executes a typed live action once and refuses stale owners and disabled handlers", () => {
    let calls = 0
    let enabled = true
    const stack: RegisteredBinding[] = [
      {
        id: 1,
        config: () => ({
          enabled,
          bindings: [
            { id: "settings.open", key: ",", prefix: true, cmd: () => {}, action: prefixAction(() => calls++) },
          ],
        }),
      },
    ]
    const action = capturePaletteActions(stack)[0]
    expect(action?.run()).toBe(true)
    expect(calls).toBe(1)
    enabled = false
    expect(action?.run()).toBe(false)
    enabled = true
    stack[0] = { id: 2, config: stack[0]!.config }
    expect(action?.run()).toBe(false)
    expect(calls).toBe(1)
  })
  it("honors modal barriers, shadowing and terminal passthrough without synthesizing input", () => {
    let calls = 0
    const binding = {
      id: "settings.open",
      key: "s",
      cmd: () => {},
      action: prefixAction(() => calls++),
      yieldToPassthrough: true,
    }
    const stack: RegisteredBinding[] = [{ id: 1, config: () => ({ bindings: [binding] }) }]
    const captured = capturePaletteActions(stack)[0]
    stack.push({ id: 2, config: () => ({ modal: true, bindings: [] }) })
    expect(capturePaletteActions(stack)).toEqual([])
    expect(captured?.run()).toBe(false)
    stack[1] = { id: 2, config: () => ({ bindings: [{ key: "s", cmd: () => {} }] }) }
    expect(capturePaletteActions(stack)).toEqual([])
    stack[1] = { id: 2, config: () => ({ bindings: [{ key: "x", cmd: () => {}, passthrough: true }] }) }
    expect(capturePaletteActions(stack)).toEqual([])
    expect(calls).toBe(0)
  })
})
