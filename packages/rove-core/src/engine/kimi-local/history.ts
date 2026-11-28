/**
 * Kimi Code's transcript store — PATHS ONLY, no message parsing.
 *
 * The wire format (a protocol stream, not a message log) is unverified
 * against a real conversation, so `readHistory` stays empty and auto-title
 * keeps its placeholder. Only the layout is verified, which is all a
 * handoff needs: it passes the transcript's PATH (see `session-handoff.ts`).
 *
 *   ~/.kimi-code/session_index.jsonl   one line per session:
 *                                      {sessionId, sessionDir, workDir}
 *   <sessionDir>/agents/main/wire.jsonl   the main agent's stream
 *                                         (sub-agents get their own dirs)
 *
 * `workDir` (kimi's launch cwd) is matched against the task's worktree.
 */

import { stat } from "node:fs/promises"
import path from "node:path"
import { isJsonlLineWithinBound, readTextFileBounded } from "../file-bounds"
import { sameHistoryWorktree } from "../history-worktree"
import { vendorConfigHome } from "../vendor-home"

export interface KimiHistoryDeps {
  kimiDir(): string
  readFile(p: string): Promise<string>
  stat(p: string): Promise<{ mtimeMs: number }>
}

const defaultDeps: KimiHistoryDeps = {
  kimiDir() {
    return vendorConfigHome("kimi")
  },
  async readFile(p) {
    // Size-bounded: a corrupt index degrades to "" instead of an unbounded read.
    return await readTextFileBounded(p)
  },
  stat,
}

export interface KimiSessionEntry {
  readonly sessionId: string
  readonly sessionDir: string
  readonly workDir: string
}

/** Parse `session_index.jsonl`, skipping malformed or incomplete lines. */
export function parseSessionIndex(raw: string): KimiSessionEntry[] {
  const out: KimiSessionEntry[] = []
  for (const line of raw.split("\n")) {
    if (!isJsonlLineWithinBound(line) || !line.trim()) continue
    try {
      const record: unknown = JSON.parse(line)
      if (typeof record !== "object" || record === null) continue
      if (!("sessionId" in record) || !("sessionDir" in record) || !("workDir" in record)) continue
      const { sessionId, sessionDir, workDir } = record
      if (
        typeof sessionId === "string" &&
        sessionId &&
        typeof sessionDir === "string" &&
        sessionDir &&
        typeof workDir === "string" &&
        workDir
      )
        out.push({ sessionId, sessionDir, workDir })
    } catch {
      // partial line from a concurrent append — skip
    }
  }
  return out
}

async function sessionIndex(deps: KimiHistoryDeps): Promise<KimiSessionEntry[]> {
  const raw = await deps.readFile(path.join(deps.kimiDir(), "session_index.jsonl")).catch(() => "")
  return parseSessionIndex(raw)
}

/** The main agent's stream — the one a handoff points at. Sub-agent dirs
 *  (`agents/agent-N/`) are that session's internal fan-out, not its
 *  conversation. */
function wirePath(sessionDir: string): string {
  return path.join(sessionDir, "agents", "main", "wire.jsonl")
}

/**
 * Session ids rooted at `worktree`, OLDEST-FIRST per the registry contract,
 * by `wire.jsonl` mtime rather than index order, so `.at(-1)` (the handoff's
 * fork point) is the most recently worked-in session. Missing streams drop.
 */
async function worktreeSessionFiles(
  worktree: string,
  deps: KimiHistoryDeps,
): Promise<{ id: string; mtimeMs: number }[]> {
  if (!worktree) return []
  const matches: { id: string; mtimeMs: number }[] = []
  for (const entry of await sessionIndex(deps)) {
    if (!sameHistoryWorktree(entry.workDir, worktree)) continue
    const file = wirePath(entry.sessionDir)
    const info = await deps.stat(file).catch(() => null)
    if (info) matches.push({ id: entry.sessionId, mtimeMs: info.mtimeMs })
  }
  return matches.sort((a, b) => a.mtimeMs - b.mtimeMs)
}

export async function listSessionIdsForWorktree(
  worktree: string,
  deps: KimiHistoryDeps = defaultDeps,
): Promise<string[]> {
  return (await worktreeSessionFiles(worktree, deps)).map((file) => file.id)
}

export async function latestTranscriptMtimeForWorktree(
  worktree: string,
  deps: KimiHistoryDeps = defaultDeps,
): Promise<number> {
  return (await worktreeSessionFiles(worktree, deps)).at(-1)?.mtimeMs ?? 0
}

/** Absolute path of `sessionId`'s stream, or null when the index has no
 *  such id / the file isn't on disk (a handoff must not brief the next
 *  agent with a path that doesn't resolve). */
export async function transcriptPath(sessionId: string, deps: KimiHistoryDeps = defaultDeps): Promise<string | null> {
  if (!sessionId) return null
  const entry = (await sessionIndex(deps)).find((e) => e.sessionId === sessionId)
  if (!entry) return null
  const file = wirePath(entry.sessionDir)
  return await deps
    .stat(file)
    .then(() => file)
    .catch(() => null)
}
