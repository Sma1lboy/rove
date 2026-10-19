/**
 * The one executor behind `rove api`, the daemon's `api.invoke` and the
 * bridge's `api.invoke`: argv or params in, one versioned envelope out.
 */

import { ROVE_API_VERSION } from "@sma1lboy/rove-daemon/daemon/protocol"
import { describe, expect, it, vi } from "vitest"
import { executeVerb } from "../../src/cli/api/invoke.ts"
import { REMOTE_CALLER } from "../../src/cli/api/types.ts"
import type { DaemonRpc } from "../../src/cli/daemon-session.ts"

function fakeClient() {
  const request = vi.fn(async (_name: string, _payload?: unknown) => ({ notes: [] }))
  const client = { request, subscribe: async () => ({}), onChannel: () => () => {} }
  return client as unknown as DaemonRpc & { request: typeof request }
}

const remote = (client: DaemonRpc | null = null) => ({ client, caller: REMOTE_CALLER })

describe("executeVerb", () => {
  it("argv from the CLI and params from a transport reach the same envelope", async () => {
    const byArgv = await executeVerb("schema", { argv: ["--verb", "land"] }, { client: null })
    const byParams = await executeVerb("schema", { params: { verb: "land" } }, remote())
    expect(byParams).toEqual(byArgv)
    expect(byParams).toMatchObject({ apiVersion: ROVE_API_VERSION, ok: true, result: { name: "land" } })
  })

  it("a refusal is an ok:false envelope carrying the code and recovery data, never a rejection", async () => {
    await expect(executeVerb("nope", { params: {} }, remote())).resolves.toEqual({
      apiVersion: ROVE_API_VERSION,
      ok: false,
      error: expect.objectContaining({
        code: "BAD_VERB",
        message: "unknown verb: nope",
        nextCommandArgs: ["api", "schema"],
      }),
    })
  })

  it("a transport caller gets honest refusals for what only the CLI process has", async () => {
    const client = fakeClient()
    const code = async (verb: string, params: Record<string, string | readonly string[]>) => {
      const envelope = await executeVerb(verb, { params }, remote(client))
      return envelope.ok ? "ok" : envelope.error.code
    }
    // Streams NDJSON to stdout.
    expect(await code("watch", { "task-ids": ["a"] })).toBe("CLI_ONLY_VERB")
    // No cwd to resolve against: a relative path would silently mean the daemon's cwd.
    expect(await code("note-list", { repo: "relative/repo" })).toBe("BAD_FLAG")
    expect(client.request).not.toHaveBeenCalled()
    expect(await code("note-list", { repo: "/abs/repo" })).toBe("ok")
    expect(client.request).toHaveBeenCalledWith("note.list", { repo: "/abs/repo" })
  })

  it("params must fit their flag's type", async () => {
    const envelope = await executeVerb("note-list", { params: { repo: 5 } }, remote(fakeClient()))
    expect(envelope).toMatchObject({ ok: false, error: { code: "BAD_FLAG" } })
    // A csv item holding the separator would split into two ids.
    const list = await executeVerb("collect", { params: { "task-ids": ["a,b"] } }, remote(fakeClient()))
    expect(list).toMatchObject({ ok: false, error: { code: "BAD_FLAG" } })
  })
})
