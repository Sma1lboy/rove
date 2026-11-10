/**
 * The Usage page: the last 14 days of agent turns as text bars. Per day (stacked by engine), per engine and model, the
 * tasks that used the most, and where an engine reports quota, how its window is pacing. Turns come from `turns.list`
 * (engine-owned readers): an engine with no reader is named as such, never drawn as zero work. Tokens and time only.
 */

import { useEffect, useState } from "react"
import { t, useLocale } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { errorMessage, fill, usePageFocus, useReload } from "./pages-kit.ts"
import { lastReply, requestRemembered } from "./remembered.ts"
import { formatDuration } from "./routine-run-log.ts"
import { useStore } from "./store.ts"
import { page } from "./ui.ts"
import { Button } from "./ui/button.tsx"
import { PAGE_SCROLL, PAGE_TITLE } from "./ui/page.ts"
import { KICKER } from "./ui/text.ts"
import {
  USG_BAR,
  USG_DAY,
  USG_HEAD,
  USG_LABEL,
  USG_LEGEND,
  USG_MODEL_BAR,
  USG_NOTE,
  USG_ROW,
  USG_ROW_OPEN,
  USG_TIME,
  USG_TOKENS,
  USG_TURNS,
} from "./ui/usage.ts"
import {
  ENGINE_GLYPHS,
  type QuotaWindow,
  type Sum,
  type TurnRecord,
  bar,
  byEngineModel,
  compactTokens,
  lastDays,
  runway,
  stackedBar,
  topTasks,
} from "./usage-data.ts"

const DAYS = 14
/** The daemon's page cap on `turns.list`. */
const LIMIT = 500
const POLL_MS = 30_000
/** Cells for the per-day bar, and for the per-model bar beside a name. */
const DAY_BAR = 16
const MODEL_BAR = 8
const TOP_TASKS = 8

interface TurnsReply {
  readonly turns: readonly TurnRecord[]
  /** Engines that record turns at all. */
  readonly readers?: readonly string[]
}

interface EngineRow {
  readonly id: string
  readonly name: string
}

interface UsageReply {
  readonly usage:
    | readonly { readonly vendor: string; readonly name: string; readonly windows: readonly QuotaWindow[] }[]
    | null
}

type Load<T> =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly value: T }
  | { readonly kind: "failed"; readonly error: string }

/** One read, repeated every `tick`; what was last read shows while the next one is on its way. */
function useRead<T>(model: AppModel, op: string, params: Record<string, unknown>, tick: number): Load<T> {
  const cached = lastReply<T>(model, op, params)
  const [state, setState] = useState<Load<T>>(cached ? { kind: "ready", value: cached } : { kind: "loading" })
  const key = JSON.stringify(params)
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `params`; tick is a trigger
  useEffect(() => {
    let live = true
    requestRemembered<T>(model, op, params)
      .then((value) => live && setState({ kind: "ready", value }))
      .catch(
        (err) =>
          live && setState((prev) => (prev.kind === "ready" ? prev : { kind: "failed", error: errorMessage(err) })),
      )
    return () => {
      live = false
    }
  }, [model, op, key, tick])
  return state
}

const figures = (sum: Sum) => (
  <>
    <span className={`${USG_TOKENS}`}>{compactTokens(sum.tokens)}</span>
    <span className={`${USG_TURNS}`}>{`${sum.turns}t`}</span>
    <span className={`${USG_TIME}`}>{formatDuration(sum.ms)}</span>
  </>
)

function QuotaLines({ usage, nameOf }: { usage: NonNullable<UsageReply["usage"]>; nameOf: (id: string) => string }) {
  const now = Date.now()
  const lines = usage.flatMap((row) =>
    row.windows.map((window) => {
      const params = {
        engine: row.name || nameOf(row.vendor),
        label: window.label,
        percent: Math.round(window.percent),
      }
      const pace = runway(window, now)
      if (pace?.kind === "full") {
        const soon = pace.at - now < 20 * 3_600_000
        const time = new Date(pace.at).toLocaleString([], {
          ...(soon ? {} : { weekday: "short" }),
          hour: "2-digit",
          minute: "2-digit",
        })
        return { key: `${row.vendor}:${window.kind}`, text: fill(t("usage.full"), { ...params, time }) }
      }
      return {
        key: `${row.vendor}:${window.kind}`,
        text: fill(t(pace ? "usage.lasts" : "usage.window"), params),
      }
    }),
  )
  if (lines.length === 0) return null
  return (
    <>
      <h2 className={`${KICKER} text-muted ${USG_HEAD}`}>{t("usage.quota")}</h2>
      {lines.map((line) => (
        <p key={line.key} className={`mono ${USG_NOTE}`}>
          {line.text}
        </p>
      ))}
    </>
  )
}

/** A task's sums; a live task opens, a removed one is just listed. */
function TopTask({ row, title, open }: { row: Sum; title: string; open: (() => void) | null }) {
  const line = (
    <>
      <span className={USG_LABEL}>{title}</span>
      {figures(row)}
    </>
  )
  return open ? (
    <Button variant="row" className={USG_ROW_OPEN} onClick={open}>
      {line}
    </Button>
  ) : (
    <div className={USG_ROW}>{line}</div>
  )
}

