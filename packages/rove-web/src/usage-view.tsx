/**
 * Each engine's quota, one line apiece: its own name, a thin fill line and the window's figure
 * (`Claude ━━━━━━━ 7d 100%`). Figures and tones come from the TUI's own `usage-core.ts`; a missing
 * reading draws nothing, never 0. The session's context lives in the side panel's Context tab.
 */

import { narrowUsageChip } from "@sma1lboy/rove/src/tui-react/component/settings-dialog/usage-core.ts"
import { type CSSProperties, useEffect, useState } from "react"
import type { BridgeClient } from "./bridge.ts"
import { everyVisible } from "./every-visible.ts"
import { t } from "./i18n/index.ts"
import { openPage } from "./layout.ts"
import { useStore } from "./store.ts"
import { closeDialog } from "./ui.ts"
import { Button } from "./ui/button.tsx"
import { USAGE_LINE, USAGE_LINES, USAGE_TONE, usageBar } from "./ui/shell.ts"

/** The daemon publishes as engines report; the TUI reads a pushed signal, the page polls. */
const POLL_MS = 10_000

interface UsageRow {
  readonly vendor: string
  readonly name: string
  readonly capturedAt: number
  readonly windows: readonly { kind: string; label: string; percent: number; resetsAt: number | null }[]
}

export function UsageChips({
  client,
  inset = true,
}: {
  client: BridgeClient
  /** In the rail's foot: the Settings row's own side padding, so both share a left edge. Settings' sheet passes false. */
  inset?: boolean
}) {
  const conn = useStore(client.conn)
  const [usage, setUsage] = useState<readonly UsageRow[] | null>(null)
  useEffect(() => {
    if (conn.state !== "open") return
    let live = true
    const load = () =>
      client
        .request<{ usage: readonly UsageRow[] | null }>("usage.get", {})
        .then((r) => {
          if (live) setUsage(r.usage)
        })
        .catch(() => {})
    void load()
    const stop = everyVisible(POLL_MS, load)
    return () => {
      live = false
      stop()
    }
  }, [client, conn.state])

  const now = Date.now()
  // The engine's own name, as the daemon sends it; the session window's reading, else its first.
  const quota = (usage ?? []).flatMap((row) => {
    const chip = narrowUsageChip({ capturedAt: row.capturedAt, windows: row.windows }, now)
    return chip ? [{ vendor: row.vendor, name: row.name, chip }] : []
  })
  if (quota.length === 0) return null
  return (
    <div className={`${USAGE_LINES} ${inset ? "px-2" : ""}`}>
      {quota.map(({ vendor, name, chip }) => {
        const fill = Math.min(100, Math.max(0, Number.parseInt(chip.percentText, 10) || 0))
        return (
          // A click opens the Usage page, whatever surface the line sits on (Settings' sheet closes first).
          <Button
            variant="row"
            key={vendor}
            className={USAGE_LINE}
            title={`${name} · ${chip.label} ${chip.percentText} ${chip.resetText}`.trim()}
            aria-label={`${t("usage.open")}: ${name}`}
            onClick={() => {
              closeDialog()
              openPage("usage")
            }}
          >
            <span className="truncate">{name}</span>
            <span className={usageBar(chip.tone)} style={{ "--fill": `${fill}%` } as CSSProperties} />
            {/* Which window the figure is (`7d`, `5h`): a bare `100%` does not say. */}
            <span>
              {chip.label} <span className={USAGE_TONE[chip.tone]}>{chip.percentText}</span>
            </span>
          </Button>
        )
      })}
    </div>
  )
}
