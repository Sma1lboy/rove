import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, test, vi } from "vitest"
import type { DaemonOrchestrator } from "../../../rove-daemon/src/daemon/contracts.ts"
import { checkoutVanished, createVanishedProjectsSweep } from "../../../rove-daemon/src/daemon/vanished-projects.ts"

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

function orchOf(tasks: Array<{ kind?: string; repo: string; worktreePath?: string }>) {
  const forgotten: string[] = []
  const orch = {
    listTasks: () => tasks.map((task) => ({ kind: "main", worktreePath: task.repo, ...task })),
    forgetProject: async (repo: string) => {
      forgotten.push(repo)
    },
  } as unknown as DaemonOrchestrator
  return { orch, forgotten }
}

test("a deleted checkout reads as vanished; a live one, or one gone with its parent (unmounted volume), does not", async () => {
  const { root, repo } = fixture()
  expect(await checkoutVanished(repo)).toBe(false)
  rmSync(repo, { recursive: true })
  expect(await checkoutVanished(repo)).toBe(true)
  expect(await checkoutVanished(join(root, "vol", "repo"))).toBe(false)
})

test("the sweep forgets a vanished project and never probes a worktree task or a remote project", async () => {
  const probe = vi.fn(async (path: string) => path === "/gone")
  const { orch, forgotten } = orchOf([
    { repo: "/gone" },
    { repo: "/live" },
    { kind: "task", repo: "/gone", worktreePath: "/wt" },
    { repo: "ssh://box/srv/x", worktreePath: "/srv/x" },
  ])
  createVanishedProjectsSweep(orch, probe)()
  await vi.waitFor(() => expect(forgotten).toEqual(["/gone"]))
  expect(probe.mock.calls.map(([p]) => p)).toEqual(["/gone", "/live"])
})

test("a hung mount is probed once per path, and hung probes cap how many run at all", () => {
  const probe = vi.fn((_path: string) => new Promise<boolean>(() => {}))
  const { orch } = orchOf([{ repo: "/nfs/a" }, { repo: "/nfs/b" }, { repo: "/nfs/c" }])
  const sweep = createVanishedProjectsSweep(orch, probe)
  sweep()
  sweep()
  sweep()
  expect(probe.mock.calls.map(([p]) => p)).toEqual(["/nfs/a", "/nfs/b"])
})
