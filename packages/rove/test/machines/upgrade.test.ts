import { describe, expect, it } from "vitest"
import type { MachineEntry } from "../../src/machines/registry.ts"
import { upgradeMachine } from "../../src/machines/upgrade.ts"

const deck = { alias: "deck", host: "steamdeck.local" } as unknown as MachineEntry
const ok = { exitCode: 0, stdout: "", stderr: "" }

describe("upgradeMachine", () => {
  it("installs this machine's channel there, then restarts that daemon, and reports both versions", async () => {
    const ran: string[] = []
    const versions = ["0.9.289", "0.9.291"]
    const done = await upgradeMachine(deck, {
      channel: () => "next",
      version: async () => versions.shift() ?? null,
      run: async (_entry, args) => {
        ran.push(args.join(" "))
        return ok
      },
    })
    expect(ran).toEqual(["update --channel next", "daemon restart"])
    expect(done).toEqual({ alias: "deck", from: "0.9.289", to: "0.9.291", changed: true })
  })

  it("leaves the daemon running when the install fails, and says what that machine said", async () => {
    const ran: string[] = []
    const failing = upgradeMachine(deck, {
      channel: () => "next",
      version: async () => "0.9.289",
      run: async (_entry, args) => {
        ran.push(args[0] ?? "")
        return { exitCode: 1, stdout: "", stderr: "npm ERR! network" }
      },
    })
    await expect(failing).rejects.toThrow(/rove update on deck failed:\nnpm ERR! network/)
    expect(ran).toEqual(["update"])
  })
})
