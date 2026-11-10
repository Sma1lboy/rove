import { sha256Hex } from "@hsinsekai-nanami/core"
import type { ServerWebSocket } from "bun"

type Peer = { role: "agent"; th: string } | { role: "phone"; th: string; id: string }

/**
 * A blind relay speaking relay-e2e/v1's wire (PROTOCOL.md §3-§5), minus pending phones: the agent
 * registers first. With `shell` it also serves that file at `/`, as the Worker's static assets do.
 */
export function startRelay(opts: { port?: number; shell?: string } = {}) {
  const agents = new Map<string, ServerWebSocket<Peer>>()
  const phones = new Map<string, ServerWebSocket<Peer>>()
  let next = 0
  const server = Bun.serve<Peer, never>({
    hostname: "127.0.0.1",
    port: opts.port ?? 0,
    async fetch(req, srv) {
      const url = new URL(req.url)
      if (opts.shell && url.pathname === "/") return new Response(Bun.file(opts.shell))
      const phone = url.pathname.match(/^\/c\/([A-Za-z0-9_-]+)\/__alma_e2e__$/)
      const data: Peer | null =
        url.pathname === "/agent"
          ? { role: "agent", th: url.searchParams.get("th") ?? "" }
          : phone
            ? { role: "phone", th: await sha256Hex(phone[1] ?? ""), id: `t${++next}` }
            : null
      if (data && srv.upgrade(req, { data })) return undefined
      return new Response("not found", { status: 404 })
    },
    websocket: {
      open(ws) {
        if (ws.data.role !== "phone") return
        const agent = agents.get(ws.data.th)
        if (!agent) return ws.close(4404, "no agent")
        phones.set(ws.data.id, ws)
        agent.send(JSON.stringify({ t: "wopen", id: ws.data.id, path: "/__alma_e2e__" }))
      },
      message(ws, msg) {
        const peer = ws.data
        if (peer.role === "phone") {
          const wire = typeof msg === "string" ? { s: msg } : { b: Buffer.from(msg).toString("base64") }
          agents.get(peer.th)?.send(JSON.stringify({ t: "wmsg", id: peer.id, ...wire }))
          return
        }
        const frame = JSON.parse(String(msg))
        if (frame.t === "register") {
          agents.set(peer.th, ws)
          ws.send(JSON.stringify({ t: "registered" }))
        } else if (frame.t === "wmsg") phones.get(frame.id)?.send(frame.s ?? Buffer.from(frame.b, "base64"))
        else if (frame.t === "wclose") phones.get(frame.id)?.close()
      },
      close(ws) {
        const peer = ws.data
        if (peer.role === "phone") {
          phones.delete(peer.id)
          agents.get(peer.th)?.send(JSON.stringify({ t: "wclose", id: peer.id }))
        } else if (agents.get(peer.th) === ws) agents.delete(peer.th)
      },
    },
  })
  return { url: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) }
}
