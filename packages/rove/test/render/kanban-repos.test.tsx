/** @jsxImportSource @opentui/react */
import { afterEach, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathIdentity } from "@sma1lboy/rove-daemon/path-identity"
import { createStateCell } from "../../src/lib/external-store"
import { patchStateFile } from "../../src/state/store"
import { useKanbanBoards } from "../../src/tui-react/component/use-kanban-boards"
import { type Task, toTaskId } from "../../src/types/task"
import { renderComponent, settle } from "./harness"

const previousHome = process.env.ROVE_HOME_DIR
afterEach(() => {
  if (previousHome === undefined) Reflect.deleteProperty(process.env, "ROVE_HOME_DIR")
  else process.env.ROVE_HOME_DIR = previousHome
})

function task(id: string, repo: string): Task {
  return {
    id: toTaskId(id),
    repo,
    title: id,
    branch: id,
    worktreePath: repo,
    kind: "task",
    status: "in_progress",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  }
}

for (const fixture of [
  {
    name: "Windows",
    local: ["C:/repos/alpha", "c:/repos/orbit-sdk/", "C:/repos/zebra"],
    stored: ["C:\\repos\\alpha", "\\\\?\\C:\\repos\\orbit-sdk\\", "c:\\repos\\zebra"],
    roots: ["C:\\repos\\alpha", "C:\\repos\\orbit-sdk", "C:\\repos\\zebra"],
  },
  {
    name: "macOS",
    local: ["/tmp/alpha", "/tmp/orbit-sdk/", "/tmp/zebra"],
    stored: ["/private/tmp/alpha", "/private/tmp/orbit-sdk", "/private/tmp/zebra/"],
    roots: ["/private/tmp/alpha", "/private/tmp/orbit-sdk", "/private/tmp/zebra"],
  },
]) {
  for (const focused of [false, true]) {
    test(`${fixture.name}: three projects open on the ${focused ? "focused" : "active"} task's board`, async () => {
      process.env.ROVE_HOME_DIR = mkdtempSync(join(tmpdir(), "rove-kanban-repos-"))
      patchStateFile({ savedRepos: [...fixture.stored, "ssh://host/repo", ""] })
      const tasks = fixture.local.map((repo, i) => task(`T${i}`, repo))
      const reads: string[] = []
      const orchestrator = {
        listTasks: () => tasks,
        listIssueRepos: async () => fixture.stored,
        activeTaskSignal: () => createStateCell<string | null>(focused ? "T0" : "T1"),
        listIssues: async (repo: string) => {
          reads.push(repo)
          const index = fixture.stored.indexOf(repo)
          const repoRoot = fixture.roots[index] ?? repo
          return {
            repoRoot,
            exists: true,
            nextId: 8,
            skipped: 0,
            issues: [
              { id: 7, title: "Linked story", status: "open" as const, created: "2026-08-01", body: "", taskId: "T1" },
            ],
          }
        },
      }
      function Probe() {
        const state = useKanbanBoards({ orchestrator, focusTask: focused ? tasks[1] : undefined })
        return (
          <text>
            {JSON.stringify({
              roots: state.boards?.map((board) => board.repoRoot),
              active: state.activeRepo,
              selected: state.selectedId,
            })}
          </text>
        )
      }
      const { frame } = await renderComponent(<Probe />, { width: 500, height: 5 })
      await settle()
      expect((await frame()).trim()).toBe(
        JSON.stringify({ roots: fixture.roots, active: fixture.roots[1], selected: focused ? 7 : null }),
      )
      expect(reads).toEqual(fixture.stored)
      expect(new Set(reads.map(pathIdentity)).size).toBe(3)
    })
  }
}
