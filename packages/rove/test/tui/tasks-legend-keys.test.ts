/**
 * Tasks-pane footer legend keycap derivation (bug-4).
 *
 * The footer `── keys ──` legend is the ONLY always-visible keybinding
 * surface (the outer monitor's status bar is gone). docs/KEYBINDINGS.md
 * promises every surface follows the keymap: "one mutation re-points every
 * surface — chord, Help copy, and footer hint follow automatically
 * (overridden rows get their hint.keys refreshed; an unbound row loses its
 * hint)". A hardcoded literal array of legend rows
 * (`{ k: "n" }`, `{ k: "a/d" }`, …) lets an override / unbind in
 * ~/.rove/settings/keybindings.yaml change dispatch but NOT the advertised
 * cap, so the legend lies. Each cap is derived from `RoveKeymap` via
 * `legendCap` / `legendRowCap`, which live in the framework-free
 * `src/tui/lib/help-groups.ts` — imported here directly (no opentui in the
 * module graph), so this file tests the REAL helpers the footer legend
 * (tasks-pane/shortcut-hints.tsx) and the help dialog run. What locks is
 * that the resolution rule (`hint?.keys ?? keys[0]`, drop on unbind, join
 * composites with `/`) tracks a real override / unbind through the
 * live-reload machinery (applyKeymapOverrides + resetKeymapToDefaults).
 */

import { afterEach, describe, expect, test } from "vitest"
import { RoveKeymap, resetKeymapToDefaults } from "../../src/tui/context/keybindings"
import { legendCap, legendRowCap } from "../../src/tui/lib/help-groups"
import { applyKeymapOverrides } from "../../src/tui/lib/keymap-overrides"

describe("tasks-pane legend keycap derivation", () => {
  afterEach(() => resetKeymapToDefaults())

  test("an override re-points the cap (hint.keys is refreshed in place)", () => {
    // task.new: c — a bare-letter sidebar override is valid (scope:"sidebar").
    applyKeymapOverrides(RoveKeymap, [{ id: "task.new", keys: ["c"] }])
    expect(legendCap("task.new")).toBe("c")
    resetKeymapToDefaults()
    expect(legendCap("task.new")).toBe("n")
  })

  test("a composite row drops only the unbound id, keeping the survivors", () => {
    // Unbind the branch rename (b) — the r/b/v row collapses to r/v, it
    // does not advertise the dead `b`.
    applyKeymapOverrides(RoveKeymap, [{ id: "tasks.renameBranch", keys: [] }])
    expect(legendCap("tasks.renameBranch")).toBeNull()
    expect(legendRowCap(["sidebar.rename", "tasks.renameBranch", "tasks.cycleEngine"])).toBe("r/v")
  })

  test("a fully-unbound row resolves to null so the caller drops it entirely", () => {
    applyKeymapOverrides(RoveKeymap, [{ id: "tasks.openWorktree", keys: [] }])
    expect(legendCap("tasks.openWorktree")).toBeNull()
    expect(legendRowCap(["tasks.openWorktree"])).toBeNull()
  })

  test("unknown id resolves to null (typo drops its row, never throws)", () => {
    expect(legendCap("tasks.doesNotExist")).toBeNull()
    expect(legendRowCap(["tasks.doesNotExist"])).toBeNull()
  })
})
