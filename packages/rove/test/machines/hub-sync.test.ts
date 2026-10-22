/**
 * The daemon's hub follows the registry: `rove machine add|remove` from any
 * shell connects or drops a machine, and what the hub itself writes back
 * (identity, sockets) must not tear the connection down.
 */

import { describe, expect, it, vi } from "vitest"

const discover = vi.hoisted(() => vi.fn(async () => ({ ok: false as const, code: "SSH_FAILED", message: "down" })))
vi.mock("../../src/machines/discover.ts", () => ({ discoverMachine: discover, learnedFrom: () => ({}) }))

import { MachineHub } from "../../src/machines/hub.ts"
import type { MachineEntry } from "../../src/machines/registry.ts"

const box: MachineEntry = { alias: "box", host: "box", auth: { kind: "agent" } } as MachineEntry
const aliases = (hub: MachineHub) => hub.machinesSignal().get().map((m) => m.alias)

describe("MachineHub.sync", () => {
  it("connects added machines, drops removed ones, and ignores learned fields", async () => {
    const hub = new MachineHub()
    hub.sync([box])
    expect(aliases(hub)).toEqual(["box"])
    await vi.waitFor(() => expect(discover).toHaveBeenCalledTimes(1))

    hub.sync([{ ...box, identity: { hostname: "h", homeDir: "/h", daemonPid: 1 } } as MachineEntry])
    expect(discover).toHaveBeenCalledTimes(1)

    hub.sync([{ ...box, port: 2222 } as MachineEntry])
    await vi.waitFor(() => expect(discover).toHaveBeenCalledTimes(2))

    hub.sync([])
    expect(aliases(hub)).toEqual([])
    hub.dispose()
  })
})
