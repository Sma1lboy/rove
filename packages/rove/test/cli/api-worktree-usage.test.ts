/**
 * `worktree-usage` — which checkouts count as a task's own, largest-first
 * ranking with unmeasured rows last, and that the real measurement splits
 * out the gitignored part of a worktree.
 */

import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { invokeVerb } from "../../src/cli/api-cmd.ts"
import { LocalExecHost } from "../../src/exec/exec-host.ts"
import { type CheckoutUsage, measureCheckout } from "../../src/orchestrator/worktree/disk-usage.ts"
import { FakeClient, expectApiError, stubRuntime, taskFixture } from "./api-handler-fixtures.ts"

const MB = 1024 * 1024

const MAIN = taskFixture({ id: "main", kind: "main", worktreePath: "/repo/x" })
const DIR = taskFixture({ id: "dir", kind: "dir", worktreePath: "/somewhere", repo: "/somewhere" })
const SMALL = taskFixture({ id: "small", worktreePath: "/wt/small" })
const BIG = taskFixture({
  id: "big",
  archived: true,
  worktreePath: "/wt/big",
  extraRepos: [{ name: "api", repo: "/repo/api", branch: "rove/t-big", worktreePath: "/wt/big-api" }],
})
const SHARED = taskFixture({ id: "shared", worktreePath: "/wt/small", sharesWorkspaceOf: "small" })
const GONE = taskFixture({ id: "gone", worktreePath: "/wt/gone" })
const DELETING = taskFixture({ id: "deleting", worktreePath: "/wt/deleting", deletion: { phase: "running" } })

const SIZES: Record<string, CheckoutUsage> = {
  "/wt/small": { exists: true, bytes: 10 * MB, ignoredBytes: 2 * MB },
  "/wt/big": { exists: true, bytes: 300 * MB, ignoredBytes: 250 * MB },
  "/wt/big-api": { exists: true, bytes: 50 * MB, ignoredBytes: 40 * MB },
  "/wt/deleting": { exists: true, bytes: 900 * MB, ignoredBytes: 0 },
}

function measure(sizes: Record<string, CheckoutUsage>) {
  return async (path: string) => sizes[path] ?? { exists: false, bytes: null, ignoredBytes: null }
}

function client(tasks: Record<string, unknown>[]) {
  return new FakeClient({
    "task.get": (p) => ({ task: tasks.find((t) => t.id === (p as { taskId: string }).taskId) }),
    "task.list": () => ({ tasks }),
  })
}

describe("worktree-usage", () => {
  it("ranks only task-owned worktrees, largest first, archived and extra repos included", async () => {
    const out = (await invokeVerb("worktree-usage", [], {
      client: client([MAIN, DIR, SMALL, BIG, SHARED, GONE, DELETING]),
      runtime: stubRuntime({ measureCheckout: measure(SIZES) }),
    })) as { tasks: { taskId: string; bytes: number; ignoredBytes: number; archived: boolean }[]; bytes: number }
    expect(out.tasks.map((t) => [t.taskId, t.bytes, t.ignoredBytes, t.archived])).toEqual([
      ["big", 350 * MB, 290 * MB, true],
      ["small", 10 * MB, 2 * MB, false],
    ])
    expect(out.bytes).toBe(360 * MB)
  })

  it("an unmeasured checkout makes its row and the total null, and sorts last", async () => {
    const out = (await invokeVerb("worktree-usage", [], {
      client: client([SMALL, BIG]),
      runtime: stubRuntime({
        measureCheckout: measure({ ...SIZES, "/wt/big-api": { exists: true, bytes: null, ignoredBytes: null } }),
      }),
    })) as { tasks: { taskId: string; bytes: number | null }[]; bytes: number | null }
    expect(out.tasks.map((t) => [t.taskId, t.bytes])).toEqual([
      ["small", 10 * MB],
      ["big", null],
    ])
    expect(out.bytes).toBeNull()
  })

  it("--task-id refuses a task that owns no worktree", async () => {
    const deps = { client: client([MAIN, SHARED]), runtime: stubRuntime({ measureCheckout: measure(SIZES) }) }
    await expectApiError(() => invokeVerb("worktree-usage", ["--task-id", "main"], deps), "NO_WORKTREE")
    await expectApiError(() => invokeVerb("worktree-usage", ["--task-id", "shared"], deps), "NO_WORKTREE")
  })
})

describe("measureCheckout", () => {
  let dir: string | undefined
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = undefined
  })

  it("reports the gitignored part of a real worktree separately", async () => {
    dir = mkdtempSync(join(tmpdir(), "rove-usage-"))
    execFileSync("git", ["init", "-q"], { cwd: dir })
    writeFileSync(join(dir, ".gitignore"), "node_modules/\n")
    writeFileSync(join(dir, "index.ts"), "export {}\n")
    mkdirSync(join(dir, "node_modules", "dep"), { recursive: true })
    writeFileSync(join(dir, "node_modules", "dep", "blob.bin"), Buffer.alloc(2 * MB, 1))

    const usage = await measureCheckout(new LocalExecHost(), dir)
    expect(usage.exists).toBe(true)
    expect(usage.ignoredBytes).toBeGreaterThanOrEqual(2 * MB)
    expect(usage.bytes).toBeGreaterThanOrEqual(usage.ignoredBytes ?? Number.POSITIVE_INFINITY)
  })

  it("a missing directory is absent, not zero", async () => {
    const usage = await measureCheckout(new LocalExecHost(), join(tmpdir(), "rove-usage-does-not-exist"))
    expect(usage).toEqual({ exists: false, bytes: null, ignoredBytes: null })
  })
})
