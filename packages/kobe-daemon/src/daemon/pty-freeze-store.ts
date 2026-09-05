/**
 * Freeze/restore persistence for hosted PTY sessions.
 *
 * The host keeps every session's scrollback ring in memory, so the host
 * process ending (crash, machine reboot, SIGTERM) would otherwise take the
 * whole work scene with it: dead children are expected, but the session
 * table and every byte of scrollback would go too, leaving the next host to
 * come up knowing nothing. This store is the freeze half: one small
 * JSON file per session under `<home>/.kobe/pty-sessions/`, holding
 * everything a LATER host incarnation needs to put the session back —
 * metadata (key, cwd, launch command, size, title, byte offsets) plus the
 * ring buffer itself.
 *
 * Restore is LAZY and lossy-by-design: a thawed session comes back as a
 * dead "restored" corpse with its scrollback intact, and the first
 * `pty.open` respawns the child in place (see `pty-host.ts`). Nothing
 * pretends a dead process can be resurrected — the contract is "your
 * screen and your launch line survive the host, your conversation
 * survives via the engine's own resume".
 *
 * Write discipline: atomic tmp+rename per session file, everything
 * best-effort (a freeze hiccup must never take the terminal down), one
 * file per session so a flush rewrites only what drifted. Explicitly
 * killed sessions (`pty.kill`, task-deletion sweep) drop their record — a
 * close the user asked for is not a restart casualty. `rove reset`'s
 * graceful stop clears the whole directory ("starts fresh" is reset's
 * contract); a bare SIGTERM / crash / reboot leaves it for the next host.
 */

import { randomUUID } from "node:crypto"
import { chmodSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { StringDecoder } from "node:string_decoder"
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
  /** Epoch ms of the most recent attached-client write. Absent means none. */
  readonly lastHumanWriteMs?: number
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
  readonly lastHumanWriteMs?: number
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
    ...(session.lastHumanWriteMs ? { lastHumanWriteMs: session.lastHumanWriteMs } : {}),
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
    lastHumanWriteMs: record.lastHumanWriteMs ?? 0,
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
 * thawing it. Restore exists so the session you were just looking at
 * survives a host restart; a snapshot nobody has touched in a fortnight is
 * a dead task's leftovers, not a work scene. Two weeks is well past any
 * plausible "I'll come back to that tab on Monday" and still short enough
 * that the directory can't grow without bound.
 */
export const FREEZE_TTL_MS = 14 * 24 * 60 * 60 * 1000

/**
 * How much frozen scrollback ONE boot reads back, newest first.
 *
 * This is a restore budget, not a retention policy: a record past it is left
 * on disk untouched, not deleted. The two jobs used to be one 64-record cap
 * that did neither well — it was applied AFTER reading every file (so it
 * bounded nothing) and it `rmSync`'d the overflow (so a directory that had
 * merely outgrown a guess lost real scrollback). A measured install carried
 * 108 records / 69MB against that "several times any realistic number" cap,
 * and every record past 64 was from the previous day's work.
 *
 * Bytes rather than records because bytes are what both costs actually track:
 * the boot read, and the rings the host then holds in memory for the whole
 * session. 64MB is ~128 sessions at the 512KB ring cap and ~100 at the 640KB
 * mean record that install showed.
 */
export const FREEZE_RESTORE_MAX_BYTES = 64 * 1024 * 1024

/** What one {@link loadFrozenSessions} did — `pty-server` logs it, so a boot
 *  that dropped or deferred someone's scrollback says so in `daemon.log`
 *  instead of doing it silently. */
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
 * Ordering comes from each file's mtime, taken from `statSync` — deciding
 * what to read by a field INSIDE the records would mean reading all of them
 * first, which is the unbounded read this budget exists to stop. A record is
 * rewritten wholesale on every freeze, so its mtime and its `updatedAt` are
 * stamped at the same moment; the parsed `updatedAt` still governs the TTL
 * for everything actually read, so a record whose mtime drifted newer than
 * its contents (a copy, a restore-from-backup) is still expired correctly.
 *
 * Only the TTL deletes. That is what bounds the directory — `pty.sweep`
 * reaches only a RUNNING host, so a task deleted while the host was down
 * leaves its record behind, and two weeks is the backstop. Deferring a record
 * for being over budget must never delete it: the budget is a statement about
 * this boot's memory, and the user may still want that scrollback.
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

/** Owner-only. See {@link tightenExistingPermissions} for why the mode
 *  arguments on mkdir/write are not enough on their own. */
const DIR_MODE = 0o700
const FILE_MODE = 0o600

/**
 * Re-`chmod` the freeze directory and every record already in it.
 *
 * The `mode` options on `mkdirSync` / `writeFileSync` apply ONLY when the
 * path is created — for a path that already exists they are a silent no-op.
 * So an install whose freeze directory was created with a laxer umask keeps
 * its 0755 directory and its 0644 records forever: the directory stays
 * traversable by every local user, and any session not re-frozen since keeps
 * world-readable scrollback. Closing that takes a remediation pass over the
 * existing paths, not just correct modes on files created from here on.
 *
 * Best-effort and idempotent, like every other write in this module: a
 * chmod that fails (foreign owner, read-only mount) must never take the
 * terminal down.
 */
export function tightenExistingPermissions(dir: string): void {
  try {
    chmodSync(dir, DIR_MODE)
  } catch {
    /* absent, or not ours to chmod — the mkdir below still creates it 0700 */
  }
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return // no directory yet: nothing pre-existing to tighten
  }
  for (const name of names) {
    if (!name.endsWith(".json")) continue
    try {
      chmodSync(join(dir, name), FILE_MODE)
    } catch {
      /* one stubborn file must not cost the rest */
    }
  }
}

/** The real sink: per-session atomic files under `dir`. Never throws. */
export function fileFreezeSink(dir = defaultPtyFreezeDir()): PtyFreezeSink {
  // Remediate on construction (once per host boot), not per save: the mode
  // arguments below only bind at creation time, so a pre-existing 0755
  // directory / 0644 record would otherwise stay wide open forever.
  tightenExistingPermissions(dir)
  return {
    save(record) {
      try {
        // 0700/0600: `ringB64` is the session's whole scrollback, so this file
        // holds every byte the agent printed — `env` output, `cat`ed credential
        // files, a git remote carrying a PAT. Owner-only, like a private key.
        mkdirSync(dir, { recursive: true, mode: DIR_MODE })
        const target = recordFile(dir, record.key)
        const staging = `${target}.${process.pid}.tmp`
        writeFileSync(staging, JSON.stringify(record), { encoding: "utf8", mode: FILE_MODE })
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
 * Wipe every frozen session — `rove reset`'s graceful pty-host stop only.
 * An explicit teardown is not a restart: the next host must come up empty,
 * not resurrect sessions reset was asked to end.
 */
export function clearFrozenSessions(dir = defaultPtyFreezeDir()): void {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* already gone */
  }
}
