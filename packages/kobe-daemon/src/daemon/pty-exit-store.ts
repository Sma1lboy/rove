/**
 * Durable death records for hosted PTY sessions.
 *
 * The host keeps an exited session's ring in memory, but the host itself
 * idle-exits ~60s after its last live session dies — exactly the window in
 * which a crashed engine's cause evaporates. This store writes a
 * small JSON file per KOBE home (`pty-exits.json`) at exit time so
 * `get-task`/`inspect` can answer "how did it die" long after the host is
 * gone.
 *
 * TWO layers land here. `pty` records come from the host's exit hook — the
 * session's own child died. `engine` records come from the daemon's activity
 * observer noticing the AI process gone from a session that is STILL ALIVE:
 * a tab's shell wrapper reaps its engine and `exec`s a fallback shell, so
 * that death is invisible to the hook above. Store keys differ (`<key>` vs
 * `<key>#engine`) so both coexist.
 *
 * Noise rules: clean PTY exits (code 0, no signal) and internal keys (the
 * warm `::spare`) are never recorded — engine deaths always are, since an
 * unexplained one is exactly what we came for. The file is capped to the newest
 * {@link MAX_RECORDS} records; a corrupt/missing file reads as empty.
 * Everything here is best-effort by contract — the host wraps the write in
 * its own fail-safe guard too.
 */

import { randomUUID } from "node:crypto"
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { defaultPtyExitsPath } from "./paths.ts"
import type { PtySessionEndInfo } from "./pty-observability.ts"
import { terminalRows } from "./terminal-rows.ts"

/**
 * Which process died. `pty` is the session's own child (the shell wrapper);
 * `engine` is the AI process INSIDE a still-living PTY — the layer the PTY
 * hook is structurally blind to, because the wrapper `exec`s a fallback
 * shell and keeps the session alive (`session-launch.ts` keepAlive).
 */
export type PtyExitLayer = "pty" | "engine"

/** One persisted record. Store key is the session key for `pty` records and
 *  `<sessionKey>#engine` for engine ones, so both layers of the same tab
 *  coexist; `key` always names the session either way. */
export interface PtyExitRecord {
  readonly key: string
  readonly pid: number | null
  /** Wait-status code where the OS gave one; otherwise the shell wrapper's
   *  own `Engine exited (code N)` banner ({@link engineExitCodeFromTail}),
   *  which is the only code a signalled or reaped death leaves behind. Read
   *  it together with {@link signal} and {@link layer}: `code: 143` beside
   *  `signal: "SIGKILL"` on a `pty` record means the ENGINE exited 143 and
   *  the surviving session was then killed. */
  readonly code: number | null
  readonly signal: string | null
  readonly at: string
  /** Plain-text last lines of output (ANSI stripped, CR-folded). */
  readonly tail: readonly string[]
  /** Absent on legacy records written before engine-layer deaths existed. */
  readonly layer?: PtyExitLayer
  /** Engine layer only: which engine died, per the foreground walk. */
  readonly vendor?: string
  /** Engine layer only: always true — the PTY outlived its engine, which is
   *  exactly what makes this record's existence meaningful. */
  readonly parentAlive?: boolean
  /** `at` is when the daemon DISCOVERED this death, not when it happened.
   *  Set on records the boot reconciler writes for an engine that died while
   *  no daemon was watching (see `activity-observer.ts`'s
   *  `onEngineAbsentAtStart`): the wrapper's banner proves the death but
   *  carries no clock, and stamping discovery time silently would make an
   *  hours-old corpse read as fresh. */
  readonly atApproximate?: true
}

const MAX_RECORDS = 50
const TAIL_LINES = 40
const TAIL_LINE_CHARS = 500

/** Raw PTY tail → readable last lines: recover rows (see `terminal-rows.ts` —
 *  an engine's alt-screen paint has no newlines to split on), drop trailing
 *  blanks, keep the last {@link TAIL_LINES}. */
export function plainTail(raw: string): string[] {
  const lines = terminalRows(raw, TAIL_LINE_CHARS)
  while (lines.length > 0 && (lines[lines.length - 1] ?? "").trim() === "") lines.pop()
  return lines.slice(-TAIL_LINES)
}

