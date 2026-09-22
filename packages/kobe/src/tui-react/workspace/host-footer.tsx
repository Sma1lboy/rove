/** @jsxImportSource @opentui/react */
/**
 * The workspace's bottom line: per-vendor quota on the left
 * (`CLAUDE 5h 42% → 14:00 · 7d 12%`), key hint (`⌃ A commands · F1 help`)
 * on the right. Quota is snapshot-only (the daemon's `usage.snapshot`); a
 * vendor with no readable login never appears. Nothing to show → no row.
 *
 * One 1-cell row; the chips yield: built against an explicit cell budget
 * (`buildFooterChips`), so 80 columns degrade to compact chips.
 */

import { useTerminalDimensions } from "@opentui/react"
import type { ReactNode } from "react"
import type { RemoteOrchestrator } from "../../client/remote-orchestrator"
import { engineDisplayName } from "../../engine/interactive-command"
import { displayWidth } from "../../lib/display-width"
import { StatusKeyHintBar, useStatusKeyHintItems } from "../component/keyboard-hints"
import {
  buildFooterChips,
  contextChip,
  tokenTotalChip,
  usageChipsBudget,
} from "../component/settings-dialog/usage-core"
import { ShortcutRevealProvider } from "../component/shortcut-reveal"
import { useTheme } from "../context/theme"
import { isNarrowWidth } from "../lib/narrow-mode"
import { useAccessor } from "../lib/use-accessor"

/**
 * Context-window meter. Resolved by `WorkspaceFrame`, which decides whether
 * the row exists, so a reading keeps the row alive. Null (no reading) is
 * absence, never `0%`.
 */
function ContextChip(props: { chip: ReturnType<typeof contextChip> }) {
  const { theme } = useTheme()
  const chip = props.chip
  if (!chip) return null
  const toneColor = { ok: theme.success, warn: theme.warning, crit: theme.error } as const
  return (
    <box flexDirection="row" gap={1} flexShrink={0}>
      <text fg={theme.textMuted} wrapMode="none">
        {chip.label}
      </text>
      <text fg={toneColor[chip.tone]} wrapMode="none">
        {chip.percentText}
      </text>
    </box>
  )
}

/** Session token total. Muted: a record, not a budget. Null → nothing, never `0`. */
function TokenChip(props: { chip: ReturnType<typeof tokenTotalChip> }) {
  const { theme } = useTheme()
  const chip = props.chip
  if (!chip) return null
  return (
    <box flexDirection="row" gap={1} flexShrink={0}>
      <text fg={theme.textMuted} wrapMode="none">
        {chip.label}
      </text>
      <text fg={theme.textMuted} wrapMode="none">
        {chip.text}
      </text>
    </box>
  )
}

function UsageChips(props: { orchestrator: RemoteOrchestrator; narrow: boolean; budget: number }) {
  const { theme } = useTheme()
  const usage = useAccessor(props.orchestrator.usageSnapshotSignal())
  const toneColor = { ok: theme.success, warn: theme.warning, crit: theme.error } as const
  const now = Date.now()
  const view =
    usage && usage.size > 0
      ? buildFooterChips({
          usage,
          budget: props.budget,
          nowMs: now,
          vendorLabel: engineDisplayName,
          forceCompact: props.narrow,
        })
      : null
  if (!view) return null
  if (view.form === "full") {
    return (
      <box flexDirection="row" gap={2}>
        {view.vendors.map((vendor) => (
          <box key={vendor.vendor} flexDirection="row" gap={1}>
            <text fg={theme.textMuted} wrapMode="none">
              {vendor.vendor}
            </text>
            {vendor.chips.map((chip, i) => (
              <box key={chip.label} flexDirection="row" gap={1}>
                <text fg={theme.textMuted} wrapMode="none">
                  {i === 0 ? chip.label : `· ${chip.label}`}
                </text>
                <text fg={toneColor[chip.tone]} wrapMode="none">
                  {chip.percentText}
                </text>
                {chip.resetText ? (
                  <text fg={theme.textMuted} wrapMode="none">
                    {chip.resetText}
                  </text>
                ) : null}
              </box>
            ))}
          </box>
        ))}
      </box>
    )
  }
  // Compact form (also the narrow-footer form): vendor + tone percent only.
  return (
    <box flexDirection="row" gap={2}>
      {view.vendors.map((vendor, index) => (
        <box key={`${vendor.vendor}-${index}`} flexDirection="row" gap={1}>
          <text fg={theme.textMuted} wrapMode="none">
            {vendor.vendor}
          </text>
          <text fg={toneColor[vendor.tone]} wrapMode="none">
            {vendor.percentText}
          </text>
        </box>
      ))}
    </box>
  )
}

