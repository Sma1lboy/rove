/**
 * The side panel's Usage tab: one card per meter `quota.list` returns (this conversation's context,
 * each engine's quota windows, E2B's estimated spend). Card title folds it; the bar is segmented by
 * the parts that carry a share, the legend lists every part.
 */

import { useEffect, useState } from "react"
import type { TaskRow } from "rove-bridge/protocol"
import { t, useLocale } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { errorMessage } from "./pages-kit.ts"
import { type QuotaMeter, type QuotaReply, percentText, segmentsOf, swatchOf } from "./quota-data.ts"
import { useStore } from "./store.ts"
import { Button } from "./ui/button.tsx"
import * as s from "./ui/quota.ts"

const POLL_MS = 15_000
const FOLDED_KEY = "rove.quota.folded"

type Load = { kind: "loading" } | { kind: "ready"; reply: QuotaReply } | { kind: "failed"; error: string }

function readFolded(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(FOLDED_KEY) ?? "[]")
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [])
  } catch {
    return new Set()
  }
}

export function QuotaView({ model, task, active }: { model: AppModel; task: TaskRow; active: boolean }) {
  useLocale()
  const conn = useStore(model.client.conn)
  const selection = useStore(model.selection)
  const tabId = selection.taskId === task.id ? selection.tabId : null
  const [load, setLoad] = useState<Load>({ kind: "loading" })
  const [folded, setFolded] = useState(readFolded)

  useEffect(() => {
    if (!active || conn.state !== "open") return
    let live = true
    const read = () =>
      model.client
        .request<QuotaReply>("quota.list", tabId ? { taskId: task.id, tabId } : {})
        .then((reply) => live && setLoad({ kind: "ready", reply }))
        .catch(
          (err) =>
            live && setLoad((prev) => (prev.kind === "ready" ? prev : { kind: "failed", error: errorMessage(err) })),
        )
    void read()
    const timer = window.setInterval(read, POLL_MS)
    return () => {
      live = false
      window.clearInterval(timer)
    }
  }, [model, active, conn.state, task.id, tabId])

  const toggle = (id: string) => {
    const next = new Set(folded)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setFolded(next)
    localStorage.setItem(FOLDED_KEY, JSON.stringify([...next]))
  }

  if (load.kind === "loading") return <p className={s.QUOTA_EMPTY}>{t("quota.loading")}</p>
  if (load.kind === "failed") return <p className={s.QUOTA_EMPTY}>{t("quota.failed", { error: load.error })}</p>
  const { meters, engineReported } = load.reply
  return (
    <div className={s.QUOTA}>
      {meters.length === 0 && <p className={s.QUOTA_EMPTY}>{t("quota.empty")}</p>}
      {meters.map((meter) => (
        <MeterCard key={meter.id} meter={meter} folded={folded.has(meter.id)} onToggle={() => toggle(meter.id)} />
      ))}
      {meters.length > 0 && !engineReported && <p className={s.QUOTA_NOTE}>{t("quota.noEngineYet")}</p>}
    </div>
  )
}

function MeterCard({ meter, folded, onToggle }: { meter: QuotaMeter; folded: boolean; onToggle: () => void }) {
  const title = meter.titleKey ? t(`quota.title.${meter.titleKey}`) : (meter.title ?? meter.id)
  return (
    <section className={s.QUOTA_CARD}>
      <Button variant="row" className={s.QUOTA_TITLE} aria-expanded={!folded} onClick={onToggle}>
        {title}
        <span className={s.QUOTA_CARET}>{folded ? "▸" : "▾"}</span>
      </Button>
      <div className={s.QUOTA_HEAD}>
        <span className="text-ink">{t("quota.used", { percent: percentText(meter.percent).replace("%", "") })}</span>
        <span className="text-muted">{meter.amount}</span>
      </div>
      <div
        className={s.QUOTA_BAR}
        role="meter"
        aria-valuenow={Math.round(meter.percent)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        {segmentsOf(meter).map((seg, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional
          <span key={i} className={s.QUOTA_SEG} style={{ width: `${seg.width}%`, background: seg.color }} />
        ))}
      </div>
      {meter.resetsAt !== null && <p className={s.QUOTA_NOTE}>{t("quota.resets", { when: when(meter.resetsAt) })}</p>}
      {!folded && (
        <ul className={s.QUOTA_ROWS}>
          {meter.parts.map((part, i) => {
            const swatch = swatchOf(meter, i)
            const label = part.labelKey ? t(`quota.part.${part.labelKey}`) : (part.label ?? "")
            return (
              <li key={part.labelKey ?? part.label} className={s.QUOTA_ROW}>
                <span className={s.QUOTA_SWATCH} style={swatch ? { background: swatch } : undefined} />
                <span className={s.QUOTA_LABEL} title={label}>
                  {label}
                </span>
                <span className={s.QUOTA_VALUE}>{part.value}</span>
                <span className={s.QUOTA_PCT}>
                  {part.share !== undefined ? percentText(part.share) : part.resetsAt ? when(part.resetsAt) : "—"}
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {!folded && meter.note && (
        <p className={s.QUOTA_NOTE}>
          {meter.note.key === "estimated"
            ? t("quota.note.estimated", { since: meter.note.since ? day(meter.note.since) : "?" })
            : t("quota.note.approximate")}
          {meter.note.error ? ` ${t("quota.note.error", { error: meter.note.error })}` : ""}
        </p>
      )}
    </section>
  )
}

function when(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })
}

function day(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}
