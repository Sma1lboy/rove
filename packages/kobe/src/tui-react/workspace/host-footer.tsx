/** @jsxImportSource @opentui/react */
/**
 * The workspace's bottom line: per-vendor subscription quota on the left,
 * e.g. `CLAUDE 5h 42% → 14:00 · 7d 12%   CODEX 7d 47% → 8/4 06:00`, and the
 * keyboard micro-hint (`⌃ A commands · F1 help`) on the right.
 *
 * Usage is snapshot-only — this pane never fetches. It renders whatever the
 * daemon's quota cache last pushed on `usage.snapshot` (slow poll + backoff,
 * see kobe-daemon/src/daemon/quota-usage-cache.ts); a vendor with no
 * readable login simply never appears. The hint resolves through the live
 * keymap/reachability (component/keyboard-hints.tsx). With no vendors AND
 * the hint muted, the row is not rendered, so nothing shifts on terminals
 * that have nothing to show.
 *
 * Both halves share ONE 1-cell row, and the chips are the yielding half:
 * their box shrinks + clips and the chip view model is built against an
 * explicit cell budget (usage-core's buildFooterChips), so an 80-col
 * terminal degrades to compact chips instead of colliding with the hint bar.
 *
 * `WorkspaceFrame` owns the column wrapper, for the same reason as
 * `host-sidebar.tsx`: the host composes the workspace's regions and each
 * region owns how it renders itself.
 */

import { useTerminalDimensions } from "@opentui/react"
import type { ReactNode } from "react"
import type { RemoteOrchestrator } from "../../client/remote-orchestrator"
import { engineDisplayName } from "../../engine/interactive-command"
import { displayWidth } from "../../lib/display-width"
import { StatusKeyHintBar, useStatusKeyHintItems } from "../component/keyboard-hints"
import { buildFooterChips, usageChipsBudget } from "../component/settings-dialog/usage-core"
import { ShortcutRevealProvider } from "../component/shortcut-reveal"
import { useTheme } from "../context/theme"
import { isNarrowWidth } from "../lib/narrow-mode"
import { useAccessor } from "../lib/use-accessor"

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
  /** Top-of-window strip (the daemon-down banner) — rendered above the pane
   *  row. The host owns it because the surfaces that BYPASS this frame
   *  (settings, worktrees, update) need the same strip. */
  banner?: ReactNode
  children: ReactNode
}) {
  const { theme } = useTheme()
  const dims = useTerminalDimensions()
  const narrow = isNarrowWidth(dims.width)
  const usage = useAccessor(props.orchestrator.usageSnapshotSignal())
  // The same options the bar below renders with — the budget must measure
  // the bar that is actually on screen (compact drops the [settings] chip).
  const hintItems = useStatusKeyHintItems({
    onOpenSettings: narrow ? undefined : props.onOpenSettings,
    compact: narrow,
  })
  const footerVisible = (usage != null && usage.size > 0) || hintItems.length > 0
  const hintCells = hintItems.reduce((sum, item, index) => sum + displayWidth(item.text) + (index > 0 ? 3 : 0), 0)
  const chipsBudget = usageChipsBudget({ terminalWidth: dims.width, hintCells })
  return (
    <ShortcutRevealProvider>
      <box flexDirection="column" flexGrow={1} backgroundColor={theme.background}>
        {props.banner}
        <box flexDirection="row" flexGrow={1}>
          {props.children}
        </box>
        {footerVisible ? (
          <box flexDirection="row" flexShrink={0} height={1} paddingLeft={1} paddingRight={1} gap={2}>
            {/* The chips yield first: shrink + clip is the hard guarantee,
                the budget-truncated view model the graceful one. */}
            <box flexGrow={1} flexShrink={1} flexDirection="row" overflow="hidden">
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
