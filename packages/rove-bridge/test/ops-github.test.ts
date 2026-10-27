import { describe, expect, test } from "bun:test"
import { githubOps } from "../src/ops/github.ts"
import { taskOpDeps } from "../src/ops/tasks-shared.ts"
import { fakeApi, isolateTaskOpDeps } from "./task-ops-harness.ts"

isolateTaskOpDeps()

const repos = () => githubOps["github.repos"]?.run({}, { api: fakeApi().api })

describe("github.repos", () => {
  test("lists what gh returns, keeping only the fields the picker shows", async () => {
    taskOpDeps.gh = async () => ({
      ok: true,
      stdout: JSON.stringify([
        { nameWithOwner: "me/app", description: "An app", isPrivate: true, url: "x" },
        { nameWithOwner: "me/lib", description: null, isPrivate: false },
        { description: "no name" },
      ]),
    })
    expect(await repos()).toEqual({
      repos: [
        { nameWithOwner: "me/app", description: "An app", isPrivate: true },
        { nameWithOwner: "me/lib", description: "", isPrivate: false },
      ],
    })
  })

  test("a missing, signed-out or garbled gh is an empty list with a reason, never a throw", async () => {
    taskOpDeps.gh = async () => ({ ok: false, reason: "unauthenticated" })
    expect(await repos()).toEqual({ repos: [], reason: "unauthenticated" })
    taskOpDeps.gh = async () => ({ ok: true, stdout: "not json" })
    expect(await repos()).toEqual({ repos: [], reason: "failed" })
  })
})
