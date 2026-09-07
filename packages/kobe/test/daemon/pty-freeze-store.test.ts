/**
 * Freeze/restore store (`pty-freeze-store.ts`) — the persistence half of
 * "a pty-host restart must not take the work scene with it". One JSON file
 * per session; the pins here are the round-trip, the corruption/malformed
 * tolerance (a bad file must never block the OTHER sessions' restore), the
 * ring cap on thaw, and the reset semantics (clear = starts fresh).
 */

import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  FREEZE_RESTORE_MAX_BYTES,
  FREEZE_TTL_MS,
  type FreezeLoadSummary,
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
  // CREATION. A freeze directory created under a laxer umask keeps its 0755
  // directory and 0644 records, so a mode argument alone fixes nobody who is
  // already exposed. Asserting the call arguments would pass while the bug
  // persists — these read the real filesystem bits back.
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

describe("pruning stale + over-budget records", () => {
  const DAY = 24 * 60 * 60 * 1000

  function writeRecord(key: string, updatedAt: string, ringBytes = 0): void {
    const chunks = ringBytes > 0 ? [Buffer.alloc(ringBytes, 0x61)] : undefined
    fileFreezeSink(dir).save({ ...freezeSession(fakeSession({ key, ...(chunks ? { chunks } : {}) })), updatedAt })
    // Ordering is decided by mtime (see `loadFrozenSessions`), so pin it
    // rather than relying on write order resolving at ms granularity.
    const at = Date.parse(updatedAt) / 1000
    utimesSync(join(dir, `${encodeURIComponent(key)}.json`), at, at)
  }

  /** Two of these overflow FREEZE_RESTORE_MAX_BYTES; one does not. */
  const HALF_BUDGET_RING = Math.ceil(((FREEZE_RESTORE_MAX_BYTES / 2 + 2 * 1024 * 1024) * 3) / 4)

  it("deletes records past the TTL instead of thawing them", () => {
    const now = Date.parse("2026-08-30T00:00:00.000Z")
    writeRecord("fresh::tab-1", new Date(now - DAY).toISOString())
    // A task deleted while the host was down: the sweep only reaches a
    // RUNNING host, so nothing ever removed this record.
    writeRecord("orphan::tab-1", new Date(now - 30 * DAY).toISOString())

    const loaded = loadFrozenSessions(dir, now)

    expect(loaded.map((r) => r.key)).toEqual(["fresh::tab-1"])
    // Deleted, not merely skipped — otherwise every later boot re-reads it.
    expect(readdirSync(dir).filter((n) => n.endsWith(".json"))).toHaveLength(1)
  })

  it("restores newest-first up to the byte budget and LEAVES the rest on disk", () => {
    const now = Date.parse("2026-08-30T00:00:00.000Z")
    writeRecord("newer::tab-1", new Date(now - 60_000).toISOString(), HALF_BUDGET_RING)
    writeRecord("older::tab-1", new Date(now - 120_000).toISOString(), HALF_BUDGET_RING)

    const loaded = loadFrozenSessions(dir, now)

    expect(loaded.map((r) => r.key)).toEqual(["newer::tab-1"])
    // The point of the whole change: over-budget is DEFERRED, never deleted.
    // A directory that outgrew a guess used to lose the overflow permanently.
    expect(readdirSync(dir).filter((n) => n.endsWith(".json"))).toHaveLength(2)
  })

  it("still restores a lone record larger than the whole budget", () => {
    const now = Date.parse("2026-08-30T00:00:00.000Z")
    writeRecord("huge::tab-1", new Date(now - 60_000).toISOString(), FREEZE_RESTORE_MAX_BYTES)

    expect(loadFrozenSessions(dir, now).map((r) => r.key)).toEqual(["huge::tab-1"])
  })

  it("expires a record the budget never reads, so the TTL still bounds the directory", () => {
    const now = Date.parse("2026-08-30T00:00:00.000Z")
    writeRecord("newer::tab-1", new Date(now - 60_000).toISOString(), HALF_BUDGET_RING)
    // Past the budget AND past the TTL. Only a check that runs BEFORE the read
    // can reach it — a budget that merely stopped reading would strand it
    // forever, and the directory would grow without bound again.
    writeRecord("ancient::tab-1", new Date(now - 30 * DAY).toISOString(), HALF_BUDGET_RING)

    const loaded = loadFrozenSessions(dir, now)

    expect(loaded.map((r) => r.key)).toEqual(["newer::tab-1"])
    expect(readdirSync(dir).filter((n) => n.endsWith(".json"))).toEqual(["newer%3A%3Atab-1.json"])
  })

  it("reports what the boot did with the store", () => {
    const now = Date.parse("2026-08-30T00:00:00.000Z")
    writeRecord("newer::tab-1", new Date(now - 60_000).toISOString(), HALF_BUDGET_RING)
    writeRecord("older::tab-1", new Date(now - 120_000).toISOString(), HALF_BUDGET_RING)
    writeRecord("ancient::tab-1", new Date(now - 30 * DAY).toISOString())

    let summary: FreezeLoadSummary | undefined
    loadFrozenSessions(dir, now, (s) => {
      summary = s
    })

    // Deferring and deleting are different outcomes and the log must say which.
    expect(summary).toMatchObject({ restored: 1, deferred: 1, expired: 1, unreadable: 0 })
    expect(summary?.bytesRead).toBeLessThanOrEqual(FREEZE_RESTORE_MAX_BYTES)
  })

  it("keeps a record right at the TTL edge", () => {
    const now = Date.parse("2026-08-30T00:00:00.000Z")
    writeRecord("edge::tab-1", new Date(now - FREEZE_TTL_MS).toISOString())
    expect(loadFrozenSessions(dir, now).map((r) => r.key)).toEqual(["edge::tab-1"])
  })
})
