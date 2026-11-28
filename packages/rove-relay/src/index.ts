// Vendored from relay-kit (https://github.com/nanami-0713/relay-kit, MIT, see LICENSE-relay-kit) at
// 8159a643b3e9fc57c5768e9477c3f14a98700776, workers/relay/src/index.ts. Rove's additions are the abuse
// limits of a shared, hosted relay: a per-IP connect rate, phones per room, and a daily byte budget per room.
//
// relay-e2e/v1 relay server for Cloudflare Workers.
// Behavior spec: PROTOCOL.md §3-§5. The server is a blind byte pump:
// it routes by sha256(routingToken), assigns tunnel ids, wraps/unwraps
// wmsg frames, and never sees plaintext (E2E is enforced by path design).
//
// Sockets use the WebSocket Hibernation API: the isolate is evicted while
// connections stay open, so idle duration bills ~zero. (With plain
// ws.accept() the always-on agent sockets pinned their DOs in memory 24/7
// — 2 x 86,400s x 0.125GB = 21.6k GB-s/day against the 13k free tier.)
// Per-socket state therefore lives in the socket attachment (role, tunnel
// id, pending deadline) and in storage (early-frame buffer), never in
// closures — those die with the isolate.

export interface Env {
  RELAY_ROOM: DurableObjectNamespace
  /** Cloudflare rate limiting binding: connects per client IP per minute. */
  CONNECTS?: { limit(opts: { key: string }): Promise<{ success: boolean }> }
}

/** Every open phone of one pairing: a person's browsers and app, with headroom. */
const MAX_PHONES = 8
/** Bytes a room may relay per UTC day, both directions. Far above a day of terminal use; stops a free proxy. */
const DAILY_BYTES = 2 * 1024 ** 3
/** How often the running count is written down: an evicted isolate forgets at most this much. */
const PERSIST_EVERY = 8 * 1024 ** 2

const encoder = new TextEncoder()

async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(s))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")
}

function b64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out.buffer
}

function abToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let s = ""
  for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode(...bytes.subarray(i, i + 32768))
  return btoa(s)
}

const NO_AGENT_TIMEOUT_MS = 60_000
// A pending phone's buffered frames live at this storage key. Early frames
// are the E2E handshake (3 tiny JSON messages, <1 KB total), so these caps
// are ~64x headroom for a legit client — and a hard ceiling for a hostile
// one: without the byte cap, 256 x 1 MiB frames could pin ~256 MB of DO
// storage per room on a public relay.
const EARLY = (pid: string) => `early:${pid}`
const EARLY_MAX_FRAMES = 256
const EARLY_MAX_BYTES = 64 * 1024

// Attachments (<= ~100B, well under the 2KiB cap). `reg` marks the one
// registered agent; `id` marks a phone whose tunnel the agent accepted
// (wopen sent); `deadline` is a pending phone's give-up time.
interface AgentAtt {
  role: "agent"
  reg: boolean
}
interface PhoneAtt {
  role: "phone"
  id: string | null
  pid: string
  deadline: number | null
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (env.CONNECTS && (url.pathname === "/agent" || url.pathname.startsWith("/c/"))) {
      const ip = request.headers.get("CF-Connecting-IP") ?? "unknown"
      if (!(await env.CONNECTS.limit({ key: ip })).success) return new Response("too many connections", { status: 429 })
    }

    // Desktop agent registration. The original request is forwarded verbatim:
    // stub.fetch() must carry the Upgrade header for the WS handshake to
    // survive the hop into the Durable Object.
    if (url.pathname === "/agent") {
      const th = url.searchParams.get("th") ?? ""
      if (!/^[0-9a-f]{64}$/.test(th)) return new Response("bad token hash", { status: 400 })
      const stub = env.RELAY_ROOM.get(env.RELAY_ROOM.idFromName(th))
      return stub.fetch(request)
    }

