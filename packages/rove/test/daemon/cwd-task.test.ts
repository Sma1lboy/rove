import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import path from "node:path"
import { matchTaskByCwd, resolvePtyOwner, tasksAtWorktreePath } from "@sma1lboy/rove-daemon/daemon/cwd-task"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

let prevHome: string | undefined

beforeEach(() => {
  prevHome = process.env.ROVE_HOME_DIR
  process.env.ROVE_HOME_DIR = "/home/rove-test"
})

afterEach(() => {
  if (prevHome === undefined) Reflect.deleteProperty(process.env, "ROVE_HOME_DIR")
  else process.env.ROVE_HOME_DIR = prevHome
})

describe("matchTaskByCwd", () => {
  const main = { id: "main", worktreePath: "/repo" }
  const sub = { id: "sub", worktreePath: "/repo/.claude/worktrees/snipe" }
  const other = { id: "other", worktreePath: "/elsewhere/proj" }
  const tasks = [main, sub, other]

  it("limits home cwd attribution to the exact directory and allows explicit descendants", () => {
    const home = { id: "home", worktreePath: homedir() }
    const scratch = { id: "scratch", worktreePath: path.join(homedir(), "tmp") }
    expect(matchTaskByCwd([home], home.worktreePath)).toBe("home")
    expect(matchTaskByCwd([home], scratch.worktreePath)).toBeUndefined()
    expect(matchTaskByCwd([home, scratch], path.join(scratch.worktreePath, "notes"))).toBe("scratch")
    expect(resolvePtyOwner([home], "home", "tab-1")).toBe("home")
  })

  it("matches a cwd inside a worktree", () => {
    expect(matchTaskByCwd(tasks, "/elsewhere/proj/src/deep")).toBe("other")
  })

  it("prefers the longest (most specific) worktree — sub-task over its repo root", () => {
    // A sub-task's worktree lives UNDER the main task's repo root, so the cwd
    // prefix-matches both; the longer path must win.
    expect(matchTaskByCwd(tasks, "/repo/.claude/worktrees/snipe")).toBe("sub")
    expect(matchTaskByCwd(tasks, "/repo/.claude/worktrees/snipe/pkg")).toBe("sub")
  })

  it("falls back to the repo-root (main) task for a cwd not under any sub-worktree", () => {
    expect(matchTaskByCwd(tasks, "/repo/src")).toBe("main")
    expect(matchTaskByCwd(tasks, "/repo")).toBe("main")
  })

  it("returns undefined for an unrelated cwd", () => {
    expect(matchTaskByCwd(tasks, "/totally/unrelated")).toBeUndefined()
  })

  it("does not treat a sibling-prefix dir as a match (/repo vs /repo-other)", () => {
    expect(matchTaskByCwd([main], "/repo-other/src")).toBeUndefined()
  })

  it("attributes a cwd inside an extra worktree of a multi-repo task, and the owner wins over the main row", () => {
    const multi = { id: "multi", worktreePath: "/wt/web-1", extraRepos: [{ worktreePath: "/other/.wt/api-1" }] }
    const apiMain = { id: "api-main", worktreePath: "/other" }
    expect(matchTaskByCwd([main, apiMain, multi], "/other/.wt/api-1/src")).toBe("multi")
    expect(tasksAtWorktreePath([multi], "/other/.wt/api-1")).toEqual(["multi"])
  })
})

