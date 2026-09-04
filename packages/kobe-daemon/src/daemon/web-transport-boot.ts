/**
 * The daemon's SECONDARY transport: the loopback HTTP/SSE surface kobe-web
 * talks to. Split out of `server.ts`, where it was the one job in the boot
 * closure that shared state with nothing else — it owns its listener, its own
 * SSE client set, and the bind-failure reason `daemon.status` reports. The
 * unix-socket daemon owns task/channel state and its own client set.
 *
 * The handle is created BEFORE the boot so `DaemonLifetime`'s `clients`
 * generator can yield from a set that is still empty; {@link
 * DaemonWebTransport.start} takes the collaborators that only exist later.
 */

import { logDaemonError, logDaemonInfo } from "./crash-log.ts"
import type { DaemonEventBus } from "./event-bus.ts"
import type { DaemonLifetime } from "./lifetime.ts"
import type { PtyLiveHold } from "./pty-live-hold.ts"
import type { DaemonServerOptions } from "./server-options.ts"
import { type DaemonWebLink, type DaemonWebServer, startDaemonWebServer } from "./web-server.ts"

/**
 * One open SSE stream, shaped like the socket clients `DaemonLifetime`
 * counts — a browser tab is a gui, so it holds the daemon's lifetime.
 */
interface WebSseClient {
  subscribed: boolean
  holdsLifetime: boolean
}

export interface WebTransportStartDeps {
  readonly options: DaemonServerOptions
  readonly bus: DaemonEventBus
  readonly link: DaemonWebLink
  readonly lifetime: DaemonLifetime
  readonly ptyHold: PtyLiveHold
  /** Live socket-client count, for the "N client(s)" connection log lines. */
  readonly socketClientCount: () => number
}

export interface DaemonWebTransport {
  /** Live SSE membership. `DaemonLifetime`'s `clients` generator yields from it. */
  readonly clients: ReadonlySet<WebSseClient>
  /** Listening port; `undefined` when the transport is off, failed, or closed. */
  readonly port: number | undefined
  /** Why it isn't listening (port taken, bind failed); `null` when there's nothing to report. */
  readonly error: string | null
  /** Binds the listener when `options.webPort` is set. Never throws. */
  start(deps: WebTransportStartDeps): Promise<void>
  close(): void
}

export function createWebTransport(): DaemonWebTransport {
  const clients = new Set<WebSseClient>()
  let server: DaemonWebServer | null = null
  let error: string | null = null

  return {
    clients,
    get port() {
      return server?.port
    },
    get error() {
      return error
    },
    async start(deps) {
      const { options } = deps
      if (options.webPort === undefined) return
      // The web transport is a SECONDARY surface — a bind failure (port taken by
      // a stray `vite preview`, another kobe daemon, whatever) must NEVER take
      // the daemon down. Degrade to socket-only, record the reason for status,
      // and keep serving every attached TUI/pane over the unix socket.
      try {
        server = await startDaemonWebServer({
          runtime: options.runtime,
          port: options.webPort,
          hostname: options.webHost,
          staticDir: options.webStaticDir,
          link: deps.link,
          onEvent: (sink) => deps.bus.onPublish(sink),
          onSseOpen: () => {
            const client: WebSseClient = { subscribed: true, holdsLifetime: true }
            clients.add(client)
            deps.lifetime.guiAttached()
            logDaemonInfo(
              "conn",
              `web client subscribed — ${deps.socketClientCount() + clients.size} client(s), ${deps.lifetime.guiCount()} gui`,
            )
            return () => {
              clients.delete(client)
              logDaemonInfo(
                "conn",
                `web client disconnected — ${deps.socketClientCount() + clients.size} client(s), ${deps.lifetime.guiCount()} gui left`,
              )
              void deps.ptyHold.probeSoon()
              deps.lifetime.clientDisconnected(true)
            }
          },
        })
        logDaemonInfo("web", `daemon web transport listening on http://${server.hostname}:${server.port}`)
      } catch (err) {
        server = null
        error = err instanceof Error ? err.message : String(err)
        logDaemonError("web", err)
        logDaemonInfo("web", "daemon running socket-only — web transport disabled (see error above)")
      }
    },
    close() {
      server?.close()
      server = null
    },
  }
}
