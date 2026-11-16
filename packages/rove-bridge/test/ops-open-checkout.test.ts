import { describe, expect, test } from "bun:test"
import { taskOpDeps } from "../src/ops/tasks-shared.ts"
import { isolateTaskOpDeps, refused, run } from "./task-ops-harness.ts"

isolateTaskOpDeps()

describe("task.openCheckout", () => {
  test("saves the project first, then a dir task on the root it reports, on the engine asked for", async () => {
    taskOpDeps.validateRepoPath = () => null
    const { result, calls } = await run(
      "task.openCheckout",
      { repo: "/var/work/rove", engine: "codex", title: "fix login", model: "gpt-5" },
      { "project.ensure": { repo: "/private/var/work/rove" }, "task.openDir": { taskId: "S1" } },
    )
    expect(result).toEqual({ taskId: "S1" })
    expect(calls.map((c) => ("rpc" in c ? c.rpc : c.verb))).toEqual(["engine-list", "project.ensure", "task.openDir"])
    expect(calls.at(-1)).toEqual({
      rpc: "task.openDir",
      payload: { dir: "/private/var/work/rove", vendor: "codex", title: "fix login", model: "gpt-5" },
    })
  })

  // A friend's folder with no git refused New session outright; it has no worktrees to offer, nothing else is missing.
  test("a folder git cannot use opens as a directory session, without saving a project", async () => {
    taskOpDeps.validateRepoPath = () => "not a git repo"
    taskOpDeps.isDirectory = (p) => p === "/home/me/notes"
    const { result, calls } = await run(
      "task.openCheckout",
      { repo: "/home/me/notes", engine: "codex" },
      { "task.openDir": { taskId: "D1" } },
    )
    expect(result).toEqual({ taskId: "D1" })
    expect(calls.map((c) => ("rpc" in c ? c.rpc : c.verb))).toEqual(["engine-list", "task.openDir"])
    expect(calls.at(-1)).toEqual({ rpc: "task.openDir", payload: { dir: "/home/me/notes", vendor: "codex" } })
  })

  test("a path that is no folder, or not absolute, is refused", async () => {
    taskOpDeps.validateRepoPath = () => "path does not exist"
    taskOpDeps.isDirectory = () => false
    await refused("task.openCheckout", { repo: "/nope" })
    await refused("task.openCheckout", { repo: "rel" })
  })
})

describe("task.openMain and project.ensure", () => {
  test("openMain needs a usable git repo, not a known one, and opens a new session in its checkout", async () => {
    taskOpDeps.validateRepoPath = () => null
    const { result, calls } = await run(
      "task.openMain",
      { repo: "/work/fresh" },
      { "project.ensure": { repo: "/private/work/fresh" }, "task.openDir": { taskId: "S1" } },
    )
    expect(calls).toEqual([
      { rpc: "project.ensure", payload: { repo: "/work/fresh" } },
      { rpc: "task.openDir", payload: { dir: "/private/work/fresh", vendor: "claude" } },
    ])
    expect(result).toEqual({ taskId: "S1" })
    taskOpDeps.validateRepoPath = () => "not a git repo"
    await refused("task.openMain", { repo: "/etc" })
    await refused("task.openMain", { repo: "rel" })
  })

  test("project.ensure saves any usable git repo and answers the daemon's key for it", async () => {
    taskOpDeps.validateRepoPath = () => null
    const { result, calls } = await run(
      "project.ensure",
      { repo: "/work/fresh" },
      { "project.ensure": { repo: "/private/work/fresh" } },
    )
    expect(calls).toEqual([{ rpc: "project.ensure", payload: { repo: "/work/fresh" } }])
    expect(result).toEqual({ repo: "/private/work/fresh" })
    taskOpDeps.validateRepoPath = () => "not a git repo"
    await refused("project.ensure", { repo: "/etc" })
    await refused("project.ensure", { repo: "rel" })
  })
})
