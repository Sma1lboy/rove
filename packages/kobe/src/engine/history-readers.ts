/**
 * The per-vendor {@link EngineHistoryReader} implementations: thin adapters
 * over each `*-local/history.ts`, normalized to the registry contract. Import
 * them via `engineEntry(vendor).history`, not directly.
 *
 * Must stay importable from vitest and MUST NOT import from `src/tui/`.
 */

import path from "node:path"
import * as claudeHistory from "./claude-code-local/history.ts"
import * as codexHistory from "./codex-local/history.ts"
import * as copilotHistory from "./copilot-local/history.ts"
import { readTextFileIfRegular } from "./file-bounds.ts"
import * as kimiHistory from "./kimi-local/history.ts"
import { parsePiSessionRaw } from "./pi-local/history-parse.ts"
import * as piHistory from "./pi-local/history.ts"
// Type-only, so the registry↔readers pair is not a runtime cycle.
import type { EngineHistoryReader } from "./registry.ts"

/** For engines with no transcript store (custom engines), so auto-title keeps the
 *  placeholder instead of mis-reading claude's transcripts. */
export const EMPTY_HISTORY: EngineHistoryReader = {
  async listSessionIdsForWorktree() {
    return []
  },
  async readHistory() {
    return []
  },
  async transcriptPath() {
    return null
  },
  async latestTranscriptMtimeForWorktree() {
    return 0
  },
}

/** `listSessionFilesForWorktree` is NEWEST-first; the contract is oldest-first. */
export const claudeHistoryReader: EngineHistoryReader = {
  async listSessionIdsForWorktree(worktree) {
    const files = await claudeHistory.listSessionFilesForWorktree(worktree)
    return [...files].sort((a, b) => a.mtimeMs - b.mtimeMs).map((f) => f.sessionId)
  },
  readHistory: (sessionId) => claudeHistory.readHistory(sessionId),
  readUsageSnapshot: (sessionId) => claudeHistory.readUsageSnapshot(sessionId),
  async transcriptPath(sessionId, worktree) {
    const files = await claudeHistory.listSessionFilesForWorktree(worktree)
    return files.find((f) => f.sessionId === sessionId)?.path ?? null
  },
  latestTranscriptMtimeForWorktree: (worktree) => claudeHistory.latestTranscriptMtimeForWorktree(worktree),
}

/** `listSessionIdsForWorktree` is already oldest-first. */
export const codexHistoryReader: EngineHistoryReader = {
  listSessionIdsForWorktree: (worktree) => codexHistory.listSessionIdsForWorktree(worktree),
  readHistory: (sessionId) => codexHistory.readHistory(sessionId),
  readUsageSnapshot: async (sessionId) => (await codexHistory.readHistoryWithMetrics(sessionId)).usageMetrics,
  // Store is date-keyed, not worktree-keyed; the filename embeds the UUID.
  transcriptPath: async (sessionId) => (await codexHistory.findRolloutFile(sessionId)) ?? null,
  latestTranscriptMtimeForWorktree: (worktree) => codexHistory.latestTranscriptMtimeForWorktree(worktree),
}

export const copilotHistoryReader: EngineHistoryReader = {
  listSessionIdsForWorktree: (worktree) => copilotHistory.listSessionIdsForWorktree(worktree),
  readHistory: (sessionId) => copilotHistory.readHistory(sessionId),
  readUsageSnapshot: async (sessionId) => (await copilotHistory.readHistoryWithMetrics(sessionId)).usageMetrics,
  async transcriptPath(sessionId) {
    const dir = await copilotHistory.findSessionDir(sessionId)
    return dir ? path.join(dir, "events.jsonl") : null
  },
  latestTranscriptMtimeForWorktree: (worktree) => copilotHistory.latestTranscriptMtimeForWorktree(worktree),
}

/** PATHS ONLY: `wire.jsonl`'s message shape is unverified, so `readHistory` stays
 *  empty while the handoff still gets a real file to pass on. */
export const kimiHistoryReader: EngineHistoryReader = {
  listSessionIdsForWorktree: (worktree) => kimiHistory.listSessionIdsForWorktree(worktree),
  // Shares EMPTY_HISTORY's function so `supportsStructuredHistory` reports
  // kimi honestly as "no message reader".
  readHistory: EMPTY_HISTORY.readHistory,
  transcriptPath: (sessionId) => kimiHistory.transcriptPath(sessionId),
  latestTranscriptMtimeForWorktree: (worktree) => kimiHistory.latestTranscriptMtimeForWorktree(worktree),
}

/** pi and omp share store format, parser and encoder; only the agent directory
 *  differs (see `pi-local/history.ts`). */
function piFamilyHistoryReader(vendor: piHistory.PiStoreVendor): EngineHistoryReader {
  return {
    listSessionIdsForWorktree: (worktree) => piHistory.listSessionIdsForWorktree(vendor, worktree),
    readHistory: (sessionId) => piHistory.readHistory(vendor, sessionId),
    readUsageSnapshot: async (sessionId) => {
      const file = await piHistory.findSessionFile(vendor, sessionId)
      if (!file) return undefined
      const raw = await readTextFileIfRegular(file)
      if (raw === null) return undefined
      return parsePiSessionRaw(file, raw, sessionId).usageMetrics
    },
    transcriptPath: (sessionId, worktree) => piHistory.transcriptPath(vendor, sessionId, worktree),
    latestTranscriptMtimeForWorktree: (worktree) => piHistory.latestTranscriptMtimeForWorktree(vendor, worktree),
  }
}

export const piHistoryReader = piFamilyHistoryReader("pi")
export const ompHistoryReader = piFamilyHistoryReader("omp")
