/**
 * The Inbox dialog (TUI `AttentionInboxPane`): ATTENTION = pending episodes
 * from the daemon, RECENT = sessions this browser opened. ↑/↓ or j/k move,
 * Enter or click opens (and acks the episode), `d` acks without opening, `[ ack all ]` acks every one.
 */

import { useEffect, useState } from "react"
import { DialogShell } from "./dialogs.tsx"
import { t, useLocale } from "./i18n/index.ts"
import { type Card, useInbox } from "./inbox-data.ts"
import { dismissEpisode } from "./inbox-open.ts"
import { InboxPeek } from "./inbox-peek.tsx"
import { InboxSheet } from "./inbox-sheet.tsx"
import { compactAge, inboxBadge } from "./inbox.ts"
import { useNarrow } from "./layout.ts"
import type { AppModel } from "./model.ts"
import { Button } from "./ui/button.tsx"
import { Legend } from "./ui/legend.tsx"
import {
  DIALOG_BODY,
  INBOX_AGE,
  INBOX_BADGE,
  INBOX_CARD,
  INBOX_CARDS,
  INBOX_CARD_MAIN,
  INBOX_HINTS,
  INBOX_HINTS_ROW,
  INBOX_KICKER,
  INBOX_LINE,
  INBOX_PEEK_TOGGLE,
  INBOX_SUB,
} from "./ui/overlay.ts"
import { ROW_TITLE, rowClass } from "./ui/row.ts"
import { KICKER } from "./ui/text.ts"
import { TONE_CLASS } from "./ui/tone.ts"

/** A phone gets its own sheet (inbox-sheet.tsx); the rows and what they do are shared (inbox-data.ts). */
export function InboxDialog({ model }: { model: AppModel }) {
  return useNarrow() ? <InboxSheet model={model} /> : <InboxDesk model={model} />
}

function InboxDesk({ model }: { model: AppModel }) {
  useLocale()
  const { attention, recent, cards, now, open, ackAll, peekOf } = useInbox(model)
  const [index, setIndex] = useState(0)
  const [peeked, setPeeked] = useState<string | null>(null)
  const current = cards[Math.min(index, cards.length - 1)]

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A reply field takes its own keys: typing j or d there moves or clears nothing.
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea")) return
      if (e.key === "ArrowDown" || e.key === "j") setIndex((i) => Math.min(cards.length - 1, i + 1))
      else if (e.key === "ArrowUp" || e.key === "k") setIndex((i) => Math.max(0, i - 1))
      else if (e.key === "Enter" && current) open(current)
      else if (e.key === "d" && current?.attention) void dismissEpisode(model, current.attention, true)
      else if (e.key === "D") ackAll()
      else return
      e.preventDefault()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  const renderCard = (card: Card) => {
    const badge = card.attention ? inboxBadge(card.attention.state) : null
    const active = card === current
    const peek = peekOf(card)
    const peeking = !!peek && peeked === peek.id
    return (
      <li key={card.key}>
        <div className={INBOX_CARD}>
          <button
            type="button"
            className={`${rowClass({ selected: active, stack: true })} ${INBOX_CARD_MAIN}`}
            onMouseEnter={() => setIndex(cards.indexOf(card))}
            onClick={() => open(card)}
          >
            <span className={INBOX_LINE}>
              <span className={ROW_TITLE}>{card.identity}</span>
              {badge && (
                <span className={`${INBOX_BADGE} ${TONE_CLASS[badge.tone]}`}>
                  {badge.glyph} {t(badge.stateKey)}
                </span>
              )}
              <span className={INBOX_AGE}>{compactAge(now - card.at)}</span>
            </span>
            {card.subtitle && <span className={INBOX_SUB}>{card.subtitle}</span>}
          </button>
          {peek ? (
            <Button
              className={INBOX_PEEK_TOGGLE}
              aria-expanded={peeking}
              onClick={() => {
                setIndex(cards.indexOf(card))
                setPeeked(peeking ? null : peek.id)
              }}
            >
              {peeking ? t("inbox.hide") : t("inbox.reply")}
            </Button>
          ) : (
            // Holds the reply column so every row's badge and age share one right edge.
            <span aria-hidden className={INBOX_PEEK_TOGGLE} />
          )}
        </div>
        {peeking && card.taskId && (
          <InboxPeek
            model={model}
            taskId={card.taskId}
            tabId={peek.tabId}
            mode={peek.mode}
            gate={peek.gate}
            onOpenTab={() => open(card)}
          />
        )}
      </li>
    )
  }

  return (
    <DialogShell title={t("inbox.title")} wide>
      <div className={DIALOG_BODY}>
        <div className={INBOX_HINTS_ROW}>
          <p className={`${KICKER} text-muted ${INBOX_HINTS} touch:hidden!`}>
            <Legend text={t("inbox.hints")} />
          </p>
          {attention.length > 0 && (
            <Button className={INBOX_PEEK_TOGGLE} onClick={ackAll}>
              {t("inbox.ackAll")}
            </Button>
          )}
        </div>
        <h2 className={`${KICKER} text-muted ${INBOX_KICKER}`}>{t("inbox.attention")}</h2>
        {attention.length === 0 ? (
          <p className="mono text-muted">{t("inbox.empty")}</p>
        ) : (
          <ul className={INBOX_CARDS}>{attention.map(renderCard)}</ul>
        )}
        {recent.length > 0 && (
          <>
            <h2 className={`${KICKER} text-muted ${INBOX_KICKER}`}>{t("inbox.recent")}</h2>
            <ul className={INBOX_CARDS}>{recent.map(renderCard)}</ul>
          </>
        )}
      </div>
    </DialogShell>
  )
}
