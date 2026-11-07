/**
 * The /proc walk must read the same subtree `ps` does, or the live-engine
 * probe would light or drop a tab's engine differently on Linux.
 */

import { execFileSync, spawn } from "node:child_process"
import { describe, expect, it } from "vitest"
import { parsePsSnapshot } from "../../src/engine/foreground"
import { procDescendantRows } from "../../src/engine/proc-descendants"

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
      let rows = await procDescendantRows([root])
      for (let i = 0; i < 100 && argsOf(rows).join("|") !== settled.join("|"); i++) {
        await new Promise((r) => setTimeout(r, 20))
        rows = await procDescendantRows([root])
      }
      expect(argsOf(rows)).toEqual(settled)
      const fromPs = parsePsSnapshot(execFileSync("ps", ["-A", "-o", "pid=,ppid=,args="], { encoding: "utf8" }))
      const subtree = new Set([root])
      const expected: string[] = []
      for (const row of fromPs) {
        if (!subtree.has(row.ppid)) continue
        subtree.add(row.pid)
        expected.push(`${row.ppid} ${row.args}`)
      }
      expect(rows.map((row) => `${row.ppid} ${row.args}`).sort()).toEqual(expected.sort())
    } finally {
      process.kill(-root, "SIGKILL")
    }
  })

  it("answers no rows for a pid that is gone", async () => {
    expect(await procDescendantRows([2 ** 22 + 7])).toEqual([])
  })
})
