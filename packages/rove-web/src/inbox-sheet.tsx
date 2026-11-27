/**
 * The Inbox on a phone: a sheet from the bottom bar, one session per two-line row. A tap opens the session (and acks
 * it), a swipe left acks it, a long press opens its menu (reply here, open, ack). Ack all sits at the sheet's foot.
 */

import { useState } from "react"
import { t, useLocale } from "./i18n/index.ts"
import { type Card, useInbox } from "./inbox-data.ts"
import { InboxPeek } from "./inbox-peek.tsx"
import { compactAge, inboxBadge } from "./inbox.ts"
import type { AppModel } from "./model.ts"
import { type MenuItem, closeDialog, menu } from "./ui.ts"
import { PhoneGroup, PhoneListRow } from "./ui/phone.tsx"
import { SHEET_LIST, Sheet, SheetRow } from "./ui/sheet.tsx"
import { SwipeRow } from "./ui/swipe-row.tsx"
import { TONE_CLASS } from "./ui/tone.ts"

export function InboxSheet({ model }: { model: AppModel }) {
  useLocale()
  const { attention, recent, now, open, ack, ackAll, peekOf } = useInbox(model)
  const [peeked, setPeeked] = useState<string | null>(null)
  // What waits on the owner leads, ahead of errors and done (a stable sort keeps the shared order inside each).
  const needsYou = (card: Card) => (card.attention && inboxBadge(card.attention.state).glyph === "?" ? 0 : 1)
  const waiting = [...attention].sort((a, b) => needsYou(a) - needsYou(b))

  const row = (card: Card) => {
    const badge = card.attention ? inboxBadge(card.attention.state) : null
    const peek = peekOf(card)
    const items: MenuItem[] = [
      ...(peek ? [{ label: t("inbox.phone.reply"), run: () => setPeeked(peek.id) }] : []),
      { label: t("inbox.phone.open"), run: () => open(card) },
      ...(card.attention ? [{ label: t("inbox.phone.ack"), run: () => ack(card) }] : []),
    ]
    const body = (
      <PhoneListRow
        title={card.identity}
        subtitle={card.subtitle}
        onClick={() => open(card)}
        onContextMenu={(e) => {
          e.preventDefault()
          menu.set({ x: e.clientX, y: e.clientY, target: e.currentTarget, items })
        }}
        trailing={
          <>
            {badge && (
              // Done is history, not a call to act: it stays quiet.
              <span
                className={`flex-none font-sans text-meta ${badge.tone === "success" ? "text-subtle" : TONE_CLASS[badge.tone]}`}
              >
                {badge.glyph} {t(badge.stateKey)}
              </span>
            )}
            <span className="flex-none font-sans text-meta text-subtle">{compactAge(now - card.at)}</span>
          </>
        }
      />
    )
    return (
      <div key={card.key}>
        {card.attention ? (
          <SwipeRow left={{ label: t("inbox.phone.ack"), tone: "accent", run: () => ack(card) }}>{body}</SwipeRow>
        ) : (
          body
        )}
        {peek && peeked === peek.id && card.taskId && (
          <InboxPeek
            model={model}
            taskId={card.taskId}
            tabId={peek.tabId}
            mode={peek.mode}
            gate={peek.gate}
            onOpenTab={() => open(card)}
          />
        )}
      </div>
    )
  }

  return (
    <Sheet label={t("inbox.phone.title")} title={t("inbox.phone.title")} onClose={closeDialog}>
      {() => (
        <>
          <div className={`${SHEET_LIST} gap-4`}>
            {attention.length === 0 && recent.length === 0 && (
              <p className="m-0 px-2 py-3 font-sans text-body text-muted">{t("inbox.phone.empty")}</p>
            )}
            {attention.length > 0 && <PhoneGroup label={t("inbox.attention")}>{waiting.map(row)}</PhoneGroup>}
            {recent.length > 0 && <PhoneGroup label={t("inbox.recent")}>{recent.map(row)}</PhoneGroup>}
          </div>
          {attention.length > 0 && (
            <div className="flex-none px-3 pt-1">
              <SheetRow tone="action" onClick={ackAll}>
                {t("inbox.phone.ackAll")}
              </SheetRow>
            </div>
          )}
        </>
      )}
    </Sheet>
  )
}
