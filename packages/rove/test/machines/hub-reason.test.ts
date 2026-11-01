/**
 * A machine that is not online says why, as a class the web app may show: a probe that failed before
 * the tunnel fell back to the known sockets must not be lost when that tunnel then reports `offline`.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

const discover = vi.hoisted(() => vi.fn())
const tunnelListeners = vi.hoisted(() => [] as ((state: string) => void)[])
vi.mock("../../src/machines/discover.ts", () => ({ discoverMachine: discover, learnedFrom: () => ({}) }))
vi.mock("../../src/machines/tunnel.ts", () => ({
  startTunnel: () => ({
    alias: "box",
    daemonSocketPath: "/tmp/none.sock",
    ptySocketPath: "/tmp/none-pty.sock",
    state: () => "connecting",
    onState: (listener: (state: string) => void) => {
      tunnelListeners.push(listener)
      return () => {}
    },
    stop: () => {},
  }),
}))
vi.mock("../../src/machines/registry.ts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  updateMachine: () => {},
}))

import { MachineHub } from "../../src/machines/hub.ts"
import type { MachineEntry } from "../../src/machines/registry.ts"

const sockets = { daemon: "/r/d.sock", pty: "/r/p.sock" }
const status = (hub: MachineHub) => hub.machinesSignal().get()[0]

async function connected(entry: MachineEntry): Promise<MachineHub> {
  const hub = new MachineHub()
  hub.sync([entry])
  await vi.waitFor(() => expect(discover).toHaveBeenCalled())
  return hub
}

beforeEach(() => {
  discover.mockReset()
  tunnelListeners.length = 0
})

describe("MachineHub reason", () => {
  it("keeps the probe's ssh cause through the fallback tunnel going offline", async () => {
    discover.mockResolvedValue({
      ok: false,
      code: "SSH_FAILED",
      ssh: "refused",
      message: "ssh: connect to host wsl port 22: Connection refused",
    })
    const hub = await connected({ alias: "box", host: "box", auth: { kind: "key" }, sockets } as MachineEntry)
    await vi.waitFor(() => expect(tunnelListeners).toHaveLength(1))
    for (const listener of tunnelListeners) listener("offline")
    expect(status(hub)).toMatchObject({ state: "offline", reason: "refused" })
    hub.dispose()
  })

  it("names what the probe found when there is no socket to fall back to", async () => {
    discover.mockResolvedValue({ ok: false, code: "NO_ROVE", message: "rove: command not found" })
    const hub = await connected({ alias: "box", host: "box", auth: { kind: "key" } } as MachineEntry)
    await vi.waitFor(() => expect(status(hub)?.state).toBe("offline"))
    expect(status(hub)?.reason).toBe("no-rove")
    hub.dispose()
  })

  it("calls a tunnel that drops after a good probe a lost link", async () => {
    discover.mockResolvedValue({ ok: true, status: { socketPath: "/r/d.sock", ptySocketPath: "/r/p.sock" } })
    const hub = await connected({ alias: "box", host: "box", auth: { kind: "key" } } as MachineEntry)
    await vi.waitFor(() => expect(tunnelListeners).toHaveLength(1))
    for (const listener of tunnelListeners) listener("offline")
    expect(status(hub)).toMatchObject({ state: "offline", reason: "lost" })
    hub.dispose()
  })
})
