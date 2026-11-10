/**
 * The daemon runs its machine hub only while some client reads `machines`.
 * A peer's hub subscribes without that channel, so two machines registered to
 * each other must not keep each other's hubs (and daemons) up forever.
 */

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { RoveDaemonClient } from "@sma1lboy/rove-daemon/client"
import { type DaemonServer, startDaemonServer } from "@sma1lboy/rove-daemon/daemon/server"
import { afterEach, expect, it } from "vitest"
import { daemonRuntime } from "../../src/core/daemon-runtime.ts"
import { fakeOrchestrator, waitFor } from "./harness.ts"

let dir: string
let server: DaemonServer | null = null
const clients: RoveDaemonClient[] = []

afterEach(async () => {
  for (const client of clients) client.close()
  clients.length = 0
  await server?.close().catch(() => {})
  rmSync(dir, { recursive: true, force: true })
})

it("starts for a client that reads machines, not for a peer hub's filtered subscription", async () => {
  dir = mkdtempSync(join(tmpdir(), "rove-hub-gate-"))
  let starts = 0
  server = await startDaemonServer(() => fakeOrchestrator(), {
    runtime: {
      ...daemonRuntime,
      startMachineHub(bus) {
        starts++
        bus.publish("machines", {
          machines: [{ alias: "box", hostLabel: "box", state: "online" }],
          tasks: [],
          live: { activity: {}, changes: {}, tokens: {} },
        })
        return () => {}
      },
    },
    socketPath: join(dir, "daemon.sock"),
    pidPath: join(dir, "daemon.pid"),
    homeDir: dir,
    updatePollMs: 0,
    autoTitlePollMs: 0,
    uiPrefsDebounceMs: 0,
    keybindingsDebounceMs: 0,
  })

  const peer = new RoveDaemonClient(join(dir, "daemon.sock"))
  clients.push(peer)
  await peer.subscribe({ role: "gui", channels: ["task.snapshot", "engine-state"] })
  await new Promise((r) => setTimeout(r, 1500))
  expect(starts).toBe(0)

  const window = new RoveDaemonClient(join(dir, "daemon.sock"))
  clients.push(window)
  const seen: string[] = []
  window.onChannel("machines", (payload) => seen.push(...payload.machines.map((m) => m.alias)))
  await window.subscribe({ role: "gui" })
  expect(await waitFor(() => seen.includes("box"), 3000)).toBe(true)
  expect(starts).toBe(1)
})
