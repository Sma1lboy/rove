/**
 * Call back into Rove through `$ROVE_BIN_PATH` (with `$KOBE_BIN_PATH` as a
 * compatibility fallback). `rove()` is the raw runner; named helpers wrap
 * Rove API verbs (full list: `rove api help` / `rove api schema`).
 */

import { execFile } from "node:child_process"

export interface RoveRunOptions {
  /** Defaults to `process.env.ROVE_BIN_PATH`, then `KOBE_BIN_PATH`. */
  readonly binPath?: string
  readonly cwd?: string
  /** Extra env merged over the inherited environment. */
  readonly env?: Record<string, string>
  /** Millis before the child is killed. Default 30_000. */
  readonly timeoutMs?: number
}

/** @deprecated Use RoveRunOptions. */
export type KobeRunOptions = RoveRunOptions

export interface RoveRunResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

/** @deprecated Use RoveRunResult. */
export type KobeRunResult = RoveRunResult

/** Run the Rove CLI with `<args…>`; resolves with the exit code (never rejects on non-zero). */
export function rove(args: readonly string[], opts: RoveRunOptions = {}): Promise<RoveRunResult> {
  const bin = opts.binPath ?? process.env.ROVE_BIN_PATH ?? process.env.KOBE_BIN_PATH
  if (!bin) return Promise.reject(new Error("ROVE_BIN_PATH is not set and no binPath was given"))
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args as string[],
      {
        cwd: opts.cwd,
        env: opts.env ? { ...process.env, ...opts.env } : process.env,
        timeout: opts.timeoutMs ?? 30_000,
        maxBuffer: 8 * 1024 * 1024,
      },
      (err, stdout, stderr) => {
        // Missing binary is a caller bug → reject; non-zero exit is a result → resolve.
        if (err && (err as NodeJS.ErrnoException).code === "ENOENT") return reject(err)
        const rawCode = err ? (err as { code?: unknown }).code : 0
        const code = typeof rawCode === "number" ? rawCode : err ? 1 : 0
        resolve({ code, stdout: String(stdout), stderr: String(stderr) })
      },
    )
  })
}

/** Compatibility alias for plugins written against the Kobe-named SDK. */
export const kobe = rove

/** Run and parse stdout as JSON; throws on non-zero exit or bad JSON. */
export async function roveJson<T = unknown>(args: readonly string[], opts: RoveRunOptions = {}): Promise<T> {
  const res = await rove(args, opts)
  if (res.code !== 0) throw new Error(`Rove command ${args.join(" ")} exited ${res.code}: ${res.stderr.trim()}`)
  return JSON.parse(res.stdout) as T
}

/** Compatibility alias for plugins written against the Kobe-named SDK. */
export const kobeJson = roveJson

/** Toast a notification in every attached Rove UI. */
export function notify(title: string, body?: string, opts?: RoveRunOptions): Promise<RoveRunResult> {
  return rove(["api", "notify", "--title", title, ...(body ? ["--body", body] : [])], opts)
}

/** Send prompt text into a live engine session. */
export function dispatch(taskId: string, prompt: string, opts?: RoveRunOptions): Promise<RoveRunResult> {
  return rove(["api", "dispatch", "--task-id", taskId, "--prompt", prompt], opts)
}

/** All tasks, as the daemon serializes them. */
export function listTasks<T = unknown>(opts?: RoveRunOptions): Promise<T> {
  return roveJson<T>(["api", "list"], opts)
}

/**
 * Open one of this plugin's own `[[panes]]` (qualified id: `you.plugin.pane`).
 * Without `taskId` the host uses the active task and fails when there is none.
 * Check `clients`, not the exit code: 0 means no attached UI did the split.
 */
export async function openPane(
  qualifiedPaneId: string,
  opts: RoveRunOptions & { taskId?: string } = {},
): Promise<RoveRunResult & { clients?: number }> {
  const { taskId, ...run } = opts
  const args = ["plugin", "pane", "open", qualifiedPaneId, ...(taskId ? ["--task", taskId] : [])]
  const res = await rove(args, run)
  try {
    const parsed = JSON.parse(res.stdout) as { clients?: number }
    return { ...res, ...(typeof parsed.clients === "number" ? { clients: parsed.clients } : {}) }
  } catch {
    return res // older host: the verb printed prose, so `clients` is unknowable
  }
}

/**
 * Ask the human for a line of text (`rove api prompt`). Null when cancelled,
 * timed out, or no TUI is attached. Blocks up to `timeoutMs` (host default 120s).
 */
export async function promptUser(
  title: string,
  opts: RoveRunOptions & { placeholder?: string; initial?: string; timeoutMs?: number } = {},
): Promise<string | null> {
  const { placeholder, initial, timeoutMs, ...run } = opts
  const args = [
    "api",
    "prompt",
    "--title",
    title,
    ...(placeholder ? ["--placeholder", placeholder] : []),
    ...(initial ? ["--initial", initial] : []),
    ...(timeoutMs ? ["--timeout", String(timeoutMs)] : []),
  ]
  try {
    const result = await roveJson<{ value?: string; cancelled?: boolean }>(args, {
      ...run,
      timeoutMs: (timeoutMs ?? 120_000) + 10_000,
    })
    return typeof result.value === "string" ? result.value : null
  } catch {
    return null
  }
}

/** Semantic role for a row token — the active theme picks the colour. */
export type RowTokenTone = "info" | "success" | "warning" | "error" | "muted"

export interface RowTokenOptions extends RoveRunOptions {
  /** Which of your two slots on this row; rewriting a key refreshes its TTL. Default `"default"`. */
  readonly key?: string
  /** Seconds the label survives without a refresh (1…3600). Default 60. */
  readonly ttlSeconds?: number
  readonly tone?: RowTokenTone
}

/**
 * Put one short label on a task's sidebar/board row (`rove api row-token`).
 * **Every token expires** unless refreshed, so a dead plugin leaves no stale
 * state. Everything else on the row is host-owned. Resolves `false` (never
 * throws) on an older host without row tokens — no version gate needed.
 */
export async function setRowToken(taskId: string, text: string, opts: RowTokenOptions = {}): Promise<boolean> {
  const { key, ttlSeconds, tone, ...run } = opts
  const args = [
    "api",
    "row-token",
    "--task-id",
    taskId,
    "--text",
    text,
    ...(key ? ["--key", key] : []),
    ...(ttlSeconds !== undefined ? ["--ttl", String(ttlSeconds)] : []),
    ...(tone ? ["--tone", tone] : []),
  ]
  try {
    const result = await roveJson<{ ok?: boolean }>(args, run)
    return result.ok === true
  } catch {
    return false
  }
}

/** Remove a row token now; `key` omitted clears every token you own on that row. */
export async function clearRowToken(taskId: string, key?: string, opts: RoveRunOptions = {}): Promise<boolean> {
  const args = ["api", "row-token", "--task-id", taskId, "--clear", ...(key ? ["--key", key] : [])]
  try {
    const result = await roveJson<{ ok?: boolean }>(args, opts)
    return result.ok === true
  } catch {
    return false
  }
}
