/**
 * Bob Shell's screen rules, checked against PTY captures of 2.0.4 that were
 * re-verified word-for-word on 2.0.5.
 *
 * The negative case carries the weight: a false `blocked` lights Rove's
 * attention inbox and keeps it lit, which is worse than reading nothing
 * (`null` = keep the previous reading).
 */
import { describe, expect, it } from "vitest"
import { BOB_SCREEN_MANIFEST } from "../../src/engine/bob-local/screen.ts"
import { classifyScreen } from "../../src/engine/screen-state.ts"

describe("bob screen manifest", () => {
  const bob = BOB_SCREEN_MANIFEST

  // The composer footer Bob draws underneath every dialog and every streaming
  // turn, from a PTY capture of 2.0.4 (rules only ever read the last line; the
  // separators are shortened here).
  const FOOTER = [
    " ─────────────────────────────────────────────",
    "  ❯   Build Anything, @ for context, / for commands, $ for skills",
    " ─────────────────────────────────────────────",
    "  Agent Mode · 74.6k / 270.0k (28%) · 0.149",
  ]

  // Captured at 80x24, the tight case: the "Execute Command" header has already
  // scrolled out of the bottom-12 window, which is why the rule anchors on the
  // option list at the dialog's foot instead.
  it("reads the command-approval dialog as blocked", () => {
    const screen = [
      "  Execute Command",
      "  Command:          touch ./probe-small.txt",
      "  Approve commands:",
      "  │touch│",
      "  → Approve Once",
      "    Always Allow Command for task",
      "    Reject",
      "    ↑↓ (1/3)",
      "  Wait for input after execution: No (Tab to toggle)",
      "  Press Enter to confirm",
    ].join("\n")
    expect(classifyScreen(bob, screen)).toBe("blocked")
  })

  // An expired token parks Bob here; nothing on screen but a spinner, so
  // without a rule the task keeps its old badge and looks like it is resting.
  it("reads the browser sign-in wall as blocked", () => {
    const screen = ["  ∙∙● Complete sign-in in your browser…", "     (Press ESC or Ctrl+C to exit)"].join("\n")
    expect(classifyScreen(bob, screen)).toBe("blocked")
  })

  it("reads the first-run folder gate as blocked", () => {
    const screen = [
      "   Do you trust this folder?",
      "   Trusting a folder allows Bob Shell to execute commands it suggests.",
      "   → 1. Trust folder (hyena)",
      "     2. Trust parent folder (rove-c2566670e7c2)",
      "     3. Don't trust",
      "   Press ESC or CTRL+C to exit",
    ].join("\n")
    expect(classifyScreen(bob, screen)).toBe("blocked")
  })

  it("reads a streaming turn as working even though the idle footer is drawn", () => {
    const screen = ["   Branch splits from the trunk", " ⠸ Processing… (Enter to steer, Tab to queue)", ...FOOTER].join(
      "\n",
    )
    expect(classifyScreen(bob, screen)).toBe("working")
  })

  it("reads the resting composer as idle", () => {
    expect(classifyScreen(bob, ["• Branch splits from the trunk", ...FOOTER].join("\n"))).toBe("idle")
  })

  // The splash runs before the composer exists; claiming idle there would
  // report a task as ready to take work while Bob is still booting.
  it("does not classify the startup splash", () => {
    const screen = [
      "  ─────────────────── Version 2.0.4 ───────────────────",
      "                      Did you know?",
      "        Use Shift+Tab to cycle through modes",
      "                   ∙∙∙ Initializing…",
      "            (Press ESC or Ctrl+C to exit)",
    ].join("\n")
    expect(classifyScreen(bob, screen)).toBeNull()
  })
})
