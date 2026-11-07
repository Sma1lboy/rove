/**
 * `worktree-usage` — which checkouts count as a task's own, largest-first
 * ranking with unmeasured rows last, and that the real measurement splits
 * out the gitignored part of a worktree.
 */

import { execFileSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { invokeVerb } from "../../src/cli/api-cmd.ts"
import { LocalExecHost, RemoteExecHost } from "../../src/exec/exec-host.ts"
import { type CheckoutUsage, measureCheckout } from "../../src/orchestrator/worktree/disk-usage.ts"
import { duKb } from "../../src/orchestrator/worktree/salvage-ignored.ts"
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

  it.each(["normal", "no", "all"])("measures ignored content with status.showUntrackedFiles=%s", async (mode) => {
    dir = mkdtempSync(join(tmpdir(), "rove-usage-"))
    execFileSync("git", ["init", "-q"], { cwd: dir })
    execFileSync("git", ["config", "status.showUntrackedFiles", mode], { cwd: dir })
    writeFileSync(join(dir, ".gitignore"), "node_modules/\n")
    writeFileSync(join(dir, "index.ts"), "export {}\n")
    mkdirSync(join(dir, "node_modules", "dep"), { recursive: true })
    writeFileSync(join(dir, "node_modules", "dep", "blob.bin"), Buffer.alloc(2 * MB, 1))

    const usage = await measureCheckout(new LocalExecHost(), dir)
    expect(usage.exists).toBe(true)
    expect(usage.ignoredBytes).toBeGreaterThanOrEqual(2 * MB)
    expect(usage.bytes).toBeGreaterThanOrEqual(usage.ignoredBytes ?? Number.POSITIVE_INFINITY)
  })

  it.skipIf(process.getuid?.() === 0)("keeps unreadable content and inaccessible checkouts unknown", async () => {
    dir = mkdtempSync(join(tmpdir(), "rove-usage-permission-"))
    execFileSync("git", ["init", "-q"], { cwd: dir })
    writeFileSync(join(dir, ".gitignore"), "ignored/\n")
    const ignored = join(dir, "ignored")
    mkdirSync(ignored)
    writeFileSync(join(ignored, "blob"), Buffer.alloc(MB, 1))
    chmodSync(ignored, 0)
    try {
      expect(await measureCheckout(new LocalExecHost(), dir)).toEqual({
        exists: true,
        bytes: null,
        ignoredBytes: null,
      })
      expect(await measureCheckout(new LocalExecHost(), join(ignored, "checkout"))).toEqual({
        exists: null,
        bytes: null,
        ignoredBytes: null,
      })
    } finally {
      chmodSync(ignored, 0o755)
    }
  })

  it("a missing directory is absent, not zero", async () => {
    const usage = await measureCheckout(new LocalExecHost(), join(tmpdir(), "rove-usage-does-not-exist"))
    expect(usage).toEqual({ exists: false, bytes: null, ignoredBytes: null })
  })
})

describe("measurement failures", () => {
  function failedRemote() {
    return new RemoteExecHost({ host: "offline", user: "test", auth: { kind: "key" }, controlPath: "/unused" }, () => ({
      exitCode: 255,
      stdout: "",
      stderr: "connection failed",
    }))
  }

  it("keeps a failed SSH existence probe unknown", async () => {
    expect(await measureCheckout(failedRemote(), "/wt/small")).toEqual({
      exists: null,
      bytes: null,
      ignoredBytes: null,
    })
  })

  it.each([{ args: [] }, { args: ["--task-id", "small"] }])(
    "keeps unreachable checkouts in API totals: %j",
    async ({ args }) => {
      const out = await invokeVerb("worktree-usage", args, {
        client: client([SMALL]),
        runtime: stubRuntime({ measureCheckout: (path) => measureCheckout(failedRemote(), path) }),
      })
      expect(out).toMatchObject({ bytes: null, ignoredBytes: null })
      if (args.length === 0) expect(out).toMatchObject({ tasks: [{ taskId: "small", bytes: null }] })
    },
  )

  it("preserves salvage's partial results while strict measurement rejects a failed batch", async () => {
    const host = new LocalExecHost()
    vi.spyOn(host, "run").mockResolvedValue({ exitCode: 1, stdout: "2\ta/\n", stderr: "unreadable b/" })
    expect(await duKb(host, "/wt", ["a/", "b/"])).toEqual(new Map([["a/", 2]]))
    await expect(duKb(host, "/wt", ["a/", "b/"], { requireSuccess: true })).rejects.toThrow()
    await expect(duKb(host, "/wt", ["a\nb/"], { requireSuccess: true })).rejects.toThrow()
  })

  it.each([
    { totalExit: 1, ignoredExit: 0, output: "2\ta/\n3\tb/\n", bytes: null, ignoredBytes: 5120 },
    { totalExit: 0, ignoredExit: 1, output: "", bytes: 102400, ignoredBytes: null },
    { totalExit: 0, ignoredExit: 1, output: "2\ta/\n", bytes: 102400, ignoredBytes: null },
    { totalExit: 0, ignoredExit: 1, output: "2\ta/\n3\tb/\n", bytes: 102400, ignoredBytes: null },
    { totalExit: 0, ignoredExit: 0, output: "2\ta/\n", bytes: 102400, ignoredBytes: null },
  ])("rejects incomplete du results: %j", async ({ totalExit, ignoredExit, output, bytes, ignoredBytes }) => {
    const host = new LocalExecHost()
    vi.spyOn(host, "run").mockImplementation(async (argv) => {
      if (argv[0] === "git") return { exitCode: 0, stdout: "!! a/\0!! b/\0", stderr: "" }
      if (argv[0] === "sh") return { exitCode: 0, stdout: "", stderr: "" }
      return argv.includes("/wt/small")
        ? { exitCode: totalExit, stdout: "100\t/wt/small\n", stderr: "" }
        : { exitCode: ignoredExit, stdout: output, stderr: "" }
    })
    expect(await measureCheckout(host, "/wt/small")).toEqual({ exists: true, bytes, ignoredBytes })
  })
})
