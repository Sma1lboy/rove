/** @jsxImportSource @opentui/react */
/**
 * Per-ChatTab completion notifications: sound, toast, unread mark. Pure
 * transforms and the "error toasts always show" invariant live in
 * `src/tui/lib/notify-state.ts`. Toggles come from KV, else (render tests,
 * mock host) a one-time `state.json` snapshot.
 */

import { useRenderer } from "@opentui/react"
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { loadStateFile } from "../../state/store"
import {
  type NotificationKind,
  type NotifyInput,
  TOAST_DURATION_MS,
  type Toast,
  addUnread,
  osc9,
  removeUnread,
  shouldShowToast,
} from "../../tui/lib/notify-state"
import { writeThroughRenderer } from "../../tui/lib/screen-refresh"
import { pulse as pulseSound } from "../../tui/lib/sound"
import { useOptionalKV } from "./kv"

export type { NotificationKind, Toast, NotifyInput } from "../../tui/lib/notify-state"

export interface NotificationsContext {
  readonly toasts: readonly Toast[]
  readonly unread: ReadonlyMap<string, NotificationKind>
  notify(input: NotifyInput): void
  dismiss(id: number): void
  markRead(taskId: string, tabId: string): void
}

const ctx = createContext<NotificationsContext | null>(null)

export function NotificationsProvider(props: { children?: ReactNode }) {
  const [toasts, setToasts] = useState<readonly Toast[]>([])
  const [unread, setUnread] = useState<ReadonlyMap<string, NotificationKind>>(new Map())
  const kv = useOptionalKV()
  const renderer = useRenderer()
  const snapshot = useMemo(() => loadStateFile(), [])
  const prefs = useMemo(
    () => ({
      "notifications.sound.enabled":
        (kv?.get("notifications.sound.enabled") as boolean | undefined) ?? snapshot["notifications.sound.enabled"],
      "notifications.toast.enabled":
        (kv?.get("notifications.toast.enabled") as boolean | undefined) ?? snapshot["notifications.toast.enabled"],
    }),
    [kv, snapshot],
  )
  const counter = useRef(0)

  // Cleared on unmount so `dismiss()` never fires against a torn-down tree.
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  useEffect(
    () => () => {
      for (const id of timers.current) clearTimeout(id)
      timers.current.clear()
    },
    [],
  )

  const dismiss = useCallback((id: number): void => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const notify = useCallback(
    (input: NotifyInput): void => {
      // The unread dot is passive, so neither toggle gates it.
      setUnread((prev) => addUnread(prev, input))

      // One toggle for BEL + chime + OSC 9. OSC 9 matters over SSH: it rides
      // the stream to the LOCAL terminal (iTerm2/kitty/WezTerm/Ghostty raise
      // an OS notification; others ignore it), unlike `afplay`, which rings
      // on the remote box.
      if ((prefs["notifications.sound.enabled"] as boolean | undefined) !== false) {
        // Through the renderer: its native thread owns fd 1 while `useThread`
        // is on (all but Linux), so a bare write could split a frame's escapes.
        writeThroughRenderer(renderer, `\x07${osc9(`Rove — ${input.title}`)}`)
        pulseSound()
      }

      // Independent of sound; `error` always shows.
      const toastEnabled = (prefs["notifications.toast.enabled"] as boolean | undefined) !== false
      if (shouldShowToast(input.kind, toastEnabled)) {
        const id = ++counter.current
        setToasts((prev) => [...prev, { id, ...input }])
        const timer = setTimeout(() => {
          timers.current.delete(timer)
          dismiss(id)
        }, TOAST_DURATION_MS)
        timers.current.add(timer)
      }
    },
    [prefs, dismiss, renderer],
  )

  const markRead = useCallback((taskId: string, tabId: string): void => {
    setUnread((prev) => removeUnread(prev, taskId, tabId))
  }, [])

  const value = useMemo<NotificationsContext>(
    () => ({ toasts, unread, notify, dismiss, markRead }),
    [toasts, unread, notify, dismiss, markRead],
  )

  return <ctx.Provider value={value}>{props.children}</ctx.Provider>
}

export function useNotifications(): NotificationsContext {
  const value = useContext(ctx)
  if (!value) throw new Error("useNotifications must be used within a NotificationsProvider")
  return value
}

/** Null instead of throwing, for panes that also mount in render tests and mock hosts. */
export function useOptionalNotifications(): NotificationsContext | null {
  return useContext(ctx)
}
