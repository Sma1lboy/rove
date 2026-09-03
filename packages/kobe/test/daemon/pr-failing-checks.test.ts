import {
  MAX_FAILING_JOBS,
  failingCheckTargets,
  joinFailingChecks,
  parseFailedRunLog,
  runIdFromDetailsUrl,
} from "@sma1lboy/kobe-daemon/daemon/pr-failing-checks"
import { describe, expect, it } from "vitest"

describe("runIdFromDetailsUrl", () => {
  it("pulls the workflow run id out of a CheckRun details url", () => {
    expect(runIdFromDetailsUrl("https://github.com/o/r/actions/runs/33738142593/job/100593506044")).toBe("33738142593")
  })
  it("is null for a non-Actions check (a Vercel StatusContext target)", () => {
    expect(runIdFromDetailsUrl("https://vercel.com/github")).toBeNull()
    expect(runIdFromDetailsUrl("")).toBeNull()
  })
})

describe("failingCheckTargets", () => {
  it("keeps only the failed COMPLETED CheckRuns, with their run ids", () => {
    const targets = failingCheckTargets([
      {
        __typename: "CheckRun",
        name: "typecheck-and-test",
        status: "COMPLETED",
        conclusion: "SUCCESS",
        detailsUrl: "https://github.com/o/r/actions/runs/1/job/1",
      },
      {
        __typename: "CheckRun",
        name: "render-track",
        status: "COMPLETED",
        conclusion: "FAILURE",
        detailsUrl: "https://github.com/o/r/actions/runs/2/job/2",
      },
      {
        __typename: "CheckRun",
        name: "behavior",
        status: "COMPLETED",
        conclusion: "TIMED_OUT",
        detailsUrl: "https://github.com/o/r/actions/runs/2/job/3",
      },
    ])
    expect(targets.map((t) => t.jobName)).toEqual(["render-track", "behavior"])
    expect(targets.map((t) => t.runId)).toEqual(["2", "2"])
    expect(targets[0]?.conclusion).toBe("FAILURE")
  })

  it("skips a still-running check even when it carries a stale conclusion", () => {
    expect(
      failingCheckTargets([{ name: "flaky", status: "IN_PROGRESS", conclusion: "FAILURE", detailsUrl: "" }]),
    ).toEqual([])
  })

  it("reads a legacy StatusContext from its state and targetUrl", () => {
    const targets = failingCheckTargets([
      { __typename: "StatusContext", context: "Vercel", state: "FAILURE", targetUrl: "https://vercel.com/x" },
      { __typename: "StatusContext", context: "Other", state: "PENDING", targetUrl: "https://vercel.com/y" },
    ])
    expect(targets).toEqual([{ jobName: "Vercel", conclusion: "FAILURE", url: "https://vercel.com/x", runId: null }])
  })

  it("treats SKIPPED and NEUTRAL as passing, not failing", () => {
    expect(
      failingCheckTargets([
        { name: "a", status: "COMPLETED", conclusion: "SKIPPED" },
        { name: "b", status: "COMPLETED", conclusion: "NEUTRAL" },
      ]),
    ).toEqual([])
  })
})

describe("parseFailedRunLog", () => {
  const log = [
    "render-track\tCoverage floor\t2026-09-03T09:17:42Z ##[group]Run bun scripts/coverage-gate.mjs",
    "render-track\tCoverage floor\t2026-09-03T09:17:43Z floor not met",
    "behavior\tRun tests\t2026-09-03T09:18:00Z 1 failing",
    "not a tsv line",
    "",
  ].join("\n")

  it("groups by job and drops the step column", () => {
    const byJob = parseFailedRunLog(log)
    expect([...byJob.keys()]).toEqual(["render-track", "behavior"])
    expect(byJob.get("render-track")).toEqual([
      "2026-09-03T09:17:42Z ##[group]Run bun scripts/coverage-gate.mjs",
      "2026-09-03T09:17:43Z floor not met",
    ])
    expect(byJob.get("behavior")).toEqual(["2026-09-03T09:18:00Z 1 failing"])
  })

  it("keeps the LAST maxLines per job — a failure's cause is at the end", () => {
    const many = Array.from({ length: 10 }, (_, i) => `job\tstep\tline ${i}`).join("\n")
    expect(parseFailedRunLog(many, 3).get("job")).toEqual(["line 7", "line 8", "line 9"])
  })

  it("strips the BOM gh writes on the first line of a job", () => {
    expect(parseFailedRunLog("job\tstep\t﻿first").get("job")).toEqual(["first"])
  })
})

describe("joinFailingChecks", () => {
  const target = (jobName: string) => ({ jobName, conclusion: "FAILURE", url: `u/${jobName}`, runId: "1" })

  it("caps the reported jobs but still counts them all", () => {
    const targets = ["a", "b", "c", "d"].map(target)
    const result = joinFailingChecks(targets, new Map([["a", ["x"]]]))
    expect(result.totalFailing).toBe(4)
    expect(result.checks).toHaveLength(MAX_FAILING_JOBS)
    expect(result.checks[0]).toEqual({ jobName: "a", conclusion: "FAILURE", url: "u/a", tail: "x" })
  })

  it("still reports a job whose log could not be read, with an empty tail", () => {
    const result = joinFailingChecks([target("a")], new Map())
    expect(result.checks).toEqual([{ jobName: "a", conclusion: "FAILURE", url: "u/a", tail: "" }])
  })
})
