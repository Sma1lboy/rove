import { legacyAdoptedTasks } from "@sma1lboy/rove-daemon/daemon/legacy-adopted"
import { expect, it } from "vitest"

const ghost = { id: "ghost", title: "agent-a1", worktreePath: "/repo/.claude/worktrees/agent-a1", status: "backlog" }

it("finds a backlog task still named after its worktree directory", () => {
  expect(legacyAdoptedTasks([ghost]).map((t) => t.id)).toEqual(["ghost"])
})

it("leaves alone anything a person named, started, or that Rove made for another purpose", () => {
  const kept = [
    { ...ghost, id: "named", title: "fix the login page" },
    { ...ghost, id: "started", status: "in_progress" },
    { ...ghost, id: "checkout", worktreeOnly: true },
    { ...ghost, id: "child", parentTaskId: "main" },
    { ...ghost, id: "main", kind: "dir", title: "repo", worktreePath: "/repo" },
    { ...ghost, id: "archived", archived: true },
  ]
  expect(legacyAdoptedTasks(kept)).toEqual([])
})
