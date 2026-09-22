/**
 * Freeze/restore persistence for hosted PTY sessions.
 *
 * Scrollback lives in host memory, so a host crash / reboot / SIGTERM would
 * otherwise lose the session table and every byte of it. One JSON file per
 * session under `<home>/.kobe/pty-sessions/` holds what a LATER host needs:
 * key, cwd, launch command, size, title, byte offsets, and the ring.
 *
 * Restore is LAZY and lossy-by-design: a thawed session is a dead
 * "restored" corpse with scrollback intact; the first `pty.open` respawns
 * the child in place (`pty-host.ts`). Screen and launch line survive the
 * host; the conversation survives via the engine's own resume.
 *
 * Writes: atomic tmp+rename, one file per session, all best-effort (a
 * freeze hiccup must never take the terminal down). Explicit kills
 * (`pty.kill`, task-deletion sweep) drop their record. `rove reset`'s
 * graceful stop clears the directory; SIGTERM / crash / reboot leave it.
 */

import { randomUUID } from "node:crypto"
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { StringDecoder } from "node:string_decoder"
import {
  OWNER_ONLY_DIR_MODE,
  OWNER_ONLY_FILE_MODE,
  tightenDirPermissionsSync,
  tightenFilePermissionsSync,
} from "./owner-only.ts"
import { defaultPtyFreezeDir } from "./paths.ts"
import type { PtySessionExit } from "./protocol.ts"
import type { PtySessionState } from "./pty-host-types.ts"
import { DEFAULT_TERMINAL_COLORS } from "./terminal-colors.ts"

/** Record format version — unknown versions read as absent (forward-safe). */
const FREEZE_VERSION = 1

/** One session, frozen. The ring rides base64; offsets stay monotonic. */
export interface FrozenPtySession {
  readonly v: number
  readonly key: string
  readonly cwd: string
  readonly command: readonly string[]
  readonly cols: number
  readonly rows: number
  readonly title: string
  /** Same monotonic total the live session tracked — restored sessions
   *  continue it, so a client's parked offset stays comparable. */
  readonly totalBytes: number
  /** How the child died when it did; null for a host-death casualty. */
  readonly exit: PtySessionExit | null
  readonly ringB64: string
  readonly updatedAt: string
}

/** Durable-snapshot sink `PtyHost` reports freezeable moments to. */
export interface PtyFreezeSink {
  save(record: FrozenPtySession): void
  drop(key: string): void
}

/** The session fields a snapshot needs (structural — `PtySessionState`
 *  satisfies it, tests can fake it). */
export interface FreezeableSession {
  readonly key: string
  readonly cwd: string
  readonly command: readonly string[]
  readonly cols: number
  readonly rows: number
  readonly title: string
  readonly totalBytes: number
  readonly exit: PtySessionExit | null
  readonly chunks: readonly Buffer[]
  readonly bytes: number
}

/** Session state → its durable record. Pure. */
export function freezeSession(session: FreezeableSession, now = new Date()): FrozenPtySession {
  return {
    v: FREEZE_VERSION,
    key: session.key,
    cwd: session.cwd,
    command: [...session.command],
    cols: session.cols,
    rows: session.rows,
    title: session.title,
    totalBytes: session.totalBytes,
    exit: session.exit,
    ringB64: Buffer.concat(session.chunks as Buffer[]).toString("base64"),
    updatedAt: now.toISOString(),
  }
}

/**
 * Record → ring buffers, trimmed to `cap` bytes from the FRONT (the tail
 * is what a reattach repaints). Returns null for a malformed ring. A newer
 * host with a smaller cap than the freezing host still restores safely.
 */
export function thawRing(record: FrozenPtySession, cap: number): { chunks: Buffer[]; bytes: number } | null {
  let ring: Buffer
  try {
    ring = Buffer.from(record.ringB64, "base64")
  } catch {
    return null
  }
  const trimmed = ring.byteLength > cap ? ring.subarray(ring.byteLength - cap) : ring
  return { chunks: trimmed.byteLength > 0 ? [trimmed] : [], bytes: trimmed.byteLength }
}

