/**
 * Translation fidelity for the four screen-only contrib engines — cline,
 * kiro, maki, antigravity — whose rules come from refs/herdr's
 * src/detect/manifests/*.toml rather than a capture (none of the four CLIs
 * was installed where they were written).
 *
 * The negative cases carry the weight. herdr's blocked judgement is
 * deliberately strict — it only claims `blocked` when a known approval or
 * question UI is on screen and falls back to idle otherwise — and this keeps
 * that: a false `blocked` lights Rove's attention inbox and keeps it lit,
 * which is worse than reading nothing at all (`null` = keep the previous
 * reading).
 */
import { describe, expect, it } from "vitest"
import { CONTRIB_ENGINES } from "../../src/engine/contrib-engines.ts"
import { type EngineScreenManifest, classifyScreen } from "../../src/engine/screen-state.ts"

function manifest(id: string): EngineScreenManifest {
  const found = CONTRIB_ENGINES[id]?.screenManifest
  if (!found) throw new Error(`no screen manifest for ${id}`)
  return found
}

describe("cline screen manifest", () => {
  const cline = manifest("cline")

  it("reads a tool-permission prompt as blocked", () => {
    expect(classifyScreen(cline, "Let Cline use this tool: read_file(src/app.ts)?")).toBe("blocked")
    expect(
      classifyScreen(cline, "[ACT MODE]\nCline wants to run a command:\n  npm run build\nExecute command?\n❯ Yes  No"),
    ).toBe("blocked")
    expect(classifyScreen(cline, "[PLAN MODE]\nUse this tool?\n❯ Yes  No")).toBe("blocked")
  })

  // The mode banner alone is not an approval UI, and neither is a half-drawn
  // dialog — both must stay unclassified rather than become a false blocker.
  it("does not claim blocked on a mode banner or a dialog missing its answer", () => {
    expect(classifyScreen(cline, "[ACT MODE]\nReading src/app.ts…")).toBeNull()
    expect(classifyScreen(cline, "Execute command?\n  npm run build")).toBeNull()
  })

  // Documented gap: herdr's `default_cline_working` is a catch-all
  // (`regex = '(?s).+'`) it can afford because that rule is only a hint its
  // state machine weighs. Here the classifier's answer IS the badge, so the
  // catch-all was dropped and cline has no working/idle rule at all.
  it("answers null on working and resting screens (no rule, by design)", () => {
    expect(classifyScreen(cline, "Cline is editing src/app.ts…\nesc to cancel")).toBeNull()
    expect(classifyScreen(cline, "Cline v3.2.1\n❯ Type a message")).toBeNull()
  })
})

describe("kiro screen manifest", () => {
  const kiro = manifest("kiro")

  it("reads the tool-approval dialog as blocked", () => {
    const screen = [
      "Using tool: executeBash (requires approval)",
      "   ⋮ npm test",
      " ❯ Yes, single permission",
      "   Trust, always allow",
      "   No (tab to edit)",
    ].join("\n")
    expect(classifyScreen(kiro, screen)).toBe("blocked")
  })

  it("reads a subagent approval queue as blocked", () => {
    const screen = [
      "2 tool approvals pending from subagents",
      "  [a] Approve all pending",
      "  [c] Configure individually",
      "  [e] Exit (cancel subagents)",
    ].join("\n")
    expect(classifyScreen(kiro, screen)).toBe("blocked")
  })

  it("reads both working signals", () => {
    expect(classifyScreen(kiro, "Kiro is working on your request…")).toBe("working")
    expect(classifyScreen(kiro, "◑ Searching the workspace\n  esc to cancel")).toBe("working")
  })

  // Both blocked rules are conjunctions in herdr too: the approval banner
  // without its option list, and the subagent banner without its actions,
  // classify as nothing.
  it("does not claim blocked on an approval banner with no options", () => {
    expect(classifyScreen(kiro, "Using tool: executeBash (requires approval)\n   ⋮ npm test")).toBeNull()
    expect(classifyScreen(kiro, "2 tool approvals pending from subagents")).toBeNull()
  })

  it("does not claim working on a bare cancel hint or a resting prompt", () => {
    // The spinner glyph is half of the conjunction; `esc to cancel` alone is
    // drawn by other kiro screens too.
    expect(classifyScreen(kiro, "esc to cancel")).toBeNull()
    expect(classifyScreen(kiro, "kiro-cli 1.4.0\n> ")).toBeNull()
  })
})

describe("maki screen manifest", () => {
  const maki = manifest("maki")

  it("reads each permission-prompt shape as blocked", () => {
    expect(classifyScreen(maki, " Permission required\n Run: rm -rf build\n y allow · n deny")).toBe("blocked")
    expect(classifyScreen(maki, " Permission required\n ❯ Confirm allow")).toBe("blocked")
    expect(classifyScreen(maki, " Permission required\n enter deny · esc cancel")).toBe("blocked")
  })

  it("reads the plan-complete form as blocked", () => {
    expect(classifyScreen(maki, " Plan complete — 4 steps\n space toggle parallel · enter confirm")).toBe("blocked")
  })

  it("reads the status bar: spinner is working, bare mode label is idle", () => {
    expect(classifyScreen(maki, "assistant output\n ⠋ [BUILD] main · 12s · 3.1k")).toBe("working")
    expect(classifyScreen(maki, "assistant output\n [BUILD] main · ready")).toBe("idle")
  })

  // The idle rule reads the bottom row only, and sits below the spinner rule,
  // so a streaming pane can never fall through to idle.
  it("never reads a streaming pane as idle", () => {
    const streaming = " [PLAN] main · ready\n ⠹ [PLAN] main · 2s"
    expect(classifyScreen(maki, streaming)).toBe("working")
  })

  // Documented gap: herdr's `prompt_box_idle` narrow-pane fallback needs two
  // `not` gates the classifier cannot express, so it was dropped — a bare
  // chevron reports nothing rather than a possibly-wrong idle.
  it("answers null on the prompt chevron alone (dropped narrow-pane rule)", () => {
    expect(classifyScreen(maki, "assistant output\n❯ ")).toBeNull()
    expect(classifyScreen(maki, "Permission required")).toBeNull()
    // A status bar scrolled out from under an overlay is stale: both status
    // rules read the bottom row only, so this is null, not idle.
    expect(classifyScreen(maki, " [BUILD] main · ready\nSelect a file\n❯ ")).toBeNull()
  })
})

describe("antigravity screen manifest", () => {
  const agy = manifest("antigravity")

  it("reads a permission request as blocked", () => {
    expect(
      classifyScreen(agy, "Requesting permission for: run_command\n  $ git push --force\nDo you want to proceed?"),
    ).toBe("blocked")
    expect(classifyScreen(agy, "Requesting permission for: run_command\n ⏎ run   tab amend   e edit command")).toBe(
      "blocked",
    )
  })

  it("reads the spinner and the background-task counter as working", () => {
    expect(classifyScreen(agy, "⠹ Analyzing the repository")).toBe("working")
    expect(classifyScreen(agy, "❯ \n · 2 tasks running")).toBe("working")
  })

  it("does not claim blocked on a permission banner with no answer row", () => {
    expect(classifyScreen(agy, "Requesting permission for: run_command\n  $ git push --force")).toBeNull()
  })

  it("does not claim working on a resting pane or a zero task count", () => {
    expect(classifyScreen(agy, "Antigravity 0.4.0\n❯ ")).toBeNull()
    expect(classifyScreen(agy, "❯ \n · 0 tasks running")).toBeNull()
  })
})
