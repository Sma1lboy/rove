/**
 * Real git: `worktree add` writes its checkout meter into Rove's stderr pipe,
 * and creating a task's worktree reports it as whole percents.
 */

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, expect, test } from "vitest"
import { checkoutProgressReader } from "../../src/orchestrator/worktree/checkout-progress.ts"
import { GitWorktreeManager } from "../../src/orchestrator/worktree/manager.ts"

let tmpRoot: string
let repo: string
let prevHome: string | undefined
let prevDelay: string | undefined

function git(cwd: string, ...args: string[]): void {
  // No auto gc/maintenance: `commit` detaches one that can still be writing `.git/objects` at teardown.
  const config = ["user.email=t@t", "user.name=t", "commit.gpgsign=false", "gc.auto=0", "maintenance.auto=false"]
  const r = spawnSync("git", [...config.flatMap((c) => ["-c", c]), ...args], {
    cwd,
    encoding: "utf8",
  })
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`)
}

beforeEach(() => {
  tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rove-checkout-progress-")))
  repo = path.join(tmpRoot, "repo")
  prevHome = process.env.ROVE_HOME_DIR
  process.env.ROVE_HOME_DIR = path.join(tmpRoot, "home")
  // Git holds its meter back for two seconds; a small test repo checks out faster than that.
  prevDelay = process.env.GIT_PROGRESS_DELAY
  process.env.GIT_PROGRESS_DELAY = "0"
  fs.mkdirSync(repo, { recursive: true })
  git(repo, "init", "-q", "-b", "main")
  for (let i = 0; i < 300; i++) fs.writeFileSync(path.join(repo, `f${i}.txt`), String(i))
  git(repo, "add", "-A")
  git(repo, "commit", "-q", "-m", "init")
})

afterEach(() => {
  if (prevHome === undefined) Reflect.deleteProperty(process.env, "ROVE_HOME_DIR")
  else process.env.ROVE_HOME_DIR = prevHome
  if (prevDelay === undefined) Reflect.deleteProperty(process.env, "GIT_PROGRESS_DELAY")
  else process.env.GIT_PROGRESS_DELAY = prevDelay
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

test("creating a task's worktree reports the checkout's percents up to 100", async () => {
  const seen: number[] = []
  const info = await new GitWorktreeManager().createForTask({
    repo,
    slug: "wide",
    branch: "feat/wide",
    onProgress: (percent) => seen.push(percent),
  })
  expect(fs.existsSync(path.join(info.path, "f299.txt"))).toBe(true)
  expect(seen.at(-1)).toBe(100)
  expect(seen).toEqual([...new Set(seen)].sort((a, b) => a - b))
})

test("a meter frame split across chunks, under a translated label, still reads", () => {
  const seen: number[] = []
  const read = checkoutProgressReader((percent) => seen.push(percent))
  read("Dateien werden aktualisiert:  4")
  read("2% (42/100)\rDateien werden aktualisiert:  42% (42/100)\rDateien werden aktual")
  read("isiert: 100% (100/100), Fertig.\n")
  expect(seen).toEqual([42, 100])
})
