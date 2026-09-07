import { describe, expect, it } from "vitest"
import { CONTRIB_ENGINES, CONTRIB_ENGINE_IDS, isContribEngine } from "../../src/engine/contrib-engines.ts"
import { engineEntry } from "../../src/engine/registry.ts"
import { classifyScreen } from "../../src/engine/screen-state.ts"
import { isBuiltinVendor } from "../../src/types/vendor.ts"

describe("contrib engine catalog", () => {
  it("no contrib id shadows a built-in", () => {
    for (const id of CONTRIB_ENGINE_IDS) expect(isBuiltinVendor(id)).toBe(false)
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

  it("a non-catalog custom id keeps the plain custom entry", () => {
    expect(isContribEngine("my-aider")).toBe(false)
    const entry = engineEntry("my-aider")
    expect(entry.displayName).toBe("my-aider")
    expect(entry.screenManifest).toBeUndefined()
  })

  // opencode's positional argument is a project DIRECTORY, so an argv-delivered
  // first message becomes a path and the launch dies before the engine is up
  // ("Failed to change directory to <cwd>/<the prompt>"). Same class as kimi,
  // same fix: the spawner pastes it instead.
  it("opencode declares paste delivery; the rest keep the argv default", () => {
    expect(engineEntry("opencode").firstMessageDelivery).toBe("paste")
    for (const id of CONTRIB_ENGINE_IDS) {
      if (id === "opencode") continue
      expect(engineEntry(id).firstMessageDelivery, id).toBeUndefined()
    }
  })

  it("every catalog manifest declares blocked rules before working rules", () => {
    for (const [id, spec] of Object.entries(CONTRIB_ENGINES)) {
      const states = spec.screenManifest.rules.map((r) => r.state)
      const lastBlocked = states.lastIndexOf("blocked")
      const firstWorking = states.indexOf("working")
      if (lastBlocked >= 0 && firstWorking >= 0) {
        expect(lastBlocked, `${id}: blocked rules must precede working (first match wins)`).toBeLessThan(firstWorking)
      }
    }
  })

  // Footers captured from opencode 0.6.3 (2026-09-04). It prints
  // `esc interrupt`, not the `esc to interrupt` the manifest used to look for,
  // so nothing matched and the badge stayed "unknown" for the tab's whole
  // life; and with no idle rule the badge could never come back down either.
  it("classifies opencode 0.6.3's real working and resting footers", () => {
    const oc = CONTRIB_ENGINES.opencode?.screenManifest
    expect(oc).toBeDefined()
    if (!oc) return
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
    const cursor = CONTRIB_ENGINES.cursor?.screenManifest
    expect(cursor).toBeDefined()
    if (!cursor) return
    const wall = "                    Cursor Agent\n  v2026.04.17-787b533\n  Press any key to log in..."
    expect(classifyScreen(cursor, wall)).toBe("blocked")
    // A running turn is still working — the new rule sits above it but only
    // fires on the wall's own words.
    expect(classifyScreen(cursor, "Generating...   esc to cancel")).toBe("working")
  })

  it("classifies representative screens (spot checks per engine)", () => {
    const cases: ReadonlyArray<[string, string, "working" | "blocked"]> = [
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
    ]
    for (const [id, capture, expected] of cases) {
      const manifest = CONTRIB_ENGINES[id]?.screenManifest
      expect(manifest, id).toBeDefined()
      if (manifest) expect(classifyScreen(manifest, capture), `${id}: ${capture}`).toBe(expected)
    }
  })
})
