/**
 * A repo's `.rove/teardown.sh` runs in the worktree right before Rove removes
 * it — and only once the removal is going ahead. Real git, real `sh`.
 */

import { execSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { LocalExecHost } from "../../src/exec/exec-host.ts"
import { GitWorktreeManager } from "../../src/orchestrator/worktree/manager.ts"
import { runRepoTeardown } from "../../src/orchestrator/worktree/teardown.ts"

let root: string
let repo: string
let manager: GitWorktreeManager

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
}

function git(cmd: string, cwd = repo): void {
  execSync(`git ${cmd}`, { cwd, env: gitEnv, stdio: "ignore" })
}

/** A worktree on a branch whose committed `.rove/teardown.sh` is `body`. */
function worktreeWithTeardown(name: string, body: string): string {
  git(`checkout -q -b base-${name} main`)
  mkdirSync(join(repo, ".rove"), { recursive: true })
  writeFileSync(join(repo, ".rove", "teardown.sh"), body)
  git("add .rove/teardown.sh")
  git(`commit -q -m teardown-${name}`)
  git("checkout -q main")
  const wt = join(root, name)
  git(`worktree add -q ${JSON.stringify(wt)} -b rove/${name} base-${name}`)
  return wt
}

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "rove-wt-teardown-")))
  repo = join(root, "repo")
  mkdirSync(repo)
  execSync("git init -q -b main && git commit -q --allow-empty -m init", { cwd: repo, env: gitEnv })
  manager = new GitWorktreeManager()
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe("removing a worktree whose repo ships .rove/teardown.sh", () => {
  it("runs the script inside the worktree before deleting it", async () => {
    const marker = join(root, "ran-clean")
    const wt = worktreeWithTeardown("clean", `pwd > ${JSON.stringify(marker)}\n`)

    await manager.remove(wt)

    expect(readFileSync(marker, "utf8").trim()).toBe(wt)
    expect(existsSync(wt)).toBe(false)
  })

  it("still removes the worktree when the script fails, and logs why", async () => {
    const wt = worktreeWithTeardown("failing", "echo 'database busy' >&2\nexit 3\n")
    const log = vi.spyOn(console, "error").mockImplementation(() => {})

    await manager.remove(wt)

    expect(existsSync(wt)).toBe(false)
    expect(log.mock.calls.flat().join("\n")).toMatch(/teardown\.sh .*exit 3: database busy/)
    log.mockRestore()
  })

  it("does not run when the removal is refused for uncommitted work", async () => {
    const marker = join(root, "ran-dirty")
    const wt = worktreeWithTeardown("dirty", `touch ${JSON.stringify(marker)}\n`)
    writeFileSync(join(wt, "notes.txt"), "unsaved")

    await expect(manager.remove(wt)).rejects.toThrow()

    expect(existsSync(marker)).toBe(false)
    expect(existsSync(wt)).toBe(true)
  })

  it("gives up on a script that outlives its time limit", async () => {
    const wt = worktreeWithTeardown("hung", "sleep 30\n")

    const outcome = await runRepoTeardown(new LocalExecHost(), wt, 200)

    expect(outcome).toEqual({ kind: "failed", reason: expect.stringMatching(/timed out/) })
  })
})
