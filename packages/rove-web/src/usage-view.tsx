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
import { useEffect, useState } from "react"
import type { BridgeClient } from "./bridge.ts"
import { useStore } from "./store.ts"

/** The daemon publishes as engines report; the TUI reads a pushed signal, the page polls. */
const POLL_MS = 10_000

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
  const quota = reply?.usage?.length
    ? buildFooterChips({
        usage: new Map(reply.usage.map((row) => [row.vendor, { capturedAt: row.capturedAt, windows: row.windows }])),
        budget: Number.POSITIVE_INFINITY,
        nowMs: Date.now(),
        vendorLabel: (vendor) => names.get(vendor) ?? vendor,
      })
    : null
  return (
    <span className="usage">
      {ctx && (
        <span className="usage-chip">
          <span>{ctx.label}</span> <span className={`tone-${ctx.tone}`}>{ctx.percentText}</span>
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
            {vendor.chips.map((chip, i) => (
              <span key={chip.label}>
                {" "}
                {i === 0 ? chip.label : `· ${chip.label}`}{" "}
                <span className={`tone-${chip.tone}`}>{chip.percentText}</span>
                {chip.resetText ? ` ${chip.resetText}` : ""}
              </span>
            ))}
          </span>
        ))}
    </span>
  )
}
