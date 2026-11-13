import { describe, expect, test } from "bun:test"
import { githubOps } from "../src/ops/github.ts"
import { taskOpDeps } from "../src/ops/tasks-shared.ts"
import { fakeApi, isolateTaskOpDeps } from "./task-ops-harness.ts"

isolateTaskOpDeps()

const repos = () => githubOps["github.repos"]?.run({}, { api: fakeApi().api })

describe("github.repos", () => {
  const page = (nodes: unknown[], endCursor: string | null) =>
    JSON.stringify({
      data: { viewer: { repositories: { nodes, pageInfo: { hasNextPage: endCursor !== null, endCursor } } } },
    })

  test("lists every page gh returns, keeping only the fields the picker shows", async () => {
    const cursors: (string | undefined)[] = []
    taskOpDeps.gh = async (args) => {
      const after = args.find((arg) => arg.startsWith("after="))?.slice(6)
      cursors.push(after)
      return after
        ? { ok: true, stdout: page([{ nameWithOwner: "org/lib", description: null, isPrivate: false }], null) }
        : {
            ok: true,
            stdout: page(
              [
                { nameWithOwner: "me/app", description: "An app", isPrivate: true, url: "x" },
                { description: "no name" },
              ],
              "c1",
            ),
          }
    }
    expect(await repos()).toEqual({
      repos: [
        { nameWithOwner: "me/app", description: "An app", isPrivate: true },
        { nameWithOwner: "org/lib", description: "", isPrivate: false },
      ],
    })
    expect(cursors).toEqual([undefined, "c1"])
  })

  test("a missing, signed-out or garbled gh is an empty list with a reason, never a throw", async () => {
    taskOpDeps.gh = async () => ({ ok: false, reason: "unauthenticated" })
    expect(await repos()).toEqual({ repos: [], reason: "unauthenticated" })
    taskOpDeps.gh = async () => ({ ok: true, stdout: "not json" })
    expect(await repos()).toEqual({ repos: [], reason: "failed" })
  })
})
