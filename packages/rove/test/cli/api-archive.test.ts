/** `archive` / `unarchive`: one `task.archive` request each, `--force` only ever on the way in. */

import { describe, expect, it } from "vitest"
import { invokeVerb } from "../../src/cli/api-cmd.ts"
import { FakeClient, stubRuntime } from "./api-handler-fixtures.ts"

function daemon() {
  return new FakeClient({ "task.archive": () => ({ archived: ["child", "t1"] }) })
}

describe("archive verbs", () => {
  it("archive hides the subtree and names every task it hid", async () => {
    const client = daemon()
    const result = await invokeVerb("archive", ["--task-id", "t1"], { client, runtime: stubRuntime() })
    expect(result).toEqual({ taskId: "t1", archived: true, ids: ["child", "t1"] })
    expect(client.requests).toEqual([{ name: "task.archive", payload: { taskId: "t1", archived: true, force: false } }])
  })

  it("--force passes through to the daemon", async () => {
    const client = daemon()
    await invokeVerb("archive", ["--task-id", "t1", "--force"], { client, runtime: stubRuntime() })
    expect(client.requests[0]?.payload).toEqual({ taskId: "t1", archived: true, force: true })
  })

  it("unarchive restores and never forces", async () => {
    const client = daemon()
    const result = await invokeVerb("unarchive", ["--task-id", "t1"], { client, runtime: stubRuntime() })
    expect(result).toEqual({ taskId: "t1", archived: false, ids: ["child", "t1"] })
    expect(client.requests[0]?.payload).toEqual({ taskId: "t1", archived: false, force: false })
  })
})
