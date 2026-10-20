import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import type { DaemonServer } from "@sma1lboy/rove-daemon/daemon/server"
import { startDaemonServer } from "@sma1lboy/rove-daemon/daemon/server"
import { afterEach, describe, expect, it } from "vitest"
import { daemonRuntime } from "../../src/core/daemon-runtime.ts"
import { addMachine } from "../../src/machines/registry.ts"
import { localDaemonSocketPath } from "../../src/machines/ssh-args.ts"
import type { Task } from "../../src/types/task.ts"
import { type DaemonHarness, bootDaemonHarness, fakeOrchestrator } from "./harness.ts"

const REMOTE_TASK: Task = {
  id: "01REMOTETASK0000000000000",
  title: "remote probe",
  repo: "/srv/repo",
  branch: "rove/probe",
  worktreePath: "/srv/wt/probe",
  kind: "task",
  status: "in_progress",
  vendor: "claude",
  createdAt: 0,
  updatedAt: 0,
} as unknown as Task

/**
 * A hub daemon dispatching to a machine. The machine's daemon listens where
 * the ssh forward would put its socket, so this is the hub's whole path minus
 * ssh itself.
 */
describe("api.invoke across machines", () => {
  let hub: DaemonHarness
  let machine: DaemonServer | null = null
  let machineHome: string | null = null

  afterEach(async () => {
    await machine?.close()
    machine = null
    if (machineHome) rmSync(machineHome, { recursive: true, force: true })
    machineHome = null
    await hub.close()
  })

  async function bootHubAndMachine(): Promise<void> {
    hub = await bootDaemonHarness()
    addMachine("narwhal", { host: "narwhal", auth: { kind: "key" } })
    const socketPath = localDaemonSocketPath("narwhal", hub.dir)
    mkdirSync(dirname(socketPath), { recursive: true })
    const home = mkdtempSync(join(tmpdir(), "rove-machine-"))
    machineHome = home
    machine = await startDaemonServer(
      () =>
        fakeOrchestrator({
          listTasks: () => [REMOTE_TASK],
          getTask: (id: string) => (id === REMOTE_TASK.id ? REMOTE_TASK : undefined),
        }),
      {
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
      },
    )
  }

  it("runs a verb aimed at another machine's task on that machine", async () => {
    await bootHubAndMachine()
    const res = await hub.client().request("api.invoke", { verb: "get-task", params: { "task-id": REMOTE_TASK.id } })
    expect(res).toMatchObject({ ok: true, result: { task: { id: REMOTE_TASK.id, title: "remote probe" } } })
  })

  it("routes --machine explicitly, and refuses an alias nobody registered", async () => {
    await bootHubAndMachine()
    const client = hub.client()
    // The machine answers list with ITS tasks only: a forwarded list never fans out again.
    await expect(client.request("api.invoke", { verb: "list", params: {}, machine: "narwhal" })).resolves.toMatchObject(
      { ok: true, result: { tasks: [{ id: REMOTE_TASK.id }] } },
    )
    await expect(client.request("api.invoke", { verb: "list", params: {}, machine: "otter" })).resolves.toMatchObject({
      ok: false,
      error: { code: "UNKNOWN_MACHINE" },
    })
  })

  it("never moves a call that was already forwarded", async () => {
    await bootHubAndMachine()
    const res = await hub
      .client()
      .request("api.invoke", { verb: "get-task", params: { "task-id": REMOTE_TASK.id }, forwarded: true })
    expect(res).toMatchObject({ ok: false, error: { code: "TASK_NOT_FOUND" } })
  })

  it("reports a registered machine that does not answer", async () => {
    hub = await bootDaemonHarness()
    addMachine("narwhal", { host: "narwhal", auth: { kind: "key" } })
    await expect(
      hub.client().request("api.invoke", { verb: "list", params: {}, machine: "narwhal" }),
    ).resolves.toMatchObject({ ok: false, error: { code: "MACHINE_UNREACHABLE" } })
  })
})
