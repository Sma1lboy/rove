/**
 * The relay tunnel dressed as the page's `fetch` and `WebSocket` (`relay-transport.ts`). The
 * tunnel's sockets carry no headers, so the bridge token that a browser offers as the
 * `rove.bearer.<token>` subprotocol rides `?token=` instead; only the bridge's relay ingress reads it.
 */

import type { RelayTunnelClient, TunnelWebSocket } from "@hsinsekai-nanami/client"
import type { RelayTransport } from "./relay-transport.ts"

export type Tunnel = Pick<RelayTunnelClient, "state" | "connect" | "fetch" | "openSocket">

const TOKEN_PROTOCOL = "rove.bearer."
/** Statuses a `Response` must be built without a body. */
const NO_BODY = new Set([101, 204, 205, 304])

/** Bring the tunnel back after it dropped (a phone slept); a no-op while it is up. */
function up(tunnel: Tunnel): Promise<void> {
  return tunnel.state === "ready" ? Promise.resolve() : tunnel.connect()
}

export function relayTransport(tunnel: Tunnel): RelayTransport {
  class RelaySocket {
    static readonly OPEN = 1
    readyState = 0
    onopen: ((ev: Event) => void) | null = null
    onmessage: ((ev: { data: string }) => void) | null = null
    onclose: ((ev: Event) => void) | null = null
    onerror: ((ev: Event) => void) | null = null
    private sock: TunnelWebSocket | null = null

    constructor(url: string, protocols: string[]) {
      const token = protocols.find((p) => p.startsWith(TOKEN_PROTOCOL))?.slice(TOKEN_PROTOCOL.length)
      const path = new URL(url, "http://relay").pathname + (token ? `?token=${encodeURIComponent(token)}` : "")
      void this.open(path)
    }

    private async open(path: string): Promise<void> {
      try {
        await up(tunnel)
        const sock = await tunnel.openSocket(path)
        if (this.readyState === 3) {
          sock.close()
          return
        }
        this.sock = sock
        sock.onmessage = (data) =>
          this.onmessage?.({ data: typeof data === "string" ? data : new TextDecoder().decode(data) })
        sock.onclose = () => this.closed()
        this.readyState = 1
        this.onopen?.(new Event("open"))
      } catch {
        // Tunnel down or the bridge refused the socket: a close, which the client's backoff retries.
        this.closed()
      }
    }

    send(data: string): void {
      this.sock?.send(data)
    }

    close(): void {
      this.sock?.close()
      this.closed()
    }

    private closed(): void {
      if (this.readyState === 3) return
      this.readyState = 3
      this.onclose?.(new Event("close"))
    }
  }

  return {
    async fetch(path, init = {}) {
      await up(tunnel)
      const body = typeof init.body === "string" ? init.body : undefined
      const res = await tunnel.fetch(path, {
        method: init.method,
        headers: Object.fromEntries(new Headers(init.headers).entries()),
        body,
      })
      return new Response(NO_BODY.has(res.status) ? null : res.bytes(), { status: res.status, headers: res.headers })
    },
    WebSocket: RelaySocket as unknown as RelayTransport["WebSocket"],
  }
}
