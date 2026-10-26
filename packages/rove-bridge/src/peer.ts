/**
 * What kind of screen opened a connection, decided once at upgrade from the request itself (a
 * page's own claims are never believed): the daemon's `viewers` and the Browser panel's
 * "can this page reach the agent's localhost" both rest on it.
 */

import { isLoopbackHost } from "@sma1lboy/rove-daemon/daemon/frame-check"
import { offersWebSubprotocol } from "./auth.ts"
import type { ViewingFields } from "./protocol.ts"

export interface Peer {
  /** The browser page speaks the web subprotocol; the phone app does not. */
  readonly surface: "web" | "phone"
  /** Same machine as the bridge, so the agent's `localhost` is this screen's `localhost`. */
  readonly local: boolean
}

/**
 * Behind cloudflared every peer is 127.0.0.1, so a loopback address proves nothing alone: the
 * tunnel's own headers (Cloudflare's client IP, the Access JWT, a forwarded-for) and an Origin on
 * the tunnel hostname all mean "came through the tunnel". Local is loopback AND none of those.
 */
export function peerOf(
  req: Request,
  address: string | undefined,
  deps: { readonly access?: unknown; readonly publicHost?: string | null },
): Peer {
  const surface = offersWebSubprotocol(req) ? "web" : "phone"
  const origin = req.headers.get("origin")
  let viaTunnel = deps.access !== undefined
  if (origin !== null && deps.publicHost) {
    try {
      viaTunnel ||= new URL(origin).hostname === deps.publicHost.toLowerCase()
    } catch {
      viaTunnel = true
    }
  }
  const tunnelHeader = ["cf-connecting-ip", "cf-access-jwt-assertion", "x-forwarded-for", "forwarded"].some((name) =>
    req.headers.has(name),
  )
  const loopback = address !== undefined && isLoopbackHost(address.replace(/^::ffff:/i, ""))
  return { surface, local: loopback && !viaTunnel && !tunnelHeader }
}

/** The `ui.viewing` fields for this connection: what the page reported about its layout, plus what the bridge knows of the peer. */
export function viewingFields(args: Readonly<Record<string, unknown>>, peer: Peer): ViewingFields {
  const flag = (key: string) => (typeof args[key] === "boolean" ? (args[key] as boolean) : undefined)
  const [panel, panelOpen, narrow] = [flag("panel"), flag("panelOpen"), flag("narrow")]
  return {
    surface: peer.surface,
    local: peer.local,
    ...(panel !== undefined && peer.surface === "web" ? { panel } : {}),
    ...(panelOpen !== undefined ? { panelOpen } : {}),
    ...(narrow !== undefined ? { narrow } : {}),
  }
}