export function UsageView({ model }: { model: AppModel }) {
  useLocale()
  const root = usePageFocus()
  const [tick] = useReload(POLL_MS)
  const turns = useRead<TurnsReply>(model, "turns.list", { sinceDays: DAYS, limit: LIMIT }, tick)
  const engines = useRead<{ engines: readonly EngineRow[] }>(model, "engines.list", {}, tick)
  const quota = useRead<UsageReply>(model, "usage.get", {}, tick)
  const payload = useStore(model.tasks)

  const names = engines.kind === "ready" ? engines.value.engines : []
  const nameOf = (id: string) => names.find((engine) => engine.id === id)?.name ?? id
  const titleOf = (taskId: string) => payload?.tasks.find((task) => task.id === taskId)?.label ?? t("usage.removedTask")

  const body = () => {
    if (turns.kind === "loading") return <p className="text-muted">{t("usage.loading")}</p>
    if (turns.kind === "failed") return <p className="text-error">{fill(t("usage.failed"), { error: turns.error })}</p>
    const records = turns.value.turns
    const readers = new Set(turns.value.readers ?? [])
    const window = lastDays(records, Date.now(), DAYS, LIMIT)
    // The engines on screen, the busiest first: each gets a shade in the day bars.
    const totals = new Map<string, number>()
    for (const day of window.days)
      for (const [engine, tokens] of Object.entries(day.byEngine))
        totals.set(engine, (totals.get(engine) ?? 0) + tokens)
    const shown = [...totals].sort((a, b) => b[1] - a[1]).map(([engine]) => engine)
    const peak = Math.max(0, ...window.days.map((day) => day.tokens))
    const rows = byEngineModel(records)
    const rowPeak = Math.max(0, ...rows.map((row) => row.tokens))
    // Engines with tasks but no way to read their turns: not "no work", just not counted.
    const uncounted = [
      ...new Set(
        (payload?.tasks ?? []).flatMap((task) =>
          task.engine?.id && !readers.has(task.engine.id) ? [task.engine.id] : [],
        ),
      ),
    ]
    return (
      <>
        <p className={USG_NOTE}>{fill(t("usage.range"), { days: DAYS })}</p>
        {records.length === 0 ? (
          <p className="text-muted">{t("usage.empty")}</p>
        ) : (
          <>
            <h2 className={`${KICKER} text-muted ${USG_HEAD}`}>{t("usage.perDay")}</h2>
            <div className={USG_LEGEND}>
              {shown.map((engine, i) => (
                <span key={engine}>{`${ENGINE_GLYPHS[i % ENGINE_GLYPHS.length]} ${nameOf(engine)}`}</span>
              ))}
            </div>
            {window.days.map((day) => (
              <div key={day.day} className={USG_ROW}>
                <span className={USG_DAY}>{`${day.day.slice(5)}${day.partial ? "~" : ""}`}</span>
                <span className={USG_BAR}>{stackedBar(day.byEngine, shown, peak, DAY_BAR)}</span>
                {figures(day)}
              </div>
            ))}
            {window.cutoff && (
              <p className={USG_NOTE}>
                {fill(t("usage.cutoff"), { count: window.cutoff.count, day: window.cutoff.day.slice(5) })}
              </p>
            )}

            <h2 className={`${KICKER} text-muted ${USG_HEAD}`}>{t("usage.byModel")}</h2>
            {rows.map((row) => (
              <div key={`${row.engine}\0${row.model}`} className={USG_ROW}>
                <span className={USG_LABEL} title={`${nameOf(row.engine)} · ${row.model}`}>
                  {`${nameOf(row.engine)} · ${row.model}`}
                </span>
                <span className={USG_MODEL_BAR}>{bar(row.tokens, rowPeak, MODEL_BAR)}</span>
                {figures(row)}
              </div>
            ))}

            <h2 className={`${KICKER} text-muted ${USG_HEAD}`}>{t("usage.topTasks")}</h2>
            {topTasks(records, TOP_TASKS).map((row) => (
              <TopTask
                key={row.taskId}
                row={row}
                title={titleOf(row.taskId)}
                open={
                  payload?.tasks.some((task) => task.id === row.taskId)
                    ? () => {
                        page.set(null)
                        model.select(row.taskId)
                      }
                    : null
                }
              />
            ))}
          </>
        )}
        {uncounted.length > 0 && (
          <p className={USG_NOTE}>{fill(t("usage.noReader"), { engines: uncounted.map(nameOf).join(", ") })}</p>
        )}
        {quota.kind === "ready" && quota.value.usage && <QuotaLines usage={quota.value.usage} nameOf={nameOf} />}
      </>
    )
  }

  return (
    <div
      className={PAGE_SCROLL}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the page takes the TUI page keys while focused
      tabIndex={0}
      ref={root}
      onKeyDown={(e) => {
        if (e.metaKey || e.ctrlKey || e.altKey || (e.key !== "q" && e.key !== "Escape")) return
        e.preventDefault()
        page.set(null)
      }}
    >
      <h1 className={PAGE_TITLE}>{t("usage.title")}</h1>
      {body()}
    </div>
  )
}
