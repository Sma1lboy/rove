/** @jsxImportSource @opentui/react */
/**
 * Toast overlay: bottom-right cards, newest at the bottom, up to three, click
 * to dismiss. Each card: semantic-colored left accent bar, title row with
 * glyph, optional muted body line. Auto-dismiss timers belong to the
 * notifications context.
 */

import { TextAttributes } from "@opentui/core"
import { charWidth } from "../../lib/display-width"
import type { Toast } from "../../tui/lib/notify-state"
import { truncateEndCells } from "../../tui/lib/truncate"
import { useNotifications } from "../context/notifications"
import { useTheme } from "../context/theme"
import { useTerminalDimensions } from "../lib/use-terminal-dimensions"

const MAX_VISIBLE = 3
const CARD_WIDTH = 44
const RIGHT_MARGIN = 2
const BOTTOM_MARGIN = 2
/** Rows per card incl. the stack gap: accent-bar card is 1 or 2 rows + 1 gap. */
function cardRows(toast: Toast): number {
  return (toast.body ? 2 : 1) + 1
}

export function ToastOverlay() {
  const { theme } = useTheme()
  const dims = useTerminalDimensions()
  const notif = useNotifications()

  if (notif.toasts.length === 0) return null
  const visibleToasts = notif.toasts.slice(-MAX_VISIBLE)

  // Absolute, bottom-right; `zIndex` above panes, below the dialog backdrop (3000).
  const stackRows = visibleToasts.reduce((rows, toast) => rows + cardRows(toast), 0)
  // Clamp so a narrow terminal doesn't push the card across the neighbour pane.
  const cardWidth = Math.min(CARD_WIDTH, Math.max(12, dims.width - RIGHT_MARGIN * 2))
  const left = Math.max(0, dims.width - cardWidth - RIGHT_MARGIN)
  const top = Math.max(0, dims.height - BOTTOM_MARGIN - stackRows)
  // Inner text budget: accent bar (1) + card padding (2) = 3; the title row
  // spends 2 more on its glyph, the body row 2 on its indent — same number.
  const textBudget = cardWidth - 5

  return (
    <box position="absolute" zIndex={2500} left={left} top={top} width={cardWidth} flexDirection="column" gap={1}>
      {visibleToasts.map((toast) => {
        const accent =
          toast.kind === "needs_input" ? theme.warning : toast.kind === "error" ? theme.error : theme.success
        const glyph = toast.kind === "needs_input" ? "?" : toast.kind === "error" ? "✕" : "✓"
        return (
          <box
            key={toast.id}
            flexDirection="row"
            backgroundColor={theme.backgroundElement}
            onMouseUp={() => notif.dismiss(toast.id)}
          >
            {/* Semantic accent bar — the Inbox selection-bar language. */}
            <box flexDirection="column" flexShrink={0}>
              <text fg={accent} wrapMode="none">
                ▌
              </text>
              {toast.body ? (
                <text fg={accent} wrapMode="none">
                  ▌
                </text>
              ) : null}
            </box>
            <box flexDirection="column" flexBasis={0} flexGrow={1} flexShrink={1} paddingLeft={1} paddingRight={1}>
              <box flexDirection="row">
                <text fg={accent} attributes={TextAttributes.BOLD} wrapMode="none" flexShrink={0}>
                  {`${glyph} `}
                </text>
                <text
                  fg={theme.text}
                  attributes={TextAttributes.BOLD}
                  wrapMode="none"
                  flexBasis={0}
                  flexGrow={1}
                  flexShrink={1}
                >
                  {truncateEndCells(toast.title, textBudget, charWidth)}
                </text>
              </box>
              {toast.body ? (
                <box flexDirection="row" paddingLeft={2}>
                  <text fg={theme.textMuted} wrapMode="none" flexBasis={0} flexGrow={1} flexShrink={1}>
                    {truncateEndCells(toast.body, textBudget, charWidth)}
                  </text>
                </box>
              ) : null}
            </box>
          </box>
        )
      })}
    </box>
  )
}
