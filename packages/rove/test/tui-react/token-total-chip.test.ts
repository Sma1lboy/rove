/**
 * The footer's session-token chip (`tokenTotalChip`) and the narrowing that
 * feeds it (`daemonRuntime.readEngineContextUsage`).
 *
 * Both halves exist to carry a number the vendor already computed without
 * inventing one. The refusals are what these pin: a vendor that reports no
 * tokens renders NOTHING rather than a free-looking `0`, and a field the
 * adapter omitted stays omitted on the wire rather than arriving as a zero
 * some later reader would sum.
 */

import { daemonRuntime } from "@/core/daemon-runtime"
import { tokenTotalChip } from "@/tui-react/component/settings-dialog/usage-core"
import type { EngineUsageSnapshot } from "@/types/engine"
import { describe, expect, test, vi } from "vitest"

vi.mock("@/engine/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/engine/registry")>()
  return { ...actual, engineEntry: vi.fn(actual.engineEntry) }
})

/** Drive the narrowing with one canned snapshot, through the real adapter. */
async function narrow(snapshot: EngineUsageSnapshot | undefined) {
  const { engineEntry } = await import("@/engine/registry")
  vi.mocked(engineEntry).mockReturnValueOnce({
    history: { readUsageSnapshot: async () => snapshot },
  } as unknown as ReturnType<typeof engineEntry>)
  return await daemonRuntime.readEngineContextUsage("claude", "session-1")
}

describe("readEngineContextUsage", () => {
  test("a full snapshot carries every token count through", async () => {
    expect(
      await narrow({
        input_tokens: 41_000,
        output_tokens: 3_600,
        cache_read_input_tokens: 812_000,
        cache_creation_input_tokens: 24_500,
        context_tokens: 547_500,
        context_window_tokens: 200_000,
        context_tokens_approximate: true,
      }),
    ).toEqual({
      contextTokens: 547_500,
      contextWindowTokens: 200_000,
      approximate: true,
      inputTokens: 41_000,
      outputTokens: 3_600,
      cacheReadTokens: 812_000,
      cacheCreationTokens: 24_500,
    })
  })

  test("a field the adapter omitted is ABSENT, never zero", async () => {
    // The distinction the whole contract rests on: "this session used no
    // cache" and "this engine does not report cache" must not look alike.
    const usage = await narrow({
      input_tokens: 10,
      output_tokens: 20,
      context_tokens: 30,
    } as EngineUsageSnapshot)
    expect(usage).toEqual({ contextTokens: 30, inputTokens: 10, outputTokens: 20 })
    expect(usage && "cacheReadTokens" in usage).toBe(false)
    expect(usage && "cacheCreationTokens" in usage).toBe(false)
  })

  test("no context reading still returns null — the meter's gate is unchanged", async () => {
    expect(await narrow({ input_tokens: 10, output_tokens: 20 })).toBeNull()
    expect(await narrow(undefined)).toBeNull()
  })
})

describe("tokenTotalChip", () => {
  test("absent data renders nothing rather than a free-looking zero", () => {
    expect(tokenTotalChip(undefined)).toBeNull()
    expect(tokenTotalChip(null)).toBeNull()
    expect(tokenTotalChip({})).toBeNull()
  })

  test("prompt plus completion, humanised — and cache is deliberately not in it", () => {
    expect(tokenTotalChip({ inputTokens: 41_000, outputTokens: 3_600 })).toEqual({ label: "Σ", text: "44k" })
    // Same call with a huge cache read attached must produce the SAME figure:
    // a cached prompt is reuse, not effort, and folding it in would read as
    // an order of magnitude more work than the session did.
    expect(tokenTotalChip({ inputTokens: 41_000, outputTokens: 3_600, cacheReadTokens: 8_000_000 } as never)).toEqual({
      label: "Σ",
      text: "44k",
    })
  })

  test("one count present and the other missing renders the one that exists", () => {
    expect(tokenTotalChip({ outputTokens: 500 })).toEqual({ label: "Σ", text: "500" })
  })

  test("truncates rather than rounds up, so it never claims a milestone early", () => {
    expect(tokenTotalChip({ inputTokens: 999_999, outputTokens: 0 })?.text).toBe("999k")
    expect(tokenTotalChip({ inputTokens: 1_000_000, outputTokens: 0 })?.text).toBe("1.0M")
    expect(tokenTotalChip({ inputTokens: 1_990_000, outputTokens: 0 })?.text).toBe("1.9M")
  })
})
