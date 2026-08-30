/**
 * Durable death records for hosted PTY sessions.
 *
 * The host keeps an exited session's ring in memory, but the host itself
 * idle-exits ~60s after its last live session dies — exactly the window in
 * which a crashed engine's cause evaporates (issue #9). This store writes a
 * small JSON file per KOBE home (`pty-exits.json`) at exit time so
 * `get-task`/`inspect` can answer "how did it die" long after the host is
 * gone.
 *
 * TWO layers land here. `pty` records come from the host's exit hook — the
 * session's own child died. `engine` records come from the daemon's activity
 * observer noticing the AI process gone from a session that is STILL ALIVE:
 * a tab's shell wrapper reaps its engine and `exec`s a fallback shell, so
 * that death is invisible to the hook above and used to leave no trace at
 * all. Store keys differ (`<key>` vs `<key>#engine`) so both coexist.
 *
 * Noise rules: clean PTY exits (code 0, no signal) and internal keys (the
 * warm `::spare`) are never recorded — engine deaths always are, since an
 * unexplained one is exactly what we came for. The file is capped to the newest
 * {@link MAX_RECORDS} records; a corrupt/missing file reads as empty.
 * Everything here is best-effort by contract — the host wraps the write in
 * its own fail-safe guard too.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { defaultPtyExitsPath } from "./paths.ts"
import type { PtySessionEndInfo } from "./pty-observability.ts"

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
}

const MAX_RECORDS = 50
const TAIL_LINES = 40
const TAIL_LINE_CHARS = 500

// Same escape grammar the read-output verb strips (CSI / OSC / single-char).
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping raw ANSI escapes is the point
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[@-_]/g

/** Raw PTY tail → readable last lines: strip ANSI, honor CR overwrites,
 *  drop trailing blanks, keep the last {@link TAIL_LINES}. */
export function plainTail(raw: string): string[] {
  const plain = raw.replace(ANSI_RE, "").replace(/\r\n/g, "\n")
  const lines = plain.split("\n").map((line) => (line.split("\r").pop() ?? "").slice(0, TAIL_LINE_CHARS))
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
    const m = /Engine exited \(code (\d+)\)/.exec(tail[i] ?? "")
    if (m?.[1]) return Number.parseInt(m[1], 10)
  }
  return null
}

/** All records keyed by store key; empty on missing/corrupt file. */
export function readPtyExitRecords(path = defaultPtyExitsPath()): Record<string, PtyExitRecord> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"))
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {}
    return parsed as Record<string, PtyExitRecord>
  } catch {
    return {}
  }
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
  writeRecord(
    info.key,
    {
      key: info.key,
      pid: info.pid,
      code: info.exit.code,
      signal: info.exit.signal,
      at: info.exit.at,
      tail: plainTail(info.tail),
      layer: "pty",
    },
    path,
  )
}

/** What the activity observer hands {@link recordEngineExit}. */
export interface EngineExitInfo {
  /** Session key (`taskId::tabId`) of the PTY that OUTLIVED this engine. */
  readonly key: string
  readonly vendor: string
  /** The ENGINE's own pid, from the last walk that still saw it alive; null
   *  when no walk ever resolved one. Never the surviving session's pid. */
  readonly pid: number | null
  readonly at: string
  /** Raw PTY tail at detection time (ANSI included; stripped here). */
  readonly tail: string
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
      vendor: info.vendor,
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
 */
function writeRecord(storeKey: string, record: PtyExitRecord, path: string): void {
  const records = readPtyExitRecords(path)
  records[storeKey] = record
  const newest = Object.entries(records)
    .sort(([, a], [, b]) => (a.at < b.at ? 1 : -1))
    .slice(0, MAX_RECORDS)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(Object.fromEntries(newest), null, 2), "utf8")
}
