/**
 * Durable death records: a crashed engine's exit code, signal,
 * time, and last output must survive the PTY host's idle-exit. The store is
 * the persistence half; the host's onSessionExit hook is wired to it in
 * pty-server.ts. Noise rules matter as much as retention — clean exits and
 * the warm spare must never pollute the file.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  compareByExitAtDesc,
  plainTail,
  readPtyExitRecords,
  recordPtyExit,
} from "@sma1lboy/kobe-daemon/daemon/pty-exit-store"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

let dir: string
let path: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kobe-pty-exits-"))
  path = join(dir, "pty-exits.json")
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const endInfo = (over: Partial<Parameters<typeof recordPtyExit>[0]> = {}) => ({
  key: "t1::tab-1",
  pid: 4242,
  exit: { code: 1, signal: null, at: "2026-08-11T00:00:00.000Z" },
  tail: "[31mError:[0m config missing\r\nexiting\r\n",
  ...over,
})

describe("pty exit store", () => {
  it("round-trips an abnormal exit with a plain-text tail", () => {
    recordPtyExit(endInfo(), path)
    const records = readPtyExitRecords(path)
    expect(records["t1::tab-1"]).toMatchObject({
      key: "t1::tab-1",
      pid: 4242,
      code: 1,
      signal: null,
      at: "2026-08-11T00:00:00.000Z",
    })
    // ANSI stripped — the record is directly pasteable evidence.
    expect(records["t1::tab-1"]?.tail).toEqual(["Error: config missing", "exiting"])
  })

  it("skips clean exits and the internal warm spare (no-noise rule)", () => {
    recordPtyExit(endInfo({ exit: { code: 0, signal: null, at: "2026-08-11T00:00:00.000Z" } }), path)
    recordPtyExit(endInfo({ key: "::spare", exit: { code: null, signal: "SIGTERM", at: "x" } }), path)
    expect(readPtyExitRecords(path)).toEqual({})
  })

  it("records a signal kill and an unknown cause (both nulls)", () => {
    recordPtyExit(endInfo({ exit: { code: null, signal: "SIGKILL", at: "t" } }), path)
    recordPtyExit(endInfo({ key: "t1::tab-2", exit: { code: null, signal: null, at: "t" } }), path)
    const records = readPtyExitRecords(path)
    expect(records["t1::tab-1"]?.signal).toBe("SIGKILL")
    expect(records["t1::tab-2"]).toMatchObject({ code: null, signal: null })
  })

  it("newest record per key wins, and the file caps at the 50 newest", () => {
    recordPtyExit(endInfo({ exit: { code: 1, signal: null, at: "2026-08-11T00:00:00.000Z" } }), path)
    recordPtyExit(endInfo({ exit: { code: 137, signal: null, at: "2026-08-11T01:00:00.000Z" } }), path)
    expect(readPtyExitRecords(path)["t1::tab-1"]?.code).toBe(137)

    for (let i = 0; i < 60; i++) {
      const at = `2026-08-12T00:00:${String(i).padStart(2, "0")}.000Z`
      recordPtyExit(endInfo({ key: `t2::tab-${i}`, exit: { code: 1, signal: null, at } }), path)
    }
    const records = readPtyExitRecords(path)
    expect(Object.keys(records).length).toBe(50)
    // The oldest (t1::tab-1 and the first t2 tabs) were trimmed; the newest kept.
    expect(records["t1::tab-1"]).toBeUndefined()
    expect(records["t2::tab-59"]).toBeDefined()
  })

  it("orders newest-first and stays a valid strict-weak ordering across ties", () => {
    const rec = (at: string) => ({ key: "k", pid: null, code: 1, signal: null, at, tail: [] })
    const older = rec("2026-08-11T00:00:00.000Z")
    const newer = rec("2026-08-11T01:00:00.000Z")
    // Newest first.
    expect(compareByExitAtDesc(newer, older)).toBeLessThan(0)
    expect(compareByExitAtDesc(older, newer)).toBeGreaterThan(0)
    // Equal timestamps tie (0) instead of the non-transitive `? 1 : -1`, which
    // claimed each preceded the other.
    expect(compareByExitAtDesc(rec("t"), rec("t"))).toBe(0)
    expect(compareByExitAtDesc(newer, newer)).toBe(0)
  })

  it("caps to the 50 newest even when the newest all share one timestamp", () => {
    // A burst the observer stamps in one sweep: 50 deaths at the same instant,
    // plus one strictly older. The older one must be the record that is trimmed.
    const tied = "2026-08-12T00:00:00.000Z"
    recordPtyExit(endInfo({ key: "old::tab-1", exit: { code: 1, signal: null, at: "2026-08-11T00:00:00.000Z" } }), path)
    for (let i = 0; i < 50; i++) {
      recordPtyExit(endInfo({ key: `burst::tab-${i}`, exit: { code: 1, signal: null, at: tied } }), path)
    }
    const records = readPtyExitRecords(path)
    expect(Object.keys(records).length).toBe(50)
    expect(records["old::tab-1"]).toBeUndefined()
    expect(records["burst::tab-0"]).toBeDefined()
    expect(records["burst::tab-49"]).toBeDefined()
  })

  it("a corrupt or missing file reads as empty and recovers on next write", () => {
    expect(readPtyExitRecords(path)).toEqual({})
    writeFileSync(path, "{not json", "utf8")
    expect(readPtyExitRecords(path)).toEqual({})
    recordPtyExit(endInfo(), path)
    expect(readPtyExitRecords(path)["t1::tab-1"]).toBeDefined()
    // And the file itself is valid JSON again.
    expect(() => JSON.parse(readFileSync(path, "utf8"))).not.toThrow()
  })

  it("plainTail honors CR overwrites, drops trailing blanks, and bounds the tail", () => {
    expect(plainTail("progress 1%\rprogress 99%\r\ndone\r\n\r\n")).toEqual(["progress 99%", "done"])
    const many = Array.from({ length: 100 }, (_, i) => `line-${i}`).join("\n")
    const tail = plainTail(many)
    expect(tail.length).toBe(40)
    expect(tail[tail.length - 1]).toBe("line-99")
  })
})
