/**
 * The Usage page: the last 14 days of agent turns as thin bars. Per day (stacked by engine), per engine and model, the
 * tasks that used the most, and where an engine reports quota, how its window is pacing. Turns come from `turns.list`
 * (engine-owned readers): an engine with no reader is named as such, never drawn as zero work. Tokens and time only.
 */

import { narrowUsageChip } from "@sma1lboy/rove/src/tui-react/component/settings-dialog/usage-core.ts"
import { type CSSProperties, useEffect, useState } from "react"
import { t, useLocale } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { errorMessage, fill, usePageFocus, useReload } from "./pages-kit.ts"
import { lastReply, requestRemembered } from "./remembered.ts"
import { formatDuration } from "./routine-run-log.ts"
import { useStore } from "./store.ts"
import { page } from "./ui.ts"
import { Button } from "./ui/button.tsx"
import { PAGE_SCROLL, PAGE_TITLE } from "./ui/page.ts"
import { USAGE_TONE, usageBar } from "./ui/shell.ts"
import { KICKER } from "./ui/text.ts"
import {
  USG_BAR,
  USG_BAR_CELL,
  USG_DAYS,
  USG_ENGINE_TONES,
  USG_FIGURE,
  USG_HEAD,
  USG_LABEL,
  USG_LEGEND,
  USG_NAME,
  USG_NOTE,
  USG_PAGE,
  USG_QUIET,
  USG_QUOTA,
  USG_ROW,
  USG_ROWS,
  USG_ROW_OPEN,
  USG_SEG,
  USG_SWATCH,
  USG_TASK_TONE,
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

/** Tokens, turns, time; a row with no turns leaves the three cells empty. */
const figures = (sum: Sum) =>
  sum.turns === 0 ? (
    <span className="col-span-3" />
  ) : (
    <>
      <span className={USG_FIGURE}>{compactTokens(sum.tokens)}</span>
      <span className={USG_FIGURE}>{`${sum.turns}t`}</span>
      <span className={USG_FIGURE}>{formatDuration(sum.ms)}</span>
    </>
  )

interface Part {
  readonly key: string
  readonly tone: string
  readonly value: number
}

/** A bar `total / max` of its cell wide, split by `parts` in their order. */
function Bar({ parts, max }: { parts: readonly Part[]; max: number }) {
  const live = parts.filter((part) => part.value > 0)
  const total = live.reduce((sum, part) => sum + part.value, 0)
  return (
    <span className={USG_BAR_CELL}>
      {total > 0 && max > 0 && (
        <span className={USG_BAR} style={{ "--fill": `${(total / max) * 100}%` } as CSSProperties}>
          {live.map((part) => (
            <span key={part.key} className={`${USG_SEG} ${part.tone}`} style={{ flexGrow: part.value }} />
          ))}
        </span>
      )}
    </span>
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
        engine: row.name || nameOf(row.vendor),
        window,
        // The rail's own tones, so a window reads the same in both places.
        tone: narrowUsageChip({ capturedAt: row.capturedAt, windows: [window] }, now)?.tone ?? "ok",
        note,
      }
    }),
  )
  if (lines.length === 0) return null
  return (
    <>
      <h2 className={`${KICKER} text-muted ${USG_HEAD}`}>{t("usage.quota")}</h2>
      <div className={USG_QUOTA}>
        {lines.map((line) => {
          const percent = Math.round(line.window.percent)
          return (
            <div key={line.key} className={USG_ROW}>
              <span className={USG_NAME}>{line.engine}</span>
              <span className="text-muted">{line.window.label}</span>
              <span
                className={usageBar(line.tone)}
                style={{ "--fill": `${Math.min(100, Math.max(0, percent))}%` } as CSSProperties}
              />
              <span className={`text-right ${USAGE_TONE[line.tone]}`}>{`${percent}%`}</span>
              <span className={`${USG_LABEL} font-sans text-subtle`} title={line.note}>
                {line.note}
              </span>
            </div>
          )
        })}
      </div>
    </>
  )
}

/** A task's sums; a live task opens, a removed one is just listed. */
function TopTask({ row, title, max, open }: { row: Sum; title: string; max: number; open: (() => void) | null }) {
  const line = (
    <>
      <span className={open ? USG_NAME : `${USG_NAME} ${USG_QUIET}`} title={title}>
        {title}
      </span>
      <Bar parts={[{ key: "task", tone: USG_TASK_TONE, value: row.tokens }]} max={max} />
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
    const rows = byEngineModel(records)
    const rowPeak = Math.max(0, ...rows.map((row) => row.tokens))
    const tasks = topTasks(records, TOP_TASKS)
    const taskPeak = Math.max(0, ...tasks.map((row) => row.tokens))
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
            <div className={USG_HEAD}>
              <h2 className={`${KICKER} text-muted`}>{t("usage.perDay")}</h2>
              {shown.length > 1 && (
                <div className={USG_LEGEND}>
                  {shown.map((engine) => (
                    <span key={engine}>
                      <span className={`${USG_SWATCH} ${toneOf(engine)}`} />
                      {nameOf(engine)}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className={USG_DAYS}>
              {days.map((day) => (
                <div key={day.day} className={USG_ROW}>
                  <span className={day.turns === 0 ? USG_QUIET : "text-muted"}>
                    {`${day.day.slice(5)}${day.partial ? "~" : ""}`}
                  </span>
                  <Bar
                    parts={shown.map((engine) => ({
                      key: engine,
                      tone: toneOf(engine),
                      value: day.byEngine[engine] ?? 0,
                    }))}
                    max={peak}
                  />
                  {figures(day)}
                </div>
              ))}
            </div>
            {window.cutoff && (
              <p className={`${USG_NOTE} mt-1.5`}>
                {fill(t("usage.cutoff"), { count: window.cutoff.count, day: window.cutoff.day.slice(5) })}
              </p>
            )}

            <h2 className={`${KICKER} text-muted ${USG_HEAD}`}>{t("usage.byModel")}</h2>
            <div className={USG_ROWS}>
              {rows.map((row) => (
                <div key={`${row.engine}\0${row.model}`} className={USG_ROW}>
                  <span className={USG_LABEL} title={`${nameOf(row.engine)} · ${row.model}`}>
                    <span className="font-sans text-muted">{`${nameOf(row.engine)} · `}</span>
                    {row.model}
                  </span>
                  <Bar parts={[{ key: row.engine, tone: toneOf(row.engine), value: row.tokens }]} max={rowPeak} />
                  {figures(row)}
                </div>
              ))}
            </div>

            <h2 className={`${KICKER} text-muted ${USG_HEAD}`}>{t("usage.topTasks")}</h2>
            <div className={USG_ROWS}>
              {tasks.map((row) => (
                <TopTask
                  key={row.taskId}
                  row={row}
                  title={titleOf(row.taskId)}
                  max={taskPeak}
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
            </div>
          </>
        )}
        {uncounted.length > 0 && (
          <p className={`${USG_NOTE} mt-1.5`}>
            {fill(t("usage.noReader"), { engines: uncounted.map(nameOf).join(", ") })}
          </p>
        )}
        {quota.kind === "ready" && quota.value.usage && <Quota usage={quota.value.usage} nameOf={nameOf} />}
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
      <div className={USG_PAGE}>
        <h1 className={PAGE_TITLE}>{t("usage.title")}</h1>
        {body()}
      </div>
    </div>
  )
}
