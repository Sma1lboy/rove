/**
 * The usage lines, as the TUI's `host-footer.tsx`: `ctx 62%` and `Σ 45k` for the selected session,
 * then each engine's quota under the engine's own name (`Claude 11%  Codex 24%`). Figures and tones
 * come from the TUI's own `usage-core.ts`; a missing reading draws nothing, never 0.
 */

import {
  contextChip,
  narrowUsageChip,
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
  inset = true,
}: {
  client: BridgeClient
  taskId: string | null
  tabId: string | null
  /** The rail's 14px side padding; Settings' sheet already has its own, so it passes false. */
  inset?: boolean
}) {
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
  const now = Date.now()
  // The engine's own name, as the daemon sends it; the session window's reading, else its first.
  const quota = (reply?.usage ?? []).flatMap((row) => {
    const chip = narrowUsageChip({ capturedAt: row.capturedAt, windows: row.windows }, now)
    return chip ? [{ vendor: row.vendor, name: row.name, chip }] : []
  })
  if (!ctx && !tok && quota.length === 0) return null
  return (
    <div className={`${USAGE_QUIET} ${inset ? "px-3.5" : ""}`}>
      {ctx && (
        <span className={USAGE_CHIP}>
          <span>{ctx.label}</span>
          <UsageBar percentText={ctx.percentText} tone={ctx.tone} />
          <span className={USAGE_TONE[ctx.tone]}>{ctx.percentText}</span>
        </span>
      )}
      {tok && (
        <span className={USAGE_CHIP}>
          <span>{tok.label}</span>
          <span className="text-muted">{tok.text}</span>
        </span>
      )}
      {quota.map(({ vendor, name, chip }) => (
        // The window and its reset, numbers only: `Claude · 5h 56% → 14:00`.
        <span
          key={vendor}
          className={USAGE_CHIP}
          title={`${name} · ${chip.label} ${chip.percentText} ${chip.resetText}`.trim()}
        >
          <span>{name}</span>
          <span className={USAGE_TONE[chip.tone]}>{chip.percentText}</span>
        </span>
      ))}
    </div>
  )
}
