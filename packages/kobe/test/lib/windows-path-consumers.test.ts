import { findAdoptableWorktree, matchTaskByCwd, matchTaskByWorktreePath } from "@sma1lboy/kobe-daemon/daemon/cwd-task"
import { expect, it } from "vitest"
import { isForeignDaemonHome } from "../../../kobe-daemon/src/daemon/protocol-compat"
import { sameHistoryWorktree } from "../../src/engine/history-worktree"
import { tildify } from "../../src/lib/path-home"
import { relativeToWorktree } from "../../src/tui/lib/editor-launch"
import { splitPathForDirSuggest } from "../../src/tui/lib/path-helpers"

it("attributes Windows hooks to the most specific saved worktree", () => {
  const tasks = [
    { id: "main", worktreePath: "C:/repo" },
    { id: "child", worktreePath: "C:/repo/worktrees/child/" },
  ]
  expect(matchTaskByCwd(tasks, "C:\\repo\\worktrees\\child\\src")).toBe("child")
  expect(matchTaskByWorktreePath(tasks, "C:\\repo\\worktrees\\child")).toBe("child")
  expect(matchTaskByCwd(tasks, "C:\\repo-other")).toBeUndefined()
})

it.runIf(process.platform === "win32")("adopts a native Windows repo-local worktree only once", () => {
  const main = { id: "main", repo: "C:\\path-identity-fixture\\repo", worktreePath: "C:\\path-identity-fixture\\repo" }
  const cwd = "C:\\path-identity-fixture\\repo\\.rove\\worktrees\\child\\src"
  expect(findAdoptableWorktree([main], cwd)?.worktreePath).toBe("C:/path-identity-fixture/repo/.rove/worktrees/child")
  const child = { id: "child", repo: main.repo, worktreePath: "C:/path-identity-fixture/repo/.rove/worktrees/child/" }
  expect(findAdoptableWorktree([main, child], cwd)).toBeUndefined()
})

it("accepts the same daemon home in native and git spelling", () => {
  expect(isForeignDaemonHome("C:\\Users\\me", "C:/Users/me/")).toBe(false)
})

it("finds engine history with a trailing directory separator", () => {
  expect(sameHistoryWorktree("C:\\repo\\", "C:/repo")).toBe(true)
})

it("shortens a native Windows home and completes native directory input", () => {
  expect(tildify("C:\\Users\\me\\repo", "C:/Users/me")).toBe("~/repo")
  expect(splitPathForDirSuggest("C:\\Users\\me\\rep")).toEqual({ base: "C:\\Users\\me\\", filter: "rep" })
})

it("opens a Windows worktree file through the repository diff editor", () => {
  expect(relativeToWorktree("C:/repo", "C:\\repo\\src\\main.ts")).toBe("src/main.ts")
  expect(relativeToWorktree("C:/repo", "C:/repo-other/main.ts")).toBeNull()
})
