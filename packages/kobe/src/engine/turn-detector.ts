/**
 * Engine-owned turn completion detection for hosted PTY sessions. The live
 * response stream is invisible inside a PTY, so each vendor adapter names the
 * persisted transcript record that means "a turn completed"; UI code combines
 * that with pane quiescence.
 */

import { stat } from "node:fs/promises"
import * as claudeHistory from "@/engine/claude-code-local/history"
import * as codexHistory from "@/engine/codex-local/history"
import type { VendorId } from "@/types/vendor"
import { isJsonlLineWithinBound, readTextFileIfRegular } from "./file-bounds"
import { engineEntry } from "./registry.ts"

/** `needs_input` comes from hooks (`turn-state-merge.ts`) or, for marker-less
 *  engines with a screen manifest, the screen classifier (`engine/screen-state.ts`).
 *
 *  `rate_limited` and `dead` are hook/registry-only and deliberately NOT folded
 *  into `error`: a rate limit clears on its own, an error wants you to look, a
 *  dead engine needs restarting — and the sidebar draws them apart, so the tab
 *  strip must too. */
export type ChatTabTurnState =
  | "idle"
  | "running"
  | "done"
  | "error"
  | "rate_limited"
  | "dead"
  | "needs_input"
  | "unknown"

export interface TurnCompletionMarker {
  /**
   * Opaque identity for "this exact completion", stored long-lived across polls.
   *
   * MEMORY INVARIANT: never (or contain) a substring of the transcript contents.
   * In JSC a `.slice`/`.match` shares the parent's buffer, so such an id would
   * pin the whole multi-MB transcript between polls. Build ids from numbers +
   * the file PATH, or force-copy with `Buffer.from(s).toString()`.
   */
  readonly id: string
  readonly timestampMs: number
  /** Which engine's transcript produced the marker (built-ins only today). */
  readonly source: VendorId
}

/** Newest completion marker AND newest transcript mtime from one dir scan.
 *  `mtimeMs` is `0` when there is no transcript (or no store to read). */
export interface TranscriptScan {
  readonly marker: TurnCompletionMarker | null
  readonly mtimeMs: number
}

export abstract class EngineTurnDetector {
  abstract readonly vendor: VendorId

  /** Whether this detector can emit completion markers for its vendor. */
  supportsCompletionMarkers(): boolean {
    return true
  }

  abstract latestActivity(worktree: string): Promise<TranscriptScan>

  /** Newest persisted completion marker for `worktree`, or null when absent. */
  async latestCompletion(worktree: string): Promise<TurnCompletionMarker | null> {
    return (await this.latestActivity(worktree)).marker
  }

  /**
   * {@link latestActivity} scoped to ONE session transcript: when sessions share
   * a worktree (a main task's tabs), a sibling's Stop must not idle a mid-turn
   * engine. `null` = no trustworthy scan (unsupported, missing, unreadable,
   * non-regular, oversized); an empty readable file gives a null marker. A
   * known path must never fall back to a sibling.
   */
  async latestActivityInFile(_transcriptPath: string): Promise<TranscriptScan | null> {
    return null
  }
}

/**
 * Delegates to the engine registry. Intentional import cycle with
 * `registry.ts`: safe only because both sides dereference each other's
 * bindings inside function bodies, never at module top level.
 */
export function createEngineTurnDetector(vendor: VendorId): EngineTurnDetector {
  return engineEntry(vendor).createTurnDetector()
}

interface TranscriptFileDeps {
  readFile(path: string): Promise<string | null>
  statMtimeMs?(path: string): Promise<number>
  statFile?(path: string): Promise<{ mtimeMs: number; size: number; ctimeMs: number; ino: number; dev: number } | null>
}

export interface ClaudeTurnDetectorDeps extends TranscriptFileDeps {
  listSessionFiles(worktree: string): Promise<claudeHistory.WorktreeSessionFile[]>
}

export interface CodexTurnDetectorDeps extends TranscriptFileDeps {
  findLatestRollout(worktree: string): Promise<{ path: string; mtimeMs: number } | null>
}

