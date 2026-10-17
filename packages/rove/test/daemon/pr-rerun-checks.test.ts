import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { rerunFailedChecks } from "@sma1lboy/rove-daemon/daemon/pr-rerun-checks"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

const ROLLUP = JSON.stringify({
  statusCheckRollup: [
    { name: "lint", status: "COMPLETED", conclusion: "SUCCESS", detailsUrl: "https://x/actions/runs/10/job/1" },
    { name: "test (a)", status: "COMPLETED", conclusion: "FAILURE", detailsUrl: "https://x/actions/runs/20/job/2" },
    { name: "test (b)", status: "COMPLETED", conclusion: "TIMED_OUT", detailsUrl: "https://x/actions/runs/20/job/3" },
    { name: "e2e", status: "COMPLETED", conclusion: "FAILURE", detailsUrl: "https://x/actions/runs/30/job/4" },
    { context: "preview-deploy", state: "ERROR", targetUrl: "https://deploy.example/1" },
  ],
})

/** Real spawns through a fake `gh` on PATH: answers `pr view` with {@link ROLLUP},
 *  logs every `run rerun`, and refuses run 30 when asked to. */
describe("rerunFailedChecks", () => {
  let binDir: string
  let cwd: string
  let calls: string
  let previousPath: string | undefined

  function fakeGh(refuseRun30: boolean): void {
    writeFileSync(join(binDir, "rollup.json"), ROLLUP)
    writeFileSync(
      join(binDir, "gh"),
      [
        "#!/bin/sh",
        `if [ "$1" = "pr" ]; then cat "${join(binDir, "rollup.json")}"; exit 0; fi`,
        `echo "$*" >> "${calls}"`,
        refuseRun30 ? `if [ "$3" = "30" ]; then echo "run 30 cannot be rerun; it is in progress" >&2; exit 1; fi` : "",
        "exit 0",
        "",
      ].join("\n"),
      { mode: 0o755 },
    )
  }

  beforeEach(() => {
    binDir = mkdtempSync(join(tmpdir(), "rove-fake-gh-"))
    cwd = mkdtempSync(join(tmpdir(), "rove-gh-cwd-"))
    calls = join(binDir, "calls.log")
    writeFileSync(calls, "")
    previousPath = process.env.PATH
    process.env.PATH = `${binDir}:${previousPath ?? ""}`
  })

  afterEach(() => {
    process.env.PATH = previousPath ?? ""
    rmSync(binDir, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
  })

  it("restarts each failed run's failed jobs once, and counts the non-Actions check", async () => {
    fakeGh(false)
    const res = await rerunFailedChecks({ worktreePath: cwd, prNumber: 7 })

    // Run 20 failed twice (a matrix) and is restarted once; passing run 10 is left alone.
    expect(readFileSync(calls, "utf8").trim().split("\n")).toEqual(["run rerun 20 --failed", "run rerun 30 --failed"])
    expect(res).toEqual({ rerunRuns: 2, external: 1 })
  })

  it("keeps going past a run gh refuses, and quotes the refusal", async () => {
    fakeGh(true)
    const res = await rerunFailedChecks({ worktreePath: cwd, prNumber: 7 })

    expect(res.rerunRuns).toBe(1)
    expect(res.refused).toContain("in progress")
  })
})
