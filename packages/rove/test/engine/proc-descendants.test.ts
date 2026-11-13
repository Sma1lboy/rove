/**
 * The /proc walk must read the same subtree `ps` does, or the live-engine
 * probe would light or drop a tab's engine differently on Linux.
 */

import { execFileSync, spawn } from "node:child_process"
import { describe, expect, it, vi } from "vitest"
import { parsePsSnapshot } from "../../src/engine/foreground"
import { procDescendantRows } from "../../src/engine/proc-descendants"

/** `ppid args` of every process under `root`, from `ps` (parents list before children). */
function psSubtree(root: number): string[] {
  const subtree = new Set([root])
  const out: string[] = []
  for (const row of parsePsSnapshot(execFileSync("ps", ["-A", "-o", "pid=,ppid=,args="], { encoding: "utf8" }))) {
    if (!subtree.has(row.ppid)) continue
    subtree.add(row.pid)
    out.push(`${row.ppid} ${row.args}`)
  }
  return out
}

describe.skipIf(process.platform !== "linux")("procDescendantRows", () => {
  it("matches ps for a shell's nested children", async () => {
    const shell = spawn("bash", ["-c", "sh -c 'sleep 31 & wait' & sleep 32 & wait"], {
      stdio: "ignore",
      detached: true,
    })
    const root = shell.pid as number
    try {
      const settled = ["sh -c sleep 31 & wait", "sleep 31", "sleep 32"]
      const argsOf = (rows: { args: string }[]) => rows.map((row) => row.args).sort()
      // A child read between fork and exec still shows bash's argv: poll until the tree settles.
      let rows: Awaited<ReturnType<typeof procDescendantRows>> = []
      await vi.waitFor(
        async () => {
          rows = await procDescendantRows([root])
          expect(argsOf(rows)).toEqual(settled)
        },
        { timeout: 2000, interval: 20 },
      )
      expect(rows.map((row) => `${row.ppid} ${row.args}`).sort()).toEqual(psSubtree(root).sort())
    } finally {
      process.kill(-root, "SIGKILL")
    }
  })

  it("answers no rows for a pid that is gone", async () => {
    expect(await procDescendantRows([2 ** 22 + 7])).toEqual([])
  })
})