const statFile: NonNullable<TranscriptFileDeps["statFile"]> = (path) => stat(path).catch(() => null)

function completionReader(
  deps: TranscriptFileDeps,
  parse: (raw: string, path: string, mtimeMs: number) => TurnCompletionMarker | null,
) {
  const cache = new Map<string, { key: string; scan: TranscriptScan }>()
  return async (path: string, knownMtime?: number): Promise<TranscriptScan | null> => {
    const info = deps.statFile ? await deps.statFile(path) : null
    if (deps.statFile && !info) return null
    const mtimeMs =
      info?.mtimeMs ??
      knownMtime ??
      (await (deps.statMtimeMs ?? (async (p) => (await statFile(p))?.mtimeMs ?? 0))(path))
    if (!info && knownMtime === undefined && mtimeMs === 0) return null
    const key = info ? `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}` : String(mtimeMs)
    const hit = cache.get(path)
    if (mtimeMs > 0 && hit?.key === key) return hit.scan
    let raw: string | null
    try {
      raw = await deps.readFile(path)
    } catch {
      cache.delete(path)
      return null
    }
    if (raw === null) {
      cache.delete(path)
      return null
    }
    const scan = { marker: parse(raw, path, mtimeMs), mtimeMs }
    cache.delete(path)
    cache.set(path, { key, scan })
    if (cache.size > 8) {
      const oldest = cache.keys().next().value
      if (oldest !== undefined) cache.delete(oldest)
    }
    return scan
  }
}

const defaultClaudeDeps: ClaudeTurnDetectorDeps = {
  listSessionFiles: (worktree) => claudeHistory.listSessionFilesForWorktree(worktree),
  readFile: readTextFileIfRegular,
  statFile,
}

export class ClaudeTurnDetector extends EngineTurnDetector {
  readonly vendor = "claude" as const
  private readonly readCompletion

  constructor(private readonly deps: ClaudeTurnDetectorDeps = defaultClaudeDeps) {
    super()
    this.readCompletion = completionReader(deps, latestClaudeCompletionMarkerFromJsonl)
  }

  async latestActivity(worktree: string): Promise<TranscriptScan> {
    const files = await this.deps.listSessionFiles(worktree)
    const mtimeMs = files[0]?.mtimeMs ?? 0
    let latest: TurnCompletionMarker | null = null
    for (const file of files.slice(0, 4)) {
      const marker = (await this.readCompletion(file.path, file.mtimeMs))?.marker
      if (marker && (!latest || marker.timestampMs > latest.timestampMs)) latest = marker
    }
    return { marker: latest, mtimeMs }
  }

  override latestActivityInFile(transcriptPath: string): Promise<TranscriptScan | null> {
    return this.readCompletion(transcriptPath)
  }
}

const defaultCodexDeps: CodexTurnDetectorDeps = {
  findLatestRollout: (worktree) => codexHistory.findLatestRolloutForWorktree(worktree),
  readFile: readTextFileIfRegular,
  statFile,
}

export class CodexTurnDetector extends EngineTurnDetector {
  readonly vendor = "codex" as const
  private readonly readCompletion

  constructor(private readonly deps: CodexTurnDetectorDeps = defaultCodexDeps) {
    super()
    this.readCompletion = completionReader(deps, latestCodexCompletionMarkerFromJsonl)
  }

  override latestActivityInFile(transcriptPath: string): Promise<TranscriptScan | null> {
    return this.readCompletion(transcriptPath)
  }

  async latestActivity(worktree: string): Promise<TranscriptScan> {
    if (!worktree) return { marker: null, mtimeMs: 0 }
    const found = await this.deps.findLatestRollout(worktree)
    return found
      ? ((await this.readCompletion(found.path, found.mtimeMs)) ?? { marker: null, mtimeMs: 0 })
      : { marker: null, mtimeMs: 0 }
  }
}

/** Detector for vendors without transcript completion markers (copilot, custom). */
export class UnknownTurnDetector extends EngineTurnDetector {
  constructor(readonly vendor: VendorId) {
    super()
  }

  override supportsCompletionMarkers(): boolean {
    return false
  }

