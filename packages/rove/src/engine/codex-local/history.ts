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
 * Messages and tool call/result `response_item`s become {@link Message}s
 * (`./history-parse.ts`); other records are dropped. Lookup by UUID scans the
 * date tree newest-first (the UUID carries no date); unreadable files are
 * skipped per entry so one corrupt rollout doesn't blank the result.
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

/** Newest rollout mtime (epoch ms) for `worktree`, or 0; polled by the Ops pane. */
export async function latestTranscriptMtimeForWorktree(
  worktree: string,
  deps: HistoryDeps = defaultHistoryDeps,
): Promise<number> {
  return (await findLatestRolloutForWorktree(worktree, deps))?.mtimeMs ?? 0
}

export async function readHistory(
  sessionId: string,
  deps: HistoryDeps = defaultHistoryDeps,
): Promise<readonly Message[]> {
  return (await readHistoryWithMetrics(sessionId, deps)).messages
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
