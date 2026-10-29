/**
 * The footer's usage half, as the TUI's `host-footer.tsx`: `ctx 62%` and `Σ 45k` for the
 * selected session, then per-engine quota (`CLAUDE 5h 42% → 14:00 · 7d 12%`). Text and
 * tones come from the TUI's own `usage-core.ts`; a missing reading draws nothing, never 0.
 */

import {
  buildFooterChips,
  contextChip,
  tokenTotalChip,
} from "@sma1lboy/rove/src/tui-react/component/settings-dialog/usage-core.ts"
import { type CSSProperties, type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react"
import type { BridgeClient } from "./bridge.ts"
import { useStore } from "./store.ts"

/** The daemon publishes as engines report; the TUI reads a pushed signal, the page polls. */
const POLL_MS = 10_000
/** A bar (28px plus its margins, in place of one space) in 11px footer cells, rounded up. */
const BAR_CELLS = 5

/** The window's fill beside its percent; `percentText` is the TUI's `42%` / `42%~`. */
function UsageBar({ percentText, tone }: { percentText: string; tone: string }) {
  const percent = Math.min(100, Math.max(0, Number.parseInt(percentText, 10) || 0))
  return <span className={`usage-bar tone-${tone}`} style={{ "--fill": `${percent}%` } as CSSProperties} />
}

/** JetBrains Mono advances 0.6em per glyph; the footer's width in TUI cells is its width over that. */
const CELL_EM = 0.6
/** CSS gap between chips (16px) in cells, rounded up: the TUI budgets 2. */
const GAP_CELLS = 3

/** The footer width left for usage, in cells; Infinity until measured. */
function useCells(): [RefObject<HTMLSpanElement | null>, number] {
  const box = useRef<HTMLSpanElement>(null)
  const [cells, setCells] = useState(Number.POSITIVE_INFINITY)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => {
      const cell = Number.parseFloat(getComputedStyle(el).fontSize) * CELL_EM
      setCells(Math.floor(el.clientWidth / cell))
    }
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    measure()
    return () => observer.disconnect()
  }, [])
  return [box, cells]
}

interface UsageRow {
  readonly vendor: string
  readonly name: string
  readonly capturedAt: number
  readonly windows: readonly { kind: string; label: string; percent: number; resetsAt: number | null }[]
}

interface ContextReading {
  readonly contextTokens: number
  readonly contextWindowTokens?: number
  readonly approximate?: boolean
  readonly inputTokens?: number
  readonly outputTokens?: number
}

interface UsageReply {
  readonly usage: readonly UsageRow[] | null
  readonly context?: ContextReading | null
}

export function UsageChips({
  client,
  taskId,
  tabId,
}: { client: BridgeClient; taskId: string | null; tabId: string | null }) {
  const conn = useStore(client.conn)
  const [reply, setReply] = useState<UsageReply | null>(null)
  const [box, cells] = useCells()
  useEffect(() => {
    if (conn.state !== "open") return
    let live = true
    const load = () =>
      client
        .request<UsageReply>("usage.get", taskId && tabId ? { taskId, tabId } : {})
        .then((r) => {
          if (live) setReply(r)
        })
        .catch(() => {})
    void load()
    const timer = window.setInterval(load, POLL_MS)
    return () => {
      live = false
      window.clearInterval(timer)
    }
  }, [client, conn.state, taskId, tabId])

  const ctx = contextChip(reply?.context)
  const tok = tokenTotalChip(reply?.context)
  const names = new Map((reply?.usage ?? []).map((row) => [row.vendor, row.name]))
  const lead =
    (ctx ? `${ctx.label} ${ctx.percentText}`.length + BAR_CELLS + GAP_CELLS : 0) +
    (tok ? `${tok.label} ${tok.text}`.length + GAP_CELLS : 0)
  const footerChips = (rows: readonly UsageRow[], budget: number, forceCompact = false) =>
    buildFooterChips({
      usage: new Map(rows.map((row) => [row.vendor, { capturedAt: row.capturedAt, windows: row.windows }])),
      budget,
      nowMs: Date.now(),
      vendorLabel: (vendor) => names.get(vendor) ?? vendor,
      forceCompact,
    })
  // Each vendor gap is wider in CSS than the TUI's 2 cells; one cell per vendor covers it. The full form
  // draws a bar per window; the compact form draws none, so it gets the room back.
  const rows = reply?.usage ?? []
  const room = cells - lead - rows.length
  const bars = rows.reduce((sum, row) => sum + row.windows.length, 0) * BAR_CELLS
  const fitted = rows.length ? footerChips(rows, room - bars) : null
  const quota = fitted?.form === "compact" ? footerChips(rows, room, true) : fitted
  return (
    <span className="usage" ref={box}>
      {ctx && (
        <span className="usage-chip">
          <span>{ctx.label}</span>
          <UsageBar percentText={ctx.percentText} tone={ctx.tone} />
          <span className={`tone-${ctx.tone}`}>{ctx.percentText}</span>
        </span>
      )}
      {tok && (
        <span className="usage-chip">
          {tok.label} {tok.text}
        </span>
      )}
      {quota?.form === "full" &&
        quota.vendors.map((vendor) => (
          <span key={vendor.vendor} className="usage-chip">
            <span>{vendor.vendor}</span>
            {vendor.chips.map((chip) => (
              <span key={chip.label}>
                {" "}
                {chip.label}
                <UsageBar percentText={chip.percentText} tone={chip.tone} />
                <span className={`tone-${chip.tone}`}>{chip.percentText}</span>
                {chip.resetText ? ` ${chip.resetText}` : ""}
              </span>
            ))}
          </span>
        ))}
      {quota?.form === "compact" &&
        quota.vendors.map((vendor) => (
          <span key={vendor.vendor} className="usage-chip">
            {vendor.vendor} <span className={`tone-${vendor.tone}`}>{vendor.percentText}</span>
          </span>
        ))}
    </span>
  )
}
