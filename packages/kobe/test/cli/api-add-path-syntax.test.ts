import { resolve } from "node:path"
import { expect, it } from "vitest"
import { invokeVerb } from "../../src/cli/api-cmd"
import { FakeClient, stubRuntime, taskFixture } from "./api-handler-fixtures"

it("reports a requested subdirectory when git and the caller use different Windows separators", async () => {
  const requested = resolve("C:/Projects/demo/packages/app")
  const repo = requested.replaceAll("\\", "/").replace(/\/packages\/app$/, "")
  const client = new FakeClient({ "task.create": () => ({ taskId: "t1", task: taskFixture() }) })
  const result = await invokeVerb("add", ["--repo", requested, "--command", "claude"], {
    client,
    runtime: stubRuntime({ resolveRepoRoot: async () => repo }),
  })
  expect(result).toMatchObject({ repoResolvedFrom: requested })
})

it("does not report a subdirectory when only the path spelling changed", async () => {
  const requested = resolve("C:/Projects/demo")
  const client = new FakeClient({ "task.create": () => ({ taskId: "t1", task: taskFixture() }) })
  const result = await invokeVerb("add", ["--repo", requested, "--command", "claude"], {
    client,
    runtime: stubRuntime({ resolveRepoRoot: async () => requested.replaceAll("\\", "/") }),
  })
  expect(result).not.toHaveProperty("repoResolvedFrom")
})