  // The daemon collector falls back to the vendor's own `latestTranscriptMtime`.
  async latestActivity(): Promise<TranscriptScan> {
    return { marker: null, mtimeMs: 0 }
  }
}

/**
 * Assistant `stop_reason` values that END the turn. Claude Code writes one
 * assistant record per STEP, mostly `tool_use` (mid-turn; 1965 of 2036 records
 * over 8 real transcripts); counting those as completions makes the lapse
 * watchdog (`activity-registry.ts` → `stillWorking`) idle a working engine.
 *
 * Allowlist, not a `!== "tool_use"` denylist: `pause_turn` is also mid-turn,
 * and a future mid-turn value must default to "still working".
 *
 * A missing/null `stop_reason` is NOT a completion (0 of the 2036 lacked one):
 * a wrong "running" just re-arms the watchdog, a wrong completion idles a
 * live engine for good.
 */
const CLAUDE_TURN_END_STOP_REASONS = new Set(["end_turn", "stop_sequence", "max_tokens", "refusal"])

export function latestClaudeCompletionMarkerFromJsonl(
  raw: string,
  sourceId = "claude",
  fallbackMtimeMs = 0,
): TurnCompletionMarker | null {
  let latest: TurnCompletionMarker | null = null
  let lineNo = 0
  for (const line of raw.split("\n")) {
    lineNo++
    const record = parseJsonLine(line)
    if (!record) continue
    const inner = isObject(record.message) ? record.message : record
    if (inner.role !== "assistant") continue
    if (typeof inner.stop_reason !== "string") continue
    if (!CLAUDE_TURN_END_STOP_REASONS.has(inner.stop_reason)) continue
    const timestampMs = timestampFromRecord(record, fallbackMtimeMs)
    const marker = {
      id: `claude:${sourceId}:${timestampMs}:${lineNo}`,
      timestampMs,
      source: "claude" as const,
    }
    if (!latest || marker.timestampMs >= latest.timestampMs) latest = marker
  }
  return latest
}

/**
 * Rollout `event_msg` payload types that mean "turn done". The on-disk rollout
 * never writes top-level `turn.completed` (that is the `codex exec --json`
 * STREAM shape); it wraps events as `{ type: "event_msg", payload: { type } }`
 * with the codex `EventMsg` snake_case tag: `task_complete` (v1),
 * `turn_complete` (v2 alias), `turn_aborted` (interrupted).
 */
const CODEX_ROLLOUT_DONE_EVENTS = new Set(["task_complete", "turn_complete", "turn_aborted"])

/** Also accepts top-level `turn.completed` from a `codex exec --json` stream dump. */
function isCodexCompletionRecord(record: Record<string, unknown>): boolean {
  if (record.type === "turn.completed") return true
  if (record.type !== "event_msg") return false
  const payload = isObject(record.payload) ? record.payload : undefined
  return typeof payload?.type === "string" && CODEX_ROLLOUT_DONE_EVENTS.has(payload.type)
}

export function latestCodexCompletionMarkerFromJsonl(raw: string, sourceId = "codex"): TurnCompletionMarker | null {
  let latest: TurnCompletionMarker | null = null
  let lineNo = 0
  for (const line of raw.split("\n")) {
    lineNo++
    const record = parseJsonLine(line)
    if (!record || !isCodexCompletionRecord(record)) continue
    const timestampMs = timestampFromRecord(record, 0)
    const marker = {
      id: `codex:${sourceId}:${timestampMs}:${lineNo}`,
      timestampMs,
      source: "codex" as const,
    }
    if (!latest || marker.timestampMs >= latest.timestampMs) latest = marker
  }
  return latest
}

function parseJsonLine(line: string): Record<string, unknown> | null {
  if (!isJsonlLineWithinBound(line)) return null
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    const parsed = JSON.parse(trimmed) as unknown
    return isObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

function timestampFromRecord(record: Record<string, unknown>, fallback: number): number {
  const ts = typeof record.timestamp === "string" ? Date.parse(record.timestamp) : Number.NaN
  return Number.isFinite(ts) ? ts : fallback
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}
