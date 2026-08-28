/** @jsxImportSource @opentui/react */
/**
 * Toast overlay (React port of `src/tui/component/toast-overlay.tsx`,
 * issue #15 G3) — bottom-right transient cards, newest at the bottom, up
 * to three visible, click to dismiss early. Each toast is a framed card:
 * a semantic-colored left accent bar (the Inbox selection-bar language,
 * not a full border frame), a title row with the status glyph, and an
 * optional muted body line for context (task title, project). Auto-dismiss
 * timers stay owned by the notifications context.
 */

import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/react"
import { charWidth } from "../../lib/display-width"
import type { Toast } from "../../tui/lib/notify-state"
import { truncateEndCells } from "../../tui/lib/truncate"
import { useNotifications } from "../context/notifications"
import { useTheme } from "../context/theme"

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

  // Anchor the stack to the bottom-right corner. Position is absolute so
  // the overlay sits on top of the layout without taking flow space;
  // `zIndex` keeps it above the panes but below the dialog backdrop (3000).
  const stackRows = visibleToasts.reduce((rows, toast) => rows + cardRows(toast), 0)
  // On a terminal narrower than the card the stack used to poke left across
  // the neighbouring pane — clamp to what actually fits.
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
