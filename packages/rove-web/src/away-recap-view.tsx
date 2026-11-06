/** The one-line "since 01:20 · 3 finished · 1 needs you" strip at the top of the rail (see `away-recap.ts`). */

import type { MouseEvent } from "react"
import { useEffect } from "react"
import type { TaskRow } from "rove-bridge/protocol"
import { type Recap, recap, watchAway } from "./away-recap.ts"
import { t, useLocale } from "./i18n/index.ts"
import { InboxDialog } from "./inbox-view.tsx"
import type { AppModel } from "./model.ts"
import { useStore } from "./store.ts"
import { dialog, menu } from "./ui.ts"
import { Button } from "./ui/button.tsx"
import { AWAY_RECAP } from "./ui/rail.ts"

const clock = (at: number): string => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })

/** A count opens the tasks it counts: what needs you opens the Inbox, the others a list to pick one from. */
function openTasks(model: AppModel, e: MouseEvent<HTMLElement>, rows: readonly TaskRow[]): void {
  const box = e.currentTarget.getBoundingClientRect()
  menu.set({
    x: box.left,
    y: box.bottom,
    target: e.currentTarget,
    items: rows.map((row) => ({ label: row.label, run: () => model.select(row.id) })),
  })
}

export function AwayRecap({ model }: { model: AppModel }) {
  useLocale()
  // Record each look and compute the recap; this strip mounts once, in the rail.
  useEffect(
    () =>
      watchAway(
        () => model.tasks.get(),
        (fn) => model.tasks.subscribe(fn),
      ),
    [model],
  )
  const found: Recap | null = useStore(recap)
  if (!found) return null
  const parts = [
    {
      key: "finished",
      rows: found.finished,
      open: (e: MouseEvent<HTMLElement>) => openTasks(model, e, found.finished),
    },
    { key: "needs", rows: found.needs, open: () => dialog.set(<InboxDialog model={model} />) },
    { key: "failed", rows: found.failed, open: (e: MouseEvent<HTMLElement>) => openTasks(model, e, found.failed) },
    { key: "merged", rows: found.merged, open: (e: MouseEvent<HTMLElement>) => openTasks(model, e, found.merged) },
  ] as const
  return (
    <div className={AWAY_RECAP}>
      <span className="text-muted">{t("rail.recap.since", { time: clock(found.since) })} ·</span>
      {parts
        .filter((part) => part.rows.length > 0)
        .map((part, i, shown) => (
          <span key={part.key} className="inline-flex gap-2.5">
            <Button hit="tight" onClick={part.open}>
              {t(`rail.recap.${part.key}`, { count: part.rows.length })}
            </Button>
            {i < shown.length - 1 && <span className="text-muted">·</span>}
          </span>
        ))}
      <Button
        hit="tight"
        className="ml-auto"
        aria-label={t("rail.recap.dismiss")}
        title={t("rail.recap.dismiss")}
        onClick={() => recap.set(null)}
      >
        ×
      </Button>
    </div>
  )
}