// The engine hooks are global, so a cwd under a tracked worktree can belong to
// a DIFFERENT repository — a vendored clone under `refs/`, a `.dev-sandbox`
// checkout, any repo under a `$HOME` scratch shell's directory task. Real
// directories, because the boundary is decided by a `.git` on disk.
describe("matchTaskByCwd across a repository boundary", () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "rove-cwd-task-"))
    // A tracked project, its own plain subdir, and a nested UNRELATED repo.
    mkdirSync(path.join(root, "alpha", ".git"), { recursive: true })
    mkdirSync(path.join(root, "alpha", "src", "deep"), { recursive: true })
    mkdirSync(path.join(root, "alpha", "refs", "vendorlib", ".git"), { recursive: true })
    // A repo and a plain directory under a `$HOME`-style directory task.
    mkdirSync(path.join(root, "gamma", ".git"), { recursive: true })
    mkdirSync(path.join(root, "notes"), { recursive: true })
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it("drops a cwd in a nested repo of its own", () => {
    const tasks = [{ id: "alpha", worktreePath: path.join(root, "alpha") }]
    expect(matchTaskByCwd(tasks, path.join(root, "alpha", "refs", "vendorlib"))).toBeUndefined()
    expect(matchTaskByCwd(tasks, path.join(root, "alpha", "refs", "vendorlib", "sub"))).toBeUndefined()
  })

  it("does not make a directory task the owner of every repo beneath it", () => {
    const tasks = [{ id: "scratch", worktreePath: root }]
    expect(matchTaskByCwd(tasks, path.join(root, "gamma"))).toBeUndefined()
    expect(matchTaskByCwd(tasks, path.join(root, "alpha", "src", "deep"))).toBeUndefined()
    // A plain directory under it crosses nothing and still belongs to the task.
    expect(matchTaskByCwd(tasks, path.join(root, "notes"))).toBe("scratch")
  })

  it("matches a nested repo that is a task in its own right", () => {
    // The nested repo IS tracked: the longer worktree wins and no boundary
    // sits below it, so its own sessions keep landing on it.
    const tasks = [
      { id: "alpha", worktreePath: path.join(root, "alpha") },
      { id: "vendor", worktreePath: path.join(root, "alpha", "refs", "vendorlib") },
    ]
    expect(matchTaskByCwd(tasks, path.join(root, "alpha", "refs", "vendorlib", "sub"))).toBe("vendor")
  })

  it("treats a `.git` FILE (submodule / linked worktree) as a boundary too", () => {
    mkdirSync(path.join(root, "alpha", "vendored"), { recursive: true })
    writeFileSync(path.join(root, "alpha", "vendored", ".git"), "gitdir: ../../elsewhere\n")
    const tasks = [{ id: "alpha", worktreePath: path.join(root, "alpha") }]
    expect(matchTaskByCwd(tasks, path.join(root, "alpha", "vendored"))).toBeUndefined()
  })
})

describe("tasksAtWorktreePath", () => {
  const tasks = [
    { id: "main", repo: "/repo", worktreePath: "/repo" },
    { id: "sub", repo: "/repo", worktreePath: "/repo/.claude/worktrees/snipe" },
  ]

  it("matches a task whose worktree IS exactly the path", () => {
    expect(tasksAtWorktreePath(tasks, "/repo/.claude/worktrees/snipe")).toEqual(["sub"])
  })

  it("does NOT match a parent on a path prefix (unlike matchTaskByCwd)", () => {
    // Removing an untracked worktree under /repo must not affect the main task.
    expect(tasksAtWorktreePath(tasks, "/repo/.claude/worktrees/unknown")).toEqual([])
  })

  it("lists the owner before the children sharing its directory, whatever the row order", () => {
    const shared = [
      { id: "b-child", repo: "/repo", worktreePath: "/repo/wt", sharesWorkspaceOf: "z-owner" },
      { id: "a-child", repo: "/repo", worktreePath: "/repo/wt", sharesWorkspaceOf: "z-owner" },
      { id: "z-owner", repo: "/repo", worktreePath: "/repo/wt" },
    ]
    expect(tasksAtWorktreePath(shared, "/repo/wt")).toEqual(["z-owner", "a-child", "b-child"])
  })
})

describe("hooks in a directory shared by a parent and its children", () => {
  const shared = [
    { id: "child", repo: "/repo", worktreePath: "/repo/wt", sharesWorkspaceOf: "owner" },
    { id: "owner", repo: "/repo", worktreePath: "/repo/wt" },
  ]

  it("attributes a cwd-only report to the owner, never to whichever row is listed first", () => {
    expect(matchTaskByCwd(shared, "/repo/wt")).toBe("owner")
    expect(matchTaskByCwd([...shared].reverse(), "/repo/wt")).toBe("owner")
  })

  it("resolves a report from a migrated child's parent-keyed PTY to the child", () => {
    const tasks = [
      { id: "parent", repo: "/repo", worktreePath: "/repo/wt" },
      {
        id: "migrated",
        repo: "/repo",
        worktreePath: "/repo/wt",
        sharesWorkspaceOf: "parent",
        ptyAlias: { taskId: "parent", tabId: "tab-2" },
      },
    ]
    expect(resolvePtyOwner(tasks, "parent", "tab-2")).toBe("migrated")
    expect(resolvePtyOwner(tasks, "parent", "tab-1")).toBe("parent")
    expect(resolvePtyOwner(tasks, "parent", undefined)).toBe("parent")
  })
})
