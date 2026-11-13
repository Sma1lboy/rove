/**
 * The Usage page: the last 14 days of agent turns printed as a statement. The total, a bar per day (coloured by
 * engine), a line item per engine and model and per top task, and where an engine reports quota, how its window is
 * pacing. Turns come from `turns.list` (engine-owned readers): an engine with no reader is named as such, never drawn
 * as zero work. Tokens and time only.
 */

import { narrowUsageChip } from "@sma1lboy/rove/src/tui-react/component/settings-dialog/usage-core.ts"
import { type CSSProperties, type ReactNode, useEffect, useState } from "react"
import { t, useLocale } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { errorMessage, fill, usePageFocus, useReload } from "./pages-kit.ts"
import { lastReply, requestRemembered } from "./remembered.ts"
import { formatDuration } from "./routine-run-log.ts"
import { useStore } from "./store.ts"
import { page } from "./ui.ts"
import { Button } from "./ui/button.tsx"
import { PAGE_SCROLL } from "./ui/page.ts"
import { BRACKET, USAGE_TONE } from "./ui/shell.ts"
import {
  USG_BAR,
  USG_BARCODE,
  USG_CAPS,
  USG_COLS,
  USG_DAY,
  USG_DIM,
  USG_ENGINE_TONES,
  USG_FAINT,
  USG_FOOT,
  USG_GAUGE,
  USG_HEAD,
  USG_HEAD_SPLIT,
  USG_ITEM,
  USG_ITEM_OPEN,
  USG_LEAD,
  USG_LEADER,
  USG_LEAD_CHART,
  USG_LEGEND,
  USG_LINE,
  USG_MARK,
  USG_NAME,
  USG_PAGE,
  USG_QUOTA,
  USG_RULE,
  USG_SEG,
  USG_STRIPE,
  USG_SUB,
  USG_SWATCH,
  USG_TOP,
  USG_TOTAL,
} from "./ui/usage.ts"
import {
  type QuotaWindow,
  type Sum,
  type TurnRecord,
  byEngineModel,
  compactTokens,
  lastDays,
  runway,
  topTasks,
} from "./usage-data.ts"

const DAYS = 14
/** The daemon's page cap on `turns.list`. */
const LIMIT = 500
const POLL_MS = 30_000
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
    | readonly {
        readonly vendor: string
        readonly name: string
        readonly capturedAt: number
        readonly windows: readonly QuotaWindow[]
      }[]
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

const Rule = () => <div className={USG_RULE} />

/** A line item: the name, a dotted leader, the tokens; turns and time in the small print under it. */
function Item({
  name,
  title,
  sum,
  sub,
  open,
}: { name: ReactNode; title: string; sum: Sum; sub?: string; open?: (() => void) | null }) {
  const lines = (
    <>
      <span className={USG_LINE}>
        <span className={USG_NAME} title={title}>
          {name}
        </span>
        <span className={USG_LEADER} />
        <span>{compactTokens(sum.tokens)}</span>
      </span>
      <span className={`block truncate ${USG_SUB}`}>
        {[sub, `${sum.turns}t`, formatDuration(sum.ms)].filter(Boolean).join(" · ")}
      </span>
    </>
  )
  return open ? (
    <Button variant="row" className={USG_ITEM_OPEN} onClick={open}>
      {lines}
    </Button>
  ) : (
    <div className={USG_ITEM}>{lines}</div>
  )
}

/** The total as a barcode: each digit is a stripe and the gap after it. */
function Barcode({ sum }: { sum: Sum }) {
  const digits = `${sum.tokens}${sum.turns}${sum.ms}`.repeat(4).slice(0, 36)
  return (
    <div className={USG_BARCODE} aria-hidden="true">
      {[...digits].map((digit, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: stripes have no identity but their place
          key={i}
          className={USG_STRIPE}
          style={{ width: 1 + (Number(digit) % 3), marginRight: 1 + (Number(digit) % 2) }}
        />
      ))}
    </div>
  )
}

