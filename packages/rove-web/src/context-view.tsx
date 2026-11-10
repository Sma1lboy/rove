/**
 * The side panel's Context column: what this conversation's context window holds (`context.usage`): `9% used`
 * and `86.6k / 1M`, a bar split by what the engine reports (system prompt, tools, memory files, skills,
 * messages), then a row per part that opens onto what it is made of. An engine that records no context draws a
 * plain note, never a zero.
 */

import { useEffect, useRef, useState } from "react"
import type { TaskRow } from "rove-bridge/protocol"
import { everyVisible } from "./every-visible.ts"
import { t, useLocale } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { errorMessage } from "./pages-kit.ts"
import { useStore } from "./store.ts"
import * as s from "./ui/context.ts"

const POLL_MS = 10_000
/** A part keeps its colour whichever parts sit beside it; theme roles, never literal hex. */
const COLOURS: Readonly<Record<string, string>> = {
  system: "var(--info)",
  system_prompt: "var(--info)",
  system_tools: "var(--success)",
  mcp_tools: "var(--warning)",
  mcp_instructions: "var(--warning)",
  custom_agents: "var(--ink)",
  memory_files: "var(--merged)",
  skills: "var(--muted)",
  messages: "var(--accent)",
  used: "var(--accent)",
}
const SPARE = ["var(--info)", "var(--success)", "var(--warning)", "var(--merged)"] as const

interface ContextItem {
  readonly name: string
  readonly tokens: number
}
interface ContextRow {
  readonly key: string
  readonly tokens: number
  readonly share?: number
  readonly label?: string
  readonly items?: readonly ContextItem[]
  readonly itemCount?: number
  readonly deferred?: true
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
  const [probing, setProbing] = useState(false)
  const shown = useRef("")

  useEffect(() => {
    if (!active || conn.state !== "open") return
    // Another conversation's numbers never stand in for this one's.
    const session = `${task.id}::${tabId}`
    if (shown.current !== session) setLoad({ kind: "loading" })
    shown.current = session
    if (!tabId) {
      setLoad({ kind: "ready", meter: null })
      return
    }
    let live = true
    const read = (probe: boolean) =>
      model.client
        .request<{ meter: ContextMeter | null }>("context.usage", { taskId: task.id, tabId, probe })
        .then((reply) => live && setLoad({ kind: "ready", meter: reply.meter }))
        .catch(
          (err) =>
            live && setLoad((prev) => (prev.kind === "ready" ? prev : { kind: "failed", error: errorMessage(err) })),
        )
    // Every read asks for the engine's own breakdown: the daemon holds one for minutes and paces its retries,
    // so this starts a process only when the session is new to it (a restart, a cleared conversation).
    const probe = () => {
      setProbing(true)
      void read(true).finally(() => live && setProbing(false))
    }
    // The transcript's total paints at once; the breakdown lands when the probe answers.
    void read(false).then(probe)
    const stop = everyVisible(POLL_MS, probe)
    return () => {
      live = false
      setProbing(false)
      stop()
    }
  }, [model, active, conn.state, task.id, tabId])

  if (load.kind === "loading") return <p className={s.CTX_EMPTY}>{t("context.loading")}</p>
  if (load.kind === "failed") return <p className={s.CTX_EMPTY}>{t("context.failed", { error: load.error })}</p>
  if (!load.meter) return <p className={s.CTX_EMPTY}>{t("context.none")}</p>
  const meter = load.meter
  const shared = meter.rows.filter((row) => row.share !== undefined)
  const colour = (row: ContextRow) =>
    row.share === undefined ? undefined : (COLOURS[row.key] ?? SPARE[shared.indexOf(row) % SPARE.length])
  const used = `${meter.approximate ? "~" : ""}${tokens(meter.used)}`
  return (
    <div className={s.CTX}>
      <div className={s.CTX_HEAD}>
        <span className="text-ink">
          {meter.percent === null
            ? t("context.usedTokens", { tokens: used })
            : t("context.used", { percent: percentText(meter.percent) })}
        </span>
        {meter.window !== null && (
          <span className="text-muted">
            {used} / {tokens(meter.window)}
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
        {meter.rows.map((row, index) => {
          const key = `context.part.${row.key}`
          const label = t(key) === key ? (row.label ?? row.key) : t(key)
          const swatch = colour(row)
          const cells = (
            <>
              <span className={s.CTX_SWATCH} style={swatch ? { background: swatch } : undefined} />
              <span className={s.CTX_NAME}>
                <span className={s.CTX_LABEL} title={label}>
                  {label}
                </span>
                {row.items && <span className={s.CTX_CHEVRON}>›</span>}
              </span>
              <span className={s.CTX_VALUE}>{tokens(row.tokens)}</span>
              <span className={s.CTX_PCT}>
                {row.deferred ? "—" : percentText((row.tokens / (meter.window ?? meter.used)) * 100)}
              </span>
            </>
          )
          // What is left over sits apart from what is used, and what loads on demand apart from both.
          const opens = row.deferred ? !meter.rows[index - 1]?.deferred : row.share === undefined
          const gap = opens ? s.CTX_GAP : undefined
          if (!row.items) {
            return (
              <li key={row.key} className={gap}>
                <div className={s.CTX_ROW}>{cells}</div>
              </li>
            )
          }
          const listed = row.items.reduce((sum, item) => sum + item.tokens, 0)
          const more = (row.itemCount ?? row.items.length) - row.items.length
          return (
            <li key={row.key} className={gap}>
              <details className={s.CTX_FOLD}>
                <summary className={s.CTX_SUMMARY}>{cells}</summary>
                <ul className={s.CTX_ITEMS}>
                  {row.items.map((item) => (
                    <Item key={item.name} name={item.name} tokens={item.tokens} />
                  ))}
                  {more > 0 && <Item name={t("context.more", { count: more })} tokens={row.tokens - listed} />}
                </ul>
              </details>
            </li>
          )
        })}
      </ul>
      {probing && shared.length < 2 && <p className={s.CTX_NOTE}>{t("context.probing")}</p>}
    </div>
  )
}

/** A path keeps its file name and gives up its directories first; any other name truncates at the end. */
function Item({ name, tokens: count }: ContextItem) {
  const cut = name.lastIndexOf("/") + 1
  return (
    <li className={s.CTX_ITEM} title={name}>
      <span className={s.CTX_ITEM_NAME}>
        {cut > 0 && <span className={s.CTX_ITEM_DIR}>{name.slice(0, cut)}</span>}
        <span className={cut > 0 ? s.CTX_ITEM_LEAF : s.CTX_ITEM_DIR}>{name.slice(cut)}</span>
      </span>
      <span className={s.CTX_ITEM_VALUE}>{tokens(Math.max(0, count))}</span>
      <span className={s.CTX_ITEM_PAD} />
    </li>
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
