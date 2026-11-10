import { describe, expect, test } from "bun:test"
import { createReviewOps } from "../src/ops/review-queue.ts"
import { taskOpDeps } from "../src/ops/tasks-shared.ts"
import type { OpTable } from "../src/ops/types.ts"
import { REPO, fakeApi, isolateTaskOpDeps } from "./task-ops-harness.ts"

isolateTaskOpDeps()

const pr = (n: number, repo: string, extra: Record<string, unknown> = {}) => ({
  number: n,
  title: `pr ${n}`,
  url: `https://github.com/${repo}/pull/${n}`,
  isDraft: false,
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-02T00:00:00Z",
  additions: 10,
  deletions: 2,
  headRefName: `feature-${n}`,
  baseRefName: "main",
  isCrossRepository: false,
  author: { login: "ann" },
  repository: { nameWithOwner: repo },
  commits: { nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS" } } }] },
  ...extra,
})
const reply = (...nodes: unknown[]) => JSON.stringify({ data: { search: { nodes } } })

function setup(ops: OpTable = createReviewOps()) {
  taskOpDeps.savedRepos = () => [REPO]
  taskOpDeps.repoId = (path) => (path === REPO ? "github.com/me/payments-api" : undefined)
  const { api } = fakeApi({ "task.list": { tasks: [] } })
  return { run: (op: string, args: Record<string, unknown> = {}) => ops[op]?.run(args, { api }) as Promise<any> }
}

describe("review.queue", () => {
  test("lists the PRs awaiting you in known projects (case-insensitive), counts the rest, and maps the fields", async () => {
    let args: readonly string[] = []
    taskOpDeps.gh = async (a) => {
      args = a
      return {
        ok: true,
        stdout: reply(
          pr(7, "Me/Payments-API", {
            isDraft: true,
            isCrossRepository: true,
            commits: { nodes: [{ commit: { statusCheckRollup: { state: "FAILURE" } } }] },
          }),
          pr(9, "someone/else"),
          { title: "no number" },
        ),
      }
    }
    const { run } = setup()
    const res = await run("review.queue")
    expect(res.other).toBe(1)
    expect(res.prs).toEqual([
      {
        repo: REPO,
        nameWithOwner: "Me/Payments-API",
        number: 7,
        title: "pr 7",
        url: "https://github.com/Me/Payments-API/pull/7",
        author: "ann",
        isDraft: true,
        createdAt: "2026-11-01T00:00:00Z",
        updatedAt: "2026-11-02T00:00:00Z",
        additions: 10,
        deletions: 2,
        headRef: "feature-7",
        baseRef: "main",
        fork: true,
        checks: "failing",
      },
    ])
    // Only a search query: no mutation, a fixed argv.
    expect(args.slice(0, 2)).toEqual(["api", "graphql"])
    expect(args.join(" ")).toContain("review-requested:@me")
    expect(args.join(" ")).not.toContain("mutation")
  })

  test("is cached for a minute and `refresh` asks again", async () => {
    let calls = 0
    let clock = 0
    taskOpDeps.gh = async () => {
      calls++
      return { ok: true, stdout: reply(pr(calls, "me/payments-api")) }
    }
    const { run } = setup(createReviewOps(() => clock))
    expect((await run("review.queue")).prs[0].number).toBe(1)
    clock = 30_000
    expect((await run("review.queue")).prs[0].number).toBe(1)
    clock = 61_000
    expect((await run("review.queue")).prs[0].number).toBe(2)
    expect((await run("review.queue", { refresh: true })).prs[0].number).toBe(3)
  })

  test("a missing, signed-out or garbled gh is an empty queue with a reason, never a throw", async () => {
    const { run } = setup()
    taskOpDeps.gh = async () => ({ ok: false, reason: "unauthenticated" })
    expect(await run("review.queue")).toEqual({ prs: [], other: 0, reason: "unauthenticated" })
    taskOpDeps.gh = async () => ({ ok: true, stdout: "oops" })
    expect(await run("review.queue")).toEqual({ prs: [], other: 0, reason: "failed" })
  })
})

describe("review.prepare", () => {
  test("fetches the PR head into a local ref of a known project, and refuses anything else", async () => {
    const fetched: Array<[string, number]> = []
    taskOpDeps.fetchPullHead = async (repo, number) => {
      fetched.push([repo, number])
      return { ok: true, ref: `refs/rove/pr/${number}` }
    }
    const { run } = setup()
    expect(await run("review.prepare", { repo: REPO, number: 42 })).toEqual({ ref: "refs/rove/pr/42" })
    expect(fetched).toEqual([[REPO, 42]])
    await expect(run("review.prepare", { repo: "/not/known", number: 1 })).rejects.toMatchObject({
      name: "BridgeError",
    })
    await expect(run("review.prepare", { repo: REPO, number: "1; rm" })).rejects.toMatchObject({ name: "BridgeError" })
    await expect(run("review.prepare", { repo: REPO })).rejects.toMatchObject({ code: "BAD_ARGS" })
    expect(fetched).toHaveLength(1)
  })

  test("a failed fetch says what git said", async () => {
    taskOpDeps.fetchPullHead = async () => ({ ok: false, error: "couldn't find remote ref" })
    const { run } = setup()
    await expect(run("review.prepare", { repo: REPO, number: 5 })).rejects.toMatchObject({
      code: "FETCH_FAILED",
      message: "couldn't find remote ref",
    })
  })
})
