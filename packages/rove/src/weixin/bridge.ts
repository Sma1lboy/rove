/**
 * The daemon-side WeChat channel: long-polls iLink for messages from allowed
 * senders, answers them through {@link handleCommand}, and pushes task-group
 * arrivals (needs you / ready for review / ready to merge).
 *
 * The binding is re-read from disk every cycle, so `rove weixin login` /
 * `logout` take effect without a daemon restart. Pushes respect the reply
 * window: a peer that has not written in {@link REPLY_WINDOW_MS} is not
 * messaged; the push goes to `undelivered.jsonl` and the daemon log instead.
 */

import { setTimeout as delay } from "node:timers/promises"
import { type RoveOps, handleCommand } from "./commands.ts"
import { toBubbles } from "./format.ts"
import {
  type FetchFn,
  ILINK_BASE_URL,
  IlinkClient,
  type IlinkMessage,
  type IlinkStatus,
  LONG_POLL_TIMEOUT_MS,
  type UpdatesResponse,
  classifyIlink,
  describeIlink,
  isGroupMessage,
  messageText,
} from "./ilink.ts"
import { GroupTracker, renderArrivals } from "./notify.ts"
import { type WeixinAccount, type WeixinRuntimeState, type WeixinStore, isAllowedSender } from "./store.ts"

/** Bot-initiated messages are only accepted within a day of the peer's last message. */
export const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000
const ACCOUNT_RECHECK_MS = 5_000
const RETRY_MS = 2_000
const BACKOFF_MS = 30_000
const MAX_CONSECUTIVE_FAILURES = 3
const EXPIRED_PAUSE_MS = 10 * 60 * 1000
const BUBBLE_GAP_MS = 300
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
  const tracker = new GroupTracker()

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
      if (account) {
        deps.log("weixin", "unbound — stopped polling")
        account = null
        deps.onUnbound?.()
      }
      account = null
      client = null
      state = null
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

  /**
   * Send `text` as bubbles. A stale context token gets one tokenless retry
   * (iLink's degraded path), a rate limit one delayed retry; anything else
   * lands in the undelivered log. Returns whether every bubble went out.
   */
  async function deliver(to: string, text: string): Promise<boolean> {
    if (!client || !state) return false
    const bubbles = toBubbles(text)
    for (let i = 0; i < bubbles.length; i++) {
      const bubble = bubbles[i] ?? ""
      let token: string | null = state.peers[to]?.contextToken ?? null
      let retried = false
      for (;;) {
        let resp: IlinkStatus
        try {
          resp = await client.sendText(to, bubble, token)
        } catch (err) {
          recordUndelivered(
            to,
            `network: ${err instanceof Error ? err.message : String(err)}`,
            bubbles.slice(i).join("\n"),
          )
          return false
        }
        const outcome = classifyIlink(resp)
        if (outcome === "ok") break
        if (!retried && outcome === "session-expired" && token) {
          retried = true
          token = null
          continue
        }
        if (!retried && outcome === "rate-limited") {
          retried = true
          await sleep(RETRY_MS)
          continue
        }
        const hint = outcome === "session-expired" ? " — they need to message the bot first" : ""
        recordUndelivered(to, `iLink refused: ${describeIlink(resp)}${hint}`, bubbles.slice(i).join("\n"))
        return false
      }
      if (i < bubbles.length - 1) await sleep(BUBBLE_GAP_MS)
    }
    return true
  }

  async function handleInbound(message: IlinkMessage): Promise<void> {
    if (!account || !state) return
    const from = message.from_user_id?.trim() ?? ""
    if (!from || from === account.accountId || isGroupMessage(message)) return
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
    const reply = text ? await handleCommand(text, deps.ops) : "Text messages only. Send help for commands."
    await deliver(from, reply)
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

  /** Recipients with an open reply window; the rest are logged as undelivered. */
  async function push(text: string): Promise<void> {
    if (!account || !state) return
    const targets = [...new Set([account.ownerUserId, ...account.allow].filter(Boolean))]
    for (const to of targets) {
      const last = state.peers[to]?.lastInboundAt
      if (last === undefined || now() - last > REPLY_WINDOW_MS) {
        recordUndelivered(
          to,
          last === undefined ? "no message from this user yet" : "reply window closed (>24h since their last message)",
          text,
        )
        continue
      }
      await deliver(to, text)
    }
  }

  let notifying = false
  async function notifyTick(): Promise<void> {
    if (notifying || stopped || !account) return
    notifying = true
    try {
      const arrivals = tracker.observe((await deps.ops.status(null)).tasks)
      if (arrivals.length > 0) await push(renderArrivals(arrivals))
    } catch (err) {
      deps.log("weixin", `notify tick failed: ${err instanceof Error ? err.message : String(err)}`)
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
      clearInterval(notifyTimer)
    },
  }
}
