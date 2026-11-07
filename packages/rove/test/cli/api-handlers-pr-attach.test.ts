/** `api pr-attach`: what reaches the daemon for each accepted spelling of `--url`, and what is refused before it does. */

import { describe, expect, it } from "vitest"
import { invokeVerb } from "../../src/cli/api-cmd.ts"
import { FakeClient, stubRuntime } from "./api-handler-fixtures.ts"

const URL = "https://github.com/acme/app/pull/42"

describe("pr-attach handler", () => {
  it("sends the canonical PR URL, dropping a trailing page or fragment", async () => {
    const client = new FakeClient({ "task.addSessionPr": () => ({ taskId: "t1", url: URL }) })
    const res = await invokeVerb("pr-attach", ["--task-id", "t1", "--url", `${URL}/files#diff-1`], {
      client,
      runtime: stubRuntime(),
    })
    expect(client.requests).toHaveLength(1)
    expect(client.requests[0]).toMatchObject({ name: "task.addSessionPr", payload: { taskId: "t1", url: URL } })
    expect(res).toEqual({ taskId: "t1", url: URL })
  })

  it("refuses a value that is neither a PR URL nor a number without calling the daemon", async () => {
    const client = new FakeClient({})
    await expect(
      invokeVerb("pr-attach", ["--task-id", "t1", "--url", "https://example.com/x"], {
        client,
        runtime: stubRuntime(),
      }),
    ).rejects.toMatchObject({ code: "BAD_FLAG" })
    expect(client.requests).toEqual([])
  })
})
