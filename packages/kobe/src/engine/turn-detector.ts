/**
 * Engine-owned turn completion detection for hosted PTY sessions.
 *
 * Warp's reliable status model comes from structured response-stream
 * lifecycle events. kobe hosts engines in interactive CLIs inside a PTY,
 * so we cannot observe the live stream directly. The next-best contract is
 * engine-owned transcript markers: each vendor adapter knows which persisted
 * record means "a turn completed"; UI code only asks this abstraction and
 * combines it with pane quiescence.
 */

import { stat } from "node:fs/promises"
import * as claudeHistory from "@/engine/claude-code-local/history"
import * as codexHistory from "@/engine/codex-local/history"
import type { VendorId } from "@/types/vendor"
import { isJsonlLineWithinBound, readTextFileIfRegular } from "./file-bounds"
import { engineEntry } from "./registry.ts"

/** `needs_input` comes from hooks (permission prompt / question dialog via
 *  `turn-state-merge.ts`) or, for marker-less engines with a screen
 *  manifest, from the poll's screen classifier (`engine/screen-state.ts`).
 *
 *  `rate_limited` and `dead` are hook/registry-only (the poll cannot see
 *  either) and are deliberately NOT folded into `error`: the three ask for
 *  opposite actions — a rate limit clears on its own, an error wants you to
 *  look, and a dead engine needs restarting. The sidebar has always drawn
 *  them apart; collapsing them here made the tab strip disagree with the rail
 *  about the same tab. */
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
   * Opaque identity for "this exact completion". Callers (the Ops pane's
   * turn poller) store it long-lived as a baseline across polls.
   *
   * MEMORY INVARIANT: the id must NEVER be (or contain) a substring of the
   * transcript file contents. In JSC (Bun) a `.slice`/`.match` of a string
   * shares the parent's backing buffer, so a long-lived id sliced out of a
   * whole-file JSONL read would pin the entire multi-MB transcript in
   * memory between polls. The builders below construct ids from template
   * literals over numbers + the file PATH (an independent small string) —
   * keep it that way, or force-copy with `Buffer.from(s).toString()`.
   */
  readonly id: string
  readonly timestampMs: number
  /** Which engine's transcript produced the marker (built-ins only today). */
  readonly source: VendorId
}

/**
 * The two fs-derived facts a single transcript-dir scan yields: the newest
 * completion marker AND the newest transcript mtime. The daemon collector
 * wants both per probe, and finding the completion already walks the dir
 * and stats its files — so one scan surfaces both instead of two callers
 * each doing their own readdir (the perf win). `mtimeMs` is `0` when the
 * worktree has no transcript yet (or the detector has no store to read).
 */
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

  /**
   * Newest completion marker AND newest transcript mtime for `worktree`
   * from ONE directory scan. Callers that want both (the daemon's activity
   * collector) use this so the transcript dir is listed once, not twice.
   */
  abstract latestActivity(worktree: string): Promise<TranscriptScan>

  /** Newest persisted completion marker for `worktree`, or null when absent. */
  async latestCompletion(worktree: string): Promise<TurnCompletionMarker | null> {
    return (await this.latestActivity(worktree)).marker
  }

  /**
   * {@link latestActivity} scoped to ONE session transcript. The worktree
   * scan answers "did ANY session here complete a turn" — wrong question for
   * the activity lapse watchdog when several sessions share a worktree (the
   * kobe main task runs many tabs in one checkout): a sibling's Stop read as
   * "this turn ended" and idled a genuinely mid-turn engine at the TTL.
   * `null` means there is no trustworthy scan: unsupported, missing,
   * unreadable, non-regular, or oversized. An empty readable file produces
   * a scan with a null marker. A known path must never fall back to a sibling.
   */
  async latestActivityInFile(_transcriptPath: string): Promise<TranscriptScan | null> {
    return null
  }
}

/**
 * Resolve the turn detector for a vendor — a thin delegate to the engine
 * registry, which owns the per-vendor choice (one entry per engine; see
 * `registry.ts`). Kept exported here so call sites (`tui/ops/host.tsx`)
 * keep their import. NB: registry.ts imports the detector classes below,
 * so this pair is an intentional import cycle (same pattern as
 * `hook-adapter.ts`) — both sides only dereference the other's bindings
 * inside function bodies, never at module top-level, which keeps the cycle
 * safe under ESM evaluation order.
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

  // No transcript store this detector can read — no marker, no mtime. The
  // daemon collector falls back to the vendor's own `latestTranscriptMtime`
  // (e.g. copilot's) when `supportsCompletionMarkers()` is false.
  async latestActivity(): Promise<TranscriptScan> {
    return { marker: null, mtimeMs: 0 }
  }
}

/**
 * Assistant `stop_reason` values that END the turn. Claude Code appends one
 * assistant record per STEP, and the overwhelming majority are
 * `stop_reason: "tool_use"` — mid-turn, the exact opposite of a completion
 * (measured over 8 real transcripts: 1965 of 2036 assistant records).
 * Treating any assistant record as a completion made the daemon's lapse
 * watchdog (`activity-registry.ts` → `stillWorking`) idle a working engine at
 * the TTL, and made its heartbeat re-arm unreachable for Claude: the
 * `completedAt >= at` branch always won.
 *
 * Allowlist, not a `!== "tool_use"` denylist, for the same reason
 * {@link CODEX_ROLLOUT_DONE_EVENTS} is one: `pause_turn` (long-running server
 * tools) is also mid-turn, and the next mid-turn value the API adds must
 * default to "still working" rather than silently idling the badge again.
 *
 * A MISSING or null `stop_reason` is NOT a completion. Real transcripts always
 * carry one on assistant records (0 absent in the 2036 above), so the only
 * records this drops are malformed or synthetic ones — and for those,
 * "the turn is still running" is the recoverable guess: the watchdog just
 * re-arms, whereas a wrong completion idles a live engine for good.
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
 * Rollout `event_msg` payload types that mean "this turn is done". Codex's
 * real on-disk rollout (codex-cli) never writes a top-level `turn.completed`
 * record — that shape is the `codex exec --json` STREAM event. A rollout wraps
 * each agent event as `{ type: "event_msg", payload: { type: ... } }`, and the
 * completion signal is the flattened EventMsg tag: `task_complete` (v1 wire),
 * `turn_complete` (v2 alias), or `turn_aborted` (interrupted). Sourced from the
 * codex protocol enum (`EventMsg` #[serde(rename_all="snake_case")], with
 * `task_complete`/`turn_complete` aliased on the same variant).
 */
const CODEX_ROLLOUT_DONE_EVENTS = new Set(["task_complete", "turn_complete", "turn_aborted"])

/** True when `record` is a rollout completion marker — either the real
 *  rollout `event_msg` (task_complete / turn_complete / turn_aborted) or the
 *  legacy top-level `turn.completed` from a `codex exec --json` stream dump. */
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
