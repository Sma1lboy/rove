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
