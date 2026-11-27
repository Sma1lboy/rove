/** @jsxImportSource @opentui/react */
/**
 * The workspace's bottom line: the active session's context meter on the left,
 * key hint (`⌃ A commands · F1 help`) on the right. Nothing to show → no row.
 * Quota and Settings live in the rail's foot.
 */

import type { ReactNode } from "react"
import type { RemoteOrchestrator } from "../../client/remote-orchestrator"
import { USAGE_SHOW_KEY, normalizeUsageShow } from "../../state/usage-show"
import { StatusKeyHintBar, useStatusKeyHintItems } from "../component/keyboard-hints"
import { contextChip } from "../component/settings-dialog/usage-core"
import { ShortcutRevealProvider } from "../component/shortcut-reveal"
import { useOptionalKV } from "../context/kv"
import { useTheme } from "../context/theme"
import { isNarrowWidth } from "../lib/narrow-mode"
import { useAccessor } from "../lib/use-accessor"
import { useTerminalSize } from "../lib/use-terminal-size"

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

/** Sidebar | workspace | files row, with the context + key-hint line under it. */
export function WorkspaceFrame(props: {
  orchestrator: RemoteOrchestrator
  /** Wires a clickable [settings] hint; the workspace leaves it off, Settings being a rail row. */
  onOpenSettings?: () => void
  /** The tab the context meter reads — the workspace's active engine session. */
  activeTaskId?: string | null
  activeTabId?: string | null
  /** Top-of-window banner; host-owned because frame-bypassing pages need it too. */
  banner?: ReactNode
  /** Drawn over the panes' top border at its right end (the Files button). */
  topBar?: ReactNode
  /** Drag handler on the row HOLDING the panes: opentui captures the pointer
   *  to whatever is under it on first motion, so only an ancestor of every
   *  pane hears the whole drag (`sidebar-resize-gesture.ts`). */
  onPaneDrag?: (event: { readonly x: number }) => void
  onPaneRelease?: () => void
  children: ReactNode
}) {
  const { theme } = useTheme()
  const dims = useTerminalSize()
  const narrow = isNarrowWidth(dims.width)
  const context = useAccessor(props.orchestrator.contextUsageSignal())
  const usageEntry =
    props.activeTaskId && props.activeTabId ? context?.get(`${props.activeTaskId}::${props.activeTabId}`) : undefined
  const usageShow = normalizeUsageShow(useOptionalKV()?.get(USAGE_SHOW_KEY, undefined))
  const ctxChip = contextChip(usageEntry, usageShow)
  const hintItems = useStatusKeyHintItems({
    onOpenSettings: narrow ? undefined : props.onOpenSettings,
    compact: narrow,
  })
  const footerVisible = ctxChip !== null || hintItems.length > 0
  return (
    <ShortcutRevealProvider>
      <box flexDirection="column" flexGrow={1} backgroundColor={theme.background}>
        {props.banner}
        <box flexDirection="row" flexGrow={1} onMouseDrag={props.onPaneDrag} onMouseUp={props.onPaneRelease}>
          {props.children}
          {props.topBar}
        </box>
        {footerVisible ? (
          <box flexDirection="row" flexShrink={0} height={1} paddingLeft={1} paddingRight={1} gap={2}>
            <box flexGrow={1} flexShrink={1} flexDirection="row" gap={2} overflow="hidden">
              <ContextChip chip={ctxChip} />
            </box>
            {/* Narrow drops the verbs and the [settings] chip: `⌃A · F1`. */}
            <StatusKeyHintBar onOpenSettings={narrow ? undefined : props.onOpenSettings} compact={narrow} />
          </box>
        ) : null}
      </box>
    </ShortcutRevealProvider>
  )
}
