import { describe, expect, test } from "bun:test"
import { taskOpDeps } from "../src/ops/tasks-shared.ts"
import { isolateTaskOpDeps, refused, run } from "./task-ops-harness.ts"

isolateTaskOpDeps()

describe("task.openCheckout", () => {
  test("makes the project row first, then a dir task on the root it reports, on the engine asked for", async () => {
    taskOpDeps.validateRepoPath = () => null
    const { result, calls } = await run(
      "task.openCheckout",
      { repo: "/var/work/rove", engine: "codex", title: "fix login" },
      { "task.ensureMain": { task: { id: "M1", repo: "/private/var/work/rove" } }, "task.openDir": { taskId: "S1" } },
    )
    expect(result).toEqual({ taskId: "S1" })
    expect(calls.map((c) => ("rpc" in c ? c.rpc : c.verb))).toEqual(["engine-list", "task.ensureMain", "task.openDir"])
    expect(calls.at(-1)).toEqual({
      rpc: "task.openDir",
      payload: { dir: "/private/var/work/rove", vendor: "codex", title: "fix login" },
    })
  })

  test("needs a usable git repo at an absolute path", async () => {
    taskOpDeps.validateRepoPath = () => "not a git repo"
    await refused("task.openCheckout", { repo: "/etc" })
    await refused("task.openCheckout", { repo: "rel" })
  })
})
