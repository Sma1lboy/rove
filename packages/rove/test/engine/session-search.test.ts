import { describe, expect, it } from "vitest"
import { matchMessages, prefilterToken } from "../../src/engine/session-search.ts"
import type { Message } from "../../src/types/engine.ts"

const msg = (role: Message["role"], blocks: Message["blocks"], at = "2026-11-01T00:00:00Z"): Message => ({
  role,
  blocks,
  timestamp: at,
  sessionId: "s1",
})

describe("search matching", () => {
  // Tool calls and their output mention nearly every word; a hit there is not something anyone said.
  it("finds prose in user and assistant turns only, case-insensitively, never tool traffic", () => {
    const messages: Message[] = [
      msg("user", [{ type: "text", text: "Please fix the Rotate-Token banner" }]),
      msg("assistant", [{ type: "tool_call", callId: "c", name: "Bash", input: { command: "grep rotate-token" } }]),
      msg("user", [{ type: "tool_result", callId: "c", output: "rotate-token found", isError: false }]),
      msg("system", [{ type: "text", text: "rotate-token" }]),
      msg("assistant", [{ type: "text", text: "Done: rotate-token now revokes devices." }], "2026-11-01T00:01:00Z"),
    ]
    expect(matchMessages(messages, "rotate-token", 10)).toEqual([
      { role: "user", at: "2026-11-01T00:00:00Z", snippet: "Please fix the Rotate-Token banner" },
      { role: "assistant", at: "2026-11-01T00:01:00Z", snippet: "Done: rotate-token now revokes devices." },
    ])
  })

  it("stops at the cap and trims a long turn to the text around the hit", () => {
    const long = `${"a ".repeat(200)}needle${" b".repeat(200)}`
    const hits = matchMessages(
      [msg("user", [{ type: "text", text: long }]), msg("user", [{ type: "text", text: "needle" }])],
      "needle",
      1,
    )
    expect(hits).toHaveLength(1)
    expect(hits[0]?.snippet.startsWith("…")).toBe(true)
    expect(hits[0]?.snippet.endsWith("…")).toBe(true)
    expect(hits[0]?.snippet.length).toBeLessThan(140)
  })

  // A transcript is JSONL: `say "hi"` is stored as `say \"hi\"`, so the file prefilter must look for
  // a piece the file holds verbatim or it drops a session that matches.
  it("prefilters on the longest piece a JSONL file stores verbatim", () => {
    expect(prefilterToken('the "quoted" thing')).toBe("quoted")
    expect(prefilterToken("C:\\Users\\rove")).toBe("Users")
    expect(prefilterToken("推送通知")).toBe("推送通知")
  })
})
