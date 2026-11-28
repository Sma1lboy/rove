/**
 * ACP session transcript store (`<ROVE_HOME>/.rove/acp-sessions/<encoded-cwd>/<sessionId>.jsonl`)
 * plus the `EngineHistoryReader` and `EngineTurnDetector` implementations that expose
 * ACP conversations to Rove's neutral history, search, handoff, and activity layers.
 */

import { appendFileSync, mkdirSync } from "node:fs"
import { readdir, stat } from "node:fs/promises"
import { join } from "node:path"
import type { Message } from "@sma1lboy/rove-core/types/engine.ts"
import { resolveProductHomeDir } from "@sma1lboy/rove-daemon/daemon/product-paths"
import { readTextFileIfRegular } from "../file-bounds.ts"
import type { EngineHistoryReader } from "../registry.ts"
import type { EngineTurnDetector, TranscriptScan, TurnCompletionMarker } from "../turn-detector.ts"
import { latestAcpCompletionMarkerFromJsonl, normalizeAcpRecords, parseAcpJsonl } from "./normalize.ts"
import type { AcpTranscriptRecord } from "./protocol.ts"

/** Root directory holding ACP session JSONL transcripts under Rove's home dir. */
export function acpSessionsRoot(homeDir?: string): string {
  return join(homeDir ?? resolveProductHomeDir(), ".rove", "acp-sessions")
}

/** Deterministic, filesystem-safe directory slug for a worktree path. */
export function encodeAcpWorktree(worktree: string): string {
  return worktree.replace(/[^A-Za-z0-9._-]/g, "_")
}

/** Reject path-traversal characters in a session id before touching the filesystem. */
function safeSessionId(sessionId: string): string {
  return sessionId.replace(/[^A-Za-z0-9._-]/g, "_")
}

export function acpSessionFilePath(worktree: string, sessionId: string, homeDir?: string): string {
  return join(acpSessionsRoot(homeDir), encodeAcpWorktree(worktree), `${safeSessionId(sessionId)}.jsonl`)
}

/** Append one ACP transcript record to the session's JSONL file (owner-only permissions). */
export function appendAcpTranscriptRecord(
  worktree: string,
  sessionId: string,
  record: AcpTranscriptRecord,
  homeDir?: string,
): string {
  const dir = join(acpSessionsRoot(homeDir), encodeAcpWorktree(worktree))
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const file = join(dir, `${safeSessionId(sessionId)}.jsonl`)
  appendFileSync(file, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 })
  return file
}

export interface AcpSessionFile {
  readonly sessionId: string
  readonly path: string
  readonly mtimeMs: number
}

/** Session files in `worktree`, sorted OLDEST-FIRST per `EngineHistoryReader` contract. */
export async function listAcpSessionFilesForWorktree(
  worktree: string,
  homeDir?: string,
): Promise<readonly AcpSessionFile[]> {
  if (!worktree) return []
  const dir = join(acpSessionsRoot(homeDir), encodeAcpWorktree(worktree))
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return []
  }
  const files: AcpSessionFile[] = []
  for (const name of entries) {
    if (!name.endsWith(".jsonl")) continue
    const filePath = join(dir, name)
    const info = await stat(filePath).catch(() => null)
    if (!info?.isFile()) continue
    files.push({
      sessionId: name.slice(0, -".jsonl".length),
      path: filePath,
      mtimeMs: info.mtimeMs,
    })
  }
  return files.sort((a, b) => a.mtimeMs - b.mtimeMs)
}

/** Locate a session file across all worktree buckets by its session id. */
export async function findAcpSessionFile(sessionId: string, homeDir?: string): Promise<string | null> {
  if (!sessionId) return null
  const root = acpSessionsRoot(homeDir)
  const target = `${safeSessionId(sessionId)}.jsonl`
  let dirs: string[]
  try {
    dirs = await readdir(root)
  } catch {
    return null
  }
  for (const bucket of dirs) {
    const candidate = join(root, bucket, target)
    const info = await stat(candidate).catch(() => null)
    if (info?.isFile()) return candidate
  }
  return null
}

