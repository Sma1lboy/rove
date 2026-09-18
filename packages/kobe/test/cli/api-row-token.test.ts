/**
 * `row-token` — the CLI half. What matters here is the argv → RPC mapping:
 * the TTL is expressed in SECONDS on the command line and MILLIS on the wire,
 * and the writing plugin's id comes from the environment rather than a flag,
 * so one plugin cannot claim another's slot by passing a string.
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import { invokeVerb } from "../../src/cli/api-cmd.ts"
import { FakeClient, stubRuntime } from "./api-handler-fixtures.ts"

const runtime = stubRuntime()

// `stubEnv` is what makes the `cli` default testable: assigning
// `process.env.X = undefined` stores the STRING "undefined", so a hand-rolled
// save/restore leaves the next test reading a source nobody set.
afterEach(() => {
  vi.unstubAllEnvs()
})

function client() {
  return new FakeClient({ "task.rowToken": (payload) => ({ ok: true, payload }) })
}

function lastPayload(c: FakeClient): Record<string, unknown> {
  return c.requests.at(-1)?.payload as Record<string, unknown>
}

describe("row-token", () => {
  it("converts --ttl seconds to the wire's millis", async () => {
    const c = client()
    await invokeVerb("row-token", ["--task-id", "t1", "--text", "@ana", "--ttl", "600"], { client: c, runtime })
    expect(lastPayload(c)).toMatchObject({ taskId: "t1", text: "@ana", ttlMs: 600_000 })
  })

  it("leaves ttlMs off entirely when --ttl is omitted, so the store's default wins", async () => {
    const c = client()
    await invokeVerb("row-token", ["--task-id", "t1", "--text", "@ana"], { client: c, runtime })
    expect(lastPayload(c)).not.toHaveProperty("ttlMs")
  })

  it("takes the source from ROVE_PLUGIN_ID, not from a flag", async () => {
    const c = client()
    vi.stubEnv("ROVE_PLUGIN_ID", "examples.row-tokens")
    await invokeVerb("row-token", ["--task-id", "t1", "--text", "@ana"], { client: c, runtime })
    expect(lastPayload(c)).toMatchObject({ source: "examples.row-tokens" })
  })

  it("writes as `cli` from a plain shell", async () => {
    const c = client()
    vi.stubEnv("ROVE_PLUGIN_ID", undefined)
    vi.stubEnv("KOBE_PLUGIN_ID", undefined)
    await invokeVerb("row-token", ["--task-id", "t1", "--text", "@ana"], { client: c, runtime })
    expect(lastPayload(c)).toMatchObject({ source: "cli" })
  })

  it("forwards the semantic tone", async () => {
    const c = client()
    await invokeVerb("row-token", ["--task-id", "t1", "--text", "@ana", "--tone", "warning"], { client: c, runtime })
    expect(lastPayload(c)).toMatchObject({ tone: "warning" })
  })

  it("sends no tone when none was asked for", async () => {
    const c = client()
    await invokeVerb("row-token", ["--task-id", "t1", "--text", "@ana"], { client: c, runtime })
    expect(lastPayload(c)).not.toHaveProperty("tone")
  })

  it("sends clear instead of text under --clear", async () => {
    const c = client()
    await invokeVerb("row-token", ["--task-id", "t1", "--clear", "--key", "claim"], { client: c, runtime })
    expect(lastPayload(c)).toMatchObject({ clear: true, key: "claim" })
    expect(lastPayload(c)).not.toHaveProperty("text")
  })

  it("refuses a call that neither writes nor clears", async () => {
    await expect(invokeVerb("row-token", ["--task-id", "t1"], { client: client(), runtime })).rejects.toThrow(/--text/)
  })

  it("rejects a raw colour in --tone at the flag boundary", async () => {
    await expect(
      invokeVerb("row-token", ["--task-id", "t1", "--text", "x", "--tone", "#ff0000"], {
        client: client(),
        runtime,
      }),
    ).rejects.toThrow(/tone/)
  })
})
