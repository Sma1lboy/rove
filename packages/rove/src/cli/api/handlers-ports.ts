/**
 * `ports` — the TCP ports a task's processes listen on, so an agent or script
 * finds the dev server a task started without scanning by hand. A listener
 * belongs to the task whose checkout holds its process's cwd.
 */

import { sep } from "node:path"
import type { SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import { F } from "./flags.ts"
import { daemonOf } from "./handler-helpers.ts"
import type { ListeningSocket } from "./listening-ports.ts"
import { ApiError, type VerbContext, type VerbSpec, helpStep } from "./types.ts"

export interface PortRow extends ListeningSocket {
  readonly url: string
  /** Owning task, on `--all` rows only; null when no task's checkout holds the cwd. */
  readonly taskId?: string | null
}

/** Every checkout a task's processes can run in: the primary and each materialised extra repo. */
function taskRoots(task: SerializedTask): string[] {
  const extras = (task.extraRepos ?? []).map((r) => r.worktreePath)
  return [task.worktreePath, ...extras].filter((p): p is string => typeof p === "string" && p.length > 0)
}

function under(cwd: string, root: string): boolean {
  const trimmed = root.endsWith(sep) ? root.slice(0, -1) : root
  return cwd === trimmed || cwd.startsWith(trimmed + sep)
}

/** A wildcard or loopback bind is reached as localhost. */
function urlOf(host: string, port: number): string {
  const local = ["*", "0.0.0.0", "::", "127.0.0.1", "::1", "localhost"].includes(host)
  if (local) return `http://localhost:${port}`
  return host.includes(":") ? `http://[${host}]:${port}` : `http://${host}:${port}`
}

/**
 * The task whose checkout holds `cwd`; the deepest root wins, so a worktree
 * nested inside a project's own checkout claims its own processes.
 */
export function owningTaskId(tasks: readonly SerializedTask[], cwd: string | null): string | null {
  if (!cwd) return null
  let best: { id: string; depth: number } | null = null
  for (const task of tasks) {
    for (const root of taskRoots(task)) {
      if (under(cwd, root) && (!best || root.length > best.depth)) best = { id: task.id, depth: root.length }
    }
  }
  return best?.id ?? null
}

async function handlePorts(ctx: VerbContext): Promise<unknown> {
  const daemon = daemonOf(ctx)
  const all = ctx.args.bool("all")
  const taskId = ctx.args.str("task-id")
  if (all && taskId !== undefined) {
    throw new ApiError("pass --task-id or --all, not both", "BAD_FLAG", helpStep("ports"))
  }
  if (!all && taskId === undefined) throw new ApiError("--task-id is required (or pass --all)", "MISSING_FLAG")
  const tasks = all
    ? ((await daemon.request<{ tasks?: SerializedTask[] }>("task.list")).tasks ?? [])
    : [(await daemon.request<{ task: SerializedTask }>("task.get", { taskId })).task]
  const sockets = await ctx.runtime.listeningPorts()
  // Null = the scan itself failed: "couldn't look", never "nothing listening".
  if (!sockets) return all ? { ports: null } : { taskId, ports: null }
  const rows: PortRow[] = []
  for (const s of sockets) {
    const owner = owningTaskId(tasks, s.cwd)
    if (all) rows.push({ ...s, url: urlOf(s.host, s.port), taskId: owner })
    else if (owner === taskId) rows.push({ ...s, url: urlOf(s.host, s.port) })
  }
  return all ? { ports: rows } : { taskId, ports: rows }
}

export const PORTS_VERB: VerbSpec = {
  name: "ports",
  group: "read",
  summary:
    "List the TCP ports a task's processes listen on (a dev server, a preview, a debugger), on this machine. A listener belongs to the task whose checkout holds its process's cwd. Returns { taskId, ports: [{ port, host, url, pid, command, cwd }] }; --all lists every listener with its owning `taskId` (null = no task). `ports: null` = the scan could not run, which says nothing about what is listening.",
  flags: [
    F.taskId(false),
    { name: "all", type: "bool", description: "Every listener on this machine, each tagged with its owning task." },
  ],
  handler: handlePorts,
}
