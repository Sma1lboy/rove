/**
 * Read historical messages from Claude Code's on-disk JSONL. Algorithm
 * ported from `refs/opcode/src-tauri/src/commands/claude.rs` lines 147–230.
 *
 *     ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl
 *
 * `<encoded-cwd>` is lossy ({@link encodeCwd}: `foo/bar-baz` and
 * `foo-bar/baz` collide), so reads never decode it — they scan every
 * project dir for `<sessionId>.jsonl`, as opcode does.
 *
 * Records also include permission-mode events, file-history snapshots, etc.;
 * only role+content records surface. `content` is a bare string or a
 * content-block array, both normalized via {@link normalizeClaudeContent}
 * into `Message.blocks`.
 */

import { randomUUID } from "node:crypto"
import { appendFile, mkdir, readdir, stat, unlink } from "node:fs/promises"
import path from "node:path"
import type { EngineUsageSnapshot, Message } from "@/types/engine"
import { isJsonlLineWithinBound, readTextFileBounded } from "../file-bounds"
import { isObject } from "../json-hooks.ts"
import { vendorConfigHome } from "../vendor-home"
import { parseSessionRaw } from "./history-parse"

export { parseJsonl } from "./history-parse"

/** Optional FS injection for tests. */
export interface HistoryDeps {
  /** Absolute path to the directory holding `<encoded-cwd>` subdirs. */
  projectsDir(): string
  readdir(p: string): Promise<string[]>
  readFile(p: string): Promise<string>
  /** Returns true if the path exists. Used to short-circuit before listing. */
  pathExists(p: string): Promise<boolean>
}

const defaultDeps: HistoryDeps = {
  projectsDir() {
    return path.join(vendorConfigHome("claude"), "projects")
  },
  async readdir(p) {
    try {
      return await readdir(p)
    } catch {
      return []
    }
  },
  async readFile(p) {
    // Oversize/corrupt transcript degrades to "" rather than loading GBs.
    return await readTextFileBounded(p)
  },
  async pathExists(p) {
    try {
      await readdir(p)
      return true
    } catch {
      return false
    }
  },
}

/**
 * Encode a cwd to Claude Code's project directory name. Must match Claude's
 * own encoder exactly (`/[^a-zA-Z0-9]/g` → `-`, verified in the shipped CLI
 * bundle): folding only `/` and `.` misses any path with e.g. `_`, silently
 * breaking session discovery, activity mtime, and interrupted-prompt rescue.
 * No fallback encoding — Claude creates no other. Lossy; never decoded.
 */
export function encodeCwd(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-")
}

/** One persisted Claude session file under a worktree's project dir. */
export interface WorktreeSessionFile {
  /** Session UUID (the JSONL filename without extension). */
  readonly sessionId: string
  /** Absolute path to the `.jsonl`. */
  readonly path: string
  /** File mtime in epoch ms — newest = most recent activity. */
  readonly mtimeMs: number
}

/**
 * Every Claude transcript for `worktree`, newest-first by mtime. `[]` when
 * the project dir doesn't exist yet (task never entered). Never throws.
 */
export async function listSessionFilesForWorktree(worktree: string): Promise<WorktreeSessionFile[]> {
  if (!worktree) return []
  const dir = path.join(vendorConfigHome("claude"), "projects", encodeCwd(worktree))
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return []
  }
  const out: WorktreeSessionFile[] = []
  for (const entry of entries) {
    if (!entry.endsWith(".jsonl")) continue
    const full = path.join(dir, entry)
    let mtimeMs = 0
    try {
      mtimeMs = (await stat(full)).mtimeMs
    } catch {
      // keep mtime 0; the file may have vanished between readdir and stat
    }
    out.push({ sessionId: entry.slice(0, -".jsonl".length), path: full, mtimeMs })
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return out
}

/**
 * Newest transcript mtime (epoch ms) for `worktree`, or 0 with no session
 * files. The Ops pane polls it to detect new output without parsing the PTY.
 */
export async function latestTranscriptMtimeForWorktree(worktree: string): Promise<number> {
  const files = await listSessionFilesForWorktree(worktree)
  return files[0]?.mtimeMs ?? 0
}

/**
 * Conversation messages for `sessionId`, found by scanning every project dir.
 * `[]` if not found; bad lines are skipped (old sessions have unfamiliar
 * shapes). Append-aware: the unchanged prefix keeps stable Message
 * identities so the polling chat pane doesn't churn rows; a
 * rewrite/truncation forces a full re-parse.
 */
export async function readHistory(sessionId: string, deps: HistoryDeps = defaultDeps): Promise<readonly Message[]> {
  const root = deps.projectsDir()
  const projectDirs = await deps.readdir(root)

  for (const dir of projectDirs) {
    const candidate = path.join(root, dir, `${sessionId}.jsonl`)
    let raw: string
    try {
      raw = await deps.readFile(candidate)
    } catch {
      continue
    }
    return parseSessionRaw(candidate, raw, sessionId)
  }
  return []
}

/**
 * Session-aggregate usage folded from per-turn usage on assistant records.
 * The ONE place Claude's context arithmetic lives: context = the LAST turn's
 * input + cache read + cache creation, derived (hence
 * `context_tokens_approximate`); neutral layers must not re-derive it.
 * `undefined` = nothing reported, distinct from a reported zero.
 */