/** Read and normalize one ACP session's transcript into neutral `Message[]`. */
export async function readAcpHistory(sessionId: string, homeDir?: string): Promise<readonly Message[]> {
  const file = await findAcpSessionFile(sessionId, homeDir)
  if (!file) return []
  const raw = await readTextFileIfRegular(file)
  if (raw === null) return []
  return normalizeAcpRecords(parseAcpJsonl(raw), sessionId)
}

/** Build an `EngineHistoryReader` backed by the ACP session store (injectable `homeDir` for tests). */
export function acpHistoryReaderFor(homeDir?: string): EngineHistoryReader {
  return {
    async listSessionIdsForWorktree(worktree) {
      const files = await listAcpSessionFilesForWorktree(worktree, homeDir)
      return files.map((f) => f.sessionId)
    },
    readHistory: (sessionId) => readAcpHistory(sessionId, homeDir),
    async transcriptPath(sessionId, worktree) {
      if (worktree) {
        const direct = acpSessionFilePath(worktree, sessionId, homeDir)
        const info = await stat(direct).catch(() => null)
        if (info?.isFile()) return direct
      }
      return findAcpSessionFile(sessionId, homeDir)
    },
    async latestTranscriptMtimeForWorktree(worktree) {
      const files = await listAcpSessionFilesForWorktree(worktree, homeDir)
      return files[files.length - 1]?.mtimeMs ?? 0
    },
  }
}

export const acpHistoryReader: EngineHistoryReader = acpHistoryReaderFor()

/** Completion-marker detector for ACP sessions (`turn_end` records in ACP JSONL).
 *  Implements `EngineTurnDetector` without runtime inheritance to avoid a module cycle
 *  through `registry.ts` → `acp-local/adapter.ts` → `turn-detector.ts`. */
export class AcpTurnDetector implements EngineTurnDetector {
  readonly vendor = "acp" as const
  private readonly cache = new Map<string, { key: string; scan: TranscriptScan }>()

  constructor(private readonly homeDir?: string) {}

  supportsCompletionMarkers(): boolean {
    return true
  }

  async latestCompletion(worktree: string): Promise<TurnCompletionMarker | null> {
    return (await this.latestActivity(worktree)).marker
  }

  private async scanFile(filePath: string): Promise<TranscriptScan | null> {
    const info = await stat(filePath).catch(() => null)
    if (!info?.isFile()) {
      this.cache.delete(filePath)
      return null
    }
    const key = `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`
    const hit = this.cache.get(filePath)
    if (hit?.key === key) return hit.scan
    const raw = await readTextFileIfRegular(filePath)
    if (raw === null) {
      this.cache.delete(filePath)
      return null
    }
    const scan: TranscriptScan = {
      marker: latestAcpCompletionMarkerFromJsonl(raw, filePath, info.mtimeMs),
      mtimeMs: info.mtimeMs,
    }
    this.cache.delete(filePath)
    this.cache.set(filePath, { key, scan })
    if (this.cache.size > 8) {
      const oldest = this.cache.keys().next().value
      if (oldest !== undefined) this.cache.delete(oldest)
    }
    return scan
  }

  async latestActivity(worktree: string): Promise<TranscriptScan> {
    const files = await listAcpSessionFilesForWorktree(worktree, this.homeDir)
    const mtimeMs = files[files.length - 1]?.mtimeMs ?? 0
    let latest: TurnCompletionMarker | null = null
    // Check the newest 4 sessions, matching ClaudeTurnDetector's bound.
    for (const file of files.slice(-4).reverse()) {
      const marker = (await this.scanFile(file.path))?.marker
      if (marker && (!latest || marker.timestampMs > latest.timestampMs)) latest = marker
    }
    return { marker: latest, mtimeMs }
  }

  latestActivityInFile(transcriptPath: string): Promise<TranscriptScan | null> {
    return this.scanFile(transcriptPath)
  }
}
