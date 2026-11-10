/**
 * Web Push for pages that are closed: the bridge keeps each browser's subscription in
 * `bridge/push.json` (owner-only, with the VAPID keypair it signs with) and, when a task crosses into
 * done / needs you / error, sends the subscribed browsers a push. The edge is the page's own
 * (`attentionEdges` + `attentionKindFor`, as notify.ts) and so is the switch (`crossTask`).
 *  - A subscription is tied to the credential its page connected with (a device token, or the shared
 *    token's hash): revoke the device or rotate the token and its pushes stop.
 *  - While any page is on screen, nothing is pushed: that page notifies itself.
 *  - The first task list after start only seeds, so a restart does not replay old episodes.
 */

import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { type NotificationKind, attentionEdges, attentionKindFor } from "@sma1lboy/rove/src/tui/lib/notify-state.ts"
import { BridgeError } from "./protocol.ts"
import type { TasksPayload } from "./protocol.ts"
import { writeOwnerOnly } from "./web-password.ts"
import { type PushTarget, type VapidKeys, fromB64url, generateVapidKeys, isPushEndpoint, sendPush } from "./web-push.ts"

/** What a page subscribed as: a device's name, or `token:<hash>` for the shared link. */
export type Credential = string

interface StoredSubscription extends PushTarget {
  readonly credential: Credential
  readonly createdAt: string
}

interface PushFile {
  readonly vapid: VapidKeys
  readonly subscriptions: readonly StoredSubscription[]
}

/** The payload a service worker shows: no message text beyond the task's own title. */
export interface PushMessage {
  readonly taskId: string
  readonly kind: NotificationKind
  readonly title: string
}

const MAX_SUBSCRIPTIONS = 32

export const sharedCredential = (token: string): Credential =>
  `token:${createHash("sha256").update(token).digest("hex").slice(0, 32)}`

export interface PushHubDeps {
  readonly path: string
  readonly feed: { subscribe(listener: (payload: TasksPayload) => void): () => void }
  /** The cross-task notification switch, read at send time. */
  readonly crossTask: () => boolean
  /** Whether a stored credential still opens a socket today. */
  readonly credentialValid: (credential: Credential) => boolean
  readonly send?: (target: PushTarget, message: PushMessage, vapid: VapidKeys) => Promise<number>
  readonly now?: () => Date
  readonly log?: (line: string) => void
}

export class PushHub {
  private file: PushFile
  private readonly visible = new Set<string>()
  private previous: Map<string, string> | null = null
  private unsubscribeFeed: (() => void) | null = null

  constructor(private readonly deps: PushHubDeps) {
    this.file = this.load()
    this.follow()
  }

  publicKey(): string {
    return this.file.vapid.publicKey
  }

  subscribe(raw: unknown, credential: Credential): void {
    const target = parseSubscription(raw)
    const now = (this.deps.now ?? (() => new Date()))().toISOString()
    const others = this.file.subscriptions.filter((s) => s.endpoint !== target.endpoint)
    if (others.length >= MAX_SUBSCRIPTIONS) {
      throw new BridgeError("TOO_MANY", `at most ${MAX_SUBSCRIPTIONS} browsers can be subscribed`)
    }
    this.save([...others, { ...target, credential, createdAt: now }])
  }

  /** Only the credential that subscribed an endpoint (or a revoked one, at send time) removes it. */
  unsubscribe(endpoint: unknown, credential: Credential): boolean {
    const before = this.file.subscriptions
    const after = before.filter((s) => !(s.endpoint === endpoint && s.credential === credential))
    if (after.length === before.length) return false
    this.save(after)
    return true
  }

  subscribed(endpoint: unknown, credential: Credential): boolean {
    return this.file.subscriptions.some((s) => s.endpoint === endpoint && s.credential === credential)
  }

  /** A connection's `ui.viewing`: on screen while it reports a task. */
  setVisible(viewer: string, visible: boolean): void {
    if (visible) this.visible.add(viewer)
    else this.visible.delete(viewer)
  }