/**
 * Exit code of the dead engine, scraped from the shell wrapper's own
 * `⚠ Engine exited (code N)` banner (`session-launch.ts` keepAlive) in the
 * PTY tail. A `ps` walk cannot observe a reaped child's status — the
 * wrapper shell reaped it, not us — so this line is the ONLY exit code that
 * exists at this layer. Null when the banner is absent (engine exited 0, or
 * a launch command without the wrapper). Codes >128 are signal deaths
 * (143 = 128+SIGTERM), which the shell reports the same way.
 */
export function engineExitCodeFromTail(tail: readonly string[]): number | null {
  for (let i = tail.length - 1; i >= 0; i--) {
    const m = ENGINE_EXIT_BANNER.exec(tail[i] ?? "")
    if (m?.[1]) return Number.parseInt(m[1], 10)
  }
  return null
}

/**
 * The keepAlive wrapper's own banner, as a matcher — the twin of kobe's
 * `session-launch.ts` `ENGINE_EXIT_BANNER` (this package cannot import that
 * one). Deliberately non-global: `.test`/`.exec` on a global regex carries
 * `lastIndex` between calls.
 *
 * Its presence in a tail is POSITIVE proof an engine ran here and exited
 * nonzero — a string Rove itself printed, not an inference. Capture group 1
 * is the code.
 */
export const ENGINE_EXIT_BANNER = /Engine exited \(code (\d+)\)/

export interface PtyExitStoreRead {
  readonly records: Record<string, PtyExitRecord>
  /**
   * - `ok` — parsed.
   * - `absent` — no file yet, which is truthfully an empty store.
   * - `unparsable` — bytes are there but are not a store. Only an overwrite
   *   recovers from this, so {@link writeRecord} proceeds.
   * - `unreadable` — the OS refused the read (EACCES, EMFILE, EIO). The
   *   content is presumably intact and we simply do not know it, so nothing
   *   may rewrite or prune against it.
   */
  readonly status: "ok" | "absent" | "unparsable" | "unreadable"
  /** `status` is `ok` or `absent` — i.e. `records` is what is on disk. The
   *  read/prune answer; {@link writeRecord} wants the finer `status`. */
  readonly readable: boolean
}

/**
 * All records keyed by store key, plus WHY the read came back the way it did.
 *
 * "No records" and "could not read" are different facts, and the callers that
 * mutate state on this file must not confuse them: the watcher prunes its
 * `seen` map against `records`, so treating a failed read as an empty file
 * empties `seen` and re-fires every death on disk.
 */
export function readPtyExitStore(path = defaultPtyExitsPath()): PtyExitStoreRead {
  const read = (status: PtyExitStoreRead["status"], records: Record<string, PtyExitRecord> = {}): PtyExitStoreRead => ({
    records,
    status,
    readable: status === "ok" || status === "absent",
  })
  let raw: string
  try {
    raw = readFileSync(path, "utf8")
  } catch (err) {
    return read((err as NodeJS.ErrnoException).code === "ENOENT" ? "absent" : "unreadable")
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return read("unparsable")
    return read("ok", parsed as Record<string, PtyExitRecord>)
  } catch {
    return read("unparsable")
  }
}

/** All records keyed by store key; empty on missing/corrupt file. For
 *  read-only consumers (`rove api inspect`, `get-task`) where "no records" and
 *  "could not read" lead to the same rendering. Anything that WRITES or prunes
 *  off this file must use {@link readPtyExitStore} instead. */
export function readPtyExitRecords(path = defaultPtyExitsPath()): Record<string, PtyExitRecord> {
  return readPtyExitStore(path).records
}

/**
 * Persist one session's death record. Clean exits and internal keys are
 * skipped (noise rule); the newest record per key wins; the file keeps only
 * the {@link MAX_RECORDS} newest by exit time. Throws only past the caller's
 * guard — all I/O errors surface to it.
 */
export function recordPtyExit(info: PtySessionEndInfo, path = defaultPtyExitsPath()): void {
  if (info.key.startsWith("::")) return
  if (info.exit.code === 0 && info.exit.signal === null) return
  const tail = plainTail(info.tail)
  writeRecord(
    info.key,
    {
      key: info.key,
      pid: info.pid,
      // A signalled session has no wait-status code, so `code` used to be
      // null while the very tail in the same record spelled the number out
      // (`Engine exited (code 143)`). The banner is the only code that
      // exists then — publish it rather than making every caller re-parse
      // prose the store already knows how to read.
      code: info.exit.code ?? engineExitCodeFromTail(tail),
      signal: info.exit.signal,
      at: info.exit.at,
      tail,
      layer: "pty",
    },
    path,
  )
}

