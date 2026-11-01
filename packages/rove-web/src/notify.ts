/**
 * Cross-task attention, as the TUI's `use-attention.ts`: a task that is not open crosses into
 * an attention state (needs an answer, errored, finished a turn) and the page toasts, chimes
 * and, when the tab is in the background, raises a desktop notification. The rules are the
 * TUI's own (`notify-state.ts`): errors always toast, the chime follows the sound switch,
 * the whole thing follows the cross-task switch. The bridge reports one activity per task, so
 * this diffs the task rollup (the TUI does the same for sessions with no tab identity).
 */

import pulseUrl from "@sma1lboy/rove/src/tui/asset/pulse.wav?url"
import {
  type NotificationKind,
  attentionEdges,
  attentionKindFor,
  shouldPlaySound,
  shouldShowToast,
} from "@sma1lboy/rove/src/tui/lib/notify-state.ts"
import { useEffect, useRef } from "react"
import type { TasksPayload } from "rove-bridge/protocol"
import type { AppModel } from "./model.ts"
import { prefsStore } from "./prefs.ts"
import { toast } from "./ui.ts"
import { showTaskNotice } from "./web-push.ts"

const GLYPH: Record<NotificationKind, string> = { done: "✓", needs_input: "?", error: "✕" }

export function chime(volume: number): void {
  const audio = new Audio(pulseUrl)
  audio.volume = Math.min(1, Math.max(0, volume))
  // Autoplay can refuse before the first click on the page; the toast still shows.
  void audio.play().catch(() => undefined)
}

function desktopNotice(taskId: string, kind: NotificationKind, title: string): void {
  if (!document.hidden || typeof Notification === "undefined" || Notification.permission !== "granted") return
  void showTaskNotice(taskId, kind, title, GLYPH[kind]).catch(() => undefined)
}

/** Ask once, from a click: browsers refuse the prompt outside a user gesture. */
export function allowDesktopNotices(): void {
  if (typeof Notification !== "undefined" && Notification.permission === "default") {
    void Notification.requestPermission()
  }
}

function states(payload: TasksPayload): Map<string, string> {
  const out = new Map<string, string>()
  for (const task of payload.tasks) if (task.activity) out.set(task.id, task.activity.state)
  return out
}

export function useCrossTaskNotices(model: AppModel): void {
  // Seeded by the first payload so what was already waiting does not toast on load.
  const previous = useRef<Map<string, string> | null>(null)
  useEffect(() => {
    const check = () => {
      const payload = model.tasks.get()
      if (!payload) return
      const next = states(payload)
      const edges = attentionEdges(previous.current, next, null, attentionKindFor)
      previous.current = next
      const { prefs } = prefsStore.get()
      if (!prefs.crossTask) return
      const open = model.selection.get().taskId
      const titles = new Map(payload.tasks.map((task) => [task.id, task.title]))
      for (const { key, kind } of edges) {
        if (key === open) continue
        const title = titles.get(key) ?? key
        if (shouldShowToast(kind, prefs.toast)) toast(`${GLYPH[kind]} ${title}`, kind === "error" ? "error" : "info")
        if (shouldPlaySound({}, prefs.sound)) {
          chime(prefs.soundVolume)
          desktopNotice(key, kind, title)
        }
      }
    }
    check()
    return model.tasks.subscribe(check)
  }, [model])
}
