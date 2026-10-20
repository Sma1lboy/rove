import { execFileSync } from "node:child_process"
import { join } from "node:path"
import { ROVE_API_VERSION } from "@sma1lboy/rove-daemon/daemon/protocol"
import { afterEach, describe, expect, it } from "vitest"
import { type DaemonHarness, bootDaemonHarness } from "./harness.ts"

/**
 * `api.invoke` over the real socket: the verb runs inside the daemon process
 * and reaches back through its own socket, so a forwarded socket carries the
 * whole operation to the machine that answered.
 */
describe("api.invoke", () => {
  let h: DaemonHarness

  afterEach(async () => {
    await h.close()
  })

  it("runs a verb in the daemon under the version its hello announces", async () => {
    h = await bootDaemonHarness()
    const client = h.client()
    const hello = await client.request<{ apiVersion: number }>("hello")
    expect(hello.apiVersion).toBe(ROVE_API_VERSION)

    // A daemon round trip from inside the daemon (note-list → note.list).
    const repo = join(h.dir, "repo")
    execFileSync("git", ["init", "-q", repo])
    await expect(client.request("api.invoke", { verb: "note-list", params: { repo } })).resolves.toEqual({
      apiVersion: ROVE_API_VERSION,
      ok: true,
      result: { notes: [] },
    })
    await expect(
      client.request("api.invoke", { verb: "get-task", params: { "task-id": "nope" } }),
    ).resolves.toMatchObject({ ok: false, error: { code: "TASK_NOT_FOUND" } })
    await expect(client.request("api.invoke", { verb: "watch", params: {} })).resolves.toMatchObject({
      ok: false,
      error: { code: "CLI_ONLY_VERB" },
    })
  })
})
