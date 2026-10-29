/**
 * The daemon-side WeChat channel: long-polls iLink for messages from allowed
 * senders and answers them through {@link handleCommand} or the WeChat agent.
 * The bridge itself never messages anyone unprompted: what appears in WeChat
 * is a reply to the owner or something the agent chose to send. A `--notify`
 * routine's report goes to the agent, which decides whether to pass it on.
 *
 * The binding is re-read from disk every cycle, so `rove weixin login` /
 * `logout` take effect without a daemon restart.
 */

import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { createAgentControl } from "./agent.ts"
import { type RoveOps, handleInbound as routeInbound } from "./commands.ts"
import {
  type FetchFn,
  ILINK_BASE_URL,
  IlinkClient,
  type IlinkMessage,
  LONG_POLL_TIMEOUT_MS,
  type UpdatesResponse,
  classifyIlink,
  describeIlink,
  isDirectUserMessage,
  messageText,
} from "./ilink.ts"
import { saveInboundMedia } from "./media.ts"
import { RoutineTracker, renderRoutineRuns } from "./routines.ts"
import { sendBubbles } from "./send.ts"
import { type WeixinAccount, type WeixinRuntimeState, type WeixinStore, isAllowedSender } from "./store.ts"
import { type TypingHandle, type TypingTimings, startTyping } from "./typing.ts"

/** Bot-initiated messages are only accepted within a day of the peer's last message. */
export const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000
const ACCOUNT_RECHECK_MS = 5_000
const RETRY_MS = 2_000
const BACKOFF_MS = 30_000
const MAX_CONSECUTIVE_FAILURES = 3
const EXPIRED_PAUSE_MS = 10 * 60 * 1000
const DEFAULT_NOTIFY_TICK_MS = 20_000
/** Inbound message ids remembered for dedup (iLink redelivers on hiccups). */
const SEEN_CAP = 256

export interface WeixinBridgeDeps {
  readonly store: WeixinStore
  readonly ops: RoveOps
  readonly log: (event: string, message: string) => void
  readonly fetch?: FetchFn
  /** The binding just went away — the daemon may now idle-stop. */
  readonly onUnbound?: () => void
  readonly notifyTickMs?: number
  readonly pollTimeoutMs?: number
  readonly typingTimings?: TypingTimings
  readonly now?: () => number
}

export interface WeixinBridge {
  /** A binding exists on disk — the daemon should stay up for it. */
  isBound(): boolean
  stop(): void
}

/** First characters of an id: enough to recognise in a log, never the whole thing. */
function redact(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id
}

