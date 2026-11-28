/**
 * Local IPC client from `rove api web` to `rove-desktop`'s browser socket
 * (`defaultDesktopBrowserSocketPath`). Speaks newline-delimited JSON and raises a typed
 * `DESKTOP_UNAVAILABLE` error when the desktop shell is not running.
 */

import { createConnection } from "node:net"
import { defaultDesktopBrowserSocketPath } from "@sma1lboy/rove-daemon/daemon/paths"
import { ApiError } from "./types.ts"

const DEFAULT_TIMEOUT_MS = 30_000

interface DesktopIpcError {
  readonly code?: string
  readonly message?: string
}

interface DesktopIpcResponse {
  readonly id?: string
  readonly ok?: boolean
  readonly result?: unknown
  readonly error?: DesktopIpcError
}

export async function requestDesktopBrowser(
  method: string,
  params: Record<string, unknown>,
  opts: { readonly socketPath?: string; readonly timeoutMs?: number } = {},
): Promise<unknown> {
  const socketPath = opts.socketPath ?? defaultDesktopBrowserSocketPath()
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const id = `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  return new Promise<unknown>((resolve, reject) => {
    let settled = false
    let buffer = ""
    const socket = createConnection(socketPath)
    const done = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      fn()
    }
    const timer = setTimeout(() => {
      done(() =>
        reject(new ApiError(`desktop browser request "${method}" timed out after ${timeoutMs}ms`, "BROWSER_TIMEOUT")),
      )
    }, timeoutMs)

    socket.setEncoding("utf8")
    socket.once("connect", () => {
      socket.write(`${JSON.stringify({ id, method, params })}\n`)
    })
    socket.on("data", (chunk: string) => {
      buffer += chunk
      const newline = buffer.indexOf("\n")
      if (newline === -1) return
      const line = buffer.slice(0, newline).trim()
      if (!line) return
      try {
        const res = JSON.parse(line) as DesktopIpcResponse
        if (res.ok) {
          done(() => resolve(res.result))
        } else {
          const code = typeof res.error?.code === "string" ? res.error.code : "BROWSER_ERROR"
          const message = typeof res.error?.message === "string" ? res.error.message : "desktop browser request failed"
          done(() => reject(new ApiError(message, code)))
        }
      } catch (err) {
        done(() =>
          reject(
            new ApiError(
              `invalid response from desktop browser IPC: ${err instanceof Error ? err.message : String(err)}`,
              "BROWSER_ERROR",
            ),
          ),
        )
      }
    })
    socket.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT" || err.code === "ECONNREFUSED") {
        done(() =>
          reject(
            new ApiError(
              `rove-desktop is not running (no browser IPC socket at ${socketPath})`,
              "DESKTOP_UNAVAILABLE",
              { hint: "start the Rove desktop app (`packages/rove-desktop`) to use `rove api web`" },
            ),
          ),
        )
        return
      }
      done(() => reject(new ApiError(`desktop browser IPC error: ${err.message}`, "BROWSER_ERROR")))
    })
    socket.once("close", () => {
      if (!settled) {
        done(() => reject(new ApiError("desktop browser closed the IPC connection before responding", "BROWSER_ERROR")))
      }
    })
  })
}
