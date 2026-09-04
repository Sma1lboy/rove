/**
 * Startup hygiene for the task-index directory. What matters here is as much
 * what the sweep REFUSES to remove: it runs at daemon boot while other Rove
 * processes may be mid-save, so a fresh staging file or a live holder's lock
 * must survive it. Removing either would corrupt a write in flight.
 */

import { existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { sweepIndexLeftovers } from "../../src/orchestrator/index/sweep.ts"

let dir: string
const at = (name: string) => join(dir, name)

/** Backdate a file so the sweep sees it as a corpse rather than a live save. */
function age(path: string, minutes: number): void {
  const when = new Date(Date.now() - minutes * 60_000)
  utimesSync(path, when, when)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kobe-index-sweep-"))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe("sweepIndexLeftovers", () => {
  it("removes an aged staging file and a lock whose holder is gone", () => {
    const orphan = at("tasks.json.9832.01ABC.tmp")
    writeFileSync(orphan, "x".repeat(1024))
    age(orphan, 30)
    writeFileSync(at("tasks.json.lock"), "999999:crashed")

    const result = sweepIndexLeftovers(dir)

    expect(result.tmp).toEqual([orphan])
    expect(result.tmpBytes).toBe(1024)
    expect(result.lock).toBe(true)
    expect(existsSync(orphan)).toBe(false)
    expect(existsSync(at("tasks.json.lock"))).toBe(false)
  })

  it("leaves a live holder's lock alone — another Rove is mid-save", () => {
    writeFileSync(at("tasks.json.lock"), `${process.pid}:abc123`)
    expect(sweepIndexLeftovers(dir).lock).toBe(false)
    expect(existsSync(at("tasks.json.lock"))).toBe(true)
  })

  it("leaves a FRESH staging file alone — that write may still be running", () => {
    const live = at("tasks.json.4242.01XYZ.tmp")
    writeFileSync(live, "in flight")
    const result = sweepIndexLeftovers(dir)
    expect(result.tmp).toEqual([])
    expect(existsSync(live)).toBe(true)
  })

  it("never touches the manifest itself, its backups, or unrelated files", () => {
    for (const name of ["tasks.json", "tasks.json.old", "state.json", "daemon.log"]) {
      writeFileSync(at(name), "keep")
      age(at(name), 30)
    }
    sweepIndexLeftovers(dir)
    for (const name of ["tasks.json", "tasks.json.old", "state.json", "daemon.log"]) {
      expect(existsSync(at(name))).toBe(true)
    }
  })

  it("reports nothing swept for a directory that does not exist", () => {
    expect(sweepIndexLeftovers(join(dir, "absent"))).toEqual({ tmp: [], tmpBytes: 0, lock: false })
  })
})
