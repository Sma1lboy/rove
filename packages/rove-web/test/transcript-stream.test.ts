import { describe, expect, test } from "bun:test"
import { BridgeRequestError } from "../src/bridge.ts"
import { composerSendError } from "../src/transcript-composer.tsx"
import { EMPTY, addPage, isTranscriptUpdateEvent } from "../src/transcript-data.ts"
import { type TranscriptState, applyTranscriptUpdate } from "../src/transcript-load.ts"

describe("applyTranscriptUpdate", () => {
  test("folds incremental history pushes into an existing transcript and advances cursor", () => {
    const initial: TranscriptState = {
      kind: "ready",
      transcript: addPage(
        EMPTY,
        [{ role: "user", timestamp: "2026-11-28T00:00:00Z", blocks: [{ type: "text", text: "Hello" }] }],
        0,
      ),
      cursor: "c1",
      older: "old-0",
    }

    const next = applyTranscriptUpdate(initial, {
      taskId: "T1",
      source: "history",
      history: {
        messages: [{ role: "assistant", timestamp: "2026-11-28T00:00:01Z", blocks: [{ type: "text", text: "World" }] }],
        firstIndex: 1,
      },
      cursor: "c2",
    })

    expect(next).toEqual({
      kind: "ready",
      cursor: "c2",
      older: "old-0",
      transcript: {
        entries: [
          { index: 0, role: "user", at: "2026-11-28T00:00:00Z", text: "Hello", tools: [] },
          { index: 1, role: "assistant", at: "2026-11-28T00:00:01Z", text: "World", tools: [] },
        ],
        failed: new Set(),
      },
    })
  })

  test("replaces transcript cleanly on reset push and supports terminal promotion", () => {
    const terminal: TranscriptState = { kind: "terminal", tail: ["booting…"] }
    const promoted = applyTranscriptUpdate(terminal, {
      taskId: "T1",
      reset: true,
      source: "history",
      history: {
        messages: [{ role: "assistant", timestamp: "2026-11-28T00:00:02Z", blocks: [{ type: "text", text: "Ready" }] }],
        firstIndex: 0,
      },
      cursor: "c1",
      olderCursor: null,
    })
    expect(promoted).toEqual({
      kind: "ready",
      cursor: "c1",
      older: null,
      transcript: {
        entries: [{ index: 0, role: "assistant", at: "2026-11-28T00:00:02Z", text: "Ready", tools: [] }],
        failed: new Set(),
      },
    })

    const backToTerminal = applyTranscriptUpdate(promoted, {
      taskId: "T1",
      reset: true,
      source: "terminal",
      terminal: { tail: ["line 1", "line 2"] },
      cursor: null,
    })
    expect(backToTerminal).toEqual({ kind: "terminal", tail: ["line 1", "line 2"] })
  })

  test("validates transcript.update push frames", () => {
    expect(isTranscriptUpdateEvent({ taskId: "T1", source: "history", cursor: "c1" })).toBe(true)
    expect(isTranscriptUpdateEvent({ taskId: "T1", source: "terminal", cursor: null })).toBe(true)
    expect(isTranscriptUpdateEvent({ taskId: "T1", source: "bogus" })).toBe(false)
    expect(isTranscriptUpdateEvent(null)).toBe(false)
  })
})

describe("composerSendError", () => {
  test("maps known bridge refusal codes to friendly copy", () => {
    expect(composerSendError(new BridgeRequestError("UNKNOWN_OP", "unknown op"))).not.toBe("unknown op")
    expect(composerSendError(new BridgeRequestError("AWAITING_PERMISSION", "blocked"))).not.toBe("blocked")
    expect(composerSendError(new Error("custom failure"))).toBe("custom failure")
  })
})
