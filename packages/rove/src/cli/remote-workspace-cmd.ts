/**
 * `rove remote-workspace <bash-hook|file-hook|mcp> --dir <link>`: INTERNAL, run by an engine whose workspace is on
 * another machine (`machines/remote-workspace.ts`).
 *
 * - `bash-hook` answers an engine's pre-tool hook: the shell command is rewritten to run there through `rx`.
 * - `file-hook` answers the same hook for the engine's own file tools: they stay on for this machine's
 *   files, and a call aimed at the project is turned back with where to send it.
 * - `mcp` is a stdio MCP server whose read / write / edit tools work on that machine's files.
 */

import { spawnSync } from "node:child_process"
import { realpathSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { createInterface } from "node:readline"
import { quoteShellArg } from "../lib/shell-command.ts"
import { isRemoteWorkspace, readRemoteWorkspace, rxPath } from "../machines/remote-workspace.ts"
import { CURRENT_VERSION } from "../version.ts"
import { flagValue } from "./argv.ts"

export async function runRemoteWorkspaceSubcommand(args: readonly string[]): Promise<void> {
  const dir = flagValue(args, "--dir") ?? process.cwd()
  if (!isRemoteWorkspace(dir)) return
  if (args[0] === "bash-hook") process.stdout.write(bashHookReply(await readAll(process.stdin), rxPath(dir)))
  else if (args[0] === "file-hook") process.stdout.write(fileHookReply(await readAll(process.stdin), dir))
  else if (args[0] === "mcp") await serveMcp(rxPath(dir))
}

async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  let text = ""
  for await (const chunk of stream) text += chunk
  return text
}

/**
 * The reply to a PreToolUse hook on the shell tool: the same call with its command sent through `rx`.
 * No permission decision rides along, so the engine's own rules and prompts still judge the call.
 * "" (run as asked) for a payload with no command, or one that already goes through `rx`.
 */
export function bashHookReply(payload: string, rx: string): string {
  let input: Record<string, unknown>
  try {
    input = (JSON.parse(payload) as { tool_input?: Record<string, unknown> }).tool_input ?? {}
  } catch {
    return ""
  }
  const command = input.command
  if (typeof command !== "string" || /^\s*(\S*\/)?rx\s/.test(command)) return ""
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      updatedInput: { ...input, command: `${quoteShellArg(rx)} ${quoteShellArg(command)}` },
    },
  })
}

/**
 * The reply to a PreToolUse hook on a local file tool. "" (run as asked) for a path on this machine;
 * a path in the link directory or under the project's path on that machine is denied, since the tool
 * would read an empty directory or write a file the project never sees.
 */
export function fileHookReply(payload: string, dir: string): string {
  let call: { tool_input?: Record<string, unknown>; cwd?: string }
  try {
    call = JSON.parse(payload) as typeof call
  } catch {
    return ""
  }
  const input = call.tool_input ?? {}
  const named = [input.file_path, input.notebook_path, input.path].find((p) => typeof p === "string" && p)
  // A search with no path runs in the working directory, which is the link.
  const target = resolve(call.cwd ?? dir, typeof named === "string" ? named : ".")
  const ws = readRemoteWorkspace(dir)
  const roots = [dir, realPath(dir), ...(ws ? [ws.path] : [])]
  if (!roots.some((root) => target === root || target.startsWith(`${root}/`))) return ""
  const where = ws ? `the machine "${ws.machine}", at ${ws.path}` : "another machine"
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: `${target} is in the project, which is on ${where}. This tool only sees this machine. Use the workspace read / write / edit tools for the project's files (paths relative to its root), and the shell to search it (rg, find, ls): shell commands run there.`,
    },
  })
}

function realPath(dir: string): string {
  try {
    return realpathSync(dir)
  } catch {
    return dir
  }
}

type Run = (command: string, stdin?: string) => { readonly ok: boolean; readonly out: string }

