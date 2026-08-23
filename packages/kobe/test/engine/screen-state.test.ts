import { describe, expect, it } from "vitest"
import { COPILOT_SCREEN_MANIFEST } from "../../src/engine/copilot-local/screen.ts"
import { KIMI_SCREEN_MANIFEST } from "../../src/engine/kimi-local/screen.ts"
import { type EngineScreenManifest, classifyScreen } from "../../src/engine/screen-state.ts"

describe("classifyScreen", () => {
  const manifest: EngineScreenManifest = {
    rules: [
      { state: "blocked", all: ["proceed?"], any: ["yes", "❯"] },
      { state: "working", any: ["esc to interrupt"] },
    ],
  }

  it("first matching rule wins (blocked declared before working)", () => {
    const capture = "Do you want to proceed?\n❯ 1. Yes\n  2. No\nesc to interrupt"
    expect(classifyScreen(manifest, capture)).toBe("blocked")
  })

  it("matches case-insensitively over the bottom region", () => {
    expect(classifyScreen(manifest, "thinking…\nESC TO INTERRUPT")).toBe("working")
  })

  it("returns null when nothing matches (caller keeps previous state)", () => {
    expect(classifyScreen(manifest, "$ ls\nfile.txt")).toBeNull()
    expect(classifyScreen(manifest, "")).toBeNull()
  })

  it("only looks at the trailing bottomLines of the capture", () => {
    const rule: EngineScreenManifest = { rules: [{ state: "working", bottomLines: 2, any: ["spinner"] }] }
    const capture = `spinner up here\n${Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n")}`
    expect(classifyScreen(rule, capture)).toBeNull()
    expect(classifyScreen(rule, `${capture}\nspinner`)).toBe("working")
  })

  it("a rule with no conditions never matches", () => {
    expect(classifyScreen({ rules: [{ state: "idle" }] }, "anything")).toBeNull()
  })

  it("lineRegex matches per line, not across the joined region", () => {
    const rule: EngineScreenManifest = { rules: [{ state: "working", lineRegex: ["^\\s*⠋ thinking"] }] }
    expect(classifyScreen(rule, "  ⠋ thinking hard")).toBe("working")
    expect(classifyScreen(rule, "prefix ⠋ thinking")).toBeNull()
  })
})

describe("COPILOT_SCREEN_MANIFEST", () => {
  it("reads a selection dialog as blocked even while a cancel hint shows", () => {
    expect(classifyScreen(COPILOT_SCREEN_MANIFEST, "Choose an option\nEnter to select · Esc to cancel")).toBe("blocked")
  })
  it("reads a bare interrupt hint as working", () => {
    expect(classifyScreen(COPILOT_SCREEN_MANIFEST, "Working on it…\nEsc to cancel")).toBe("working")
  })
  it("stays silent on a plain shell", () => {
    expect(classifyScreen(COPILOT_SCREEN_MANIFEST, "$ git status\nclean")).toBeNull()
  })
})

describe("KIMI_SCREEN_MANIFEST", () => {
  it("reads the approval panel as blocked", () => {
    expect(classifyScreen(KIMI_SCREEN_MANIFEST, "Run this command?\n▶ Approve\n  Reject\n↵ confirm")).toBe("blocked")
  })
  it("reads the moon spinner as working", () => {
    expect(classifyScreen(KIMI_SCREEN_MANIFEST, "🌖\nsome output")).toBe("working")
  })
  it("reads a braille progress line as working", () => {
    expect(classifyScreen(KIMI_SCREEN_MANIFEST, "⠧ Thinking...")).toBe("working")
  })
})
