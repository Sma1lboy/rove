import { execFileSync } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "vitest"
import { pickMachine, repoHosts } from "../../src/machines/forward.ts"
import type { MachineEntry } from "../../src/machines/registry.ts"

const machine = (alias: string) => ({ alias, host: alias, auth: { kind: "agent" } }) as unknown as MachineEntry
const reads = (loads: Record<string, number | null>) => async (e: MachineEntry) => loads[e.alias] ?? null

describe("--machine auto", () => {
  test("picks the machine reporting the lowest load, skipping one with no reading", async () => {
    const picked = await pickMachine(reads({ mac: 0.1, box: null }), [machine("mac"), machine("box")], undefined, 2)
    expect(picked.entry?.alias).toBe("mac")
    expect(picked.loads).toEqual({ local: 2, mac: 0.1 })
  })

  test("this machine keeps the work unless another is clearly idler", async () => {
    const picked = await pickMachine(reads({ mac: 0.4 }), [machine("mac")], undefined, 0.5)
    expect(picked.entry).toBeNull()
  })
})

describe("--machine auto with a repo", () => {
  test("only machines that have the repo are candidates, however idle the others", async () => {
    const picked = await pickMachine(
      reads({ mac: 3, box: 0 }),
      [machine("mac"), machine("box")],
      async (e) => e?.alias === "mac",
      0,
    )
    expect(picked.entry?.alias).toBe("mac")
    expect(picked.skipped).toEqual(["local", "box"])
  })

  test("when no machine has it, load alone decides", async () => {
    const picked = await pickMachine(reads({ mac: 1 }), [machine("mac")], async () => false, 2)
    expect(picked.entry?.alias).toBe("mac")
    expect(picked.skipped).toBeUndefined()
  })

  test("a checkout with commits no remote has keeps its work here", async () => {
    const repo = mkdtempSync(join(tmpdir(), "rove-auto-"))
    const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" })
    git("init", "-q")
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "local only")
    const hosts = repoHosts({ repo })
    expect(await hosts?.(null)).toBe(true)
    expect(await hosts?.(machine("deck"))).toBe(false)
  })
})
