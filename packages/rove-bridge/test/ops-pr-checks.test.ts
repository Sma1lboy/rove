import { describe, expect, test } from "bun:test"
import { type PrChecksDeps, checkState, prChecksOps } from "../src/ops/pr-checks.ts"
import { T, fakeApi } from "./task-ops-harness.ts"

const URL = (run: string) => `https://github.com/o/r/actions/runs/${run}/job/9`
const rollup = [
  {
    name: "lint",
    status: "COMPLETED",
    conclusion: "SUCCESS",
    detailsUrl: URL("11"),
    startedAt: "2026-01-01T00:00:00Z",
    completedAt: "2026-01-01T00:00:42Z",
  },
  {
    name: "test",
    status: "COMPLETED",
    conclusion: "FAILURE",
    detailsUrl: URL("12"),
    startedAt: "2026-01-01T00:00:00Z",
    completedAt: "2026-01-01T00:03:12Z",
  },
  {
    name: "build",
    status: "IN_PROGRESS",
    conclusion: "",
    detailsUrl: URL("13"),
    startedAt: "2026-01-01T00:01:00Z",
    completedAt: "0001-01-01T00:00:00Z",
  },
  { context: "ci/legacy", state: "ERROR", targetUrl: "https://ci.example/1" },
]
const view = {
  statusCheckRollup: rollup,
  mergeable: "CONFLICTING",
  mergeStateStatus: "DIRTY",
  reviewDecision: "REVIEW_REQUIRED",
  isDraft: false,
}

function harness(replies: Record<string, { ok: true; stdout: string } | { ok: false; detail: string }>) {
  const ran: string[][] = []
  let clock = 0
  const deps: PrChecksDeps = {
    gh: async (args) => {
      ran.push([...args])
      return replies[args.slice(0, 2).join(" ")] ?? { ok: false, detail: "no stub" }
    },
    now: () => clock,
  }
  const ops = prChecksOps(deps)
  const { api } = fakeApi({ "get-task": { task: { worktreePath: "/wt", prStatus: { number: 7 } } } })
  return {
    ran,
    advance: (ms: number) => {
      clock += ms
    },
    call: (op: string, args: Record<string, unknown>) =>
      ops[op]?.run(args, { api }) as Promise<Record<string, unknown>>,
  }
}

describe("pr.checks", () => {
  test("lists failures first with durations, run ids and the merge/review state; a non-Actions check has no run id", async () => {
    const h = harness({ "pr view": { ok: true, stdout: JSON.stringify(view) } })
    const res = (await h.call("pr.checks", { taskId: T })) as { checks: Array<Record<string, unknown>> } & Record<
      string,
      unknown
    >
    expect(res.checks.map((c) => [c.name, c.state, c.durationMs, c.runId])).toEqual([
      ["test", "fail", 192_000, "12"],
      ["ci/legacy", "fail", null, null],
      ["build", "pending", null, "13"],
      ["lint", "pass", 42_000, "11"],
    ])
    // GitHub's zero date on a running check means "not finished", not a finish time.
    const at = (iso: string) => Date.parse(iso)
    expect(res.checks.map((c) => [c.name, c.startedAt, c.completedAt])).toEqual([
      ["test", at("2026-01-01T00:00:00Z"), at("2026-01-01T00:03:12Z")],
      ["ci/legacy", null, null],
      ["build", at("2026-01-01T00:01:00Z"), null],
      ["lint", at("2026-01-01T00:00:00Z"), at("2026-01-01T00:00:42Z")],
    ])
    expect(res).toMatchObject({
      outcome: "ok",
      total: 4,
      mergeable: "CONFLICTING",
      mergeState: "DIRTY",
      review: "REVIEW_REQUIRED",
    })
  })

  test("reads are cached for a short while; a refresh and an expired entry read again", async () => {
    const h = harness({ "pr view": { ok: true, stdout: JSON.stringify(view) } })
    await h.call("pr.checks", { taskId: T })
    await h.call("pr.checks", { taskId: T })
    expect(h.ran).toHaveLength(1)
    await h.call("pr.checks", { taskId: T, fresh: true })
    expect(h.ran).toHaveLength(2)
    h.advance(31_000)
    await h.call("pr.checks", { taskId: T })
    expect(h.ran).toHaveLength(3)
  })

  test("a task with no PR, or a gh that cannot answer, is a result and not a throw", async () => {
    const down = harness({ "pr view": { ok: false, detail: "gh: not logged in" } })
    expect(await down.call("pr.checks", { taskId: T })).toEqual({ outcome: "unavailable", detail: "gh: not logged in" })
    const bad = harness({ "pr view": { ok: true, stdout: "<html>" } })
    expect(await bad.call("pr.checks", { taskId: T })).toMatchObject({ outcome: "unavailable" })
  })

  test("a legacy status and a skipped run read as the right states", () => {
    expect(checkState({ state: "SUCCESS" })).toBe("pass")
    expect(checkState({ status: "COMPLETED", conclusion: "SKIPPED" })).toBe("skipped")
    expect(checkState({ status: "COMPLETED", conclusion: "TIMED_OUT" })).toBe("fail")
    expect(checkState({ status: "QUEUED" })).toBe("pending")
  })
})

describe("pr.checkLog", () => {
  const log = ["test\tRun\tline 1", "test\tRun\tboom", "lint\tRun\tother"].join("\n")

  test("returns one job's tail, and one download serves every job of that run", async () => {
    const h = harness({ "run view": { ok: true, stdout: log } })
    expect(await h.call("pr.checkLog", { taskId: T, runId: "12", job: "test" })).toEqual({
      outcome: "ok",
      tail: "line 1\nboom",
    })
    expect(await h.call("pr.checkLog", { taskId: T, runId: "12", job: "lint" })).toEqual({
      outcome: "ok",
      tail: "other",
    })
    expect(await h.call("pr.checkLog", { taskId: T, runId: "12", job: "absent" })).toEqual({ outcome: "none" })
    expect(h.ran).toEqual([["run", "view", "12", "--log-failed"]])
  })

  test("the tail is bounded", async () => {
    const long = Array.from({ length: 500 }, (_, i) => `test\tRun\t${"x".repeat(50)} ${i}`).join("\n")
    const h = harness({ "run view": { ok: true, stdout: long } })
    const res = (await h.call("pr.checkLog", { taskId: T, runId: "12", job: "test" })) as { tail: string }
    expect(res.tail.length).toBeLessThanOrEqual(4000)
    expect(res.tail.split("\n").length).toBeLessThanOrEqual(40)
    expect(res.tail.endsWith("499")).toBe(true)
  })

  test("a run id that is not a number never reaches gh", async () => {
    const h = harness({ "run view": { ok: true, stdout: log } })
    await expect(h.call("pr.checkLog", { taskId: T, runId: "12 --web", job: "test" })).rejects.toMatchObject({
      code: "BAD_ARGS",
    })
    await expect(h.call("pr.checkLog", { taskId: T, runId: "--repo=x", job: "test" })).rejects.toMatchObject({
      code: "BAD_ARGS",
    })
    expect(h.ran).toEqual([])
  })
})