export async function readUsageSnapshot(
  sessionId: string,
  deps: HistoryDeps = defaultDeps,
): Promise<EngineUsageSnapshot | undefined> {
  const messages = await readHistory(sessionId, deps)
  let input = 0
  let output = 0
  let cacheRead = 0
  let cacheCreate = 0
  let lastContext = 0
  for (const message of messages) {
    const usage = message.usage
    if (!usage) continue
    input += usage.input_tokens
    output += usage.output_tokens
    const read = usage.cache_read_input_tokens ?? 0
    const create = usage.cache_creation_input_tokens ?? 0
    cacheRead += read
    cacheCreate += create
    lastContext = usage.input_tokens + read + create
  }
  if (input === 0 && output === 0) return undefined
  return {
    input_tokens: input,
    output_tokens: output,
    ...(cacheRead > 0 ? { cache_read_input_tokens: cacheRead } : {}),
    ...(cacheCreate > 0 ? { cache_creation_input_tokens: cacheCreate } : {}),
    ...(lastContext > 0 ? { context_tokens: lastContext, context_tokens_approximate: true } : {}),
  }
}

/**
 * Permanently delete `sessionId`'s JSONL. The session's cwd isn't tracked,
 * so scan every project dir like {@link readHistory}. ENOENT is tolerated;
 * any other error is thrown for the orchestrator to log.
 */
export async function deleteHistory(sessionId: string, deps: HistoryDeps = defaultDeps): Promise<void> {
  const root = deps.projectsDir()
  const projectDirs = await deps.readdir(root)
  for (const dir of projectDirs) {
    const candidate = path.join(root, dir, `${sessionId}.jsonl`)
    try {
      await unlink(candidate)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue
      throw err
    }
  }
}

/**
 * Rescue an interrupted `claude -p` prompt into the session JSONL so the
 * next `--resume` sees it. claude persists only at turn boundaries, so a
 * steer/ESC kill mid-turn drops the prompt it was processing.
 *
 * Chaining, from the most recent user/assistant record:
 *   - assistant (or empty file): append a user record with `parentUuid` = its `uuid`.
 *   - user (an earlier rescue, no reply since): coalesce — carry its text
 *     forward and chain to its PARENT as a same-parent sibling. `--resume`
 *     follows the newest leaf, so the model sees ONE user turn (the API
 *     rejects back-to-back user records); the older sibling stays on disk.
 *
 * Append-only: claude may still be flushing to this JSONL mid-stop, and a
 * whole-file rewrite would drop records flushed after our read. O_APPEND
 * writes at live EOF; a stale snapshot can only mis-chain `parentUuid`.
 *
 * Missing file → create dir, write as first line. Other I/O errors throw
 * (engine.stop logs + swallows). Minimum keys for both {@link readHistory}
 * and claude's `--resume` reader:
 *
 *     { type: "user", message: { role: "user", content: <text> },
 *       uuid, parentUuid, sessionId, cwd, timestamp,
 *       isSidechain: false, userType: "external", version: "1.0.0" }
 */
export async function appendInterruptedUserPrompt(
  sessionId: string,
  cwd: string,
  prompt: string,
  deps: HistoryDeps = defaultDeps,
): Promise<void> {
  if (!prompt || prompt.trim().length === 0) return

  const projectDir = path.join(deps.projectsDir(), encodeCwd(cwd))
  const filePath = path.join(projectDir, `${sessionId}.jsonl`)

  let lines: string[] = []
  try {
    // Oversize transcript degrades to "" → append a fresh record, no merge.
    const raw = await readTextFileBounded(filePath)
    lines = raw.split("\n").filter((l) => l.length > 0)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err
    await mkdir(projectDir, { recursive: true })
  }

  // Skip non-conversational records so coalescing sees turns, not tail noise.
  let lastConvRecord: Record<string, unknown> | null = null
  let lastConvRole: "user" | "assistant" | null = null
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] as string
    if (!isJsonlLineWithinBound(line)) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    if (!isObject(parsed)) continue
    const inner = isObject(parsed.message) ? (parsed.message as Record<string, unknown>) : parsed
    const role = inner.role
    if (role === "user" || role === "assistant") {
      lastConvRecord = parsed
      lastConvRole = role
      break
    }
  }

  const now = new Date().toISOString()

  // Append-only, NEVER rewrite: see the doc comment (concurrent flushes).
  let content = prompt
  let parentUuid = lastConvRecord && typeof lastConvRecord.uuid === "string" ? (lastConvRecord.uuid as string) : null

  if (lastConvRole === "user" && lastConvRecord) {
    const inner = isObject(lastConvRecord.message)
      ? (lastConvRecord.message as Record<string, unknown>)
      : lastConvRecord
    const existing = typeof inner.content === "string" ? inner.content : ""
    // claude may have flushed this prompt before SIGTERM, or a prior rescue
    // already coalesced it; re-injecting would double it in context.
    if (existing === prompt || existing.endsWith(`\n\n${prompt}`)) return
    // Same-parent sibling supersedes the un-replied turn (see DAG note on
    // `sortByTimestamp`).
    content = existing.length > 0 ? `${existing}\n\n${prompt}` : prompt
    parentUuid = typeof lastConvRecord.parentUuid === "string" ? (lastConvRecord.parentUuid as string) : null
  }

  const record = {
    type: "user",
    message: { role: "user", content },
    uuid: randomUUID(),
    parentUuid,
    sessionId,
    cwd,
    timestamp: now,
    isSidechain: false,
    userType: "external",
    version: "1.0.0",
  }
  await appendFile(filePath, `${JSON.stringify(record)}\n`)
}
