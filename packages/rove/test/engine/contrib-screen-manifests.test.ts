/**
 * Translation fidelity for the four screen-only contrib engines — cline,
 * kiro, maki, antigravity — whose rules were written from each CLI's
 * documented interface rather than a capture (none of the four CLIs was
 * installed where they were written).
 *
 * The negative cases carry the weight. The blocked judgement is deliberately
 * strict — it only claims `blocked` when a known approval or question UI is
 * on screen — because: a false `blocked` lights Rove's attention inbox and keeps it lit,
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

  // Both blocked rules are conjunctions: the approval banner without its
  // option list, and the subagent banner without its actions, classify as
  // nothing.
  it("does not claim blocked on an approval banner with no options", () => {
    expect(classifyScreen(kiro, "Using tool: executeBash (requires approval)\n   ⋮ npm test")).toBeNull()
    expect(classifyScreen(kiro, "2 tool approvals pending from subagents")).toBeNull()
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

  // Documented gap: the narrow-pane idle fallback needs two `not` gates the
  // classifier cannot express, so it was dropped — a bare chevron reports
  // nothing rather than a possibly-wrong idle.
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
})

describe("devin screen manifest", () => {
  const devin = manifest("devin")

  it("reads the trust prompt and a permission dialog as blocked", () => {
    expect(classifyScreen(devin, "Do you trust the authors of this directory?\n  Yes, trust this folder\n  No")).toBe(
      "blocked",
    )
    expect(classifyScreen(devin, "Run `rm -rf build`?\n  Approve once   Select   Confirm   esc cancel")).toBe("blocked")
  })

  it("reads all three working signals", () => {
    expect(classifyScreen(devin, "Running tools…\n  esc to interrupt")).toBe("working")
    expect(classifyScreen(devin, "❭ Guide Devin while it works")).toBe("working")
    expect(classifyScreen(devin, "Reading shell output\n  timeout: 30s")).toBe("working")
  })

  it("reads the welcome and live prompt footers as idle", () => {
    expect(classifyScreen(devin, "❭ Ask Devin to build features, fix bugs, or explain your code")).toBe("idle")
    expect(classifyScreen(devin, "❭ \n  context: 12%")).toBe("idle")
  })

  // Order stands in for the `not` gates the classifier lacks: an approval on
  // screen must win over the prompt footer still drawn underneath it.
  it("keeps blocked and working ahead of the idle footers", () => {
    expect(classifyScreen(devin, "Approve once   Select   Confirm   esc cancel\n❭ \n  context: 12%")).toBe("blocked")
    expect(classifyScreen(devin, "Running tools…\n  esc to interrupt\n❭ \n  context: 12%")).toBe("working")
  })

  it("does not claim blocked on a trust banner with no answer row", () => {
    expect(classifyScreen(devin, "Do you trust the authors of this directory?")).toBeNull()
    expect(classifyScreen(devin, "Devin CLI v2.1")).toBeNull()
  })
})

describe("qodercli screen manifest", () => {
  const qodercli = manifest("qodercli")

  it("reads each approval shape as blocked", () => {
    expect(classifyScreen(qodercli, "Waiting for user confirmation\n  [y] Yes  [n] No")).toBe("blocked")
    expect(classifyScreen(qodercli, "Awaiting approval\n  Allow / Reject")).toBe("blocked")
    expect(classifyScreen(qodercli, "Permission required")).toBe("blocked")
    expect(classifyScreen(qodercli, "Allow once or always?")).toBe("blocked")
    expect(classifyScreen(qodercli, "Shell awaiting input")).toBe("blocked")
  })

  it("reads the cancel hint and the spinner as working", () => {
    expect(classifyScreen(qodercli, "Thinking… (esc to cancel, 12s)")).toBe("working")
    expect(classifyScreen(qodercli, "⠸ Editing src/app.ts")).toBe("working")
  })

  // A confirmation banner with no answer row is not an approval UI, and a
  // bare braille cell with no text beside it is not a spinner.
  it("does not claim blocked or working on a half-drawn screen", () => {
    expect(classifyScreen(qodercli, "Waiting for user confirmation")).toBeNull()
    expect(classifyScreen(qodercli, "Awaiting approval")).toBeNull()
    expect(classifyScreen(qodercli, "⠸")).toBeNull()
    expect(classifyScreen(qodercli, "> ")).toBeNull()
  })
})
