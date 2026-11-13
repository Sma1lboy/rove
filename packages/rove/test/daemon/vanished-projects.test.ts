import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, test } from "vitest"
import type { DaemonOrchestrator } from "../../../rove-daemon/src/daemon/contracts.ts"
import { forgetVanishedProjects } from "../../../rove-daemon/src/daemon/vanished-projects.ts"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(): { root: string; repo: string } {
  const root = mkdtempSync(join(tmpdir(), "rove-vanished-"))
  roots.push(root)
  const repo = join(root, "repo")
  mkdirSync(repo)
  return { root, repo }
}

function orchOf(tasks: Array<{ kind?: string; repo: string; worktreePath: string }>) {
  const forgotten: string[] = []
  const orch = {
    listTasks: () => tasks.map((task) => ({ ...task, kind: task.kind ?? "main" })),
    forgetProject: async (repo: string) => {
      forgotten.push(repo)
    },
  } as unknown as DaemonOrchestrator
  return { orch, forgotten }
}

test("a project whose checkout directory was deleted is forgotten", async () => {
  const { repo } = fixture()
  const { orch, forgotten } = orchOf([{ repo, worktreePath: repo }])
  rmSync(repo, { recursive: true })

  expect(await forgetVanishedProjects(orch)).toEqual([repo])
  expect(forgotten).toEqual([repo])
})

test("a live checkout, a worktree task and a remote project stay", async () => {
  const { root, repo } = fixture()
  const missing = join(root, "missing")
  const { orch, forgotten } = orchOf([
    { repo, worktreePath: repo },
    { kind: "task", repo, worktreePath: join(root, "wt") },
    { repo: "ssh://box/srv/gone", worktreePath: missing },
  ])

  expect(await forgetVanishedProjects(orch)).toEqual([])
  expect(forgotten).toEqual([])
})

test("a repo gone with its parent is an unmounted volume, not a deletion", async () => {
  const { root } = fixture()
  const volume = join(root, "vol")
  const repo = join(volume, "repo")
  mkdirSync(repo, { recursive: true })
  const { orch, forgotten } = orchOf([{ repo, worktreePath: repo }])
  rmSync(volume, { recursive: true })

  expect(await forgetVanishedProjects(orch)).toEqual([])
  expect(forgotten).toEqual([])
})
