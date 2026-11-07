import { describe, expect, it } from "vitest"
import { parseJsonl } from "../../src/engine/claude-code-local/history.ts"
import { isSyntheticClaudeRecord } from "../../src/engine/claude-code-local/synthetic.ts"

/**
 * Claude persists injected rows (the local-command caveat as `isMeta`, the
 * `<command-name>` slash-command breadcrumb as a plain user record) BEFORE the
 * real prompt. They must be dropped from the neutral Message[] so auto-title
 * names a task from the user's actual first prompt, not the boilerplate —
 * mirroring Claude Code's own human-turn filter.
 */

describe("isSyntheticClaudeRecord", () => {
  it("flags isMeta and isCompactSummary records", () => {
    expect(isSyntheticClaudeRecord({ isMeta: true })).toBe(true)
    expect(isSyntheticClaudeRecord({ isCompactSummary: true })).toBe(true)
  })
})

describe("parseJsonl ignores API request snapshots", () => {
  it("reads the typed prompt once, not again from the request blob that repeats it", () => {
    const raw = [
      JSON.stringify({ type: "user", message: { role: "user", content: "add a --json flag" } }),
      JSON.stringify({
        type: "api-request-blob",
        message: {
          role: "user",
          content: [
            { type: "text", text: "<system-reminder>context</system-reminder>" },
            { type: "text", text: "add a --json flag" },
          ],
        },
      }),
      JSON.stringify({
        type: "api-request-blob",
        message: { role: "system", content: [{ type: "text", text: "hook output" }] },
      }),
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "done" }] } }),
    ].join("\n")
    expect(parseJsonl(raw, "s1").map((m) => m.role)).toEqual(["user", "assistant"])
  })
})

describe("parseJsonl drops synthetic first rows", () => {
  it("skips the caveat + command breadcrumb so the real prompt is first", () => {
    const raw = [
      JSON.stringify({
        type: "user",
        isMeta: true,
        message: { role: "user", content: "<local-command-caveat>Caveat: …</local-command-caveat>" },
      }),
      JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: "<command-name>/model</command-name><command-message>model</command-message>",
        },
      }),
      JSON.stringify({ type: "user", message: { role: "user", content: "actually fix the parser" } }),
    ].join("\n")
    const messages = parseJsonl(raw, "s1")
    expect(messages).toHaveLength(1)
    expect(messages[0].blocks).toEqual([{ type: "text", text: "actually fix the parser" }])
  })

  it("keeps a normal first user prompt untouched", () => {
    const raw = JSON.stringify({ type: "user", message: { role: "user", content: "hello world" } })
    expect(parseJsonl(raw, "s1")[0]?.blocks).toEqual([{ type: "text", text: "hello world" }])
  })

  // 630 of an owner's user blocks were injected CLAUDE.md context: every search for a common word,
  // and every read of "what did the user say", matched them.
  it("drops wholly injected <system-reminder> text, keeping what the user typed beside it", () => {
    const reminder = { type: "text", text: "<system-reminder>\nContents of CLAUDE.md …\n</system-reminder>" }
    const raw = [
      JSON.stringify({ type: "user", message: { role: "user", content: [reminder] } }),
      JSON.stringify({
        type: "user",
        message: { role: "user", content: [reminder, { type: "text", text: "fix it" }] },
      }),
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [reminder] } }),
    ].join("\n")
    const messages = parseJsonl(raw, "s1")
    expect(messages.map((m) => [m.role, m.blocks])).toEqual([
      ["user", [{ type: "text", text: "fix it" }]],
      ["assistant", [reminder]],
    ])
  })
})