  /** Read the task list only while someone is subscribed: the feed recomputes for every listener. */
  private follow(): void {
    const want = this.file.subscriptions.length > 0
    if (want && !this.unsubscribeFeed) {
      this.previous = null
      this.unsubscribeFeed = this.deps.feed.subscribe((payload) => void this.onTasks(payload))
    } else if (!want && this.unsubscribeFeed) {
      this.unsubscribeFeed()
      this.unsubscribeFeed = null
    }
  }

  async onTasks(payload: TasksPayload): Promise<void> {
    const next = new Map<string, string>()
    for (const task of payload.tasks) if (task.activity) next.set(task.id, task.activity.state)
    const edges = attentionEdges(this.previous, next, null, attentionKindFor)
    this.previous = next
    if (edges.length === 0 || this.visible.size > 0 || !this.deps.crossTask()) return
    const titles = new Map(payload.tasks.map((task) => [task.id, task.title]))
    const live = this.file.subscriptions.filter((s) => this.deps.credentialValid(s.credential))
    const gone = new Set(this.file.subscriptions.filter((s) => !live.includes(s)).map((s) => s.endpoint))
    const send = this.deps.send ?? ((target, message, vapid) => sendPush(target, message, vapid))
    for (const { key, kind } of edges) {
      const message: PushMessage = { taskId: key, kind, title: titles.get(key) ?? key }
      await Promise.all(
        live.map(async (s) => {
          try {
            const status = await send(s, message, this.file.vapid)
            // The browser dropped the subscription (uninstalled, permission revoked).
            if (status === 404 || status === 410) gone.add(s.endpoint)
            else if (status >= 400) this.deps.log?.(`[rove-bridge] push ${new URL(s.endpoint).host}: HTTP ${status}`)
          } catch (err) {
            this.deps.log?.(`[rove-bridge] push ${new URL(s.endpoint).host}: ${String(err)}`)
          }
        }),
      )
    }
    if (gone.size > 0) this.save(this.file.subscriptions.filter((s) => !gone.has(s.endpoint)))
  }

  private load(): PushFile {
    try {
      if (existsSync(this.deps.path)) {
        const raw = JSON.parse(readFileSync(this.deps.path, "utf8")) as PushFile
        if (raw?.vapid?.publicKey && raw.vapid.privateKey && Array.isArray(raw.subscriptions)) return raw
      }
    } catch {
      // Unreadable: start over with fresh keys; every browser subscribes again.
    }
    const fresh: PushFile = { vapid: generateVapidKeys(), subscriptions: [] }
    writeOwnerOnly(this.deps.path, `${JSON.stringify(fresh, null, 2)}\n`)
    return fresh
  }

  private save(subscriptions: readonly StoredSubscription[]): void {
    this.file = { ...this.file, subscriptions }
    writeOwnerOnly(this.deps.path, `${JSON.stringify(this.file, null, 2)}\n`)
    this.follow()
  }
}

/** A browser's `PushSubscription.toJSON()`, checked: a known push service, a P-256 key, a 16-byte secret. */
function parseSubscription(raw: unknown): PushTarget {
  const sub = raw as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null
  const endpoint = sub?.endpoint
  if (typeof endpoint !== "string" || !isPushEndpoint(endpoint)) {
    throw new BridgeError("BAD_ARGS", "endpoint must be a browser push service URL")
  }
  const { p256dh, auth } = sub?.keys ?? {}
  if (typeof p256dh !== "string" || fromB64url(p256dh).length !== 65 || fromB64url(p256dh)[0] !== 4) {
    throw new BridgeError("BAD_ARGS", "keys.p256dh must be an uncompressed P-256 key")
  }
  if (typeof auth !== "string" || fromB64url(auth).length !== 16) {
    throw new BridgeError("BAD_ARGS", "keys.auth must be 16 bytes")
  }
  return { endpoint, p256dh, auth }
}
