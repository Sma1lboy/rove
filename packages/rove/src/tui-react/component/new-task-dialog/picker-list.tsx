/** @jsxImportSource @opentui/react */
/**
 * Windowed picker list + field-label styling for all four new-task pickers.
 * Callers supply pre-windowed rows and a pick handler; the list owns the
 * cursor arrow, bold and "↑/↓ N more" lines.
 */

import { type BoxRenderable, TextAttributes } from "@opentui/core"
import type { ReactNode } from "react"
import type { PickerWindow } from "../../../tui/component/new-task-dialog/state"
import { useTheme } from "../../context/theme"
import { useT } from "../../i18n"
import { useDialogFocus } from "../../ui/dialog-body"

/** One visible picker row — body text plus an accent (selected) flag. */
export type PickerRow = {
  readonly key: string
  readonly body: string
  /** Non-cursor rows render accent (selected) instead of muted. */
  readonly accent?: boolean
  /**
   * Trailing text, always muted, pushed to the RIGHT edge. For rows whose body
   * IDENTIFIES and tail LOCATES (repo basename + directory): cursor emphasis
   * lands on the name alone, and names and directories form two columns.
   */
  readonly dim?: string
}

function PickerItem(props: { focused: boolean; children: ReactNode }) {
  const focus = useDialogFocus<BoxRenderable>(props.focused)
  return (
    <box {...focus} flexShrink={0}>
      {props.children}
    </box>
  )
}

/** A pinned row rendered above or below the windowed slice, addressed by its absolute cursor index. */
export type PinnedPickerRow = PickerRow & { readonly index: number }

function PickerRowView(props: {
  row: PickerRow
  absoluteIndex: number
  isCursor: boolean
  focused: boolean
  onPick: (absoluteIndex: number) => void
}) {
  const { theme } = useTheme()
  const { row, absoluteIndex, isCursor, focused, onPick } = props
  const fg = isCursor ? theme.primary : row.accent ? theme.accent : theme.textMuted
  const attributes = isCursor ? TextAttributes.BOLD : undefined
  // No `dim` = ONE text node: two nodes in a flex row measure and clip differently.
  if (!row.dim) {
    return (
      <PickerItem focused={isCursor && focused}>
        <text fg={fg} attributes={attributes} wrapMode="none" onMouseUp={() => onPick(absoluteIndex)}>
          {isCursor ? "▸ " : "  "}
          {row.body}
        </text>
      </PickerItem>
    )
  }
  return (
    <PickerItem focused={isCursor && focused}>
      <box flexDirection="row" onMouseUp={() => onPick(absoluteIndex)}>
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
    </PickerItem>
  )
}

export function PickerList(props: {
  window: PickerWindow
  cursor: number
  focused?: boolean
  /** Offset added to `window.start + i` when pinned rows precede the windowed slice. */
  indexOffset?: number
  /** Rows pinned above the windowed slice (always visible, e.g. `No folder`). */
  pinnedTop?: readonly PinnedPickerRow[]
  /** Pre-windowed rows; same length/order as `window.items`. */
  rows: readonly PickerRow[]
  /** Rows pinned below the windowed slice (always visible, e.g. `+ Open folder…`). */
  pinnedBottom?: readonly PinnedPickerRow[]
  onPick: (absoluteIndex: number) => void
  /** Extra line under the list (e.g. the adopt "N selected" hint). */
  footer?: ReactNode
  paddingBottom?: number
}) {
  const { theme } = useTheme()
  const t = useT()
  const listFocused = props.focused !== false
  const focus = useDialogFocus<BoxRenderable>(listFocused)
  const offset = props.indexOffset ?? 0
  const below = props.window.total - props.window.start - props.window.items.length
  return (
    <box {...focus} gap={0} flexShrink={0} paddingLeft={2} paddingBottom={props.paddingBottom}>
      {props.pinnedTop?.map((row) => (
        <PickerRowView
          key={row.key}
          row={row}
          absoluteIndex={row.index}
          isCursor={row.index === props.cursor}
          focused={listFocused}
          onPick={props.onPick}
        />
      ))}
      {props.window.start > 0 ? (
        <text fg={theme.textMuted} wrapMode="none">
          {t("newTask.picker.moreAbove", { count: props.window.start })}
        </text>
      ) : null}
      {props.rows.map((row, i) => {
        const absoluteIndex = offset + props.window.start + i
        return (
          <PickerRowView
            key={row.key}
            row={row}
            absoluteIndex={absoluteIndex}
            isCursor={absoluteIndex === props.cursor}
            focused={listFocused}
            onPick={props.onPick}
          />
        )
      })}
      {below > 0 ? (
        <text fg={theme.textMuted} wrapMode="none">
          {t("newTask.picker.moreBelow", { count: below })}
        </text>
      ) : null}
      {props.pinnedBottom?.map((row) => (
        <PickerRowView
          key={row.key}
          row={row}
          absoluteIndex={row.index}
          isCursor={row.index === props.cursor}
          focused={listFocused}
          onPick={props.onPick}
        />
      ))}
      {props.footer}
    </box>
  )
}
