import { describe, expect, it } from "vitest"
import { invokeVerb } from "../../src/cli/api-cmd.ts"
import { FakeClient, stubRuntime } from "./api-handler-fixtures.ts"

describe("review-comments", () => {
  it("an unknown task is an error, never an empty list of threads", async () => {
    const client = new FakeClient({
      "task.get": () => {
        throw new Error("Task not found: missing")
      },
      "pr.reviewComments": () => ({ prNumber: null, threads: [], totalUnresolved: 0 }),
    })
    await expect(
      invokeVerb("review-comments", ["--task-id", "missing"], { client, runtime: stubRuntime() }),
    ).rejects.toThrow("Task not found: missing")
    expect(client.requests.map((r) => r.name)).not.toContain("pr.reviewComments")
  })
})
