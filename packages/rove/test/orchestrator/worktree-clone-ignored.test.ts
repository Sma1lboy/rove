/**
 * Real git, real temp repo; only the filesystem-clone seam is injected, so the
 * suite runs on any platform while exercising discovery, gating and fallback.
 */

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import type { CloneIgnoredDeps } from "../../src/orchestrator/worktree/clone-ignored.ts"
import { GitWorktreeManager } from "../../src/orchestrator/worktree/manager.ts"

let tmpRoot: string
let repo: string
let prevHome: string | undefined
let logs: string[]

function git(cwd: string, ...args: string[]): void {
  const r = spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args], {
    cwd,
    encoding: "utf8",
  })
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`)
}

function write(file: string, content = "x"): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

/** Tracked: README, packages/x/index.js, lib/target/keep.txt. Ignored: node_modules (root + nested), dist, lib/target/junk.bin. */
function seedRepo(extraTracked: Record<string, string> = {}): void {
  fs.mkdirSync(repo, { recursive: true })
  git(repo, "init", "-q", "-b", "main")
  write(path.join(repo, ".gitignore"), "node_modules/\ndist/\n*.bin\n")
  write(path.join(repo, "README.md"))
  write(path.join(repo, "packages/x/index.js"))
  write(path.join(repo, "lib/target/keep.txt"))
  for (const [rel, content] of Object.entries(extraTracked)) write(path.join(repo, rel), content)
  git(repo, "add", "-A")
  git(repo, "commit", "-q", "-m", "init")
  write(path.join(repo, "node_modules/dep/index.js"), "root dep")
  write(path.join(repo, "packages/x/node_modules/nested/index.js"), "nested dep")
  write(path.join(repo, "dist/out.js"))
  write(path.join(repo, "lib/target/junk.bin"))
}

function deps(over: Partial<CloneIgnoredDeps> = {}): (exec: unknown) => CloneIgnoredDeps {
  return () => ({
    platform: "darwin",
    statDev: async () => 1,
    isApfs: async () => true,
    clone: (source, target) => fs.promises.cp(source, target, { recursive: true }),
    log: (m) => logs.push(m),
    ...over,
  })
}

async function createTask(over: Partial<CloneIgnoredDeps> = {}): Promise<string> {
  const mgr = new GitWorktreeManager(undefined, deps(over))
  return (await mgr.createForTask({ repo, slug: "t1", branch: "feat/t1" })).path
}

beforeEach(() => {
  prevHome = process.env.ROVE_HOME_DIR
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rove-clone-ignored-"))
  process.env.ROVE_HOME_DIR = path.join(tmpRoot, "home")
  repo = path.join(tmpRoot, "repo")
  logs = []
})

afterEach(() => {
  if (prevHome === undefined) Reflect.deleteProperty(process.env, "ROVE_HOME_DIR")
  else process.env.ROVE_HOME_DIR = prevHome
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

describe("cloning ignored dirs into a new task worktree", () => {
  test("clones root and nested node_modules; leaves other ignored dirs and tracked dirs alone", async () => {
    seedRepo()
    const wt = await createTask()

    expect(fs.readFileSync(path.join(wt, "node_modules/dep/index.js"), "utf8")).toBe("root dep")
    expect(fs.readFileSync(path.join(wt, "packages/x/node_modules/nested/index.js"), "utf8")).toBe("nested dep")
    // `dist` is ignored but not in the default list.
    expect(fs.existsSync(path.join(wt, "dist"))).toBe(false)
    // A directory holding a tracked file is never poured into: junk.bin is ignored but lives in tracked lib/target.
    expect(fs.existsSync(path.join(wt, "lib/target/keep.txt"))).toBe(true)
    expect(fs.existsSync(path.join(wt, "lib/target/junk.bin"))).toBe(false)
  })

  test("`.rove/clone-dirs` replaces the default list", async () => {
    seedRepo({ ".rove/clone-dirs": "# build output only\ndist\n" })
    const wt = await createTask()

    expect(fs.existsSync(path.join(wt, "dist/out.js"))).toBe(true)
    expect(fs.existsSync(path.join(wt, "node_modules"))).toBe(false)
  })

  test("`worktree.cloneIgnored: false` in state.json turns it off", async () => {
    seedRepo()
    write(path.join(tmpRoot, "home/.config/rove/state.json"), JSON.stringify({ "worktree.cloneIgnored": false }))
    const wt = await createTask()

    expect(fs.existsSync(path.join(wt, "README.md"))).toBe(true)
    expect(fs.existsSync(path.join(wt, "node_modules"))).toBe(false)
  })

  test.each([
    ["source and worktree on different devices", { statDev: async (p: string) => (p.includes("/repo/") ? 1 : 2) }],
    ["the volume is not APFS", { isApfs: async () => false }],
    ["the platform is not darwin", { platform: "linux" as const }],
  ])("skips silently when %s", async (_name, over) => {
    seedRepo()
    const wt = await createTask(over)

    expect(fs.existsSync(path.join(wt, "README.md"))).toBe(true)
    expect(fs.existsSync(path.join(wt, "node_modules"))).toBe(false)
    expect(logs).toEqual([])
  })

  test("a failing clone is logged, leaves no partial copy, and never fails task creation", async () => {
    seedRepo()
    const wt = await createTask({
      clone: async (_source, target) => {
        fs.mkdirSync(path.join(target, "half"), { recursive: true })
        throw new Error("disk on fire")
      },
    })

    expect(fs.existsSync(path.join(wt, "README.md"))).toBe(true)
    expect(fs.existsSync(path.join(wt, "node_modules"))).toBe(false)
    expect(fs.existsSync(path.join(wt, "packages/x/node_modules"))).toBe(false)
    expect(logs.filter((m) => m.includes("disk on fire"))).toHaveLength(2)
  })

  test("a pristine clone does not make deleting the task need --force", async () => {
    seedRepo()
    const wt = await createTask()
    expect(fs.existsSync(path.join(wt, "packages/x/node_modules"))).toBe(true)

    await new GitWorktreeManager(undefined, deps()).remove(wt)

    expect(fs.existsSync(wt)).toBe(false)
  })

  test("a reused worktree is not cloned into", async () => {
    seedRepo()
    const wt = await createTask({ platform: "linux" })
    const again = await new GitWorktreeManager(undefined, deps()).createForTask({
      repo,
      slug: "t1",
      branch: "feat/t1",
    })

    expect(again.path).toBe(wt)
    expect(fs.existsSync(path.join(wt, "node_modules"))).toBe(false)
  })
})