/**
 * Record → a restored session state: dead, ring intact, marked `restored`
 * so the host's next `open` respawns the child in place instead of treating
 * it as a view-only corpse. Null for a malformed ring.
 */
export function thawSession(record: FrozenPtySession, cap: number): PtySessionState | null {
  const ring = thawRing(record, cap)
  if (!ring) return null
  return {
    key: record.key,
    generation: randomUUID(),
    cwd: record.cwd,
    proc: null,
    alive: false,
    chunks: [...ring.chunks],
    bytes: ring.bytes,
    totalBytes: Math.max(record.totalBytes, ring.bytes),
    cols: record.cols,
    rows: record.rows,
    command: record.command,
    title: record.title,
    titleCarry: "",
    titleDecoder: new StringDecoder("utf8"),
    colorQueryCarry: "",
    defaultColors: DEFAULT_TERMINAL_COLORS,
    sinks: new Map(),
    parked: false,
    parkedScreenBytes: 0,
    exit: record.exit,
    restored: true,
    lastFreezeAtMs: 0,
  }
}

/** `taskId::tab-1` → a filename every filesystem tolerates. */
function recordFile(dir: string, key: string): string {
  return join(dir, `${encodeURIComponent(key)}.json`)
}

function parseRecord(raw: string): FrozenPtySession | null {
  try {
    const parsed = JSON.parse(raw) as FrozenPtySession
    if (parsed?.v !== FREEZE_VERSION) return null
    if (typeof parsed.key !== "string" || parsed.key.length === 0) return null
    if (parsed.key.startsWith("::")) return null // internal keys never freeze
    if (typeof parsed.cwd !== "string" || !Array.isArray(parsed.command)) return null
    if (typeof parsed.ringB64 !== "string" || typeof parsed.totalBytes !== "number") return null
    return parsed
  } catch {
    return null
  }
}

/**
 * How stale a record may be before a host boot discards it instead of
 * thawing it: well past "back to that tab on Monday", short enough that the
 * directory can't grow without bound.
 */
export const FREEZE_TTL_MS = 14 * 24 * 60 * 60 * 1000

/**
 * How much frozen scrollback ONE boot reads back, newest first.
 *
 * A restore budget, not a retention policy: a record past it stays on disk
 * untouched. Measured: one install carried 108 records / 69MB, and records
 * past the newest 64 were real previous-day work.
 *
 * Bytes, not records, because bytes drive both costs: the boot read and the
 * rings held in memory. 64MB is ~128 sessions at the 512KB ring cap and ~100
 * at that install's 640KB mean record.
 */
export const FREEZE_RESTORE_MAX_BYTES = 64 * 1024 * 1024

/** What one {@link loadFrozenSessions} did — `pty-server` logs it so dropped
 *  or deferred scrollback shows in `daemon.log`. */
export interface FreezeLoadSummary {
  readonly restored: number
  readonly bytesRead: number
  /** Past {@link FREEZE_RESTORE_MAX_BYTES}: not read, not deleted, still on disk. */
  readonly deferred: number
  /** Past {@link FREEZE_TTL_MS}: deleted. */
  readonly expired: number
  /** Present but unparseable — left alone for a human to look at. */
  readonly unreadable: number
}

/** Newest-first by `updatedAt`; unparseable stamps sort oldest. */
function updatedAtMs(record: FrozenPtySession): number {
  const t = Date.parse(record.updatedAt)
  return Number.isFinite(t) ? t : 0
}

/**
 * Every restorable record in `dir` that fits the restore budget; missing or
 * corrupt entries read as none.
 *
 * Ordered by file mtime (`statSync`): ordering by a field inside the records
 * would mean reading them all — the unbounded read the budget prevents.
 * Every freeze rewrites the file, so mtime ≈ `updatedAt`; the parsed
 * `updatedAt` still governs the TTL for records read, so a copy/backup with
 * a drifted-newer mtime still expires correctly.
 *
 * Only the TTL deletes — the backstop for tasks deleted while the host was
 * down (the task-deletion sweep reaches only a RUNNING host). Over-budget
 * records are never deleted: the budget is about this boot's memory.
 */
