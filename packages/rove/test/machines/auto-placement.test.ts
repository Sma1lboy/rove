import { describe, expect, test } from "vitest"
import { pickMachine } from "../../src/machines/forward.ts"
import type { MachineEntry } from "../../src/machines/registry.ts"

const machine = (alias: string) => ({ alias, host: alias, auth: { kind: "agent" } }) as unknown as MachineEntry
const busy = (n: number) => Array.from({ length: n }, () => ({ status: "in_progress" }))

describe("--machine auto", () => {
  test("picks the machine with the fewest tasks in progress, skipping one that does not answer", async () => {
    const remote: Record<string, Array<{ status: string }> | null> = { mac: busy(1), box: null }
    const picked = await pickMachine(
      async () => busy(2),
      async (e) => remote[e.alias] ?? null,
      [machine("mac"), machine("box")],
    )
    expect(picked.entry?.alias).toBe("mac")
    expect(picked.loads).toEqual({ local: 2, mac: 1 })
  })

  test("this machine wins a tie", async () => {
    const picked = await pickMachine(
      async () => busy(1),
      async () => busy(1),
      [machine("mac")],
    )
    expect(picked.entry).toBeNull()
  })
})
