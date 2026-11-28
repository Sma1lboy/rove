import { splitPathForDirSuggest } from "@sma1lboy/rove-core/lib/path-helpers.ts"
import { tildify } from "@sma1lboy/rove-core/lib/path-home.ts"
import { matchTaskByCwd, tasksAtWorktreePath } from "@sma1lboy/rove-daemon/daemon/cwd-task"
import { isForeignDaemonHome } from "@sma1lboy/rove-daemon/daemon/protocol-compat"
import { expect, it } from "vitest"
import { sameHistoryWorktree } from "../../src/engine/history-worktree"
import { relativeToWorktree } from "../../src/lib/editor-launch"

it("attributes Windows hooks to the most specific saved worktree", () => {
  const tasks = [
    { id: "main", worktreePath: "C:/repo" },
    { id: "child", worktreePath: "C:/repo/worktrees/child/" },
  ]
  expect(matchTaskByCwd(tasks, "C:\\repo\\worktrees\\child\\src")).toBe("child")
  expect(tasksAtWorktreePath(tasks, "C:\\repo\\worktrees\\child")).toEqual(["child"])
  expect(matchTaskByCwd(tasks, "C:\\repo-other")).toBeUndefined()
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
