/**
 * The live `gh` runner's lookup order, against a fake `gh` on PATH and a real
 * git worktree: an agent that pushes HEAD to a ref named unlike its task branch
 * must still get its PR chip.
 */

import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { makeGhPrViewRunner } from "@sma1lboy/rove-daemon/daemon/pr-status-collector"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { daemonRuntime } from "../../src/core/daemon-runtime.ts"

let tmp: string
let repo: string
let head: string
let calls: string
const savedPath = process.env.PATH

/** `gh` answering by argv: no PR on any branch, a PR view by number, and a sha search hit. */
function fakeGh(search: string): void {
  const bin = path.join(tmp, "bin")
  fs.mkdirSync(bin)
  fs.writeFileSync(
    path.join(bin, "gh"),
    `#!/bin/sh
echo "$*" >> "${calls}"
case "$*" in
  "pr list --head"*) echo '[]' ;;
  "pr view 42"*) echo '{"number":42,"state":"OPEN"}' ;;
  "pr list --search"*) echo '${search}' ;;
  *) exit 1 ;;
esac
`,
    { mode: 0o755 },
  )
  process.env.PATH = `${bin}:${savedPath}`
}

const run = () => makeGhPrViewRunner(daemonRuntime.prStatus.classify, daemonRuntime.prStatus.viewFields)

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rove-prrunner-"))
  repo = path.join(tmp, "repo")
  calls = path.join(tmp, "calls")
  fs.mkdirSync(repo)
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim()
  git("init", "-q")
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "x")
  head = git("rev-parse", "HEAD")
})

afterEach(() => {
  process.env.PATH = savedPath
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe("makeGhPrViewRunner", () => {
  test("a branch with no PR finds the PR whose head is the worktree's HEAD, not one merely containing it", async () => {
    fakeGh(`[{"number":9,"state":"MERGED","headRefOid":"0000"},{"number":1452,"state":"OPEN","headRefOid":"${head}"}]`)
    const result = await run()(repo, "hermes/pr-1452-fix")
    expect(result).toMatchObject({ kind: "pr", view: { number: 1452 } })
  })

  test("a pinned PR number is followed without searching, so a moved HEAD keeps the chip", async () => {
    fakeGh("[]")
    const result = await run()(repo, "hermes/pr-1452-fix", 42)
    expect(result).toMatchObject({ kind: "pr", view: { number: 42 } })
    expect(fs.readFileSync(calls, "utf8")).not.toContain("--search")
  })

  test("only PRs containing HEAD as a non-head commit → no PR", async () => {
    fakeGh(`[{"number":9,"state":"MERGED","headRefOid":"0000"}]`)
    expect(await run()(repo, "feature")).toEqual({ kind: "empty" })
  })
})