export function startWeixinBridge(deps: WeixinBridgeDeps): WeixinBridge {
  const now = deps.now ?? Date.now
  const pollTimeoutMs = deps.pollTimeoutMs ?? LONG_POLL_TIMEOUT_MS
  let stopped = false
  let account: WeixinAccount | null = deps.store.readAccount()
  let client: IlinkClient | null = null
  let state: WeixinRuntimeState | null = null
  const seen = new Set<string>()
  const routineTracker = new RoutineTracker()
  const agent = createAgentControl({
    ops: deps.ops,
    dir: join(deps.store.dir, "agent"),
    override: () => deps.store.readAccount()?.agent ?? null,
    read: () => state?.agent,
    write: (next) => {
      if (state) saveState({ ...state, agent: next })
    },
    now,
  })

  // Unref'd: a pending retry must never hold the daemon process open.
  const sleep = (ms: number) => delay(ms, undefined, { ref: false })

  /** Sleep in slices, waking early when stopped or the binding changes. */
  async function pause(ms: number): Promise<void> {
    const before = account?.token
    const until = now() + ms
    while (!stopped && now() < until) {
      await sleep(Math.min(ACCOUNT_RECHECK_MS, until - now()))
      if (deps.store.readAccount()?.token !== before) return
    }
  }

  function saveState(next: WeixinRuntimeState): void {
    state = next
    deps.store.writeState(next)
  }

  /** (Re)load the binding; a changed token means a fresh client and state. */
  function refreshAccount(): boolean {
    const next = deps.store.readAccount()
    if (!next) {
      const wasBound = account !== null
      account = null
      client = null
      state = null
      if (wasBound) {
        deps.log("weixin", "unbound — stopped polling")
        deps.onUnbound?.()
      }
      return false
    }
    if (!client || !account || next.token !== account.token || next.accountId !== account.accountId) {
      client = new IlinkClient(next.baseUrl || ILINK_BASE_URL, next.token, deps.fetch)
      state = deps.store.readState(next.accountId)
      deps.log("weixin", `bound to ${redact(next.accountId)} — polling`)
    }
    account = next
    return true
  }

  function recordUndelivered(to: string, reason: string, text: string): void {
    deps.store.appendUndelivered({ at: new Date(now()).toISOString(), to, reason, text })
    deps.log("weixin", `push to ${redact(to)} not delivered: ${reason}`)
  }

  /** One indicator per peer; a message while one is live just rides it. */
  const typing = new Map<string, TypingHandle>()
  function showTyping(to: string, taskId: string): void {
    if (!client || !state || typing.has(to)) return
    const ilink = client
    const contextToken = state.peers[to]?.contextToken ?? null
    let ticket: Promise<string> | null = null
    const handle = startTyping(
      {
        send: async (on) => {
          ticket ??= ilink.typingTicket(to, contextToken)
          const t = await ticket
          if (t) await ilink.sendTyping(to, t, on)
        },
        isRunning: () => deps.ops.taskRunning(taskId),
        sleep,
        now,
        log: (message) => deps.log("weixin", message),
      },
      deps.typingTimings,
    )
    typing.set(to, handle)
    void handle.done.finally(() => {
      if (typing.get(to) === handle) typing.delete(to)
    })
  }

  /** Send `text` as bubbles ({@link sendBubbles}); what fails lands in the undelivered log. */
  async function deliver(to: string, text: string): Promise<boolean> {
    if (!client || !state) return false
    const result = await sendBubbles(client, to, text, state.peers[to]?.contextToken ?? null, sleep)
    if (!result.ok) recordUndelivered(to, result.reason, result.rest)
    return result.ok
  }

  async function handleInbound(message: IlinkMessage): Promise<void> {
    if (!account || !state) return
    const from = message.from_user_id?.trim() ?? ""
    if (!from || from === account.accountId || !isDirectUserMessage(message)) return
    const id = message.message_id === undefined ? "" : String(message.message_id)
    if (id) {
      if (seen.has(id)) return
      seen.add(id)
      if (seen.size > SEEN_CAP) seen.delete(seen.values().next().value ?? "")
    }
    if (!isAllowedSender(account, from)) {
      deps.log("weixin", `dropped a message from unlisted sender ${redact(from)}`)
      saveState({
        ...state,
        rejected: [{ userId: from, at: now() }, ...state.rejected.filter((r) => r.userId !== from)],
      })
      return
    }
    const peer = state.peers[from]
    saveState({
      ...state,
      peers: {
        ...state.peers,
        [from]: { contextToken: message.context_token || peer?.contextToken, lastInboundAt: now() },
      },
    })
    const text = messageText(message)
    const stem = `${new Date(now()).toISOString().slice(0, 10)}-${(id || randomUUID()).replace(/[^\w-]/g, "_")}`
    const media = await saveInboundMedia(message, join(deps.store.dir, "inbox"), stem, deps.fetch ?? fetch)
    for (const miss of media.failed) deps.log("weixin", `${miss.kind} from ${redact(from)} not saved: ${miss.reason}`)
    // The agent opens attachments by path, so they ride the text as `[image: <path>]` lines.
    const body = [text, ...media.saved.map((m) => `[${m.kind}: ${m.path}]`)].filter(Boolean).join("\n")
    const missed = media.failed.map((miss) => `Could not download your ${miss.kind} (${miss.reason}); send it again.`)
    const result = body
      ? await routeInbound(body, deps.ops, agent)
      : {
          reply:
            missed.length > 0 ? "" : "Could not read this message (a voice note without a transcript?). Send /help.",
        }
    const reply = [...missed, result.reply].filter(Boolean).join("\n")
    if (reply) await deliver(from, reply)
    if (result.agentTaskId) showTyping(from, result.agentTaskId)
  }

  async function pollLoop(): Promise<void> {
    let failures = 0
    while (!stopped) {
      if (!refreshAccount() || !client || !state) {
        await pause(ACCOUNT_RECHECK_MS)
        continue
      }
      let resp: UpdatesResponse
      try {
        resp = await client.getUpdates(state.syncBuf, pollTimeoutMs)
      } catch (err) {
        failures++
        deps.log("weixin", `getupdates failed (${failures}): ${err instanceof Error ? err.message : String(err)}`)
        await pause(failures >= MAX_CONSECUTIVE_FAILURES ? BACKOFF_MS : RETRY_MS)
        if (failures >= MAX_CONSECUTIVE_FAILURES) failures = 0
        continue
      }
      const outcome = classifyIlink(resp)
      if (outcome === "session-expired") {
        deps.log("weixin", "binding expired — run `rove weixin login` again; pausing 10m")
        await pause(EXPIRED_PAUSE_MS)
        continue
      }
      if (outcome !== "ok") {
        failures++
        deps.log("weixin", `getupdates refused: ${describeIlink(resp)}`)
        await pause(failures >= MAX_CONSECUTIVE_FAILURES ? BACKOFF_MS : RETRY_MS)
        if (failures >= MAX_CONSECUTIVE_FAILURES) failures = 0
        continue
      }
      failures = 0
      for (const message of resp.msgs ?? []) {
        try {
          await handleInbound(message)
        } catch (err) {
          deps.log("weixin", `inbound failed: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
      // After handling: a crash mid-batch re-reads the batch rather than losing it.
      if (state && resp.get_updates_buf && resp.get_updates_buf !== state.syncBuf)
        saveState({ ...state, syncBuf: resp.get_updates_buf })
    }
  }

  /** A routine's report goes to the WeChat agent, never straight to WeChat. */
  async function handToAgent(text: string): Promise<void> {
    const { agent: live, created } = await agent.current(text)
    if (!created) await deps.ops.send(live.taskId, live.tab, text)
  }

  let notifying = false
  async function notifyTick(): Promise<void> {
    if (notifying || stopped || !account) return
    notifying = true
    try {
      const runs = routineTracker.observe(await deps.ops.notifyingRoutineRuns())
      for (const text of renderRoutineRuns(runs)) await handToAgent(text)
    } catch (err) {
      deps.log("weixin", `routine hand-off failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      notifying = false
    }
  }

  void pollLoop().catch((err) =>
    deps.log("weixin", `poll loop died: ${err instanceof Error ? err.message : String(err)}`),
  )
  const notifyTimer = setInterval(() => void notifyTick(), deps.notifyTickMs ?? DEFAULT_NOTIFY_TICK_MS)
  notifyTimer.unref?.()
  void notifyTick()

  return {
    isBound: () => account !== null,
    stop: () => {
      stopped = true
      for (const handle of typing.values()) handle.stop()
      clearInterval(notifyTimer)
    },
  }
}
