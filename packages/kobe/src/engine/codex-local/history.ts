/**
 * Read historical messages from Codex's on-disk rollout JSONL.
 *
 * Where Codex keeps sessions:
 *
 *     ~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-<ISO-TS>-<UUID>.jsonl
 *
 * Each line has shape:
 *
 *     { "type": "session_meta", "payload": { "id": "<UUID>", "cwd": "...", ... } }
 *     { "type": "response_item", "payload": { "type": "message", "role": "user"|"assistant",
 *                                              "content": [{ "type": "input_text"|"output_text", ... }] } }
 *     { "type": "event_msg", ... }
 *     { "type": "turn_context", ... }
 *     (more)
 *
 * We extract `response_item` records of type `message` with a known role,
 * plus persisted Codex tool call/result items, and surface them via
 * {@link Message}; other record types are dropped. Record parsing (and the
 * shared append-aware parse cache) lives in `./history-parse.ts`.
 *
 * Session-lookup-by-UUID requires scanning the date-organized tree
 * because the UUID alone doesn't carry the rollout date — newest-first
 * to bias toward recent sessions. ENOENT / unreadable files are
 * tolerated per-entry so a single corrupt rollout doesn't blank the
 * whole result.
 */

import { unlink } from "node:fs/promises"
import type { EngineHistory, Message } from "@/types/engine"
import { parseRolloutRaw } from "./history-parse"
import { type HistoryDeps, defaultHistoryDeps, findLatestRolloutForWorktree, findRolloutFile } from "./session-files"

export { deriveCodexUsageMetrics, parseJsonl } from "./history-parse"
export {
  type HistoryDeps,
  defaultHistoryDeps,
  findLatestRolloutForWorktree,
  findRolloutFile,
  listRolloutFiles,
  listSessionIdsForWorktree,
  rolloutCwd,
} from "./session-files"

/**
 * Newest rollout mtime (epoch ms) for `worktree`, or 0 when none match.
 * The Ops pane polls this to detect new Codex conversation output
 * without parsing the PTY screen. Thin wrapper over
 * {@link findLatestRolloutForWorktree}.
 */
export async function latestTranscriptMtimeForWorktree(
  worktree: string,
  deps: HistoryDeps = defaultHistoryDeps,
): Promise<number> {
  return (await findLatestRolloutForWorktree(worktree, deps))?.mtimeMs ?? 0
}

export async function readHistory(sessionId: string, deps: HistoryDeps = defaultHistoryDeps): Promise<Message[]> {
  return (await readHistoryWithMetrics(sessionId, deps)).messages as Message[]
}

export async function readHistoryWithMetrics(
  sessionId: string,
  deps: HistoryDeps = defaultHistoryDeps,
): Promise<EngineHistory> {
  const file = await findRolloutFile(sessionId, deps)
  if (!file) return { messages: [] }
  let raw: string
  try {
    raw = await deps.readFile(file)
  } catch {
    return { messages: [] }
  }
  return parseRolloutRaw(file, raw, sessionId)
}

export async function deleteHistory(sessionId: string, deps: HistoryDeps = defaultHistoryDeps): Promise<void> {
  const file = await findRolloutFile(sessionId, deps)
  if (!file) return
  try {
    await unlink(file)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return
    throw err
  }
}