/** Sidebar | workspace | files row, with the quota + key-hint line under it. */
export function WorkspaceFrame(props: {
  orchestrator: RemoteOrchestrator
  /** Wires the footer's clickable [settings] button; absent = no settings segment. */
  onOpenSettings?: () => void
  /** The tab the context meter reads — the workspace's active engine session. */
  activeTaskId?: string | null
  activeTabId?: string | null
  /** Top-of-window banner; host-owned because frame-bypassing pages need it too. */
  banner?: ReactNode
  /** Drag handler on the row HOLDING the panes: opentui captures the pointer
   *  to whatever is under it on first motion, so only an ancestor of every
   *  pane hears the whole drag (`sidebar-resize-gesture.ts`). */
  onPaneDrag?: (event: { readonly x: number }) => void
  onPaneRelease?: () => void
  children: ReactNode
}) {
  const { theme } = useTheme()
  const dims = useTerminalDimensions()
  const narrow = isNarrowWidth(dims.width)
  const usage = useAccessor(props.orchestrator.usageSnapshotSignal())
  const context = useAccessor(props.orchestrator.contextUsageSignal())
  const usageEntry =
    props.activeTaskId && props.activeTabId ? context?.get(`${props.activeTaskId}::${props.activeTabId}`) : undefined
  const ctxChip = contextChip(usageEntry)
  const tokChip = tokenTotalChip(usageEntry)
  // Same options as the rendered bar, so the budget measures what's on screen.
  const hintItems = useStatusKeyHintItems({
    onOpenSettings: narrow ? undefined : props.onOpenSettings,
    compact: narrow,
  })
  const footerVisible =
    (usage != null && usage.size > 0) || ctxChip !== null || tokChip !== null || hintItems.length > 0
  const hintCells = hintItems.reduce((sum, item, index) => sum + displayWidth(item.text) + (index > 0 ? 3 : 0), 0)
  // Reserved from the quota budget at max width (`ctx 100%~` + gap = 11), so
  // quota chips don't reflow as the percentage changes.
  const contextCells = 11
  // Max width (`Σ 999.9M` + gap), but only while shown: a standing 10 cells
  // pushes a 46-column footer over.
  const tokenCells = tokChip ? 10 : 0
  const chipsBudget = Math.max(
    0,
    usageChipsBudget({ terminalWidth: dims.width, hintCells }) - contextCells - tokenCells,
  )
  return (
    <ShortcutRevealProvider>
      <box flexDirection="column" flexGrow={1} backgroundColor={theme.background}>
        {props.banner}
        <box flexDirection="row" flexGrow={1} onMouseDrag={props.onPaneDrag} onMouseUp={props.onPaneRelease}>
          {props.children}
        </box>
        {footerVisible ? (
          <box flexDirection="row" flexShrink={0} height={1} paddingLeft={1} paddingRight={1} gap={2}>
            {/* The chips yield first: shrink + clip is the hard guarantee,
                the budget-truncated view model the graceful one. */}
            <box flexGrow={1} flexShrink={1} flexDirection="row" gap={2} overflow="hidden">
              <ContextChip chip={ctxChip} />
              <TokenChip chip={tokChip} />
              <UsageChips orchestrator={props.orchestrator} narrow={narrow} budget={chipsBudget} />
            </box>
            {/* Narrow drops the verbs and the [settings] chip: `⌃A · F1`. */}
            <StatusKeyHintBar onOpenSettings={narrow ? undefined : props.onOpenSettings} compact={narrow} />
          </box>
        ) : null}
      </box>
    </ShortcutRevealProvider>
  )
}
