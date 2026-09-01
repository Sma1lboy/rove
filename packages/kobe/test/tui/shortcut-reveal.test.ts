import { afterEach, describe, expect, it } from "vitest"
import { findBinding, resetKeymapToDefaults } from "../../src/tui/context/keybindings"
import { shortcutCaption } from "../../src/tui/lib/shortcut-reveal"

const reachable = (direct: string[] = [], prefix: string[] = []) => ({
  direct: new Set(direct),
  prefix: new Set(prefix),
  inputPassthrough: false,
})

describe("shortcutCaption", () => {
  afterEach(() => resetKeymapToDefaults())

  it("renders the current direct binding instead of a cosmetic hint", () => {
    expect(
      shortcutCaption({
        bindingId: "task.new",
        reachability: reachable(["task.new"]),
        prefixKey: "ctrl+a",
      }),
    ).toBe("n")

    const row = findBinding("task.new") as { keys: readonly string[] }
    row.keys = ["ctrl+r"]
    expect(
      shortcutCaption({
        bindingId: "task.new",
        reachability: reachable(["task.new"]),
        prefixKey: "ctrl+a",
      }),
    ).toBe("⌃ R")
  })

  it("composes the live prefix with the action's actual second stroke", () => {
    expect(
      shortcutCaption({
        bindingId: "kanban.open",
        reachability: reachable([], ["kanban.open"]),
        prefixKey: "ctrl+b",
      }),
    ).toBe("⌃ B 1")
  })

  it("does not advertise unknown, unreachable, or unbound actions", () => {
    expect(
      shortcutCaption({ bindingId: "missing", reachability: reachable(["missing"]), prefixKey: "ctrl+a" }),
    ).toBeNull()
    expect(shortcutCaption({ bindingId: "task.new", reachability: reachable(), prefixKey: "ctrl+a" })).toBeNull()

    const row = findBinding("task.new") as { keys: readonly string[] }
    row.keys = []
    expect(
      shortcutCaption({
        bindingId: "task.new",
        reachability: reachable(["task.new"]),
        prefixKey: "ctrl+a",
      }),
    ).toBeNull()
  })
})
