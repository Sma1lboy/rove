/** @jsxImportSource @opentui/react */
/**
 * Shared windowed picker list + field-label styling for the new-task dialog.
 * All four pickers (repo, branch, clone parent, adopt) render their
 * "↑ N more / rows / ↓ N more" block through this one component — callers
 * supply the pre-windowed row bodies and pick handler, the list owns the
 * cursor arrow, bold, and overflow lines.
 */

import { TextAttributes } from "@opentui/core"
import type { ReactNode } from "react"
import type { PickerWindow } from "../../../tui/component/new-task-dialog/state"
import { useTheme } from "../../context/theme"
import { useT } from "../../i18n"

/** One visible picker row — body text plus an accent (selected) flag. */
export type PickerRow = {
  readonly key: string
  readonly body: string
  /** Non-cursor rows render accent (selected) instead of muted. */
  readonly accent?: boolean
  /**
   * Trailing text always painted muted and pushed to the row's RIGHT edge,
   * whatever the row's own state. For a row whose body is the part that
   * IDENTIFIES the item and whose tail merely LOCATES it (the repo picker's
   * basename + directory), so the cursor's bold/primary lands on the name
   * alone instead of dragging a shared path prefix into the emphasis with it,
   * and the names line up in one column with the directories in another.
   */
  readonly dim?: string
}

export function PickerList(props: {
  window: PickerWindow
  cursor: number
  /** Pre-windowed rows; same length/order as `window.items`. */
  rows: readonly PickerRow[]
  onPick: (absoluteIndex: number) => void
  /** Extra line under the list (e.g. the adopt "N selected" hint). */
  footer?: ReactNode
  paddingBottom?: number
}) {
  const { theme } = useTheme()
  const t = useT()
  const below = props.window.total - props.window.start - props.window.items.length
  return (
    <box gap={0} paddingLeft={2} paddingBottom={props.paddingBottom}>
      {props.window.start > 0 ? (
        <text fg={theme.textMuted} wrapMode="none">
          {t("newTask.picker.moreAbove", { count: props.window.start })}
        </text>
      ) : null}
      {props.rows.map((row, i) => {
        const absoluteIndex = props.window.start + i
        const isCursor = absoluteIndex === props.cursor
        const fg = isCursor ? theme.primary : row.accent ? theme.accent : theme.textMuted
        const attributes = isCursor ? TextAttributes.BOLD : undefined
        // A row with no `dim` stays ONE text node: two nodes in a flex row
        // measure and clip differently, so splitting every row would change
        // the layout of the three pickers that pass no tail.
        if (!row.dim) {
          return (
            <text
              key={row.key}
              fg={fg}
              attributes={attributes}
              wrapMode="none"
              onMouseUp={() => props.onPick(absoluteIndex)}
            >
              {isCursor ? "▸ " : "  "}
              {row.body}
            </text>
          )
        }
        return (
          <box key={row.key} flexDirection="row" onMouseUp={() => props.onPick(absoluteIndex)}>
            <text fg={fg} attributes={attributes} wrapMode="none" flexShrink={0}>
              {isCursor ? "▸ " : "  "}
              {row.body}
            </text>
            {/* Right-aligned by a growing spacer, not by padding the string:
                the gap is whatever the row has left over, so the tails share
                one right edge however ragged the names are. */}
            <box flexGrow={1} />
            {/* The tail is the first thing to go on a narrow card: it is the
                half the row can lose and still be identifiable.
                The separating space is INSIDE the text, not `paddingLeft`:
                padding is part of the box being shrunk, so on a row wide
                enough to close the gap it went to zero and the body ran
                straight into the directory (`…(current dir)/var/folders/…`).
                A leading space in the string shrinks with the string. */}
            <text fg={theme.textMuted} wrapMode="none" flexShrink={1}>
              {` ${row.dim}`}
            </text>
          </box>
        )
      })}
      {below > 0 ? (
        <text fg={theme.textMuted} wrapMode="none">
          {t("newTask.picker.moreBelow", { count: below })}
        </text>
      ) : null}
      {props.footer}
    </box>
  )
}
