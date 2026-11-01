/**
 * `search` — find text across every task's engine conversations, through each engine's own
 * history reader (`EngineHistoryReader`). Reading every transcript per query takes seconds at real
 * scale (68 tasks, 441 sessions: ~11 s), so the transcript FILES are prefiltered for the query
 * first (`rg -l`, or an in-process scan without it) and only sessions that contain it are parsed,
 * newest first, until `--limit` hits are found. Only user and assistant prose is searched: tool
 * calls and their output would match nearly everything.
 */

import { readFile, stat } from "node:fs/promises"
import type { SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import { protocolEntry, sessionProtocol } from "../../engine/engine-presets.ts"
import { type EngineHistoryReader, supportsStructuredHistory } from "../../engine/registry.ts"
import type { Message } from "../../types/engine.ts"
import type { VendorId } from "../../types/vendor.ts"
import { daemonOf, repoFilter } from "./handler-helpers.ts"
import { readTabsSnapshot } from "./tab-snapshot.ts"
import { ApiError, type VerbContext, type VerbSpec } from "./types.ts"

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100
/** One chatty session must not fill the page. */
const PER_SESSION = 3
const SNIPPET_RADIUS = 60
/** Sessions parsed at once. */
const READ_BATCH = 8
/** Past this, stop reading sessions and say the page is partial. */
const READ_BUDGET_MS = 1500

export interface SearchMatch {
  readonly taskId: string
  readonly title: string
  readonly tabId?: string
  readonly role: "user" | "assistant"
  readonly at: string
  readonly snippet: string
}

export type SkipReason = "other-machine" | "engine-unsupported"

export interface SearchResult {
  readonly query: string
  readonly matches: readonly SearchMatch[]
  readonly skipped: readonly { readonly taskId: string; readonly reason: SkipReason }[]
  /** True when `limit` stopped the scan before every candidate session was read. */
  readonly truncated: boolean
}

interface Candidate {
  readonly task: SerializedTask
  readonly reader: EngineHistoryReader
  readonly sessionId: string
  readonly tabId?: string
  readonly path: string | null
  mtimeMs: number
}

/** `text` around the first case-insensitive hit of `needle`, whitespace folded; null when absent. */
export function snippetOf(text: string, needle: string): string | null {
  const flat = text.replace(/\s+/g, " ")
  const at = flat.toLowerCase().indexOf(needle.toLowerCase())
  if (at < 0) return null
  const start = Math.max(0, at - SNIPPET_RADIUS)
  const end = Math.min(flat.length, at + needle.length + SNIPPET_RADIUS)
  return `${start > 0 ? "…" : ""}${flat.slice(start, end).trim()}${end < flat.length ? "…" : ""}`
}

/** User and assistant prose that contains `needle`, at most `max`, in conversation order. */
export function matchMessages(
  messages: readonly Message[],
  needle: string,
  max: number,
): { readonly role: "user" | "assistant"; readonly at: string; readonly snippet: string }[] {
  const out: { role: "user" | "assistant"; at: string; snippet: string }[] = []
  for (const m of messages) {
    if (m.role !== "user" && m.role !== "assistant") continue
    for (const b of m.blocks) {
      if (b.type !== "text") continue
      const snippet = snippetOf(b.text, needle)
      if (snippet === null) continue
      out.push({ role: m.role, at: m.timestamp, snippet })
      break
    }
    if (out.length >= max) break
  }
  return out
}

/**
 * The longest word of `query` a JSONL transcript stores verbatim: quotes and backslashes are
 * escaped on disk and newlines become `\n`, so a prefilter on the whole query could miss a hit.
 */
export function prefilterToken(query: string): string {
  return query.split(/["\\\s]+/).reduce((a, b) => (b.length > a.length ? b : a), "")
}

/** Each task's sessions; a session two tasks could claim belongs to the one whose tab pinned it. */
async function candidatesOf(
  tasks: readonly SerializedTask[],
  skipped: { taskId: string; reason: SkipReason }[],
): Promise<Candidate[]> {
  const claimed = new Set<string>()
  const pinned: Candidate[] = []
  const unpinned: { task: SerializedTask; reader: EngineHistoryReader; worktree: string }[] = []
  const sharedDirs = new Map<string, number>()
  for (const t of tasks) if (t.worktreePath) sharedDirs.set(t.worktreePath, (sharedDirs.get(t.worktreePath) ?? 0) + 1)

  for (const task of tasks) {
    if (task.origin) {
      skipped.push({ taskId: task.id, reason: "other-machine" })
      continue
    }
    const vendor = task.vendor as VendorId | undefined
    const tabs = (readTabsSnapshot(task.id)?.tabs ?? []).filter((t) => t.kind === "engine")
    let any = false
    for (const tab of tabs) {
      const tabVendor = (tab.vendor as VendorId | undefined) ?? vendor
      if (!tabVendor || !supportsStructuredHistory(sessionProtocol(tabVendor)) || !tab.sessionId) continue
      if (claimed.has(tab.sessionId)) continue
      claimed.add(tab.sessionId)
      const reader = protocolEntry(tabVendor).history
      pinned.push({ task, reader, sessionId: tab.sessionId, tabId: tab.id, path: null, mtimeMs: 0 })
      any = true
    }
    if (any) continue
    if (!vendor || !supportsStructuredHistory(sessionProtocol(vendor))) {
      skipped.push({ taskId: task.id, reason: "engine-unsupported" })
      continue
    }
    // No pinned session (an engine that takes no caller-set id): the directory's sessions, unless
    // another task works in the same directory and they cannot be told apart.
    const worktree = task.worktreePath
    if (worktree && (sharedDirs.get(worktree) ?? 0) === 1) {
      unpinned.push({ task, reader: protocolEntry(vendor).history, worktree })
    }
  }
  const listed = await Promise.all(
    unpinned.map(async ({ task, reader, worktree }) =>
      (await reader.listSessionIdsForWorktree(worktree))
        .filter((id) => !claimed.has(id))
        .map((sessionId): Candidate => ({ task, reader, sessionId, path: null, mtimeMs: 0 })),
    ),
  )
  const all = [...pinned, ...listed.flat()]
  return Promise.all(
    all.map(async (c) => {
      const worktree = c.task.worktreePath || c.task.repo
      const path = await c.reader.transcriptPath(c.sessionId, worktree).catch(() => null)
      const mtimeMs = path
        ? await stat(path).then(
            (s) => s.mtimeMs,
            () => 0,
          )
        : 0
      return { ...c, path, mtimeMs }
    }),
  )
}

/** Transcript files that contain `token`, case-insensitively. */
async function filesContaining(paths: readonly string[], token: string): Promise<Set<string>> {
  if (paths.length === 0 || token === "") return new Set(paths)
  const rg = Bun.which("rg")
  if (rg) {
    const proc = Bun.spawn([rg, "-l", "-i", "-F", "--no-messages", "--", token, ...paths], {
      stdout: "pipe",
      stderr: "ignore",
    })
    const out = await new Response(proc.stdout).text()
    await proc.exited
    return new Set(out.split("\n").filter(Boolean))
  }
  const needle = token.toLowerCase()
  const hits = new Set<string>()
  for (const p of paths) {
    const text = await readFile(p, "utf8").catch(() => "")
    if (text.toLowerCase().includes(needle)) hits.add(p)
  }
  return hits
}

export async function searchTasks(
  tasks: readonly SerializedTask[],
  query: string,
  limit: number,
  budgetMs = READ_BUDGET_MS,
): Promise<SearchResult> {
  const started = Date.now()
  const skipped: { taskId: string; reason: SkipReason }[] = []
  const candidates = await candidatesOf(tasks, skipped)
  const withPath = candidates.filter((c) => c.path !== null).map((c) => c.path as string)
  const hits = await filesContaining(withPath, prefilterToken(query))
  // A reader with no file to scan (one database for every session) is read in full.
  const toRead = candidates.filter((c) => c.path === null || hits.has(c.path)).sort((a, b) => b.mtimeMs - a.mtimeMs)
  const matches: SearchMatch[] = []
  let next = 0
  // A word common in tool output passes the file prefilter in many sessions whose prose lacks it.
  while (next < toRead.length && matches.length < limit && Date.now() - started < budgetMs) {
    const batch = toRead.slice(next, next + READ_BATCH)
    next += batch.length
    const read = await Promise.all(batch.map((c) => c.reader.readHistory(c.sessionId).catch(() => [])))
    for (const [i, messages] of read.entries()) {
      const c = batch[i] as Candidate
      for (const m of matchMessages(messages, query, Math.min(PER_SESSION, limit - matches.length))) {
        matches.push({ taskId: c.task.id, title: c.task.title, ...(c.tabId ? { tabId: c.tabId } : {}), ...m })
      }
      if (matches.length >= limit) break
    }
  }
  return { query, matches, skipped, truncated: next < toRead.length }
}

async function search(ctx: VerbContext): Promise<SearchResult> {
  const query = (ctx.args.str("query") ?? "").trim()
  if (!query) throw new ApiError("search needs a non-empty --query", "MISSING_FLAG")
  const limit = Math.min(MAX_LIMIT, Math.max(1, ctx.args.int("limit") ?? DEFAULT_LIMIT))
  const daemon = daemonOf(ctx)
  const { tasks: all } = await daemon.request<{ tasks: SerializedTask[] }>("task.list")
  const repoFlag = ctx.args.str("repo")
  let tasks = all
  if (repoFlag) {
    const filter = await repoFilter(
      ctx.runtime,
      ctx.args.requireRepo("repo"),
      all.map((t) => t.repo),
    )
    tasks = all.filter((t) => filter.matches(t.repo))
  }
  return searchTasks(tasks, query, limit)
}

export const SEARCH_VERB: VerbSpec = {
  name: "search",
  group: "read",
  summary:
    "Search every task's engine conversations (user and assistant prose, not tool output), newest session first. Returns {query, matches:[{taskId, title, tabId?, role, at, snippet}], skipped:[{taskId, reason}], truncated}; reason is other-machine or engine-unsupported (an engine with no history reader).",
  flags: [
    {
      name: "query",
      type: "string",
      required: true,
      placeholder: "TEXT",
      description: "Text to find, case-insensitive.",
    },
    {
      name: "repo",
      type: "string",
      required: false,
      placeholder: "PATH",
      description: "Only this repo's tasks. Relative paths resolve against $PWD.",
    },
    {
      name: "limit",
      type: "int",
      default: String(DEFAULT_LIMIT),
      placeholder: "N",
      description: `Stop after N matches (max ${MAX_LIMIT}); at most ${PER_SESSION} per session.`,
    },
  ],
  handler: search,
}
