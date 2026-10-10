import { randomUUID } from "node:crypto"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { RoveDaemonClient } from "@sma1lboy/rove-daemon/client"
import { DaemonActivityRegistry } from "@sma1lboy/rove-daemon/daemon/activity-registry"
import { AttentionInboxStore } from "@sma1lboy/rove-daemon/daemon/attention-inbox"
import { DaemonEventBus } from "@sma1lboy/rove-daemon/daemon/event-bus"
import { nodePtyDriver } from "@sma1lboy/rove-daemon/daemon/pty-driver"
import { startPtyHostServer } from "@sma1lboy/rove-daemon/daemon/pty-server"
import { expect, it, vi } from "vitest"
import { programStatusActivity } from "../../../rove-daemon/src/daemon/program-status-activity"
import { watchProgramStatus } from "../../../rove-daemon/src/daemon/program-status-watch"

it("delivers every transition from a real PTY without polling and replays completion after daemon reconnect", async () => {
  const home = await mkdtemp(join(tmpdir(), "rove-osc-wire-"))
  vi.stubEnv("ROVE_HOME_DIR", home)
  const socketPath = process.platform === "win32" ? `\\\\.\\pipe\\rove-osc-${randomUUID()}` : join(home, "p.sock")
  const bus = new DaemonEventBus()
  const activity = new DaemonActivityRegistry(bus)
  const inbox = new AttentionInboxStore(join(home, "inbox.json"), bus)
  await inbox.init()
  const transitions: string[] = []
  bus.onPublish((event) => {
    if (
      event.channel === "engine-state" &&
      "tabId" in event.payload &&
      event.payload.tabId === "tab-1" &&
      "state" in event.payload
    )
      transitions.push(event.payload.state)
  })
  const accept = programStatusActivity(activity, (id) => id === "task", inbox)
  let ready = false
  let stop = watchProgramStatus(
    async (event) => {
      ready = true
      await accept(event)
    },
    { socketPath, retryMs: 10 },
  )
  const server = await startPtyHostServer({
    socketPath,
    pidPath: join(home, "p.pid"),
    freezeDir: join(home, "freeze"),
    driver: await nodePtyDriver(undefined, async () => "test child only"),
    idleExitMs: 60_000,
  })
  const client = new RoveDaemonClient(socketPath)
  const waitFor = async (check: () => boolean) => {
    for (let i = 0; i < 250 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 10))
    expect(check()).toBe(true)
  }
  try {
    await client.connect()
    const bytes = ["working", "blocked:kind=permission", "working", "done"]
      .map((state) => `\x1b]7501;state=${state}\x07`)
      .join("")
    const script = `process.stdin.once('data',()=>{process.stdout.write(${JSON.stringify(bytes)});setTimeout(()=>process.exit(0),50)})`
    await client.request("pty.open", { key: "task::tab-1", cwd: home, command: [process.execPath, "-e", script] })
    await waitFor(() => ready)
    await client.request("pty.write", { key: "task::tab-1", data: "go\n" })
    await waitFor(() => inbox.snapshot()[0]?.state === "turn_complete")
    expect(transitions).toEqual(["running", "permission_needed", "running", "turn_complete"])
    await stop()
    const replayed: string[] = []
    stop = watchProgramStatus(
      async (event) => {
        if (event.status) replayed.push(event.status.state)
      },
      { socketPath, retryMs: 10 },
    )
    await waitFor(() => replayed.includes("done"))
    expect(replayed).toEqual(["done"])
  } finally {
    await stop()
    client.close()
    await server.close()
    activity.close()
    vi.unstubAllEnvs()
  }
}, 10_000)
