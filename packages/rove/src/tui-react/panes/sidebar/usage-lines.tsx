/** @jsxImportSource @opentui/react */
/**
 * Each engine's quota in the rail's foot, one line apiece as the web draws it:
 * its name, a fill line and the tightest window's figure (`Claude ━━━━━━━ 5h 42%`).
 * A vendor with no reading draws nothing, never 0.
 */

import type { UsageSnapshotMap } from "@sma1lboy/rove-client/client/remote-orchestrator-payloads.ts"
import { engineDisplayName } from "@sma1lboy/rove-core/engine/interactive-command.ts"
import { displayWidth } from "@sma1lboy/rove-core/lib/display-width.ts"
import type { ReadableState } from "@sma1lboy/rove-core/lib/external-store.ts"
import { narrowUsageChip } from "@sma1lboy/rove-core/lib/usage-core.ts"
import { USAGE_SHOW_KEY, normalizeUsageShow } from "@sma1lboy/rove-core/state/usage-show.ts"
import { useOptionalKV } from "../../context/kv"
import { useTheme } from "../../context/theme"
import { useAccessor } from "../../lib/use-accessor"

const BAR = "━"
/** Below this many cells the fill line says nothing; the figure stands alone. */
const MIN_BAR = 4

export function SidebarUsageLines(props: { usage: ReadableState<UsageSnapshotMap | null>; width: number }) {
  const { theme } = useTheme()
  const usage = useAccessor(props.usage)
  const show = normalizeUsageShow(useOptionalKV()?.get(USAGE_SHOW_KEY, undefined))
  const now = Date.now()
  const lines = [...(usage ?? [])].flatMap(([vendor, reading]) => {
    const chip = narrowUsageChip(reading, now, show)
    return chip ? [{ vendor, name: engineDisplayName(vendor), figure: `${chip.label} `, chip }] : []
  })
  if (lines.length === 0) return null
  const toneColor = { ok: theme.success, warn: theme.warning, crit: theme.error } as const
  const nameCells = Math.max(...lines.map((line) => displayWidth(line.name)))
  const figureCells = Math.max(...lines.map((line) => displayWidth(line.figure) + displayWidth(line.chip.percentText)))
  const barCells = props.width - 2 - nameCells - figureCells - 2
  return (
    <box flexShrink={0} flexDirection="column" paddingLeft={1} paddingRight={1}>
      {lines.map(({ vendor, name, figure, chip }) => {
        const filled = Math.round(
          (barCells * Math.min(100, Math.max(0, Number.parseInt(chip.percentText, 10) || 0))) / 100,
        )
        return (
          <box key={vendor} flexDirection="row" gap={1}>
            <text fg={theme.textMuted} wrapMode="none" width={nameCells} flexShrink={0}>
              {name}
            </text>
            {barCells >= MIN_BAR ? (
              <text wrapMode="none" flexShrink={0}>
                <span fg={toneColor[chip.tone]}>{BAR.repeat(filled)}</span>
                <span fg={theme.border}>{BAR.repeat(barCells - filled)}</span>
              </text>
            ) : (
              <box flexGrow={1} />
            )}
            <text wrapMode="none" flexShrink={0} width={figureCells}>
              <span fg={theme.textMuted}>{figure.padStart(figureCells - displayWidth(chip.percentText))}</span>
              <span fg={toneColor[chip.tone]}>{chip.percentText}</span>
            </text>
          </box>
        )
      })}
    </box>
  )
}
