import { readdir, rm, stat } from "node:fs/promises"
import path from "node:path"
import type { ContentBlock } from "@/types/content"
import type { EngineHistory, EngineUsageSnapshot, Message } from "@/types/engine"
import { isJsonlLineWithinBound, readTextFileBounded } from "../file-bounds"
import { createAppendParseCache } from "../history-cache"
import { sameHistoryWorktree } from "../history-worktree"
import { vendorConfigHome } from "../vendor-home"
import { copilotUsageToSnapshot } from "./usage"

export interface CopilotHistoryDeps {
  copilotDir(): string
  readdir(p: string): Promise<string[]>
  readFile(p: string): Promise<string>
  stat(p: string): Promise<{ mtimeMs: number }>
  rm(p: string): Promise<void>
}

const defaultDeps: CopilotHistoryDeps = {
  copilotDir() {
    return vendorConfigHome("copilot")
  },
  async readdir(p) {
    try {
      return await readdir(p)
    } catch {
      return []
    }
  },
  async readFile(p) {
    // Size-bounded: an oversize/corrupt events.jsonl degrades to "" rather
    // than slurping a multi-GB file into memory.
    return await readTextFileBounded(p)
  },
  stat,
  async rm(p) {
    await rm(p, { recursive: true, force: true })
  },
}

export async function listSessionDirs(deps: CopilotHistoryDeps = defaultDeps): Promise<string[]> {
  const root = path.join(deps.copilotDir(), "session-state")
  const names = await deps.readdir(root)
  return names.map((name) => path.join(root, name))
}

/**
 * Session ids of Copilot conversations rooted at `worktree`, oldest-first
 * (by `updatedAt`, like the other vendors' readers). Each session is
 * `~/.copilot/session-state/<id>/` with a `workspace.yaml` recording `cwd`.
 */
export async function listSessionIdsForWorktree(
  worktree: string,
  deps: CopilotHistoryDeps = defaultDeps,
): Promise<string[]> {
  const matches: { id: string; updatedAt: string }[] = []
  for (const dir of await listSessionDirs(deps)) {
    const workspace = await readWorkspace(dir, deps)
    if (!sameHistoryWorktree(workspace.cwd, worktree)) continue
    matches.push({ id: workspace.id ?? path.basename(dir), updatedAt: workspace.updatedAt ?? "" })
  }
  return matches.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).map((m) => m.id)
}

/**
 * Newest `events.jsonl` mtime (epoch ms) across sessions rooted at
 * `worktree`, 0 when none — polled to detect new output without parsing the PTY.
 */
export async function latestTranscriptMtimeForWorktree(
  worktree: string,
  deps: CopilotHistoryDeps = defaultDeps,
): Promise<number> {
  if (!worktree) return 0
  let newest = 0
  for (const dir of await listSessionDirs(deps)) {
    const workspace = await readWorkspace(dir, deps)
    if (!sameHistoryWorktree(workspace.cwd, worktree)) continue
    try {
      const { mtimeMs } = await deps.stat(path.join(dir, "events.jsonl"))
      if (mtimeMs > newest) newest = mtimeMs
    } catch {
      // session dir without an events.jsonl yet — skip
    }
  }
  return newest
}

export async function readHistoryWithMetrics(
  sessionId: string,
  deps: CopilotHistoryDeps = defaultDeps,
): Promise<EngineHistory> {
  const dir = await findSessionDir(sessionId, deps)
  if (!dir) return { messages: [] }
  const file = path.join(dir, "events.jsonl")
  const raw = await deps.readFile(file).catch(() => "")
  const state = eventsCache(file, raw, sessionId)
  return { messages: state.messages, ...(state.usageMetrics ? { usageMetrics: state.usageMetrics } : {}) }
}

export async function readHistory(
  sessionId: string,
  deps: CopilotHistoryDeps = defaultDeps,
): Promise<readonly Message[]> {
  return (await readHistoryWithMetrics(sessionId, deps)).messages
}

export async function deleteHistory(sessionId: string, deps: CopilotHistoryDeps = defaultDeps): Promise<void> {
  const dir = await findSessionDir(sessionId, deps)
  if (!dir) return
  await deps.rm(dir)
}

export async function findSessionDir(
  sessionId: string,
  deps: CopilotHistoryDeps = defaultDeps,
): Promise<string | undefined> {
  for (const dir of await listSessionDirs(deps)) {
    if (path.basename(dir) === sessionId) return dir
    const workspace = await readWorkspace(dir, deps)
    if (workspace.id === sessionId || workspace.name?.toLowerCase() === sessionId.toLowerCase()) return dir
  }
  return undefined
}

export interface CopilotWorkspaceMeta {
  readonly id?: string
  readonly cwd?: string
  readonly name?: string
  readonly updatedAt?: string
  readonly createdAt?: string
}

export async function readWorkspace(
  dir: string,
  deps: CopilotHistoryDeps = defaultDeps,
): Promise<CopilotWorkspaceMeta> {
  const raw = await deps.readFile(path.join(dir, "workspace.yaml")).catch(() => "")
  return parseWorkspaceYaml(raw)
}

