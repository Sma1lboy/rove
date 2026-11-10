/**
 * The web Chat tab reads `output.read` history, which is the engines' neutral `Message[]`. These run RAW claude and
 * codex transcript lines through the real history parsers, then through the tab's own shaping, so a change in either
 * side's block format breaks here and not in a browser.
 */

import { describe, expect, it } from "vitest"
import {
  EMPTY,
  addPage,
  entryMarkdown,
  exportMarkdown,
  findEntries,
  hitIsOlder,
  locateHit,
} from "../../../rove-web/src/transcript-data.ts"
import { parseJsonl as parseClaude } from "../../src/engine/claude-code-local/history-parse.ts"
import { parseJsonl as parseCodex } from "../../src/engine/codex-local/history-parse.ts"

const SID = "11111111-2222-3333-4444-555555555555"
const line = (o: unknown) => JSON.stringify(o)

const CLAUDE = [
  line({
    type: "user",
    sessionId: SID,
    timestamp: "2026-11-06T10:00:00.000Z",
    message: { role: "user", content: "Why does the **login** test flake?" },
  }),
  line({
    type: "assistant",
    sessionId: SID,
    timestamp: "2026-11-06T10:00:05.000Z",
    message: {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "hmm", signature: "x" },
        { type: "text", text: "Let me run it.\n\n```sh\nnpm test\n```" },
        { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "npm test -- login", description: "Run" } },
      ],
    },
  }),
  line({
    type: "user",
    sessionId: SID,
    timestamp: "2026-11-06T10:00:09.000Z",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "FAIL", is_error: true }],
    },
  }),
  line({
    type: "assistant",
    sessionId: SID,
    timestamp: "2026-11-06T10:00:20.000Z",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "It races on the **clock**; fixed in `login.ts`." }],
    },
  }),
].join("\n")

const CODEX = [
  line({
    type: "response_item",
    timestamp: "2026-11-06T11:00:00Z",
    payload: { type: "message", role: "user", content: [{ type: "input_text", text: "List the files" }] },
  }),
  line({ type: "response_item", timestamp: "2026-11-06T11:00:01Z", payload: { type: "reasoning", text: "thinking" } }),
  line({
    type: "response_item",
    timestamp: "2026-11-06T11:00:02Z",
    payload: { type: "function_call", call_id: "c1", name: "shell", arguments: '{"command":["ls","-la"]}' },
  }),
  line({
    type: "response_item",
    timestamp: "2026-11-06T11:00:03Z",
    payload: { type: "function_call_output", call_id: "c1", output: "a.ts\nb.ts" },
  }),
  line({
    type: "response_item",
    timestamp: "2026-11-06T11:00:04Z",
    payload: {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "Two files: a.ts and b.ts." }],
    },
  }),
].join("\n")

describe("the Chat tab over a claude transcript", () => {
  const t = addPage(EMPTY, parseClaude(CLAUDE, SID), 0)

  it("keeps user and assistant prose, folds each tool call to one line, and drops thinking and tool-result turns", () => {
    expect(t.entries.map((e) => [e.role, e.text.split("\n")[0]])).toEqual([
      ["user", "Why does the **login** test flake?"],
      ["assistant", "Let me run it."],
      ["assistant", "It races on the **clock**; fixed in `login.ts`."],
    ])
    expect(t.entries[1]?.tools).toEqual([{ callId: "toolu_1", name: "Bash", summary: "npm test -- login" }])
  })

  it("marks the call whose result came back as an error", () => {
    expect(t.failed.has("toolu_1")).toBe(true)
    expect(entryMarkdown(t.entries[1] as never, t.failed)).toContain("- `Bash` npm test -- login (failed)")
  })

  it("finds a word in prose or a tool line, and a palette hit lands on the message it quoted", () => {
    expect(findEntries(t.entries, "npm test")).toEqual([1])
    expect(findEntries(t.entries, "CLOCK")).toEqual([3])
    const hit = { at: "2026-11-06T10:00:20.000Z", role: "assistant", snippet: "…races on the clock…" }
    expect(locateHit(t.entries, hit)).toBe(3)
    expect(locateHit(t.entries, { ...hit, at: "elsewhere" })).toBe(3)
    expect(hitIsOlder(t.entries.slice(1), { ...hit, at: "2026-11-06T09:00:00.000Z" })).toBe(true)
  })

  it("exports the thread as Markdown with a heading per message", () => {
    const md = exportMarkdown("Login flake", t.entries, t.failed, { user: "You", assistant: "Agent", system: "System" })
    expect(md.startsWith("# Login flake\n\n## You · 2026-11-06T10:00:00.000Z\n\nWhy does")).toBe(true)
    expect(md).toContain("## Agent · 2026-11-06T10:00:20.000Z")
  })
})

describe("the Chat tab over a codex transcript", () => {
  const t = addPage(EMPTY, parseCodex(CODEX, SID), 10)

  it("reads the same neutral blocks: prose, one-line tool calls, indexes counted from the page's firstIndex", () => {
    const ui = t.entries.map((e) => [e.index, e.role, e.text, e.tools.map((x) => `${x.name} ${x.summary}`)])
    expect(ui).toEqual([
      [10, "user", "List the files", []],
      [12, "assistant", "", ["shell ls -la"]],
      [14, "assistant", "Two files: a.ts and b.ts.", []],
    ])
  })

  it("merges a later page by index without duplicating, and an older page in front", () => {
    const newer = addPage(t, parseCodex(CODEX.split("\n").slice(4).join("\n"), SID), 14)
    expect(newer.entries.map((e) => e.index)).toEqual([10, 12, 14])
    const older = addPage(t, parseClaude(CLAUDE, SID), 0)
    expect(older.entries.map((e) => e.index)).toEqual([0, 1, 3, 10, 12, 14])
  })
})
