/**
 * Claude's own breakdown of what fills a session's context window: the
 * `get_context_usage` control request that `/context` draws from, asked of a
 * throwaway `claude -p` resuming a FORK of the session that is never persisted.
 *
 * Each probe starts a process and the user's MCP servers, so it runs on
 * demand (someone opened the Context view), never from a poller. Hooks are
 * off for it: `SessionStart` would otherwise report the fork as the tab's
 * new session.
 */

import { spawn } from "node:child_process"
import { homedir } from "node:os"
import type { ContextPart } from "@/types/engine"
import { isObject } from "../../lib/is-object.ts"
import { findClaudeBinary } from "./binary.ts"

export interface ProbedContext {
  /** Everything in the window except the conversation, which the transcript tracks per turn. */
  readonly parts: readonly ContextPart[]
  /** Absent when the probe ran on another model than the session's. */
  readonly windowTokens?: number
  readonly at: number
}

const PROBE_TIMEOUT_MS = 30_000
/** The fixed parts move only when memory files, skills or MCP servers change. */
const FRESH_MS = 5 * 60_000
/** A probe that came back empty is not asked again sooner than this: callers poll. */
const RETRY_MS = 60_000
const MAX_ITEMS = 12
const REQUEST = `${JSON.stringify({
  type: "control_request",
  request_id: "rove-context",
  request: { subtype: "get_context_usage" },
})}\n`

const probed = new Map<string, ProbedContext>()
const inFlight = new Map<string, Promise<void>>()
const triedAt = new Map<string, number>()

export function probedContext(sessionId: string): ProbedContext | undefined {
  return probed.get(sessionId)
}

type Item = { readonly name: string; readonly tokens: number }

type Items = { readonly items?: readonly Item[]; readonly itemCount?: number }

function items(list: unknown, name: (row: Record<string, unknown>) => unknown): Items {
  if (!Array.isArray(list)) return {}
  const home = homedir()
  const out: Item[] = []
  for (const row of list) {
    if (!isObject(row) || typeof row.tokens !== "number" || row.tokens <= 0) continue
    const text = name(row)
    if (typeof text !== "string" || !text) continue
    out.push({ name: text.startsWith(`${home}/`) ? `~${text.slice(home.length)}` : text, tokens: row.tokens })
  }
  if (out.length === 0) return {}
  out.sort((a, b) => b.tokens - a.tokens)
  return { items: out.slice(0, MAX_ITEMS), ...(out.length > MAX_ITEMS ? { itemCount: out.length } : {}) }
}

/** What each category is made of, where the reply lists it. */
function itemsFor(id: string, reply: Record<string, unknown>): Items {
  if (id === "memory_files") return items(reply.memoryFiles, (row) => row.path)
  if (id === "mcp_tools") return items(reply.mcpTools, (row) => (row.isLoaded === false ? undefined : row.name))
  if (id === "custom_agents") return items(reply.agents, (row) => row.agentType)
  if (id === "skills") return items(isObject(reply.skills) ? reply.skills.skillFrontmatter : undefined, (row) => row.name)
  return {}
}

/**
 * The probe's stream-json output → the fixed parts and the window. `sessionModel`
 * is the model the transcript last ran on; a probe that came up on another one
 * reports that model's window, so it is dropped.
 */
export function parseContextProbe(stdout: string, sessionModel: string | undefined, at: number): ProbedContext | null {
  for (const line of stdout.split("\n")) {
    if (!line.includes('"control_response"')) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    const reply = isObject(parsed) && isObject(parsed.response) ? parsed.response.response : undefined
    if (!isObject(reply) || !Array.isArray(reply.categories)) continue
    const parts: ContextPart[] = []
    for (const category of reply.categories) {
      if (!isObject(category) || category.kind !== "used" || category.id === "messages") continue
      if (typeof category.id !== "string" || typeof category.tokens !== "number" || category.tokens <= 0) continue
      parts.push({
        key: category.id,
        tokens: category.tokens,
        ...(typeof category.name === "string" ? { label: category.name } : {}),
        ...itemsFor(category.id, reply),
      })
    }
    if (parts.length === 0) return null
    const window = reply.rawMaxTokens
    const sameModel = typeof reply.model === "string" && bareModel(reply.model) === bareModel(sessionModel ?? "")
    return { parts, ...(sameModel && typeof window === "number" && window > 0 ? { windowTokens: window } : {}), at }
  }
  return null
}

const bareModel = (model: string): string => model.replace(/\[.*\]$/, "")

/** Where the session runs and the model it last answered with, from its newest records. */
export function sessionCwdAndModel(raw: string): { cwd?: string; model?: string } {
  let cwd: string | undefined
  let model: string | undefined
  const lines = raw.split("\n")
  for (let i = lines.length - 1; i >= 0 && !(cwd && model); i--) {
    const line = lines[i]
    if (!line || !(line.includes('"cwd"') || line.includes('"model"'))) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    if (!isObject(parsed)) continue
    if (!cwd && typeof parsed.cwd === "string" && parsed.cwd) cwd = parsed.cwd
    const name = isObject(parsed.message) ? parsed.message.model : undefined
    if (!model && typeof name === "string" && name && !name.startsWith("<")) model = name
  }
  return { cwd, model }
}

async function runClaude(sessionId: string, cwd: string, model?: string): Promise<string> {
  const binary = await findClaudeBinary()
  return new Promise((resolve, reject) => {
    const child = spawn(
      binary,
      [
        "-p",
        "--resume",
        sessionId,
        "--fork-session",
        "--no-session-persistence",
        "--settings",
        JSON.stringify({ disableAllHooks: true }),
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        // A bare `-p` comes up on the user's default model, whose window may not be this session's.
        ...(model ? ["--model", model] : []),
      ],
      { cwd, stdio: ["pipe", "pipe", "ignore"], timeout: PROBE_TIMEOUT_MS, killSignal: "SIGKILL" },
    )
    const chunks: Buffer[] = []
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk))
    child.on("error", reject)
    child.on("close", () => resolve(Buffer.concat(chunks).toString("utf8")))
    child.stdin.on("error", () => {})
    child.stdin.end(REQUEST)
  })
}

/**
 * Probe `sessionId` unless a reading younger than {@link FRESH_MS} is held or
 * one was tried within {@link RETRY_MS}, so a caller may ask on every poll;
 * concurrent callers share one process. Never throws: no reading is the failure.
 */
export function probeContext(
  sessionId: string,
  readRaw: () => Promise<string | undefined>,
  run: (sessionId: string, cwd: string, model?: string) => Promise<string> = runClaude,
): Promise<void> {
  const held = probed.get(sessionId)
  if (held && Date.now() - held.at < FRESH_MS) return Promise.resolve()
  let pending = inFlight.get(sessionId)
  if (!pending) {
    if (Date.now() - (triedAt.get(sessionId) ?? 0) < RETRY_MS) return Promise.resolve()
    triedAt.set(sessionId, Date.now())
    pending = (async () => {
      const raw = await readRaw()
      const { cwd, model } = sessionCwdAndModel(raw ?? "")
      if (!cwd) return
      // ponytail: asked the moment the process is up, so MCP servers still connecting are missing from the reading.
      const reading = parseContextProbe(await run(sessionId, cwd, model), model, Date.now())
      if (reading) probed.set(sessionId, reading)
    })()
      .catch(() => {})
      .finally(() => inFlight.delete(sessionId))
    inFlight.set(sessionId, pending)
  }
  return pending
}
