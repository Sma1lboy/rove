/**
 * The usage lines, as the TUI's `host-footer.tsx`: `ctx 62%` and `Σ 45k` for the selected session,
 * then per-engine quota in the compact form (`CLAUDE 11% CODEX 24%`). Text and tones come from
 * the TUI's own `usage-core.ts`; a missing reading draws nothing, never 0.
 */

import {
  buildFooterChips,
  contextChip,
  tokenTotalChip,
} from "@sma1lboy/rove/src/tui-react/component/settings-dialog/usage-core.ts"
import { type CSSProperties, useEffect, useState } from "react"
import type { BridgeClient } from "./bridge.ts"
import { useStore } from "./store.ts"
import { USAGE_CHIP, USAGE_QUIET, USAGE_TONE, usageBar } from "./ui/shell.ts"

/** The daemon publishes as engines report; the TUI reads a pushed signal, the page polls. */
const POLL_MS = 10_000

/** The window's fill beside its percent; `percentText` is the TUI's `42%` / `42%~`. */
function UsageBar({ percentText, tone }: { percentText: string; tone: string }) {
  const percent = Math.min(100, Math.max(0, Number.parseInt(percentText, 10) || 0))
  return <span className={usageBar(tone)} style={{ "--fill": `${percent}%` } as CSSProperties} />
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
  const rows = reply?.usage ?? []
  // The line wraps instead of dropping engines, so the budget is unbounded.
  const quota = rows.length
    ? buildFooterChips({
        usage: new Map(rows.map((row) => [row.vendor, { capturedAt: row.capturedAt, windows: row.windows }])),
        budget: Number.POSITIVE_INFINITY,
        nowMs: Date.now(),
        vendorLabel: (vendor) => names.get(vendor) ?? vendor,
        forceCompact: true,
      })
    : null
  if (!ctx && !tok && quota?.form !== "compact") return null
  return (
    <div className={USAGE_QUIET}>
      {ctx && (
        <span className={USAGE_CHIP}>
          <span>{ctx.label}</span>
          <UsageBar percentText={ctx.percentText} tone={ctx.tone} />
          <span className={USAGE_TONE[ctx.tone]}>{ctx.percentText}</span>
        </span>
      )}
      {tok && (
        <span className={USAGE_CHIP}>
          {tok.label} {tok.text}
        </span>
      )}
      {quota?.form === "compact" &&
        quota.vendors.map((vendor) => (
          <span key={vendor.vendor} className={USAGE_CHIP}>
            {vendor.vendor} <span className={USAGE_TONE[vendor.tone]}>{vendor.percentText}</span>
          </span>
        ))}
    </div>
  )
}
