/**
 * The side panel's Context tab: what this conversation's context window holds (`context.usage`), as one card:
 * `9% used` and `86.6k / 1M`, a bar split by what the engine records (system prompt & tools, messages), then a
 * row per part. An engine that records no context draws a plain note, never a zero.
 */

import { useEffect, useState } from "react"
import type { TaskRow } from "rove-bridge/protocol"
import { everyVisible } from "./every-visible.ts"
import { t, useLocale } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { errorMessage } from "./pages-kit.ts"
import { useStore } from "./store.ts"
import * as s from "./ui/context.ts"

const POLL_MS = 10_000
/** Segment colours in row order: theme roles, never literal hex. */
const PALETTE = [
  "var(--info)",
  "var(--success)",
  "var(--warning)",
  "var(--merged)",
  "var(--muted)",
  "var(--ink)",
  "var(--accent)",
] as const

interface ContextRow {
  readonly key: string
  readonly tokens: number
  readonly share?: number
  readonly label?: string
  readonly items?: readonly { readonly name: string; readonly tokens: number }[]
}
interface ContextMeter {
  readonly percent: number | null
  readonly used: number
  readonly window: number | null
  readonly rows: readonly ContextRow[]
  readonly approximate: boolean
}

type Load = { kind: "loading" } | { kind: "ready"; meter: ContextMeter | null } | { kind: "failed"; error: string }

export function ContextView({ model, task, active }: { model: AppModel; task: TaskRow; active: boolean }) {
  useLocale()
  const conn = useStore(model.client.conn)
  const selection = useStore(model.selection)
  const tabs = useStore(model.tabs)[task.id] ?? []
  // The conversation in view: the selected tab when it is an engine, else the task's first engine tab.
  const picked = selection.taskId === task.id ? tabs.find((tab) => tab.id === selection.tabId) : undefined
  const tabId = (picked?.kind === "engine" ? picked : tabs.find((tab) => tab.kind === "engine"))?.id ?? null
  const [load, setLoad] = useState<Load>({ kind: "loading" })

  useEffect(() => {
    if (!active || conn.state !== "open") return
    if (!tabId) {
      setLoad({ kind: "ready", meter: null })
      return
    }
    let live = true
    const read = (probe = false) =>
      model.client
        .request<{ meter: ContextMeter | null }>("context.usage", { taskId: task.id, tabId, probe })
        .then((reply) => live && setLoad({ kind: "ready", meter: reply.meter }))
        .catch(
          (err) =>
            live && setLoad((prev) => (prev.kind === "ready" ? prev : { kind: "failed", error: errorMessage(err) })),
        )
    // The transcript's total paints at once; the engine's own breakdown lands when its probe answers.
    void read().then(() => read(true))
    const stop = everyVisible(POLL_MS, read)
    return () => {
      live = false
      stop()
    }
  }, [model, active, conn.state, task.id, tabId])

  if (load.kind === "loading") return <p className={s.CTX_EMPTY}>{t("context.loading")}</p>
  if (load.kind === "failed") return <p className={s.CTX_EMPTY}>{t("context.failed", { error: load.error })}</p>
  if (!load.meter) return <p className={s.CTX_EMPTY}>{t("context.none")}</p>
  const meter = load.meter
  const shared = meter.rows.filter((row) => row.share !== undefined)
  const colour = (row: ContextRow) =>
    row.share === undefined ? undefined : PALETTE[shared.indexOf(row) % PALETTE.length]
  return (
    <div className={s.CTX}>
      <section className={s.CTX_CARD}>
        <h3 className={s.CTX_TITLE}>{t("context.title")}</h3>
        <div className={s.CTX_HEAD}>
          <span className="text-ink">
            {meter.percent === null
              ? t("context.usedTokens", { tokens: tokens(meter.used) })
              : t("context.used", { percent: percentText(meter.percent) })}
          </span>
          {meter.window !== null && (
            <span className="text-muted">
              {tokens(meter.used)} / {tokens(meter.window)}
            </span>
          )}
        </div>
        <div
          className={s.CTX_BAR}
          role="meter"
          aria-valuenow={Math.round(meter.percent ?? 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          {shared.map((row) => (
            <span key={row.key} className={s.CTX_SEG} style={{ width: `${row.share}%`, background: colour(row) }} />
          ))}
        </div>
        <ul className={s.CTX_ROWS}>
          {meter.rows.map((row) => {
            const key = `context.part.${row.key}`
            const label = t(key) === key ? (row.label ?? row.key) : t(key)
            const swatch = colour(row)
            const cells = (
              <>
                <span className={s.CTX_SWATCH} style={swatch ? { background: swatch } : undefined} />
                <span className={s.CTX_LABEL} title={label}>
                  {label}
                </span>
                {row.items && <span className={s.CTX_CHEVRON}>›</span>}
                <span className={s.CTX_VALUE}>{tokens(row.tokens)}</span>
                <span className={s.CTX_PCT}>{percentText((row.tokens / (meter.window ?? meter.used)) * 100)}</span>
              </>
            )
            if (!row.items) {
              return (
                <li key={row.key} className={s.CTX_ROW}>
                  {cells}
                </li>
              )
            }
            return (
              <li key={row.key}>
                <details className={s.CTX_FOLD}>
                  <summary className={s.CTX_SUMMARY}>{cells}</summary>
                  <ul className={s.CTX_ITEMS}>
                    {row.items.map((item) => (
                      <li key={item.name} className={s.CTX_ROW}>
                        <span className={s.CTX_ITEM_LABEL} title={item.name}>
                          {item.name}
                        </span>
                        <span className={s.CTX_ITEM_VALUE}>{tokens(item.tokens)}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            )
          })}
        </ul>
        {meter.approximate && <p className={s.CTX_NOTE}>{t("context.approximate")}</p>}
      </section>
    </div>
  )
}

function tokens(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${+(n / 1000).toFixed(1)}k`
  return String(n)
}

function percentText(n: number): string {
  if (n > 0 && n < 0.1) return "<0.1%"
  return `${n < 10 ? +n.toFixed(1) : Math.round(n)}%`
}