export function parseWorkspaceYaml(raw: string): CopilotWorkspaceMeta {
  const out: Record<string, string> = {}
  for (const rawLine of raw.split("\n")) {
    // Strip CR: Copilot writes CRLF on Windows, and the greedy `.*$` below
    // would keep `\r`, breaking the `cwd` match and the quote-strip.
    const line = rawLine.replace(/\r$/, "")
    const match = line.match(/^([A-Za-z_]+):\s*(.*)$/)
    if (!match) continue
    const key = match[1]
    let value = match[2] ?? ""
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1).replace(/\\"/g, '"')
    out[key] = value
  }
  return {
    id: out.id,
    cwd: out.cwd,
    name: out.name,
    updatedAt: out.updated_at,
    createdAt: out.created_at,
  }
}

export function parseEvents(
  raw: string,
  fallbackSessionId: string,
): { messages: readonly Message[]; usageMetrics?: EngineUsageSnapshot; firstUserMessage?: string | null } {
  const state = foldEvents(raw, initialParseState(fallbackSessionId))
  return { messages: state.messages, usageMetrics: state.usageMetrics, firstUserMessage: state.firstUserMessage }
}

/**
 * Fold state for `events.jsonl`. The stream is NOT line-local (`session.start`
 * sets the sessionId for what follows; firstUserMessage/usage are
 * first/last-wins), so the append-aware cache snapshots this whole state at
 * the prefix boundary and folding an appended slice reproduces a full parse.
 */
interface CopilotParseState {
  readonly messages: readonly Message[]
  readonly sessionId: string
  readonly usageMetrics: EngineUsageSnapshot | undefined
  readonly firstUserMessage: string | null
}

function initialParseState(fallbackSessionId: string): CopilotParseState {
  return {
    messages: [],
    sessionId: fallbackSessionId,
    usageMetrics: undefined,
    firstUserMessage: null,
  }
}

const eventsCache = createAppendParseCache<CopilotParseState, string>({
  initial: initialParseState,
  parseChunk: (chunk, prev) => foldEvents(chunk, prev),
})

/** Fold event lines onto `prev` without mutating it (cache contract). */
function foldEvents(raw: string, prev: CopilotParseState): CopilotParseState {
  let updatedMessages: Message[] | undefined
  const appendMessage = (message: Message) => {
    updatedMessages ??= [...prev.messages]
    updatedMessages.push(message)
  }
  let sessionId = prev.sessionId
  let usageMetrics = prev.usageMetrics
  let firstUserMessage = prev.firstUserMessage

  for (const line of raw.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (!isJsonlLineWithinBound(trimmed)) continue
    let record: unknown
    try {
      record = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (!isObject(record) || typeof record.type !== "string") continue
    const timestamp = typeof record.timestamp === "string" ? record.timestamp : new Date().toISOString()
    const data = isObject(record.data) ? record.data : {}

    if (record.type === "session.start") {
      const sid = typeof data.sessionId === "string" ? data.sessionId : undefined
      if (sid) sessionId = sid
      continue
    }

    if (record.type === "user.message") {
      const text = typeof data.content === "string" ? data.content : ""
      if (!text) continue
      // Force-copy: JSC `.slice` shares the parent's buffer, so the preview
      // would pin the full message text.
      if (!firstUserMessage) firstUserMessage = Buffer.from(text.slice(0, PREVIEW_CHAR_CAP), "utf8").toString("utf8")
      appendMessage({ role: "user", blocks: [{ type: "text", text }], timestamp, sessionId })
      continue
    }

    if (record.type === "assistant.message") {
      const blocks: ContentBlock[] = []
      const text = typeof data.content === "string" ? data.content : ""
      if (text) blocks.push({ type: "text", text })
      const toolRequests = Array.isArray(data.toolRequests) ? data.toolRequests : []
      for (const req of toolRequests) {
        if (!isObject(req)) continue
        const callId =
          typeof req.id === "string" ? req.id : typeof req.toolCallId === "string" ? req.toolCallId : "tool"
        const name = typeof req.name === "string" ? req.name : typeof req.toolName === "string" ? req.toolName : "tool"
        blocks.push({ type: "tool_call", callId, name, input: req.arguments ?? {} })
      }
      if (blocks.length > 0) appendMessage({ role: "assistant", blocks, timestamp, sessionId })
      continue
    }

    if (record.type === "tool.execution_complete") {
      const callId = typeof data.toolCallId === "string" ? data.toolCallId : undefined
      if (!callId) continue
      const output = data.result ?? (data.success === false ? { success: false } : undefined)
      appendMessage({
        role: "assistant",
        blocks: [{ type: "tool_result", callId, output, isError: data.success === false }],
        timestamp,
        sessionId,
      })
      continue
    }

    if (record.type === "session.shutdown") {
      usageMetrics = copilotUsageToSnapshot(data)
    }
  }

  return { messages: updatedMessages ?? prev.messages, sessionId, usageMetrics, firstUserMessage }
}

const PREVIEW_CHAR_CAP = 200

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}
