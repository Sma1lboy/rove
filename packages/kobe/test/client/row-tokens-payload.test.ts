/**
 * The `task.tokens` wire contract. These rows are written by PLUGIN code —
 * the one publisher in the system Rove does not ship — so the parse must drop
 * a malformed token rather than let `undefined` reach a sidebar row.
 */

import { describe, expect, it } from "vitest"
import { liveRowTokens, parseRowTokensPayload, sameRowTokenMap } from "../../src/client/remote-orchestrator.ts"

const NOW = 1_800_000_000_000

function payload(tokens: unknown): unknown {
  return { tokens }
}

describe("parseRowTokensPayload", () => {
  it("parses a well-formed map", () => {
    const map = parseRowTokensPayload(
      payload({ t1: [{ source: "p", key: "claim", text: "@ana", tone: "info", expiresAt: NOW }] }),
    )
    expect(map?.get("t1")).toEqual([{ source: "p", key: "claim", text: "@ana", tone: "info", expiresAt: NOW }])
  })

  it("rejects the payload shape, so a bad frame never clobbers a good map", () => {
    expect(parseRowTokensPayload(undefined)).toBeNull()
    expect(parseRowTokensPayload({})).toBeNull()
    expect(parseRowTokensPayload(payload([]))).toBeNull()
    expect(parseRowTokensPayload(payload("nope"))).toBeNull()
  })

  it("drops individual malformed tokens and keeps the good ones", () => {
    const map = parseRowTokensPayload(
      payload({
        t1: [
          { source: "p", key: "a", text: "ok", expiresAt: NOW },
          { source: "p", key: "b" }, // no text, no deadline
          { source: "p", key: "c", text: "", expiresAt: NOW }, // empty label
          { source: "p", key: "d", text: "x", expiresAt: "soon" }, // deadline is not a number
          null,
        ],
      }),
    )
    expect(map?.get("t1")?.map((token) => token.key)).toEqual(["a"])
  })

  it("ignores a tone that is not one of ours rather than passing a colour through", () => {
    const map = parseRowTokensPayload(
      payload({ t1: [{ source: "p", key: "a", text: "x", tone: "#f00", expiresAt: NOW }] }),
    )
    expect(map?.get("t1")?.[0]?.tone).toBeUndefined()
  })

  it("omits a task whose every token was malformed, instead of an empty row", () => {
    const map = parseRowTokensPayload(payload({ t1: [{ nope: true }] }))
    expect(map?.has("t1")).toBe(false)
  })
})

describe("sameRowTokenMap", () => {
  const base = parseRowTokensPayload(payload({ t1: [{ source: "p", key: "a", text: "x", expiresAt: NOW }] }))!

  it("is true for an identical republish — the bus replays on every reconnect", () => {
    const again = parseRowTokensPayload(payload({ t1: [{ source: "p", key: "a", text: "x", expiresAt: NOW }] }))!
    expect(sameRowTokenMap(base, again)).toBe(true)
  })

  it("notices a changed deadline, which is what a refresh IS", () => {
    const refreshed = parseRowTokensPayload(
      payload({ t1: [{ source: "p", key: "a", text: "x", expiresAt: NOW + 1 }] }),
    )!
    expect(sameRowTokenMap(base, refreshed)).toBe(false)
  })

  it("notices a changed label, a dropped task, and an added one", () => {
    const relabelled = parseRowTokensPayload(payload({ t1: [{ source: "p", key: "a", text: "y", expiresAt: NOW }] }))!
    expect(sameRowTokenMap(base, relabelled)).toBe(false)
    expect(sameRowTokenMap(base, new Map())).toBe(false)
    const added = parseRowTokensPayload(
      payload({
        t1: [{ source: "p", key: "a", text: "x", expiresAt: NOW }],
        t2: [{ source: "p", key: "a", text: "x", expiresAt: NOW }],
      }),
    )!
    expect(sameRowTokenMap(base, added)).toBe(false)
  })
})

describe("liveRowTokens", () => {
  const map = parseRowTokensPayload(
    payload({
      t1: [
        { source: "p", key: "fresh", text: "fresh", expiresAt: NOW + 1_000 },
        { source: "p", key: "lapsed", text: "lapsed", expiresAt: NOW - 1 },
      ],
    }),
  )!

  it("drops a token whose deadline has passed, without waiting for a push", () => {
    expect(liveRowTokens(map, "t1", NOW).map((token) => token.key)).toEqual(["fresh"])
  })

  it("is empty for a task with no tokens, and for no map at all", () => {
    expect(liveRowTokens(map, "t2", NOW)).toEqual([])
    expect(liveRowTokens(undefined, "t1", NOW)).toEqual([])
  })

  it("treats the deadline itself as expired — `expiresAt` is exclusive", () => {
    expect(liveRowTokens(map, "t1", NOW + 1_000)).toEqual([])
  })
})
