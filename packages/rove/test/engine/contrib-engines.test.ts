import { describe, expect, it } from "vitest"
import { CONTRIB_ENGINES, CONTRIB_ENGINE_IDS } from "../../src/engine/contrib-engines.ts"
import { engineEntry } from "../../src/engine/registry.ts"
import { classifyScreen } from "../../src/engine/screen-state.ts"
import { isBuiltinVendor } from "../../src/types/vendor.ts"

describe("contrib engine catalog", () => {
  it("no contrib id shadows a built-in", () => {
    expect(CONTRIB_ENGINE_IDS.filter((id) => isBuiltinVendor(id))).toEqual([])
  })

  it("resolves through engineEntry with catalog identity + manifest", () => {
    const gemini = engineEntry("gemini")
    expect(gemini.builtin).toBe(false)
    expect(gemini.displayName).toBe("Gemini CLI")
    expect(gemini.defaultCommand).toEqual(["gemini"])
    expect(gemini.screenManifest).toBeDefined()
    // The rest stays the documented empty custom entry.
    expect(gemini.createHookAdapter().supportsHooks()).toBe(false)
    expect(gemini.createTurnDetector().supportsCompletionMarkers()).toBe(false)
  })

  // opencode's positional argument is a project DIRECTORY, so an argv-delivered
  // first message becomes a path and the launch dies before the engine is up
  // ("Failed to change directory to <cwd>/<the prompt>"). Same class as kimi,
  // same fix: the spawner pastes it instead. kilo is an opencode fork and
  // inherits the positional, so it inherits the fix.
  const PASTE_DELIVERY = ["opencode", "kilo"]
  it("the opencode family declares paste delivery; the rest keep the argv default", () => {
    const declared = CONTRIB_ENGINE_IDS.filter((id) => engineEntry(id).firstMessageDelivery !== undefined)
    expect(declared.sort()).toEqual([...PASTE_DELIVERY].sort())
    expect(PASTE_DELIVERY.map((id) => engineEntry(id).firstMessageDelivery)).toEqual(["paste", "paste"])
  })

  // First match wins, so a blocked rule after a working one could never fire.
  it.each(Object.entries(CONTRIB_ENGINES))("%s's manifest declares blocked rules before working rules", (_id, spec) => {
    expect(spec.screenManifest.rules.map((r) => r.state).join(" ")).not.toMatch(/working.*blocked/)
  })

  // Footers captured from opencode 0.6.3 (2026-09-04). It prints
  // `esc interrupt`, not the `esc to interrupt` the manifest used to look for,
  // so nothing matched and the badge stayed "unknown" for the tab's whole
  // life; and with no idle rule the badge could never come back down either.
  it("classifies opencode 0.6.3's real working and resting footers", () => {
    const oc = CONTRIB_ENGINES.opencode!.screenManifest
    expect(classifyScreen(oc, "Build claude-sonnet-4-20250514 (02:01 AM)working...  esc interrupt")).toBe("working")
    expect(classifyScreen(oc, "┃ >   ┃\n enter send \n opencode v0.6.3  /w tab ┃ BUILD AGENT")).toBe("idle")
    // A running turn draws BOTH footers; the working rule must win.
    expect(classifyScreen(oc, "enter send    Generating...\nworking...  esc interrupt")).toBe("working")
  })

  // Captured from cursor-agent 2026.04.17 booting in a never-seen git dir on
  // a machine with no Cursor login. Before this rule the login wall and a
  // healthy resting cursor screen produced the SAME classifier answer (null),
  // so "cannot run at all" was indistinguishable from "at rest".
  it("reads the cursor login wall as blocked, not as a resting engine", () => {
    const cursor = CONTRIB_ENGINES.cursor!.screenManifest
    const wall = "                    Cursor Agent\n  v2026.04.17-787b533\n  Press any key to log in..."
    expect(classifyScreen(cursor, wall)).toBe("blocked")
    // A running turn is still working — the new rule sits above it but only
    // fires on the wall's own words.
    expect(classifyScreen(cursor, "Generating...   esc to cancel")).toBe("working")
  })

  it.each<[string, string, "working" | "blocked"]>([
    ["gemini", "output…\nesc to cancel", "working"],
    ["gemini", "│ Apply this change\n❯ Yes", "blocked"],
    ["opencode", "△ Permission required", "blocked"],
    ["opencode", "thinking…\nesc to interrupt", "working"],
    ["cursor", "Run this command?\nProceed (y)", "blocked"],
    ["droid", "streaming…\nEsc to stop", "working"],
    ["amp", "Waiting for approval\nRun this command?", "blocked"],
    ["amp", "╰ agent thinking ─ 3s", "working"],
    ["grok", "⠧ Waiting on subagent… 2.8s [stop]", "working"],
    ["grok", "┃  2 (○) Yes, proceed", "blocked"],
  ])("classifies a representative %s screen %j", (id, capture, expected) => {
    expect(classifyScreen(CONTRIB_ENGINES[id]!.screenManifest, capture)).toBe(expected)
  })
})
