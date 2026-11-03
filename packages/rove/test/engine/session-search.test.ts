import { describe, expect, it, vi } from "vitest"
import { type SearchableTask, matchMessages, prefilterToken, searchTasks } from "../../src/engine/session-search.ts"
import type { Message } from "../../src/types/engine.ts"

const fake = vi.hoisted(() => ({ sessions: new Map<string, readonly unknown[]>(), tabs: new Map<string, string[]>() }))

vi.mock("../../src/cli/api/tab-snapshot.ts", () => ({
  readTabsSnapshot: (taskId: string) => ({
    tabs: (fake.tabs.get(taskId) ?? []).map((sessionId) => ({ id: `tab-${sessionId}`, kind: "engine", sessionId })),
  }),
}))
vi.mock("../../src/engine/registry.ts", () => ({ supportsStructuredHistory: () => true }))
vi.mock("../../src/engine/engine-presets.ts", () => ({
  sessionProtocol: (v: string) => v,
  protocolEntry: () => ({
    history: {
      listSessionIdsForWorktree: async () => [],
      readHistory: async (id: string) => fake.sessions.get(id) ?? [],
      transcriptPath: async () => null,
      latestTranscriptMtimeForWorktree: async () => 0,
    },
  }),
}))

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

describe("searchTasks", () => {
  const task = (id: string): SearchableTask => ({
    id,
    title: id,
    repo: "/r",
    worktreePath: `/w/${id}`,
    vendor: "claude",
  })
  const said = (text: string): readonly Message[] => [msg("user", [{ type: "text", text }])]

  // The page is full after two sessions, so the third is never read: the page must say it is partial.
  it("reports a partial page when the limit stops the scan inside its last batch", async () => {
    fake.tabs.set("t1", ["a", "b", "c"])
    for (const id of ["a", "b", "c"]) fake.sessions.set(id, said("deploy the relay"))
    const result = await searchTasks([task("t1")], "relay", 2)
    expect(result.matches).toHaveLength(2)
    expect(result.truncated).toBe(true)
  })

  it("matches a query typed with extra spaces against prose that wraps across lines", async () => {
    fake.tabs.set("t2", ["d"])
    fake.sessions.set("d", said("rotate the\n  signing key today"))
    const result = await searchTasks([task("t2")], "the   signing", 5)
    expect(result.matches.map((m) => m.snippet)).toEqual(["rotate the signing key today"])
    expect(result.truncated).toBe(false)
  })
})
