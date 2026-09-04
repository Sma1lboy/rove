import { execFileSync } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  listUnreadableWorktreesAdapter,
  listWorktreeProjectsAdapter,
  removeWorktreeAdapter,
} from "../../src/core/daemon-worktree-adapter.ts"
import { addSavedRepo } from "../../src/state/repos.ts"

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Kobe Test",
      GIT_AUTHOR_EMAIL: "kobe@example.com",
      GIT_COMMITTER_NAME: "Kobe Test",
      GIT_COMMITTER_EMAIL: "kobe@example.com",
    },
  })

describe("daemon worktree adapter", () => {
  let root: string
  let repo: string
  let worktree: string
  let previousHome: string | undefined

  beforeAll(async () => {
    previousHome = process.env.KOBE_HOME_DIR
    root = await mkdtemp(join(tmpdir(), "kobe-daemon-worktrees-"))
    process.env.KOBE_HOME_DIR = join(root, "home")
    repo = join(root, "repo")
    worktree = join(root, "feature")
    await mkdir(repo)
    await writeFile(join(repo, "README.md"), "fixture\n")
    git(repo, "init", "-b", "main")
    git(repo, "add", "README.md")
    git(repo, "commit", "-m", "fixture")
    git(repo, "worktree", "add", "-b", "feature/demo", worktree)
    addSavedRepo(repo)
  })

  afterAll(async () => {
    if (previousHome === undefined) process.env.KOBE_HOME_DIR = undefined
    else process.env.KOBE_HOME_DIR = previousHome
    await rm(root, { recursive: true, force: true })
  })

  it("lists saved local projects with worktree audit metadata", async () => {
    const projects = await listWorktreeProjectsAdapter(false)
    expect(projects).toHaveLength(1)
    expect(projects[0]?.repo).toBe(repo)
    const row = projects[0]?.worktrees.find((entry) => entry.branch === "feature/demo")
    expect(row).toEqual(expect.objectContaining({ branch: "feature/demo", repo }))
    expect(row?.path.endsWith("/feature")).toBe(true)
  })

  it("reports a repo with no unreadable worktrees as empty", async () => {
    expect(await listUnreadableWorktreesAdapter(repo)).toEqual([])
  })

  it("removes a worktree and surfaces a failed audit as a rejection", async () => {
    // A clean worktree removes without residue: git deregisters it AND
    // deletes the directory, so there is nothing left to report.
    expect(await removeWorktreeAdapter(worktree, false)).toBeNull()

    // A saved repo whose directory does not exist — the audit must fail on
    // it. `skipGate` because the admission gate would (correctly) refuse a
    // non-repo path, and this test needs the broken entry to EXIST.
    addSavedRepo(join(root, "missing"), { skipGate: true })
    await expect(listWorktreeProjectsAdapter(true)).rejects.toThrow()
  })
})
