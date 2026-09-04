/**
 * Per-turn telemetry extraction from a Codex rollout.
 *
 * Record shapes are copied from a real `~/.codex/sessions/**.jsonl` written by
 * codex-cli 0.149.1 (prose payloads — base instructions, the assistant's reply,
 * rate limits — dropped; every field this reader touches is verbatim).
 */

import { parseCodexTurns } from "@/engine/codex-local/turns"
import { describe, expect, test } from "vitest"

const SID = "01a060d6-aae5-7c90-91c0-d5f81da8f343"
const T1 = "01a060d6-dd1a-7621-889f-d9da35a4699e"
const T2 = "01a060d7-dd1a-7621-889f-d9da35a4699e"

function line(record: Record<string, unknown>): string {
  return JSON.stringify(record)
}

const meta = line({ timestamp: "2026-09-02T06:38:09.182Z", type: "session_meta", payload: { session_id: SID } })

function started(ts: string, turnId: string): string {
  return line({
    timestamp: ts,
    type: "event_msg",
    payload: { type: "task_started", turn_id: turnId, started_at: 1788331089, model_context_window: 258400 },
  })
}

function context(ts: string, turnId: string, model = "gpt-5.6-luna"): string {
  return line({ timestamp: ts, type: "turn_context", payload: { turn_id: turnId, model } })
}

/** One model request inside a turn. `total` is session-cumulative, `last` is
 *  this request's delta — the reader must use `last`. */
function tokenCount(ts: string, last: [number, number, number], total: [number, number, number]): string {
  const usage = ([i, c, o]: [number, number, number]) => ({
    input_tokens: i,
    cached_input_tokens: c,
    output_tokens: o,
  })
  return line({
    timestamp: ts,
    type: "event_msg",
    payload: {
      type: "token_count",
      info: { total_token_usage: usage(total), last_token_usage: usage(last), model_context_window: 258400 },
    },
  })
}

function completed(ts: string, turnId: string): string {
  return line({
    timestamp: ts,
    type: "event_msg",
    payload: { type: "task_complete", turn_id: turnId, completed_at: 1788331142, duration_ms: 53436 },
  })
}

/** Two turns, the first holding a two-request tool loop. */
const ROLLOUT = [
  meta,
  started("2026-09-02T06:38:09.182Z", T1),
  context("2026-09-02T06:38:09.398Z", T1),
  tokenCount("2026-09-02T06:38:16.153Z", [19292, 8960, 276], [19292, 8960, 276]),
  tokenCount("2026-09-02T06:38:40.000Z", [28295, 9000, 246], [47587, 17960, 522]),
  completed("2026-09-02T06:39:02.616Z", T1),
  started("2026-09-02T06:39:18.843Z", T2),
  context("2026-09-02T06:39:19.000Z", T2),
  tokenCount("2026-09-02T06:39:40.000Z", [37995, 10000, 70], [85582, 27960, 592]),
  completed("2026-09-02T06:40:24.755Z", T2),
].join("\n")

describe("parseCodexTurns", () => {
  test("emits one record per completed turn, with model, span, and summed usage", () => {
    const turns = parseCodexTurns(ROLLOUT)
    expect(turns).toHaveLength(2)
    expect(turns[0]).toEqual({
      id: T1,
      sessionId: SID,
      model: "gpt-5.6-luna",
      startedAt: Date.parse("2026-09-02T06:38:09.182Z"),
      endedAt: Date.parse("2026-09-02T06:39:02.616Z"),
      usage: {
        // The turn's two requests: input 19292+28295 = 47587 total, of which
        // 8960+9000 = 17960 was cached, so 29627 was billed as fresh input.
        input_tokens: 29627,
        output_tokens: 522,
        cache_read_input_tokens: 17960,
        context_window_tokens: 258400,
      },
    })
    expect(turns[1]?.id).toBe(T2)
    expect(turns[1]?.usage?.output_tokens).toBe(70)
  })

  test("charges a turn only its own requests, not the session running total", () => {
    // The regression this guards: `total_token_usage` sits in the same record
    // and is cumulative, so reading it would bill turn 2 for turn 1 as well.
    const turns = parseCodexTurns(ROLLOUT)
    expect(turns[1]?.usage?.input_tokens).toBe(37995 - 10000)
    expect(turns[1]?.usage?.cache_read_input_tokens).toBe(10000)
  })

  test("turn ids are stable across re-reads — the dedupe key AgentTurn requires", () => {
    // The hook fires on every Stop and the rollout is re-read from the top, so
    // an unstable id would re-record every past turn on each read.
    expect(parseCodexTurns(ROLLOUT).map((t) => t.id)).toEqual(parseCodexTurns(ROLLOUT).map((t) => t.id))
    expect(parseCodexTurns(ROLLOUT).map((t) => t.id)).toEqual([T1, T2])
  })

  test("a turn still running is not emitted until its task_complete lands", () => {
    const open = ROLLOUT.split("\n").slice(0, -1).join("\n")
    expect(parseCodexTurns(open).map((t) => t.id)).toEqual([T1])
    expect(parseCodexTurns(ROLLOUT).map((t) => t.id)).toEqual([T1, T2])
  })

  test("a task_complete with no opener (file read mid-turn) is skipped", () => {
    const orphan = [meta, completed("2026-09-02T06:39:02.616Z", T1)].join("\n")
    expect(parseCodexTurns(orphan)).toEqual([])
  })

  test("a turn with no token_count carries no usage rather than zeros", () => {
    const noUsage = [meta, started("2026-09-02T06:38:09.182Z", T1), completed("2026-09-02T06:39:02.616Z", T1)].join(
      "\n",
    )
    expect(parseCodexTurns(noUsage)[0]?.usage).toBeUndefined()
  })

  test("garbage lines and an absent session_meta do not throw", () => {
    const messy = ["not json", "", "{}", started("2026-09-02T06:38:09.182Z", T1), completed("x", T1)].join("\n")
    expect(() => parseCodexTurns(messy, "fallback-sid")).not.toThrow()
    expect(parseCodexTurns(messy, "fallback-sid")[0]?.sessionId).toBe("fallback-sid")
  })
})
