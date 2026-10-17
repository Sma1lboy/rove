/**
 * Screen-rule translation for the two catalog entries added alongside their
 * hook adapters — hermes and kilo. Neither CLI was installed where these were
 * written, so the rules come from each CLI's documented pane vocabulary rather
 * than a capture, and the NEGATIVE cases carry the weight.
 *
 * A false `blocked` lights Rove's attention inbox and keeps it lit, which is
 * worse than reading nothing at all (`null` = keep the previous reading). So
 * every blocked rule is a conjunction, and these pin that each half is really
 * required.
 */

import { CONTRIB_ENGINES } from "@/engine/contrib-engines"
import { type EngineScreenManifest, classifyScreen } from "@/engine/screen-state"
import { describe, expect, it } from "vitest"

function manifest(id: string): EngineScreenManifest {
  const found = CONTRIB_ENGINES[id]?.screenManifest
  if (!found) throw new Error(`no screen manifest for ${id}`)
  return found
}

describe("hermes screen manifest", () => {
  const hermes = manifest("hermes")

  it("reads a dangerous-command approval as blocked", () => {
    expect(
      classifyScreen(
        hermes,
        ["This command is dangerous:", "  rm -rf /tmp/build", "↑/↓ to select   enter confirm"].join("\n"),
      ),
    ).toBe("blocked")
  })

  it("reads a clarification prompt and a confirmation dialog as blocked", () => {
    expect(classifyScreen(hermes, "Hermes needs your input:\n  Which branch?\n  press enter to send")).toBe("blocked")
    expect(classifyScreen(hermes, "Approve once, or cancel?\n  type 1/2/3")).toBe("blocked")
  })

  // A credential ask has no option list to gate on, so the ask itself is the
  // signal — but the key glyph still has to be paired with its subject.
  it("reads a credential prompt as blocked without needing a key hint", () => {
    expect(classifyScreen(hermes, "sudo password required to continue")).toBe("blocked")
    expect(classifyScreen(hermes, "\u{1F511} for anthropic api")).toBe("blocked")
  })

  it("reads a streaming turn as working", () => {
    expect(classifyScreen(hermes, "Editing src/app.ts…\n  ctrl+c to interrupt")).toBe("working")
    expect(classifyScreen(hermes, "Thinking…\n  ctrl+c cancel")).toBe("working")
  })

  // The trigger words appear in ordinary output all the time; without a dialog
  // footer beside them there is no dialog, and claiming one would pin the
  // attention inbox on nothing.
  it("does not claim blocked on a trigger word with no dialog footer", () => {
    expect(classifyScreen(hermes, "I'll skip that — running it would be dangerous.")).toBeNull()
    expect(classifyScreen(hermes, "The approval workflow lives in .github/workflows.")).toBeNull()
    expect(classifyScreen(hermes, "Read the \u{1F511} emoji docs")).toBeNull()
  })

  // …and a footer with no trigger is just a picker, not an approval.
  it("does not claim blocked on a bare footer hint", () => {
    expect(classifyScreen(hermes, "Pick a file\n  ↑/↓ to select   enter confirm")).toBeNull()
  })

  // Hermes states its resting phase in the terminal TITLE, which this
  // classifier cannot see; `null` keeps whatever was last read.
  it("answers null on a resting screen (no idle rule, by design)", () => {
    expect(classifyScreen(hermes, "Hermes Agent v2.1\n❯ ")).toBeNull()
  })
})

describe("kilo screen manifest", () => {
  const kilo = manifest("kilo")

  it("reads the permission banner as blocked", () => {
    expect(classifyScreen(kilo, "△ Permission required\n  write src/app.ts")).toBe("blocked")
  })

  it("reads a selection dialog as blocked when the navigation hint is there too", () => {
    expect(classifyScreen(kilo, "Choose a tool\n  ↑↓ select   enter confirm   esc dismiss")).toBe("blocked")
    expect(classifyScreen(kilo, "Choose a tool\n  ⇆ tab   enter toggle   esc dismiss")).toBe("blocked")
  })

  it("reads a running turn as working", () => {
    expect(classifyScreen(kilo, "working...   esc interrupt")).toBe("working")
  })

  // The dialog rule is a three-way conjunction; dropping any one of the parts
  // has to stop it matching, or a half-drawn frame becomes a false blocker.
  it("does not claim blocked on a partial dialog", () => {
    expect(classifyScreen(kilo, "Choose a tool\n  enter confirm   esc dismiss")).toBeNull()
    expect(classifyScreen(kilo, "Choose a tool\n  ↑↓ select   esc dismiss")).toBeNull()
    expect(classifyScreen(kilo, "Choose a tool\n  ↑↓ select   enter confirm")).toBeNull()
  })

  it("answers null on a resting screen (no idle rule, by design)", () => {
    expect(classifyScreen(kilo, "Kilo\n❯ type a message")).toBeNull()
  })
})

describe("mastracode catalog entry", () => {
  // Not an omission: its hooks report the full turn lifecycle, so there is
  // nothing for the poll to add and no bottom-bar vocabulary was pinned down
  // to translate. `null` is the honest answer for every screen.
  it("declares no screen rules and classifies nothing", () => {
    const mastracode = manifest("mastracode")
    expect(mastracode.rules).toEqual([])
    expect(classifyScreen(mastracode, "anything at all\n  esc to cancel")).toBeNull()
  })
})
