import { afterEach, describe, expect, it } from "vitest"
import { findBinding, resetKeymapToDefaults } from "../../src/tui/context/keybindings"
import { DIRECT_GUIDE_PREFIX_ACTION_ID, directGuideOptions, shortcutCaption } from "../../src/tui/lib/shortcut-reveal"

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

describe("directGuideOptions", () => {
  it("derives only ctrl follow-up keys and the live prefix from the reachable keymap", () => {
    expect(
      directGuideOptions(
        reachable(["help.open", "focus.sidebar", "focus.next", "task.new"], ["kanban.open"]),
        "ctrl+a",
      ),
    ).toEqual([
      { stroke: "q", action: "focus.sidebar" },
      { stroke: "a", action: DIRECT_GUIDE_PREFIX_ACTION_ID },
    ])
  })

  it("tracks keymap overrides without admitting multi-modifier chords", () => {
    const row = findBinding("focus.next") as { keys: readonly string[] }
    row.keys = ["ctrl+n", "ctrl+shift+n"]

    expect(directGuideOptions(reachable(["focus.next"], ["kanban.open"]), "ctrl+b")).toEqual([
      { stroke: "n", action: "focus.next" },
      { stroke: "b", action: DIRECT_GUIDE_PREFIX_ACTION_ID },
    ])
  })

  it("omits the prefix entry when it is disabled or no prefix action is reachable", () => {
    expect(directGuideOptions(reachable(["focus.sidebar"]), null)).toEqual([{ stroke: "q", action: "focus.sidebar" }])
    expect(directGuideOptions(reachable(["focus.sidebar"]), "ctrl+a")).toEqual([
      { stroke: "q", action: "focus.sidebar" },
    ])
  })
})
