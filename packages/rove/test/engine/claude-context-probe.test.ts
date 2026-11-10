import { describe, expect, it } from "vitest"
import type { HistoryDeps } from "../../src/engine/claude-code-local/history.ts"
import { probeSessionContext, readUsageSnapshot } from "../../src/engine/claude-code-local/history.ts"

function deps(sessionId: string, raw: string): HistoryDeps {
  return {
    projectsDir: () => "/fake",
    readdir: async () => ["proj"],
    readFile: async (p) => {
      if (p !== `/fake/proj/${sessionId}.jsonl`) throw new Error("ENOENT")
      return raw
    },
    pathExists: async () => true,
  }
}

const turn = (model: string, input: number): string =>
  JSON.stringify({
    type: "assistant",
    cwd: "/work/repo",
    timestamp: "2026-01-01T00:00:01.000Z",
    message: { role: "assistant", model, content: "hi", usage: { input_tokens: input, output_tokens: 5 } },
  })

/** What `claude -p` prints for `get_context_usage`, trimmed to the fields read. */
const reply = (model: string): string =>
  [
    JSON.stringify({ type: "system", subtype: "init" }),
    JSON.stringify({
      type: "control_response",
      response: {
        subtype: "success",
        response: {
          model,
          rawMaxTokens: 200_000,
          categories: [
            { id: "system_prompt", name: "System prompt", tokens: 6_000, kind: "used" },
            { id: "mcp_tools_deferred", name: "MCP tools (deferred)", tokens: 38_000, kind: "deferred" },
            { id: "memory_files", name: "Memory files", tokens: 4_000, kind: "used" },
            { id: "messages", name: "Messages", tokens: 77_777, kind: "used" },
            { id: "free_space", name: "Free space", tokens: 1, kind: "free" },
          ],
          memoryFiles: [
            { path: "/work/repo/CLAUDE.md", tokens: 1_000 },
            { path: "/work/CLAUDE.md", tokens: 3_000 },
          ],
        },
      },
    }),
  ].join("\n")

describe("Claude context probe", () => {
  it("splits the transcript's context into Claude's own parts, messages being the remainder", async () => {
    const d = deps("probe-1", turn("claude-opus-5-5", 50_000))
    const asked: string[] = []
    await probeSessionContext("probe-1", d, async (sessionId, cwd, model) => {
      asked.push(`${sessionId}@${cwd}@${model}`)
      return reply("claude-opus-5-5[1m]")
    })
    expect(asked).toEqual(["probe-1@/work/repo@claude-opus-5-5"])
    const snapshot = await readUsageSnapshot("probe-1", d)
    expect(snapshot?.context_tokens).toBe(50_000)
    expect(snapshot?.context_window_tokens).toBe(200_000)
    expect(snapshot?.context_parts).toEqual([
      { key: "system_prompt", tokens: 6_000, label: "System prompt" },
      {
        key: "memory_files",
        tokens: 4_000,
        label: "Memory files",
        items: [
          { name: "/work/CLAUDE.md", tokens: 3_000 },
          { name: "/work/repo/CLAUDE.md", tokens: 1_000 },
        ],
      },
      { key: "messages", tokens: 40_000 },
      { key: "mcp_tools_deferred", tokens: 38_000, label: "MCP tools (deferred)", deferred: true },
    ])
  })

  it("keeps the parts but not the window when the probe came up on another model", async () => {
    const d = deps("probe-2", turn("claude-opus-5-5", 50_000))
    await probeSessionContext("probe-2", d, async () => reply("claude-sonnet-5-5"))
    const snapshot = await readUsageSnapshot("probe-2", d)
    expect(snapshot?.context_parts).toHaveLength(4)
    expect(snapshot?.context_window_tokens).toBeUndefined()
  })

  it("reports one total when the conversation shrank under the probed fixed parts", async () => {
    const d = deps("probe-3", turn("claude-opus-5-5", 9_000))
    await probeSessionContext("probe-3", d, async () => reply("claude-opus-5-5"))
    const snapshot = await readUsageSnapshot("probe-3", d)
    expect(snapshot?.context_tokens).toBe(9_000)
    expect(snapshot?.context_parts).toBeUndefined()
  })
})

describe("Claude context probe pacing", () => {
  it("does not start a second process for a session whose probe just came back empty", async () => {
    const d = deps("probe-4", turn("claude-opus-5-5", 50_000))
    let runs = 0
    const empty = async () => {
      runs++
      return ""
    }
    await probeSessionContext("probe-4", d, empty)
    await probeSessionContext("probe-4", d, empty)
    expect(runs).toBe(1)
  })
})