    // Phone E2E connection. Same verbatim-forward rule; the DO identifies
    // the role from the pathname.
    const m = url.pathname.match(/^\/c\/([A-Za-z0-9_-]{16,64})\/__alma_e2e__\/?$/)
    if (m) {
      const th = await sha256Hex(m[1])
      const stub = env.RELAY_ROOM.get(env.RELAY_ROOM.idFromName(th))
      return stub.fetch(request)
    }

    return new Response("not found", { status: 404 })
  },
}

export class RelayRoom implements DurableObject {
  #state: DurableObjectState
  // tunnel id -> phone ws. Pure cache of the phone attachments (which are
  // the source of truth); rebuilt by scanning on a miss.
  #phones = new Map<string, WebSocket>()
  #day = ""
  #bytes = 0
  #saved = 0

  constructor(state: DurableObjectState, _env: Env) {
    this.#state = state
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 })
    const url = new URL(request.url)
    if (await this.#overBudget()) return new Response("this pairing used its relay budget for today", { status: 429 })
    if (url.pathname.startsWith("/c/") && this.#state.getWebSockets("phone").length >= MAX_PHONES)
      return new Response("too many browsers on this pairing", { status: 429 })
    const [client, server] = Object.values(new WebSocketPair())
    if (url.pathname === "/agent") {
      // Registered only on the "register" frame, not on connect.
      server.serializeAttachment({ role: "agent", reg: false } as AgentAtt)
      this.#state.acceptWebSocket(server, ["agent"])
    } else if (url.pathname.startsWith("/c/")) {
      // Decide the phone's fate synchronously — no awaits before the
      // attachment is in place, so the first frame can never race it.
      const agent = this.#agentSocket()
      const att: PhoneAtt = agent
        ? { role: "phone", id: crypto.randomUUID(), pid: crypto.randomUUID(), deadline: null }
        : { role: "phone", id: null, pid: crypto.randomUUID(), deadline: Date.now() + NO_AGENT_TIMEOUT_MS }
      server.serializeAttachment(att)
      this.#state.acceptWebSocket(server, ["phone"])
      if (att.id && agent) {
        // wopen must precede any wmsg: the agent drops frames for tunnels
        // it hasn't opened. A failed send kills the tunnel at birth.
        if (!this.#send(agent, JSON.stringify({ t: "wopen", id: att.id, path: "/__alma_e2e__" }))) {
          this.#phones.delete(att.id)
          try {
            server.close(1011, "agent disconnected")
          } catch {}
        } else {
          this.#phones.set(att.id, server)
        }
      } else {
        await this.#armPendingAlarm()
      }
    } else {
      return new Response("not found", { status: 404 })
    }
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const att = ws.deserializeAttachment() as AgentAtt | PhoneAtt | undefined
    if (!att) return
    if (await this.#spend(typeof message === "string" ? message.length : message.byteLength)) return
    if (att.role === "agent") await this.#onAgentMessage(ws, message)
    else await this.#onPhoneMessage(ws, att, message)
  }

  async webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
    const att = ws.deserializeAttachment() as AgentAtt | PhoneAtt | undefined
    if (!att) return
    if (att.role === "agent") {
      // An unregistered or already-demoted socket leaving changes nothing.
      if (!att.reg) return
      // The registered agent is gone: tear down every open tunnel. Pending
      // phones stay queued — the next agent picks them up.
      for (const w of this.#state.getWebSockets("phone")) {
        const pa = w.deserializeAttachment() as PhoneAtt | undefined
        if (pa?.id) {
          try {
            w.close(1011, "agent disconnected")
          } catch {}
        }
      }
      this.#phones.clear()
      return
    }
    // Phone: drop any buffered early frames and tell the agent, if this
    // tunnel was ever opened. (The agent-side wclose path clears `id`
    // first, so an agent-requested close doesn't echo back.)
    await this.#state.storage.delete(EARLY(att.pid))
    if (att.id) {
      this.#phones.delete(att.id)
      const agent = this.#agentSocket()
      if (agent) this.#send(agent, JSON.stringify({ t: "wclose", id: att.id, code: 1000 }))
    }
  }

  async #onAgentMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return
    // biome-ignore lint/suspicious/noExplicitAny: upstream relay-kit code, kept as vendored
    let msg: any
    try {
      msg = JSON.parse(message)
    } catch {
      return
    }
    switch (msg.t) {
      case "register": {
        // Same pairing, second agent: the newcomer wins, the old one gets
        // 4000. Demote first so the loser's own close handler is a no-op.
        for (const other of this.#state.getWebSockets("agent")) {
          if (other === ws) continue
          other.serializeAttachment({ role: "agent", reg: false } as AgentAtt)
          try {
            other.close(4000, "Another agent took over this pairing")
          } catch {}
        }
        ws.serializeAttachment({ role: "agent", reg: true } as AgentAtt)
        this.#send(ws, JSON.stringify({ t: "registered" }))
        for (const p of this.#state.getWebSockets("phone")) {
          const pa = p.deserializeAttachment() as PhoneAtt | undefined
          if (pa && !pa.id) await this.#openTunnel(p, pa)
        }
        break
      }
      case "wmsg": {
        const phone = this.#phoneById(String(msg.id))
        if (!phone) return
        try {
          if (typeof msg.s === "string") phone.send(msg.s)
          else if (typeof msg.b === "string") phone.send(b64ToArrayBuffer(msg.b))
        } catch {}
        break
      }
      case "wclose": {
        const phone = this.#phoneById(String(msg.id))
        if (!phone) return
        const pa = phone.deserializeAttachment() as PhoneAtt | undefined
        if (pa) {
          pa.id = null
          phone.serializeAttachment(pa)
        }
        this.#phones.delete(String(msg.id))
        try {
          phone.close(msg.code ?? 1000, String(msg.reason ?? ""))
        } catch {}
        break
      }
      // wopened / werr need no server action; the phone learns outcomes
      // from the handshake and tunnel traffic itself.
    }
  }

  async #onPhoneMessage(ws: WebSocket, att: PhoneAtt, message: string | ArrayBuffer): Promise<void> {
    if (att.id) {
      // Tunnel open: blind-forward. If the agent is gone its close handler
      // is already closing this phone — drop the frame, as before.
      const agent = this.#agentSocket()
      if (!agent) return
      this.#send(agent, JSON.stringify(this.#wrap(att.id, message)))
      return
    }
    const agent = this.#agentSocket()
    if (agent) {
      // An agent registered between this phone's connect and its first
      // frame (or while buffered frames were still arriving): open now,
      // replay what was buffered, then forward this frame.
      const id = await this.#openTunnel(ws, att, agent)
      if (!id) return
      this.#send(agent, JSON.stringify(this.#wrap(id, message)))
      return
    }
    // Buffer, don't drop: the E2E initiator sends its hello the moment its
    // socket opens. Storage, not memory — the isolate may be evicted before
    // an agent ever shows up, and a lost hello is a handshake deadlock.
    const key = EARLY(att.pid)
    const buf = (await this.#state.storage.get<{ s?: string; b?: string }[]>(key)) ?? []
    const buffered = buf.reduce((n, f) => n + (f.s?.length ?? f.b?.length ?? 0), 0)
    const incoming = typeof message === "string" ? message.length : message.byteLength
    if (buf.length < EARLY_MAX_FRAMES && buffered + incoming <= EARLY_MAX_BYTES) {
      buf.push(typeof message === "string" ? { s: message } : { b: abToB64(message) })
      await this.#state.storage.put(key, buf)
    }
    if (att.deadline === null) {
      att.deadline = Date.now() + NO_AGENT_TIMEOUT_MS
      ws.serializeAttachment(att)
    }
    await this.#armPendingAlarm()
  }

  // Give up on pending phones whose agent never came.
  async alarm(): Promise<void> {
    const now = Date.now()
    for (const ws of this.#state.getWebSockets("phone")) {
      const att = ws.deserializeAttachment() as PhoneAtt | undefined
      if (!att || att.id || att.deadline === null || now < att.deadline) continue
      try {
        ws.close(4404, "No agent connected for this pairing")
      } catch {}
    }
    await this.#armPendingAlarm()
  }

  // Assign a tunnel id to a pending phone, tell the agent (wopen), then
  // replay whatever the phone sent while it waited. Returns the id, or
  // null if the agent vanished.
  async #openTunnel(ws: WebSocket, att: PhoneAtt, agent?: WebSocket | null): Promise<string | null> {
    // biome-ignore lint/style/noParameterAssign: upstream relay-kit code, kept as vendored
    agent ??= this.#agentSocket()
    if (!agent) return null
    const id = crypto.randomUUID()
    att.id = id
    att.deadline = null
    ws.serializeAttachment(att)
    if (!this.#send(agent, JSON.stringify({ t: "wopen", id, path: "/__alma_e2e__" }))) {
      att.id = null
      ws.serializeAttachment(att)
      try {
        ws.close(1011, "agent disconnected")
      } catch {}
      return null
    }
    this.#phones.set(id, ws)
    const key = EARLY(att.pid)
    const early = await this.#state.storage.get<{ s?: string; b?: string }[]>(key)
    if (early) {
      // Replay only after the wopen above: the agent drops wmsgs for
      // tunnels it hasn't opened yet.
      for (const f of early)
        this.#send(agent, JSON.stringify(this.#wrap(id, f.s !== undefined ? f.s : b64ToArrayBuffer(f.b!))))
      await this.#state.storage.delete(key)
    }
    return id
  }

  // Earliest deadline among still-pending phones; setAlarm replaces the
  // current alarm, so always set the minimum.
  async #armPendingAlarm(): Promise<void> {
    let next: number | null = null
    for (const ws of this.#state.getWebSockets("phone")) {
      const att = ws.deserializeAttachment() as PhoneAtt | undefined
      if (att && !att.id && att.deadline !== null) next = next === null ? att.deadline : Math.min(next, att.deadline)
    }
    if (next !== null) await this.#state.storage.setAlarm(next)
  }

  #wrap(
    id: string,
    message: string | ArrayBuffer,
  ): { t: "wmsg"; id: string; s: string } | { t: "wmsg"; id: string; b: string } {
    return typeof message === "string" ? { t: "wmsg", id, s: message } : { t: "wmsg", id, b: abToB64(message) }
  }

  #agentSocket(): WebSocket | null {
    for (const ws of this.#state.getWebSockets("agent")) {
      const att = ws.deserializeAttachment() as AgentAtt | undefined
      if (att?.reg) return ws
    }
    return null
  }

  #phoneById(id: string): WebSocket | null {
    const hit = this.#phones.get(id)
    if (hit) return hit
    for (const ws of this.#state.getWebSockets("phone")) {
      const att = ws.deserializeAttachment() as PhoneAtt | undefined
      if (att?.id) this.#phones.set(att.id, ws)
    }
    return this.#phones.get(id) ?? null
  }

  /** Today's count, read back after an eviction; a new UTC day starts from zero. */
  async #overBudget(): Promise<boolean> {
    const day = new Date().toISOString().slice(0, 10)
    if (this.#day !== day) {
      this.#day = day
      this.#bytes = (await this.#state.storage.get<number>(`bytes:${day}`)) ?? 0
      this.#saved = this.#bytes
    }
    return this.#bytes >= DAILY_BYTES
  }

  /** Counts a relayed frame; past the budget every socket of the room closes. True = drop the frame. */
  async #spend(size: number): Promise<boolean> {
    if (await this.#overBudget()) return true
    this.#bytes += size
    if (this.#bytes - this.#saved >= PERSIST_EVERY || this.#bytes >= DAILY_BYTES) {
      this.#saved = this.#bytes
      await this.#state.storage.put(`bytes:${this.#day}`, this.#bytes)
    }
    if (this.#bytes < DAILY_BYTES) return false
    for (const ws of this.#state.getWebSockets()) {
      try {
        ws.close(4429, "this pairing used its relay budget for today")
      } catch {}
    }
    return true
  }

  #send(ws: WebSocket, data: string): boolean {
    try {
      ws.send(data)
      return true
    } catch {
      return false
    }
  }
}
