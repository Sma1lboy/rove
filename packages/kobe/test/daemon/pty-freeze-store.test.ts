/**
 * Freeze/restore store (`pty-freeze-store.ts`) — the persistence half of
 * "a pty-host restart must not take the work scene with it". One JSON file
 * per session; the pins here are the round-trip, the corruption/malformed
 * tolerance (a bad file must never block the OTHER sessions' restore), the
 * ring cap on thaw, and the reset semantics (clear = starts fresh).
 */

import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  FREEZE_MAX_RECORDS,
  FREEZE_TTL_MS,
  type FreezeableSession,
  type FrozenPtySession,
  clearFrozenSessions,
  fileFreezeSink,
  freezeSession,
  loadFrozenSessions,
  thawRing,
  thawSession,
} from "@sma1lboy/kobe-daemon/daemon/pty-freeze-store"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kobe-pty-freeze-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function fakeSession(over: Partial<FreezeableSession> = {}): FreezeableSession {
  return {
    key: "t1::tab-1",
    cwd: "/wt/t1",
    command: ["/bin/zsh", "-ilc", "claude --session-id abc"],
    cols: 120,
    rows: 40,
    title: "claude",
    totalBytes: 11,
    exit: null,
    chunks: [Buffer.from("hello "), Buffer.from("world")],
    bytes: 11,
    ...over,
  }
}

describe("pty freeze store", () => {
  it("round-trips a session: metadata + scrollback + offsets survive", () => {
    const sink = fileFreezeSink(dir)
    sink.save(freezeSession(fakeSession()))
    const [record] = loadFrozenSessions(dir)
    expect(record).toMatchObject({
      v: 1,
      key: "t1::tab-1",
      cwd: "/wt/t1",
      command: ["/bin/zsh", "-ilc", "claude --session-id abc"],
      cols: 120,
      rows: 40,
      title: "claude",
      totalBytes: 11,
      exit: null,
    })
    expect(Buffer.from(record.ringB64, "base64").toString("utf8")).toBe("hello world")

    const thawed = thawSession(record, 512 * 1024)
    expect(thawed).toMatchObject({ key: "t1::tab-1", alive: false, restored: true, bytes: 11, totalBytes: 11 })
    expect(Buffer.concat(thawed?.chunks ?? []).toString("utf8")).toBe("hello world")
  })

  it("encodes :: keys into filesystem-safe, per-session filenames", () => {
    const sink = fileFreezeSink(dir)
    sink.save(freezeSession(fakeSession({ key: "t1::tab-1" })))
    sink.save(freezeSession(fakeSession({ key: "t1::tab-1::leaf-2" })))
    const names = readdirSync(dir)
    expect(names.length).toBe(2)
    for (const name of names) expect(name).toMatch(/^[^/\\:]+\.json$/)
    expect(
      loadFrozenSessions(dir)
        .map((r) => r.key)
        .sort(),
    ).toEqual(["t1::tab-1", "t1::tab-1::leaf-2"])
  })

  it("a corrupt or foreign-version file reads as absent and never blocks the rest", () => {
    const sink = fileFreezeSink(dir)
    sink.save(freezeSession(fakeSession({ key: "good::tab-1" })))
    writeFileSync(join(dir, "broken.json"), "{not json", "utf8")
    writeFileSync(
      join(dir, "future.json"),
      JSON.stringify({ ...freezeSession(fakeSession({ key: "x::tab-1" })), v: 99 }),
      "utf8",
    )
    writeFileSync(join(dir, "internal.json"), JSON.stringify(freezeSession(fakeSession({ key: "::spare" }))), "utf8")
    expect(loadFrozenSessions(dir).map((r) => r.key)).toEqual(["good::tab-1"])
  })

  it("drop removes exactly one session; clear wipes the store (rove reset)", () => {
    const sink = fileFreezeSink(dir)
    sink.save(freezeSession(fakeSession({ key: "t1::tab-1" })))
    sink.save(freezeSession(fakeSession({ key: "t2::tab-1" })))
    sink.drop("t1::tab-1")
    expect(loadFrozenSessions(dir).map((r) => r.key)).toEqual(["t2::tab-1"])
    clearFrozenSessions(dir)
    expect(loadFrozenSessions(dir)).toEqual([])
    // clear on an absent dir is fine, and drop never throws past the sink.
    clearFrozenSessions(dir)
    sink.drop("never-existed")
  })

  it("thawRing trims an oversized ring to the cap's TAIL (the reattach repaint)", () => {
    const big = Buffer.alloc(1024, 0x61)
    const record = freezeSession(fakeSession({ chunks: [big], bytes: 1024, totalBytes: 2048 }))
    const ring = thawRing(record, 256)
    expect(ring?.bytes).toBe(256)
    // totalBytes stays monotonic from the record, not the trimmed window.
    const thawed = thawSession(record, 256)
    expect(thawed?.totalBytes).toBe(2048)
  })

  it("thaw tolerates a garbage ring — no throw, and the session still restores", () => {
    // Buffer.from(…, "base64") never throws: it decodes the valid subset.
    // The pin is that a weird ring can never crash the restore path.
    const record: FrozenPtySession = { ...freezeSession(fakeSession()), ringB64: "%%%" }
    const thawed = thawSession(record, 1024)
    expect(thawed?.restored).toBe(true)
    expect(thawed?.bytes).toBe(0)
  })
})

