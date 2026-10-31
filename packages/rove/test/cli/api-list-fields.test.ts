/** `list --fields`: an agent orienting across a big fleet reads only the keys it asked for. */

import { describe, expect, it } from "vitest"
import { invokeVerb } from "../../src/cli/api-cmd.ts"
import { FakeClient, expectApiError, stubRuntime, taskFixture } from "./api-handler-fixtures.ts"

const now = Date.now()
const extra = { name: "api", repo: "/api", branch: "b", worktreePath: "/wt/api" }

function fleet() {
  return new FakeClient({
    "task.list": () => ({
      activeTaskId: "busy",
      tasks: [
        taskFixture({ id: "busy", status: "in_progress", prompt: "a very long brief ".repeat(200) }),
        taskFixture({ id: "multi", status: "backlog", extraRepos: [extra] }),
      ],
    }),
    "debug.inspect": () => ({ activity: { tasks: { busy: { state: "running", at: now } } } }),
  })
}

const list = (argv: string[]) => invokeVerb("list", argv, { client: fleet(), runtime: stubRuntime() })

describe("list --fields", () => {
  it("keeps only the named keys, including ones list derives, and leaves the envelope alone", async () => {
    const result = await list(["--fields", "id,status,repoCount"])
    expect(result).toEqual({
      activeTaskId: "busy",
      tasks: [
        { id: "busy", status: "in_progress" },
        { id: "multi", status: "backlog", repoCount: 2 },
      ],
    })
  })

  it("projects after filtering, so a filter's derived key can be kept", async () => {
    const result = (await list(["--activity", "running", "--fields", "id,activity"])) as {
      tasks: Array<Record<string, unknown>>
    }
    expect(result.tasks).toEqual([{ id: "busy", activity: expect.objectContaining({ state: "running" }) }])
  })

  it("refuses a misspelled key and names the valid ones", async () => {
    await expectApiError(() => list(["--fields", "id,stauts"]), "BAD_FLAG", /worktreePath/)
  })
})