/** What the activity observer hands {@link recordEngineExit}. */
export interface EngineExitInfo {
  /** Session key (`taskId::tabId`) of the PTY that OUTLIVED this engine. */
  readonly key: string
  /** Which engine died, per the walk that last saw it. Absent on the boot
   *  reconciler's records: it never walked this session with an engine in it
   *  — the banner proves one died, and nothing on disk names it. */
  readonly vendor?: string
  /** The ENGINE's own pid, from the last walk that still saw it alive; null
   *  when no walk ever resolved one. Never the surviving session's pid. */
  readonly pid: number | null
  readonly at: string
  /** Raw PTY tail at detection time (ANSI included; stripped here). */
  readonly tail: string
  /** See {@link PtyExitRecord.atApproximate} — `at` is discovery time. */
  readonly atApproximate?: true
}

/**
 * Persist one ENGINE death — the AI process gone from a PTY that is still
 * alive. Detected by the foreground walk losing its vendor, so there is no
 * wait status to read: `signal` is always null and `code` comes from the
 * wrapper's banner when it printed one ({@link engineExitCodeFromTail}).
 * Recording an unexplained death is the point, so unlike the PTY layer
 * there is no clean-exit noise rule — every disappearance is written.
 */
export function recordEngineExit(info: EngineExitInfo, path = defaultPtyExitsPath()): void {
  if (info.key.startsWith("::")) return
  const tail = plainTail(info.tail)
  writeRecord(
    `${info.key}#engine`,
    {
      key: info.key,
      pid: info.pid,
      code: engineExitCodeFromTail(tail),
      signal: null,
      at: info.at,
      tail,
      layer: "engine",
      ...(info.vendor ? { vendor: info.vendor } : {}),
      ...(info.atApproximate ? { atApproximate: true as const } : {}),
      parentAlive: true,
    },
    path,
  )
}

/**
 * Read-modify-write one record under the cap.
 *
 * ponytail: last-writer-wins across the two writer processes (PTY host for
 * `pty` records, daemon for `engine` ones). An interleave loses a record;
 * add a lockfile if that is ever observed, not before — the writes are
 * seconds apart in practice and a lost record is what we had before.
 *
 * The write itself is tmp+rename, the sync twin of `json-file.ts`'s
 * `writeJsonAtomic` (which is async, and this runs in the PTY host's node
 * entry as well as the daemon). A plain `writeFileSync` truncates first, and
 * with TWO writer processes the daemon's own watcher reads inside that window
 * and sees an unparseable file — which used to resurrect every death on disk.
 */
function writeRecord(storeKey: string, record: PtyExitRecord, path: string): void {
  const store = readPtyExitStore(path)
  // Refuse rather than rewrite the whole file from what we failed to read:
  // that would silently drop up to MAX_RECORDS other deaths. Both callers
  // wrap this in a fail-safe guard, so the cost is one lost record.
  // `unparsable` is NOT refused: those bytes are already not a store, and
  // overwriting is the only way back — refusing would wedge it forever.
  if (store.status === "unreadable")
    throw new Error(`pty-exits store is unreadable (${path}) — refusing to overwrite it`)
  const records = store.records
  records[storeKey] = record
  const newest = Object.entries(records)
    .sort(([, a], [, b]) => (a.at < b.at ? 1 : -1))
    .slice(0, MAX_RECORDS)
  mkdirSync(dirname(path), { recursive: true })
  // pid+uuid in the tmp name for the reason writeJsonAtomic carries them: a
  // fixed `${path}.tmp` is shared state between the two writer processes.
  const tmp = `${path}.tmp-${process.pid}-${randomUUID()}`
  // 0600: every record carries `plainTail` — the dying process's last output,
  // same class of content as the scrollback in pty-freeze-store.
  writeFileSync(tmp, JSON.stringify(Object.fromEntries(newest), null, 2), { encoding: "utf8", mode: 0o600 })
  renameSync(tmp, path)
}
