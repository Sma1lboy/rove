/** @jsxImportSource @opentui/react */
/**
 * The B-layer deferral toast (issue #78): a `prompt_deferred` inbox episode is
 * inbox-ONLY (no engine activity), so `useAttention` diffs the inbox episodes
 * themselves and toasts on a fresh one. Render-track proof that the wiring
 * fires — the toast is the user-visible half of accept-and-defer.
 */

import { expect, test } from "bun:test"
import { useEffect, useState } from "react"
import type { AttentionInboxItem } from "../../src/client/remote-orchestrator"
import type { KVContext } from "../../src/tui-react/context/kv"
import type { NotificationsContext } from "../../src/tui-react/context/notifications"
import { useAttention } from "../../src/tui-react/workspace/use-attention"
import type { NotifyInput } from "../../src/tui/lib/notify-state"
import { act, renderComponent } from "./harness"

function stubKv(): KVContext {
  const store: Record<string, unknown> = {}
  return {
    ready: true,
    store,
    signal: <T,>(name: string, defaultValue: T) => {
      const read = () => (store[name] ?? defaultValue) as T
      const write = (next: T) => {
        store[name] = next
      }
      return [read, write] as const
    },
    get: (key: string, defaultValue?: unknown) => store[key] ?? defaultValue,
    set: (key: string, value: unknown) => {
      store[key] = value
    },
    flush: () => true,
    clear: () => void 0,
  }
}

function deferredItem(at: number): AttentionInboxItem {
  return {
    taskId: "task-1",
    tabId: "tab-1",
    state: "prompt_deferred",
    unread: true,
    at,
    detail: { deferredPrompt: { id: "d1", layer: "composer-not-empty" } },
  }
}

function notifSpy(): { notif: NotificationsContext; calls: NotifyInput[] } {
  const calls: NotifyInput[] = []
  const notif = {
    toasts: [],
    unread: new Map(),
    notify: (input: NotifyInput) => {
      calls.push(input)
    },
    dismiss: () => {},
    markRead: () => {},
  }
  return { notif: notif as unknown as NotificationsContext, calls }
}

// The probe mounts useAttention and exposes an imperative handle to push a new
// episode into its inboxItems, so the test can drive the rising edge the way a
// live daemon push would.
let pushEpisode: (at: number) => void = () => {}

function AttentionProbe(props: { notif: NotificationsContext }) {
  const [items, setItems] = useState<AttentionInboxItem[]>([])
  useEffect(() => {
    pushEpisode = (at: number) => setItems((prev) => [...prev, deferredItem(at)])
  }, [])
  useAttention({
    tasks: [],
    engineState: new Map(),
    inboxItems: items,
    selectedId: null,
    kv: stubKv(),
    notif: props.notif,
    openAttention: () => {},
    noTasksMessage: "none",
  })
  return null
}

test("a fresh prompt_deferred episode toasts once, and a re-push of the same episode does not", async () => {
  const { notif, calls } = notifSpy()
  await renderComponent(<AttentionProbe notif={notif} />, { width: 80, height: 24 })
  // Seed ran at mount (prev===null) — no toast yet.
  expect(calls).toHaveLength(0)

  await act(async () => {
    pushEpisode(1000)
  })
  await act(async () => {})
  const toastCount = calls.filter((c) => c.kind === "needs_input").length
  expect(toastCount).toBe(1)
  expect(calls[0]?.taskId).toBe("task-1")
  expect(calls[0]?.tabId).toBe("tab-1")
})
