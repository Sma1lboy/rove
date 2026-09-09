import { describe, expect, it } from "vitest"
import type { HistoryDeps } from "../../src/engine/claude-code-local/history.ts"
import { readUsageSnapshot } from "../../src/engine/claude-code-local/history.ts"

/**
 * `readUsageSnapshot` is where Claude's vendor-specific usage math lives:
 * session totals are the sums of the per-turn usage Claude persists inline,
 * and "context" is the LAST turn's full prompt (fresh input + cache read +
 * cache creation). Neutral layers (the web transcript header) render this
 * snapshot verbatim — they must never re-derive the arithmetic from
 * per-message fields, and they must be able to tell "no usage reported"
 * (undefined) apart from a reported zero.
 */

function record(ts: string, usage: Record<string, number> | undefined, id?: string): string {
  const message: Record<string, unknown> = { role: "assistant", content: "turn" }
  if (id) message.id = id
  if (usage) message.usage = usage
  return JSON.stringify({ type: "assistant", message, timestamp: ts, sessionId: "s1" })
}

function fakeDeps(name: string, sessionId: string, raw: string): HistoryDeps {
  const root = `/fake-${name}`
  return {
    projectsDir: () => root,
    readdir: async () => ["proj"],
    readFile: async (p) => {
      if (p !== `${root}/proj/${sessionId}.jsonl`) throw new Error("ENOENT")
      return raw
    },
    pathExists: async () => true,
  }
}

describe("readUsageSnapshot", () => {
  it("sums session totals and takes the last turn's full prompt as context", async () => {
    const raw = [
      record("2026-01-01T00:00:01.000Z", { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 5 }),
      record("2026-01-01T00:00:02.000Z", {
        input_tokens: 200,
        output_tokens: 40,
        cache_read_input_tokens: 1000,
        cache_creation_input_tokens: 50,
      }),
    ].join("\n")
    expect(await readUsageSnapshot("s1", fakeDeps("agg", "s1", raw))).toEqual({
      input_tokens: 300,
      output_tokens: 60,
      cache_read_input_tokens: 1005,
      cache_creation_input_tokens: 50,
      // context = LAST turn only: 200 + 1000 + 50
      context_tokens: 1250,
      context_tokens_approximate: true,
    })
  })

  it("counts a message once even when Claude splits it across block records", async () => {
    // One assistant message (id m1) persisted as three block records — thinking,
    // tool_use, text — each carrying the IDENTICAL message.usage. A second
    // message (id m2) is the final turn. Summing per record would triple m1;
    // folding by message id counts each once, and context is m2's prompt alone.
    const usage1 = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 5000 }
    const usage2 = {
      input_tokens: 200,
      output_tokens: 40,
      cache_read_input_tokens: 6000,
      cache_creation_input_tokens: 50,
    }
    const raw = [
      record("2026-01-01T00:00:01.000Z", usage1, "m1"),
      record("2026-01-01T00:00:01.100Z", usage1, "m1"),
      record("2026-01-01T00:00:01.200Z", usage1, "m1"),
      record("2026-01-01T00:00:02.000Z", usage2, "m2"),
      record("2026-01-01T00:00:02.100Z", usage2, "m2"),
    ].join("\n")
    expect(await readUsageSnapshot("s1", fakeDeps("blocks", "s1", raw))).toEqual({
      input_tokens: 300, // 100 + 200, not 3×100 + 2×200
      output_tokens: 60,
      cache_read_input_tokens: 11000,
      cache_creation_input_tokens: 50,
      // context = LAST message (m2) only: 200 + 6000 + 50
      context_tokens: 6250,
      context_tokens_approximate: true,
    })
  })

  it("treats missing cache fields as zero and omits empty aggregates", async () => {
    const raw = record("2026-01-01T00:00:01.000Z", { input_tokens: 42, output_tokens: 7 })
    expect(await readUsageSnapshot("s1", fakeDeps("sparse", "s1", raw))).toEqual({
      input_tokens: 42,
      output_tokens: 7,
      context_tokens: 42,
      context_tokens_approximate: true,
    })
  })

  it("returns undefined when the session has no usage records — not a zero", async () => {
    const raw = record("2026-01-01T00:00:01.000Z", undefined)
    expect(await readUsageSnapshot("s1", fakeDeps("nousage", "s1", raw))).toBeUndefined()
  })

  it("returns undefined for a missing session", async () => {
    expect(await readUsageSnapshot("nope", fakeDeps("missing", "s1", ""))).toBeUndefined()
  })
})
