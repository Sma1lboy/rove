/** The Inbox's rows and what they do, shared by the desktop dialog and the phone's sheet. */

import { useEffect, useState } from "react"
import type { AttentionRow, GateRow, TaskRow } from "rove-bridge/protocol"
import { dismissEpisode, openRoutineEpisode } from "./inbox-open.ts"
import type { PeekMode } from "./inbox-peek.tsx"
import { isRoutineState, sortAttention } from "./inbox.ts"
import type { AppModel, Visit } from "./model.ts"
import { repoLabel } from "./rail-labels.ts"
import { useStore } from "./store.ts"
import { closeDialog } from "./ui.ts"

export interface Card {
  readonly key: string
  readonly section: "attention" | "recent"
  readonly taskId: string | null
  readonly tabId: string | null
  readonly identity: string
  readonly subtitle: string
  readonly at: number
  readonly attention?: AttentionRow
}

/** How a card answers inline: absent when it can't (another machine, a routine, nothing to read). */
export interface Peek {
  readonly id: string
  readonly tabId: string | null
  readonly mode: PeekMode
  readonly gate?: GateRow
}

const RECENT_MAX = 6

function identityOf(task: TaskRow | undefined, fallback: string): string {
  if (!task) return fallback
  const project = repoLabel(task.repo)
  return `${project} › ${task.label}`
}

export function useInbox(model: AppModel) {
  const payload = useStore(model.tasks)
  const visits = useStore(model.visits)
  const tabs = useStore(model.tabs)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const tasks = new Map((payload?.tasks ?? []).map((task) => [task.id, task]))
  const tabTitle = (taskId: string | null, tabId: string | null) =>
    (taskId && tabId && tabs[taskId]?.find((tab) => tab.id === tabId)?.title) || ""
  const attention: Card[] = sortAttention(payload?.attention ?? [], payload?.tasks.map((task) => task.id) ?? []).map(
    (row, i) => {
      const task = row.taskId ? tasks.get(row.taskId) : undefined
      return {
        key: `a${i}:${row.taskId}:${row.tabId}`,
        section: "attention",
        taskId: row.taskId,
        tabId: row.tabId,
        identity: identityOf(task, row.label ?? row.taskId ?? ""),
        subtitle: tabTitle(row.taskId, row.tabId) || task?.branch || "",
        at: row.at,
        attention: row,
      }
    },
  )
  const pending = new Set(attention.map((c) => `${c.taskId}:${c.tabId}`))
  const recent: Card[] = visits
    .filter((v: Visit) => tasks.has(v.taskId) && !pending.has(`${v.taskId}:${v.tabId}`))
    .slice(0, RECENT_MAX)
    .map((v) => ({
      key: `r:${v.taskId}:${v.tabId}`,
      section: "recent",
      taskId: v.taskId,
      tabId: v.tabId,
      identity: identityOf(tasks.get(v.taskId), v.taskId),
      subtitle: tabTitle(v.taskId, v.tabId) || tasks.get(v.taskId)?.branch || "",
      at: v.at,
    }))
  const cards = [...attention, ...recent]

  const open = (card: Card) => {
    if (card.attention && isRoutineState(card.attention.state)) return openRoutineEpisode(model, card.attention)
    if (card.attention) void dismissEpisode(model, card.attention)
    if (card.taskId && tasks.has(card.taskId)) {
      model.select(card.taskId, card.tabId)
      closeDialog()
    }
  }
  const ackAll = () =>
    void Promise.all(attention.map((card) => card.attention && dismissEpisode(model, card.attention, true)))

  const ack = (card: Card) => card.attention && void dismissEpisode(model, card.attention, true)
  const peekOf = (card: Card): Peek | null => {
    const row = card.attention
    const task = card.taskId ? tasks.get(card.taskId) : undefined
    // Another machine's rows are read-only here, as in the terminal composer.
    const gate = row?.gateId ? payload?.gates?.find((g) => g.id === row.gateId && g.status === "open") : undefined
    const tabId = card.tabId ?? gate?.tabId ?? null
    const peekable =
      !!row && !!task && !task.machine && !isRoutineState(row.state) && (!row.gateId || !!gate) && (!!tabId || !!gate)
    if (!peekable) return null
    const atMenu = row?.state === "permission_needed" || (!!tabId && task?.tabStatus?.[tabId]?.kind === "needs-input")
    const mode: PeekMode = gate ? "gate" : row?.state === "dead" ? "readonly" : atMenu ? "menu" : "reply"
    return { id: `${card.taskId}:${card.tabId}:${row?.gateId ?? ""}`, tabId, mode, gate }
  }
  return { attention, recent, cards, now, open, ack, ackAll, peekOf }
}
