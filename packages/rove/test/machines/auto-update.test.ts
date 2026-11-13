import { describe, expect, it } from "vitest"
import { createStateCell } from "../../src/lib/external-store.ts"
import { type AutoUpdateDeps, startMachineAutoUpdate } from "../../src/machines/auto-update.ts"
import type { MachineStatus } from "../../src/machines/hub.ts"
import type { MachineEntry } from "../../src/machines/registry.ts"

const deck = { alias: "deck", host: "steamdeck.local" } as unknown as MachineEntry
const row = (version: string): MachineStatus => ({ alias: "deck", hostLabel: "deck", state: "online", version })
const settle = () => new Promise((done) => setTimeout(done, 20))

function start(overrides: Partial<AutoUpdateDeps>, version = "0.9.289") {
  const machines = createStateCell<readonly MachineStatus[]>([row(version)], "test.machines")
  const upgraded: string[] = []
  const stop = startMachineAutoUpdate(machines, {
    hubVersion: "0.9.293",
    enabled: () => true,
    head: async () => "0.9.293",
    entryOf: () => deck,
    busy: async () => false,
    upgrade: async (entry) => {
      upgraded.push(entry.alias)
      return { alias: entry.alias, from: version, to: "0.9.293", changed: true }
    },
    log: () => {},
    retryMs: 30,
    ...overrides,
  })
  return { machines, upgraded, stop }
}

describe("machine auto-update", () => {
  it("updates a machine that connects on an older build, once", async () => {
    const { machines, upgraded, stop } = start({})
    await settle()
    machines.set([row("0.9.289")])
    await settle()
    expect(upgraded).toEqual(["deck"])
    stop()
  })

  it("waits while a verb runs in that machine's daemon, then updates", async () => {
    let busy = true
    const { upgraded, stop } = start({ busy: async () => busy })
    await settle()
    expect(upgraded).toEqual([])
    busy = false
    await new Promise((done) => setTimeout(done, 80))
    expect(upgraded).toEqual(["deck"])
    stop()
  })

  it("leaves alone a machine that is newer, one this channel has nothing newer for, and everything when switched off", async () => {
    const newer = start({}, "0.9.300")
    const unpublished = start({ head: async () => "0.9.289" })
    const off = start({ enabled: () => false })
    await settle()
    expect([newer.upgraded, unpublished.upgraded, off.upgraded]).toEqual([[], [], []])
    for (const run of [newer, unpublished, off]) run.stop()
  })
})
