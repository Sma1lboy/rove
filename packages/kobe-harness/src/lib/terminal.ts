/**
 * Terminal client. Each PTY-backed workspace tab is owned by the node
 * pty-server; the xterm attaches by the tab's client-generated id. Vendor
 * tabs spawn the configured engine in the task's worktree. Terminal tabs
 * spawn the user's shell in the same worktree.
 */

import { withWebTokenQuery } from "./web-token.ts"

export type PtyMode = "engine" | "shell"

/** PTY sidecar websocket origin (port + 2). */
function ptyWsBase(): string {
  const proto = location.protocol === "https:" ? "wss" : "ws"
  const host = location.hostname || "localhost"
  const currentPort = Number.parseInt(location.port || "5173", 10)
  const ptyPort = Number.isFinite(currentPort) ? currentPort + 2 : 5175
  return `${proto}://${host}:${ptyPort}`
}

export function ptyUrl(
  tabId: string,
  taskId: string,
  mode: PtyMode,
  cols: number,
  rows: number,
): string {
  const q = new URLSearchParams({
    tab: tabId,
    taskId,
    mode,
    cols: String(cols),
    rows: String(rows),
  })
  // A WebSocket cannot set a request header, so the token rides the query the
  // same way the SSE stream's does. Without it the sidecar refuses the upgrade
  // — this route spawns a shell, and it is the one route the token missed.
  return withWebTokenQuery(`${ptyWsBase()}/pty?${q.toString()}`)
}
