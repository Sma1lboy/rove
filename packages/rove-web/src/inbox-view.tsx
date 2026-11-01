/**
 * The Inbox dialog (TUI `AttentionInboxPane`): ATTENTION = pending episodes
 * from the daemon, RECENT = sessions this browser opened. ↑/↓ or j/k move,
 * Enter or click opens (and clears the episode), `d` clears without opening.
 */

import { useEffect, useState } from "react"
import type { AttentionRow, TaskRow } from "rove-bridge/protocol"
import { DialogShell } from "./dialogs.tsx"
import { t, useLocale } from "./i18n/index.ts"
import { dismissRoutineEpisode, openRoutineEpisode } from "./inbox-open.ts"
import { compactAge, inboxBadge, isRoutineState, sortAttention } from "./inbox.ts"
import type { AppModel, Visit } from "./model.ts"
import { useStore } from "./store.ts"
import { closeDialog, toast } from "./ui.ts"
import { Legend } from "./ui/legend.tsx"

interface Card {
  readonly key: string
  readonly section: "attention" | "recent"
  readonly taskId: string | null
  readonly tabId: string | null
  readonly identity: string
  readonly subtitle: string
  readonly at: number
  readonly attention?: AttentionRow
}

const RECENT_MAX = 6

function identityOf(task: TaskRow | undefined, fallback: string): string {
  if (!task) return fallback
  const project = task.repo.split("/").filter(Boolean).pop() ?? task.repo
  return `${project} › ${task.title}`
}

export function InboxDialog({ model }: { model: AppModel }) {
  useLocale()
  const payload = useStore(model.tasks)
  const visits = useStore(model.visits)
  const tabs = useStore(model.tabs)
  const [index, setIndex] = useState(0)
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
  const current = cards[Math.min(index, cards.length - 1)]

  const dismiss = async (card: Card) => {
    if (card.attention && isRoutineState(card.attention.state)) return dismissRoutineEpisode(model, card.attention)
    if (!card.attention?.taskId) return
    await model.client
      .request("attention.dismiss", { taskId: card.attention.taskId, ...(card.tabId ? { tabId: card.tabId } : {}) })
      .catch((err) => toast(String(err), "error"))
  }
  const open = (card: Card) => {
    if (card.attention && isRoutineState(card.attention.state)) return openRoutineEpisode(model, card.attention)
    if (card.attention) void dismiss(card)
    if (card.taskId && tasks.has(card.taskId)) {
      model.select(card.taskId, card.tabId)
      closeDialog()
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown" || e.key === "j") setIndex((i) => Math.min(cards.length - 1, i + 1))
      else if (e.key === "ArrowUp" || e.key === "k") setIndex((i) => Math.max(0, i - 1))
      else if (e.key === "Enter" && current) open(current)
      else if (e.key === "d" && current?.attention) void dismiss(current)
      else return
      e.preventDefault()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  const renderCard = (card: Card) => {
    const badge = card.attention ? inboxBadge(card.attention.state) : null
    const active = card === current
    return (
      <li key={card.key}>
        <button
          type="button"
          className={`inbox-card row ${active ? "is-selected" : ""}`}
          onMouseEnter={() => setIndex(cards.indexOf(card))}
          onClick={() => open(card)}
        >
          <span className="inbox-line">
            <span className="row-title">{card.identity}</span>
            {badge && (
              <span className={`inbox-badge tone-${badge.tone}`}>
                {badge.glyph} {t(badge.stateKey)}
              </span>
            )}
            <span className="inbox-age">{compactAge(now - card.at)}</span>
          </span>
          {card.subtitle && <span className="inbox-sub">{card.subtitle}</span>}
        </button>
      </li>
    )
  }

  return (
    <DialogShell title={t("inbox.title")} wide>
      <div className="dialog-body inbox">
        <p className="kicker inbox-hints">
          <Legend text={t("inbox.hints")} />
        </p>
        <h2 className="kicker">{t("inbox.attention")}</h2>
        {attention.length === 0 ? (
          <p className="muted mono">{t("inbox.empty")}</p>
        ) : (
          <ul className="cards">{attention.map(renderCard)}</ul>
        )}
        {recent.length > 0 && (
          <>
            <h2 className="kicker">{t("inbox.recent")}</h2>
            <ul className="cards">{recent.map(renderCard)}</ul>
          </>
        )}
      </div>
    </DialogShell>
  )
}