describe("existing-permission remediation", () => {
  // The whole point: `mode:` on mkdirSync/writeFileSync binds only at
  // CREATION. An install that froze sessions before PR #662 keeps a 0755
  // directory and 0644 records, so a mode argument alone fixes nobody who
  // was already exposed. Asserting the call arguments would pass while the
  // bug persists — these read the real filesystem bits back.
  function modeOf(path: string): string {
    return (statSync(path).mode & 0o777).toString(8)
  }

  it("tightens a pre-existing 0755 directory and its 0644 records", () => {
    const legacy = join(dir, "legacy")
    mkdirSync(legacy, { mode: 0o755 })
    chmodSync(legacy, 0o755) // umask can shave the mkdir mode; pin it
    const record = join(legacy, "t1%3A%3Atab-1.json")
    writeFileSync(record, JSON.stringify(freezeSession(fakeSession())), { encoding: "utf8", mode: 0o644 })
    chmodSync(record, 0o644)

    expect(modeOf(legacy)).toBe("755")
    expect(modeOf(record)).toBe("644")

    fileFreezeSink(legacy)

    expect(modeOf(legacy)).toBe("700")
    expect(modeOf(record)).toBe("600")
  })

  it("tightens every pre-existing record, not just the one that gets re-frozen", () => {
    const legacy = join(dir, "many")
    mkdirSync(legacy, { mode: 0o755 })
    const names = ["a%3A%3Atab-1.json", "b%3A%3Atab-1.json", "c%3A%3Atab-1.json"]
    for (const name of names) {
      writeFileSync(join(legacy, name), JSON.stringify(freezeSession(fakeSession())), "utf8")
      chmodSync(join(legacy, name), 0o644)
    }

    // Re-freeze only ONE session; the other two are the upgraded-but-never-
    // touched-again case that a forward-only fix leaves world-readable.
    fileFreezeSink(legacy).save(freezeSession(fakeSession({ key: "a::tab-1" })))

    for (const name of names) expect(modeOf(join(legacy, name))).toBe("600")
  })

  it("survives a directory that does not exist yet", () => {
    expect(() => fileFreezeSink(join(dir, "absent"))).not.toThrow()
  })
})

describe("pruning stale + over-cap records", () => {
  const DAY = 24 * 60 * 60 * 1000

  function writeRecord(key: string, updatedAt: string): void {
    fileFreezeSink(dir).save({ ...freezeSession(fakeSession({ key })), updatedAt })
  }

  it("deletes records past the TTL instead of thawing them", () => {
    const now = Date.parse("2026-08-30T00:00:00.000Z")
    writeRecord("fresh::tab-1", new Date(now - DAY).toISOString())
    // A task deleted while the host was down: `pty.sweep` only reaches a
    // RUNNING host, so nothing ever removed this record.
    writeRecord("orphan::tab-1", new Date(now - 30 * DAY).toISOString())

    const loaded = loadFrozenSessions(dir, now)

    expect(loaded.map((r) => r.key)).toEqual(["fresh::tab-1"])
    // Deleted, not merely skipped — otherwise every later boot re-reads it.
    expect(readdirSync(dir).filter((n) => n.endsWith(".json"))).toHaveLength(1)
  })

  it("keeps the newest FREEZE_MAX_RECORDS and deletes the rest", () => {
    const now = Date.parse("2026-08-30T00:00:00.000Z")
    const total = FREEZE_MAX_RECORDS + 5
    for (let i = 0; i < total; i++) {
      // i=0 newest, ascending index = older.
      writeRecord(`t${i}::tab-1`, new Date(now - i * 60_000).toISOString())
    }

    const loaded = loadFrozenSessions(dir, now)

    expect(loaded).toHaveLength(FREEZE_MAX_RECORDS)
    expect(loaded[0]?.key).toBe("t0::tab-1")
    expect(loaded.map((r) => r.key)).not.toContain(`t${total - 1}::tab-1`)
    expect(readdirSync(dir).filter((n) => n.endsWith(".json"))).toHaveLength(FREEZE_MAX_RECORDS)
  })

  it("keeps a record right at the TTL edge", () => {
    const now = Date.parse("2026-08-30T00:00:00.000Z")
    writeRecord("edge::tab-1", new Date(now - FREEZE_TTL_MS).toISOString())
    expect(loadFrozenSessions(dir, now).map((r) => r.key)).toEqual(["edge::tab-1"])
  })
})