const runThrough =
  (rx: string): Run =>
  (command, stdin) => {
    const res = spawnSync(rx, [command], { input: stdin, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    return { ok: res.status === 0, out: res.status === 0 ? res.stdout : (res.stderr || res.stdout || "failed").trim() }
  }

/** A read with no range returns at most this many lines, and says when it cut. */
const READ_LINES = 2000

const TOOLS = [
  {
    name: "read",
    description: `Read a file of the project. Returns its text; at most ${READ_LINES} lines unless offset/limit ask for a range.`,
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path, relative to the project root or absolute on that machine." },
        offset: { type: "number", description: "First line to return (1-based)." },
        limit: { type: "number", description: "How many lines to return." },
      },
      required: ["path"],
    },
  },
  {
    name: "write",
    description: "Create a file of the project or replace its whole content. Parent directories are created.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
    },
  },
  {
    name: "edit",
    description:
      "Replace old_string with new_string in a file of the project. old_string must match exactly and occur once, unless replace_all is true.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        old_string: { type: "string" },
        new_string: { type: "string" },
        replace_all: { type: "boolean" },
      },
      required: ["path", "old_string", "new_string"],
    },
  },
]

/** One tool call against the workspace. Throws with what the model should read. */
export function callWorkspaceTool(run: Run, name: string, a: Record<string, unknown>): string {
  const path = typeof a.path === "string" ? a.path : ""
  if (!path) throw new Error("path is required")
  const file = quoteShellArg(path)
  const must = (res: { ok: boolean; out: string }): string => {
    if (!res.ok) throw new Error(res.out)
    return res.out
  }
  const write = (content: string) => must(run(`mkdir -p -- ${quoteShellArg(dirname(path))} && cat > ${file}`, content))
  if (name === "read") {
    const from = Math.max(1, Math.trunc(Number(a.offset) || 1))
    const count = Math.max(1, Math.trunc(Number(a.limit) || READ_LINES))
    const text = must(run(`sed -n '${from},${from + count}p' -- ${file}`))
    const lines = text.split("\n")
    // One line past the range was asked for, to tell a cut from the end of the file.
    if (lines.length <= count + 1) return text
    return `${lines.slice(0, count).join("\n")}\n[cut at line ${from + count - 1}; pass offset to read on]`
  }
  if (name === "write") {
    if (typeof a.content !== "string") throw new Error("content is required")
    write(a.content)
    return `wrote ${path}`
  }
  if (name === "edit") {
    const { old_string: from, new_string: to } = a
    if (typeof from !== "string" || typeof to !== "string" || !from)
      throw new Error("old_string and new_string are required")
    const text = must(run(`cat -- ${file}`))
    const hits = text.split(from).length - 1
    if (hits === 0) throw new Error(`old_string not found in ${path}`)
    if (hits > 1 && a.replace_all !== true)
      throw new Error(`old_string occurs ${hits} times in ${path}; add context to make it unique, or pass replace_all`)
    write(text.split(from).join(to))
    return `edited ${path} (${hits} replacement${hits === 1 ? "" : "s"})`
  }
  throw new Error(`unknown tool: ${name}`)
}

interface RpcMessage {
  readonly id?: number | string
  readonly method?: string
  readonly params?: Record<string, unknown>
}

/** The answer to one JSON-RPC message of the MCP stdio transport; null for a notification. */
export function mcpReply(run: Run, msg: RpcMessage): Record<string, unknown> | null {
  if (msg.id === undefined || !msg.method) return null
  const result = (value: unknown) => ({ jsonrpc: "2.0", id: msg.id, result: value })
  if (msg.method === "initialize") {
    return result({
      protocolVersion: typeof msg.params?.protocolVersion === "string" ? msg.params.protocolVersion : "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "rove-workspace", version: CURRENT_VERSION },
    })
  }
  if (msg.method === "ping") return result({})
  if (msg.method === "tools/list") return result({ tools: TOOLS })
  if (msg.method === "tools/call") {
    const args = (msg.params?.arguments ?? {}) as Record<string, unknown>
    try {
      const text = callWorkspaceTool(run, String(msg.params?.name ?? ""), args)
      return result({ content: [{ type: "text", text }] })
    } catch (err) {
      return result({
        content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
        isError: true,
      })
    }
  }
  return { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `method not found: ${msg.method}` } }
}

async function serveMcp(rx: string): Promise<void> {
  const run = runThrough(rx)
  for await (const line of createInterface({ input: process.stdin })) {
    if (!line.trim()) continue
    let msg: RpcMessage
    try {
      msg = JSON.parse(line) as RpcMessage
    } catch {
      continue
    }
    const reply = mcpReply(run, msg)
    if (reply) process.stdout.write(`${JSON.stringify(reply)}\n`)
  }
}
