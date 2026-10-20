import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import type { DaemonServer } from "@sma1lboy/rove-daemon/daemon/server"
import { startDaemonServer } from "@sma1lboy/rove-daemon/daemon/server"
import { afterEach, describe, expect, it } from "vitest"
import { daemonRuntime } from "../../src/core/daemon-runtime.ts"
import { addMachine } from "../../src/machines/registry.ts"
import { localDaemonSocketPath } from "../../src/machines/ssh-args.ts"
import { patchStateFile } from "../../src/state/store.ts"
import { type DaemonHarness, bootDaemonHarness, fakeOrchestrator } from "./harness.ts"

/**
 * A center scheduling across a worker. The worker's daemon listens where the
 * ssh forward would put its socket, so this is the whole path minus ssh.
 */
describe("fleet dispatch", () => {
  let hub: DaemonHarness
  let worker: DaemonServer | null = null
  let workerHome: string | null = null

  afterEach(async () => {
    await worker?.close()
    worker = null
    if (workerHome) rmSync(workerHome, { recursive: true, force: true })
    workerHome = null
    await hub.close()
  })

  async function bootHubAndWorker(workerOrch = fakeOrchestrator()): Promise<void> {
    hub = await bootDaemonHarness()
    addMachine("narwhal", { host: "narwhal", auth: { kind: "key" } })
    const socketPath = localDaemonSocketPath("narwhal", hub.dir)
    mkdirSync(dirname(socketPath), { recursive: true })
    const home = mkdtempSync(join(tmpdir(), "rove-worker-"))
    workerHome = home
    worker = await startDaemonServer(() => workerOrch, {
      runtime: daemonRuntime,
      socketPath,
      pidPath: join(home, "daemon.pid"),
      homeDir: home,
      updatePollMs: 0,
      autoTitlePollMs: 0,
      prStatusPollMs: 0,
      uiPrefsDebounceMs: 0,
      keybindingsDebounceMs: 0,
      worktreeChangesTickMs: 0,
      transcriptActivityTickMs: 0,
    })
  }

  it("skips a center that does not answer, then probes every node and says why none fits", async () => {
    await bootHubAndWorker()
    addMachine("gone", { host: "gone", auth: { kind: "key" } })
    patchStateFile({ "fleet.centers": ["gone", "local"] })
    const res = await hub.client().request("api.invoke", {
      verb: "add",
      params: { repo: "/nowhere/app", prompt: "fix it" },
      machine: "any",
    })
    expect(res).toMatchObject({ ok: false, error: { code: "NO_ELIGIBLE_NODE" } })
    const rejected = (res as { error: { rejected: { machine: string; why: string }[] } }).error.rejected
    expect(rejected.map((r) => r.machine).sort()).toEqual(["gone", "local", "narwhal"])
    expect(rejected.find((r) => r.machine === "narwhal")?.why).toBe("has no checkout of /nowhere/app")
  })

  it("places the task on the worker that has the repo, not on the center", async () => {
    const repo = mkdtempSync(join(tmpdir(), "rove-fleet-repo-"))
    execFileSync("git", ["init", "-q", repo])
    execFileSync("git", ["-C", repo, "remote", "add", "origin", "git@github.com:acme/app.git"])
    const created: { repo: string }[] = []
    const task = {
      id: "01FLEETTASK00000000000000",
      title: "t",
      repo,
      branch: "b",
      worktreePath: repo,
      kind: "task",
      status: "todo",
      createdAt: 0,
      updatedAt: 0,
    }
    try {
      await bootHubAndWorker(
        fakeOrchestrator({
          createTask: async (input: { repo: string }) => {
            created.push(input)
            return task
          },
        }),
      )
      patchStateFile({ savedRepos: [repo] })
      const res = await hub.client().request("api.invoke", { verb: "add", params: { repo }, machine: "any" })
      expect(res).toMatchObject({ ok: true, result: { dispatch: { machine: "narwhal" } } })
      expect(created).toEqual([expect.objectContaining({ repo })])
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it("answers NO_CENTER when no candidate is up", async () => {
    await bootHubAndWorker()
    addMachine("gone", { host: "gone", auth: { kind: "key" } })
    patchStateFile({ "fleet.centers": ["gone"] })
    await expect(
      hub.client().request("api.invoke", { verb: "add", params: { repo: "/x" }, machine: "auto" }),
    ).resolves.toMatchObject({ ok: false, error: { code: "NO_CENTER" } })
  })

  it("refuses a fleet target on a verb that follows an existing task", async () => {
    await bootHubAndWorker()
    await expect(
      hub.client().request("api.invoke", { verb: "send", params: { "task-id": "x", prompt: "p" }, machine: "any" }),
    ).resolves.toMatchObject({ ok: false, error: { code: "BAD_FLAG" } })
  })

  it("reports the elected center and each node's load", async () => {
    await bootHubAndWorker()
    const res = await hub.client().request("api.invoke", { verb: "fleet-status", params: {} })
    expect(res).toMatchObject({
      ok: true,
      result: { center: "self", nodes: [{ machine: "local" }, { machine: "narwhal" }] },
    })
    const nodes = (res as { result: { nodes: { load?: number }[] } }).result.nodes
    expect(nodes.every((n) => typeof n.load === "number")).toBe(true)
  })
})
