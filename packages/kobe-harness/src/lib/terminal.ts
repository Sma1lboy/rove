/**
 * Terminal client. Each PTY-backed workspace tab is owned by the node
 * pty-server; the xterm attaches by the tab's client-generated id. Vendor
 * tabs spawn the configured engine in the task's worktree. Terminal tabs
 * spawn the user's shell in the same worktree.
 */

import { withWebTokenQuery } from "./web-token.ts"

export type PtyMode = "engine" | "shell"

/**
 * PTY sidecar websocket origin: our own, because Vite proxies `/pty` to the
 * sidecar on `KOBE_PTY_PORT` (see `vite.config.ts`) and Vite dev is the only
 * thing that ever serves this page (`dev.ts`).
 *
 * This used to derive the sidecar's port as `location.port + 2`, which made
 * the browser a second, silent copy of the port layout `fixturePortBase()`
 * owns in `packages/kobe/scripts/fixture-core.ts`. When that layout dropped
 * its middle port the two copies disagreed, the socket dialed a port nothing
 * listened on, and all five visual specs failed as 45s `data-pty-status`
 * timeouts — while the sidecar's own log reported it had started fine. One
 * origin, one owner of the port: the proxy.
 */
function ptyWsBase(): string {
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`
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