export function loadFrozenSessions(
  dir = defaultPtyFreezeDir(),
  now = Date.now(),
  report?: (summary: FreezeLoadSummary) => void,
): FrozenPtySession[] {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  const entries: Array<{ name: string; size: number; mtimeMs: number }> = []
  for (const name of names) {
    if (!name.endsWith(".json")) continue
    try {
      const st = statSync(join(dir, name))
      entries.push({ name, size: st.size, mtimeMs: st.mtimeMs })
    } catch {
      // Vanished between readdir and stat — nothing to restore or delete.
    }
  }
  entries.sort((a, b) => b.mtimeMs - a.mtimeMs)

  const kept: FrozenPtySession[] = []
  const stale: string[] = []
  let bytesRead = 0
  let deferred = 0
  let unreadable = 0
  for (const entry of entries) {
    // mtime can only run at or ahead of the record's own stamp, so an
    // mtime-expired file is expired for certain — safe to drop unread.
    if (now - entry.mtimeMs > FREEZE_TTL_MS) {
      stale.push(entry.name)
      continue
    }
    if (bytesRead + entry.size > FREEZE_RESTORE_MAX_BYTES && kept.length > 0) {
      deferred++
      continue
    }
    let record: FrozenPtySession | null = null
    try {
      record = parseRecord(readFileSync(join(dir, entry.name), "utf8"))
    } catch {
      // One unreadable file must not cost the rest.
    }
    bytesRead += entry.size
    if (!record) {
      unreadable++
      continue
    }
    if (now - updatedAtMs(record) > FREEZE_TTL_MS) stale.push(entry.name)
    else kept.push(record)
  }
  for (const name of stale) {
    try {
      rmSync(join(dir, name), { force: true })
    } catch {
      /* best-effort: a record we couldn't delete is simply skipped this boot */
    }
  }
  kept.sort((a, b) => updatedAtMs(b) - updatedAtMs(a))
  report?.({ restored: kept.length, bytesRead, deferred, expired: stale.length, unreadable })
  return kept
}

/**
 * Re-`chmod` the freeze directory and every record already in it.
 *
 * Walks existing records: one not re-frozen since a laxer umask keeps
 * world-readable scrollback. Why a repair pass at all: `owner-only.ts`.
 */
export function tightenExistingPermissions(dir: string): void {
  tightenDirPermissionsSync(dir)
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return // no directory yet: nothing pre-existing to tighten
  }
  for (const name of names) {
    if (name.endsWith(".json")) tightenFilePermissionsSync(join(dir, name))
  }
}

/** The real sink: per-session atomic files under `dir`. Never throws. */
export function fileFreezeSink(dir = defaultPtyFreezeDir()): PtyFreezeSink {
  // Once per host boot: the mode args below bind only at creation, so a
  // pre-existing 0755 dir / 0644 record would otherwise stay open forever.
  tightenExistingPermissions(dir)
  return {
    save(record) {
      try {
        // 0700/0600: the ring holds every byte the agent printed (`env`,
        // `cat`ed credentials, a PAT in a git remote). Owner-only.
        mkdirSync(dir, { recursive: true, mode: OWNER_ONLY_DIR_MODE })
        const target = recordFile(dir, record.key)
        const staging = `${target}.${process.pid}.tmp`
        writeFileSync(staging, JSON.stringify(record), { encoding: "utf8", mode: OWNER_ONLY_FILE_MODE })
        renameSync(staging, target)
      } catch {
        /* best-effort by contract — a freeze hiccup never kills the terminal */
      }
    },
    drop(key) {
      try {
        rmSync(recordFile(dir, key), { force: true })
      } catch {
        /* absent is the desired end state anyway */
      }
    },
  }
}

/**
 * Wipe every frozen session — `rove reset`'s graceful pty-host stop only, so
 * the next host comes up empty.
 */
export function clearFrozenSessions(dir = defaultPtyFreezeDir()): void {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* already gone */
  }
}