function Quota({ usage, nameOf }: { usage: NonNullable<UsageReply["usage"]>; nameOf: (id: string) => string }) {
  const now = Date.now()
  const lines = usage.flatMap((row) =>
    row.windows.map((window) => {
      const pace = runway(window, now)
      const soon = pace?.kind === "full" && pace.at - now < 20 * 3_600_000
      const note =
        pace?.kind === "full"
          ? fill(t("usage.full"), {
              time: new Date(pace.at).toLocaleString([], {
                ...(soon ? {} : { weekday: "short" }),
                hour: "2-digit",
                minute: "2-digit",
              }),
            })
          : pace
            ? t("usage.lasts")
            : ""
      return {
        key: `${row.vendor}:${window.kind}`,
        name: `${row.name || nameOf(row.vendor)} ${window.label}`,
        percent: Math.round(window.percent),
        // The rail's own thresholds, so a window is "nearly full" in both places at once.
        tone: narrowUsageChip({ capturedAt: row.capturedAt, windows: [window] }, now)?.tone ?? "ok",
        note,
      }
    }),
  )
  if (lines.length === 0) return null
  return (
    <section>
      <h2 className={USG_HEAD}>{t("usage.quota")}</h2>
      {lines.map((line) => (
        <div key={line.key} className="py-0.5">
          <div className={USG_QUOTA}>
            <span className={USG_NAME}>{line.name}</span>
            <span
              className={USG_GAUGE[line.tone] ?? USG_GAUGE.ok}
              style={{ "--fill": `${Math.min(100, Math.max(0, line.percent))}%` } as CSSProperties}
            />
            <span className={`text-right ${USAGE_TONE[line.tone]}`}>{`${line.percent}%`}</span>
          </div>
          {line.note && <div className={USG_SUB}>{line.note}</div>}
        </div>
      ))}
    </section>
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

  const quotaBlock = quota.kind === "ready" && quota.value.usage && <Quota usage={quota.value.usage} nameOf={nameOf} />

  const body = () => {
    if (turns.kind === "loading") return <p className={`m-0 ${USG_DIM}`}>{t("usage.loading")}</p>
    if (turns.kind === "failed")
      return <p className="m-0 text-error">{fill(t("usage.failed"), { error: turns.error })}</p>
    const records = turns.value.turns
    const readers = new Set(turns.value.readers ?? [])
    const window = lastDays(records, Date.now(), DAYS, LIMIT)
    // The engines on the page, the busiest first: each gets a colour in the day bars.
    const totals = new Map<string, number>()
    for (const day of window.days)
      for (const [engine, tokens] of Object.entries(day.byEngine))
        totals.set(engine, (totals.get(engine) ?? 0) + tokens)
    const shown = [...totals].sort((a, b) => b[1] - a[1]).map(([engine]) => engine)
    const toneOf = (engine: string) =>
      USG_ENGINE_TONES[Math.max(0, shown.indexOf(engine)) % USG_ENGINE_TONES.length] ?? USG_ENGINE_TONES[0]
    const peak = Math.max(0, ...window.days.map((day) => day.tokens))
    // The chart starts at the first day with turns: a run of empty rows before it says nothing.
    const days = window.days.slice(
      Math.max(
        0,
        window.days.findIndex((day) => day.turns > 0),
      ),
    )
    const total = window.days.reduce<Sum>(
      (sum, day) => ({ turns: sum.turns + day.turns, tokens: sum.tokens + day.tokens, ms: sum.ms + day.ms }),
      { turns: 0, tokens: 0, ms: 0 },
    )
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
        <div className={USG_TOP}>
          <div>
            <h1 className={USG_MARK}>
              <span className={BRACKET}>[</span> rove <span className={BRACKET}>]</span>
            </h1>
            <div>
              <span className={USG_CAPS}>{t("usage.receipt")}</span>
              <span className={USG_DIM}>
                {`  ${window.days[0]?.day.slice(5)} → ${window.days.at(-1)?.day.slice(5)}`}
              </span>
            </div>
          </div>
          {records.length > 0 && <Barcode sum={total} />}
        </div>
        <Rule />
        {records.length === 0 ? (
          <>
            <p className={`m-0 ${USG_DIM}`}>{t("usage.empty")}</p>
            {quotaBlock && <Rule />}
            {quotaBlock}
          </>
        ) : (
          <>
            <div className={USG_LEAD}>
              <section>
                <h2 className={USG_HEAD}>{t("usage.total")}</h2>
                <div className={USG_TOTAL}>{compactTokens(total.tokens)}</div>
                <div className={`mt-1.5 ${USG_DIM}`}>
                  {`${fill(t("usage.turns"), { count: total.turns })} · ${formatDuration(total.ms)}`}
                </div>
              </section>
              <section className={USG_LEAD_CHART}>
                <h2 className={USG_HEAD_SPLIT}>
                  {t("usage.perDay")}
                  {shown.length > 1 && (
                    <span className={USG_LEGEND}>
                      {shown.map((engine) => (
                        <span key={engine}>
                          <span className={`${USG_SWATCH} ${toneOf(engine)}`} />
                          {nameOf(engine)}
                        </span>
                      ))}
                    </span>
                  )}
                </h2>
                {days.map((day) => (
                  <div key={day.day} className={USG_DAY}>
                    <span className={USG_DIM}>{`${day.day.slice(5)}${day.partial ? "~" : ""}`}</span>
                    <span className="flex min-w-0">
                      {day.tokens > 0 && peak > 0 && (
                        <span
                          className={USG_BAR}
                          style={{ "--fill": `${(day.tokens / peak) * 100}%` } as CSSProperties}
                        >
                          {shown.map(
                            (engine) =>
                              (day.byEngine[engine] ?? 0) > 0 && (
                                <span
                                  key={engine}
                                  className={`${USG_SEG} ${toneOf(engine)}`}
                                  style={{ flexGrow: day.byEngine[engine] }}
                                />
                              ),
                          )}
                        </span>
                      )}
                    </span>
                    {day.turns > 0 && (
                      <>
                        <span className="text-right">{compactTokens(day.tokens)}</span>
                        <span className={`text-right ${USG_FAINT}`}>{`${day.turns}t`}</span>
                        <span className={`text-right ${USG_FAINT}`}>{formatDuration(day.ms)}</span>
                      </>
                    )}
                  </div>
                ))}
              </section>
            </div>

            <Rule />
            <div className={USG_COLS}>
              <section>
                <h2 className={USG_HEAD}>{t("usage.byModel")}</h2>
                {byEngineModel(records).map((row) => (
                  <Item
                    key={`${row.engine}\0${row.model}`}
                    name={row.model}
                    title={`${nameOf(row.engine)} · ${row.model}`}
                    sum={row}
                    sub={nameOf(row.engine)}
                  />
                ))}
              </section>
              <section>
                <h2 className={USG_HEAD}>{t("usage.topTasks")}</h2>
                {topTasks(records, TOP_TASKS).map((row) => {
                  const live = payload?.tasks.some((task) => task.id === row.taskId)
                  const title = titleOf(row.taskId)
                  return (
                    <Item
                      key={row.taskId}
                      name={live ? title : <span className={USG_FAINT}>{title}</span>}
                      title={title}
                      sum={row}
                      open={
                        live
                          ? () => {
                              page.set(null)
                              model.select(row.taskId)
                            }
                          : null
                      }
                    />
                  )
                })}
              </section>
              {quotaBlock}
            </div>
          </>
        )}

        <Rule />
        <div className={USG_FOOT}>
          <span>{fill(t("usage.range"), { days: DAYS })}</span>
          {window.cutoff && (
            <span>{fill(t("usage.cutoff"), { count: window.cutoff.count, day: window.cutoff.day.slice(5) })}</span>
          )}
          {uncounted.length > 0 && (
            <span>{fill(t("usage.noReader"), { engines: uncounted.map(nameOf).join(", ") })}</span>
          )}
          <span className={`${USG_CAPS} ml-auto`}>{t("usage.thanks")}</span>
        </div>
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
      <div className={USG_PAGE}>{body()}</div>
    </div>
  )
}
